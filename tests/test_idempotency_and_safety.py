"""Tests for Side-Effect Safety & Deterministic Idempotency Keys (Task 20)."""

from __future__ import annotations

import asyncio
import pytest

from backend.agent.state import AgentState
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
    """Ensure idempotency key format is turn_id:call_id:hash and deterministic with key ordering."""
    turn_id = "turn_123"
    call_id = "call_abc"
    args1 = {"b": 2, "a": 1}
    args2 = {"a": 1, "b": 2}

    key1 = compute_idempotency_key(turn_id, call_id, args1)
    key2 = compute_idempotency_key(turn_id, call_id, args2)

    assert key1 == key2
    parts = key1.split(":")
    assert len(parts) == 3
    assert parts[0] == "turn_123"
    assert parts[1] == "call_abc"
    assert len(parts[2]) == 16  # 16-char hex prefix

    # Different arguments produce different keys
    key3 = compute_idempotency_key(turn_id, call_id, {"a": 2, "b": 2})
    assert key1 != key3

    # Different turn_id produces different keys
    key4 = compute_idempotency_key("turn_456", call_id, args1)
    assert key1 != key4


def test_tool_context_clone_for_call():
    """Test ToolContext cloning preserves turn_id and attaches call_id and idempotency_key."""
    ctx = ToolContext(
        conversation_id="c_1",
        workspace_root="/tmp",
        turn_id="turn_999",
        extra={"state": "dummy"},
    )
    idem_key = compute_idempotency_key(ctx.turn_id, "call_1", {"x": "y"})
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
    call_id = "call_write_1"
    args = {"data": "my_value"}
    idem_key = compute_idempotency_key(state.id, call_id, args)

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
    call = ToolCall(id=call_id, name="write_db", arguments=args)
    result1 = await director._execute(call, ctx)

    assert not result1.is_error
    assert "count=1" in result1.content
    assert execution_count == 1
    # Check that state.idempotency_cache has the record
    assert idem_key in state.idempotency_cache
    assert state.idempotency_cache[idem_key]["content"] == result1.content

    # Second execution (retry with same call_id and args -> same idem_key)
    result2 = await director._execute(call, ctx)

    assert not result2.is_error
    assert result2.content == result1.content
    # The handler was NOT called again! execution_count remains 1!
    assert execution_count == 1
