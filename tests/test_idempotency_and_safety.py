"""Tests for Side-Effect Safety & Deterministic Idempotency Keys (Task 20)."""

from __future__ import annotations

import asyncio
import pytest

from backend.agent.director import Director
from backend.agent.state import AgentState
from backend.runtime.types import ToolCall
from backend.security.confirmation import (
    ConfirmationService,
    GuardedConfirmationService,
)
from backend.tools.base import (
    RiskLevel,
    Tool,
    ToolContext,
    ToolResult,
    compute_idempotency_key,
)
from backend.tools.registry import ToolRegistry


def make_tool(name: str = "write_test", risk: RiskLevel = RiskLevel.MEDIUM, handler=None) -> Tool:
    async def _default_handler(args, ctx):
        return ToolResult.ok(f"executed {name} with {args}")

    return Tool(
        name=name,
        description="test tool",
        parameters={"type": "object", "properties": {"target": {"type": "string"}}},
        handler=handler or _default_handler,
        risk=risk,
    )


def test_compute_idempotency_key_deterministic():
    """Ensure idempotency key format is turn_id:tool:hash and deterministic with key ordering (NOT call_id)."""
    turn_id = "turn_123"
    tool_name = "write_db"
    args1 = {"b": 2, "a": 1}
    args2 = {"a": 1, "b": 2}

    key1 = compute_idempotency_key(turn_id, tool_name, args1)
    key2 = compute_idempotency_key(turn_id, tool_name, args2)

    assert key1 == key2
    parts = key1.split(":")
    assert len(parts) == 3
    assert parts[0] == "turn_123"
    assert parts[1] == "write_db"
    assert len(parts[2]) == 16  # 16-char hex prefix

    # Different arguments produce different keys
    key3 = compute_idempotency_key(turn_id, tool_name, {"a": 2, "b": 2})
    assert key1 != key3

    # Different turn_id produces different keys
    key4 = compute_idempotency_key("turn_456", tool_name, args1)
    assert key1 != key4

    # Different tool name produces different keys
    key5 = compute_idempotency_key(turn_id, "other_tool", args1)
    assert key1 != key5


def test_tool_context_clone_for_call():
    """Test ToolContext cloning preserves turn_id and attaches call_id and idempotency_key."""
    ctx = ToolContext(
        conversation_id="c_1",
        workspace_root="/tmp",
        turn_id="turn_999",
        extra={"state": "dummy"},
    )
    idem_key = compute_idempotency_key(ctx.turn_id, "my_tool", {"x": "y"})
    cloned = ctx.clone_for_call("call_1", idempotency_key=idem_key)

    assert cloned.conversation_id == "c_1"
    assert cloned.turn_id == "turn_999"
    assert cloned.call_id == "call_1"
    assert cloned.idempotency_key == idem_key
    assert cloned.extra["idempotency_key"] == idem_key
    assert cloned.extra["state"] == "dummy"


@pytest.mark.asyncio
async def test_read_operations_execute_without_prompt():
    """LOW risk read tools execute automatically without confirmation prompts."""
    read_tool = make_tool(name="read_file", risk=RiskLevel.LOW)
    events = asyncio.Queue()
    ctx = ToolContext(
        conversation_id="c_1",
        turn_id="t_1",
        events=events,
        idempotency_key="t_1:c_1:hash123",
    )

    gate = GuardedConfirmationService("guard")
    outcome = await gate.check(read_tool, {"path": "test.txt"}, ctx)

    assert outcome.allowed is True
    assert outcome.decision == "auto"
    assert outcome.risk == RiskLevel.LOW
    assert outcome.idempotency_key == "t_1:c_1:hash123"
    assert events.empty()


@pytest.mark.asyncio
async def test_mutating_operations_require_confirmation_in_guard_mode():
    """MEDIUM and HIGH risk mutating tools trigger confirmation prompt with idempotency key in guard mode."""
    write_tool = make_tool(name="delete_account", risk=RiskLevel.HIGH)
    events = asyncio.Queue()
    ctx = ToolContext(
        conversation_id="c_1",
        turn_id="t_1",
        events=events,
        idempotency_key="t_1:c_1:hash456",
    )

    asked_request = None

    async def callback(req):
        nonlocal asked_request
        asked_request = req
        return True

    gate = GuardedConfirmationService("guard", callback=callback)
    outcome = await gate.check(write_tool, {"user_id": "u_123"}, ctx)

    assert outcome.allowed is True
    assert outcome.decision == "approved"
    assert outcome.risk == RiskLevel.HIGH
    assert outcome.idempotency_key == "t_1:c_1:hash456"

    # Verify event emitted to frontend
    assert not events.empty()
    event_type, event_data = events.get_nowait()
    assert event_type == "confirmation_required"
    assert event_data["tool_name"] == "delete_account"
    assert event_data["idempotency_key"] == "t_1:c_1:hash456"

    # Verify callback received request with idempotency_key
    assert asked_request is not None
    assert asked_request.idempotency_key == "t_1:c_1:hash456"


@pytest.mark.asyncio
async def test_mutating_operations_blocked_in_read_only():
    """Mutating operations are blocked in read-only mode."""
    write_tool = make_tool(name="send_email", risk=RiskLevel.MEDIUM)
    ctx = ToolContext(
        conversation_id="c_1",
        turn_id="t_1",
        idempotency_key="t_1:c_1:hash789",
    )

    gate = GuardedConfirmationService("read-only")
    outcome = await gate.check(write_tool, {"to": "a@b.com"}, ctx)

    assert outcome.allowed is False
    assert outcome.decision == "blocked_by_mode"
    assert outcome.idempotency_key == "t_1:c_1:hash789"


@pytest.mark.asyncio
async def test_mutating_operations_allowed_in_full_access():
    """Mutating operations execute without prompt in full-access mode."""
    write_tool = make_tool(name="send_email", risk=RiskLevel.MEDIUM)
    ctx = ToolContext(
        conversation_id="c_1",
        turn_id="t_1",
        idempotency_key="t_1:c_1:hashfull",
    )

    gate = GuardedConfirmationService("full-access")
    outcome = await gate.check(write_tool, {"to": "a@b.com"}, ctx)

    assert outcome.allowed is True
    assert outcome.decision == "full_access"
    assert outcome.idempotency_key == "t_1:c_1:hashfull"


@pytest.mark.asyncio
async def test_retried_tool_calls_return_cached_results_without_reexecuting():
    """Retried tool calls with the same idempotency key return cached results without re-executing writes."""
    execution_count = 0

    async def _write_handler(args, ctx):
        nonlocal execution_count
        execution_count += 1
        return ToolResult.ok(f"wrote {args.get('data')}, count={execution_count}")

    tool = make_tool(name="write_db", risk=RiskLevel.MEDIUM, handler=_write_handler)
    registry = ToolRegistry(confirmation=GuardedConfirmationService("full-access"))
    registry.register(tool)

    state = AgentState(conversation_id="c_1")
    call_id1 = "call_write_1"
    args = {"data": "my_value"}
    idem_key = compute_idempotency_key(state.id, "write_db", args)

    ctx = ToolContext(
        conversation_id="c_1",
        turn_id=state.id,
        extra={"state": state},
    )

    from backend.runtime.types import ToolCall
    from backend.agent.director import Director

    director = Director(
        registry=registry,
    )

    # First execution
    call1 = ToolCall(id=call_id1, name="write_db", arguments=args)
    result1 = await director._execute(call1, ctx)

    assert not result1.is_error
    assert "count=1" in result1.content
    assert execution_count == 1
    # Check that state.idempotency_cache has the record
    assert idem_key in state.idempotency_cache
    assert state.idempotency_cache[idem_key]["content"] == result1.content

    # Second execution (re-issued write with a DIFFERENT call_id in the same turn)
    call2 = ToolCall(id="call_write_2_different", name="write_db", arguments=args)
    result2 = await director._execute(call2, ctx)

    assert not result2.is_error
    assert result2.content == result1.content
    # The handler was NOT called again! execution_count remains 1!
    assert execution_count == 1


@pytest.mark.asyncio
async def test_parallel_batch_intra_turn_deduplication_for_reads_and_writes(monkeypatch):
    """Duplicates within a single parallel batch deduplicate immediately without spawning duplicate executions."""
    read_count = 0
    write_count = 0

    async def _read_handler(args, ctx):
        nonlocal read_count
        read_count += 1
        await asyncio.sleep(0.01)
        return ToolResult.ok(f"read item {args.get('q')}, count={read_count}")

    async def _write_handler(args, ctx):
        nonlocal write_count
        write_count += 1
        await asyncio.sleep(0.01)
        return ToolResult.ok(f"wrote item {args.get('v')}, count={write_count}")

    read_tool = Tool(name="fetch_item", description="fetch", parameters={"q": {"type": "string"}}, handler=_read_handler, risk=RiskLevel.LOW)
    write_tool = Tool(name="save_item", description="save", parameters={"v": {"type": "string"}}, handler=_write_handler, risk=RiskLevel.HIGH)

    registry = ToolRegistry(confirmation=GuardedConfirmationService("full-access"))
    registry.register(read_tool)
    registry.register(write_tool)

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository
    from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel

    # Model emits a parallel batch with two identical reads and two identical writes in ONE turn
    responses = iter([
        ModelResponse(tool_calls=[
            ToolCall(id="r1", name="fetch_item", arguments={"q": "same_query"}),
            ToolCall(id="r2", name="fetch_item", arguments={"q": "same_query"}),
            ToolCall(id="w1", name="save_item", arguments={"v": "same_val"}),
            ToolCall(id="w2", name="save_item", arguments={"v": "same_val"}),
        ]),
        ModelResponse(text="Batch work finished."),
    ])

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return next(responses)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry=registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "run batch"):
        events.append(ev)

    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 4

    # The handlers were only called ONCE for read and ONCE for write despite duplicate calls in the batch
    assert read_count == 1
    assert write_count == 1

