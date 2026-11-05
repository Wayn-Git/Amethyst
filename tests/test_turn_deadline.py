from __future__ import annotations

import asyncio
import time

import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def _fast_tool(registry: ToolRegistry, sleep_s: float) -> list[bool]:
    """Register a `slow_thing` tool that sleeps, and return its run record."""
    ran: list[bool] = []

    async def handler(args, ctx):
        ran.append(True)
        await asyncio.sleep(sleep_s)
        return ToolResult.ok("done")

    registry.register(
        Tool(
            name="slow_thing",
            description="Slow operation",
            parameters={"type": "object", "properties": {}},
            handler=handler,
            risk=RiskLevel.LOW,
        )
    )
    return ran


# --------------------------------------------------- _execute turn deadline


@pytest.mark.asyncio
async def test_execute_refuses_a_call_whose_turn_deadline_has_passed():
    """A call that starts after the turn's hard limit answers with an error
    result instead of running its handler, so the model still hears one result
    per call and the turn's own limit is honoured inside long tool batches,
    where the loop used to only look at it after the batch finished."""
    registry = ToolRegistry(ConfirmationService(auto_approve))
    ran = _fast_tool(registry, sleep_s=0.01)
    director = Director(registry, stream=False, memory=False)

    ctx = ToolContext(conversation_id="conv_deadline_1")
    call = ToolCall(id="c1", name="slow_thing", arguments={})

    result = await director._execute(call, ctx, deadline=time.monotonic() - 1.0)

    assert result.is_error is True
    assert "was not run" in result.content
    assert "time limit" in result.content
    assert ran == []


@pytest.mark.asyncio
async def test_execute_clamps_window_to_remaining_turn_budget(monkeypatch):
    """A call starting inside the remaining budget is capped by it, even when
    its own tool-wide window would allow much longer."""
    from backend.db.repositories import ConversationRepository

    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 30.0)

    registry = ToolRegistry(ConfirmationService(auto_approve))
    _fast_tool(registry, sleep_s=10.0)
    director = Director(registry, stream=False, memory=False)

    cid = ConversationRepository().create("deadline", "any")
    ctx = ToolContext(conversation_id=cid)
    call = ToolCall(id="c1", name="slow_thing", arguments={})

    t0 = time.monotonic()
    result = await asyncio.wait_for(
        director._execute(call, ctx, deadline=t0 + 0.35),
        timeout=3.0,
    )

    assert result.is_error is True
    assert "timed out" in result.content
    assert time.monotonic() - t0 < 2.0


@pytest.mark.asyncio
async def test_execute_runs_normally_without_a_turn_deadline():
    """`deadline=None` is the contract for direct (non-turn) callers: nothing
    is clamped and the call runs to its own completion."""
    registry = ToolRegistry(ConfirmationService(auto_approve))
    _fast_tool(registry, sleep_s=0.01)
    director = Director(registry, stream=False, memory=False)

    ctx = ToolContext(conversation_id="conv_deadline_2")
    call = ToolCall(id="c1", name="slow_thing", arguments={})

    result = await director._execute(call, ctx)
    assert result.is_error is False
    assert result.content == "done"


# -------------------------------------- bounded final-answer synthesis


@pytest.mark.asyncio
async def test_guaranteed_final_answer_stops_a_hung_synthesis(monkeypatch):
    """The synthesis call happens when the turn is already out of budget, so a
    hung provider there costs `final_answer_timeout_seconds` and then the
    deterministic summary, not the provider's own 300s read timeout."""
    import backend.agent.director as director_module
    from backend.agent.state import AgentState
    from backend.db.repositories import ConversationRepository

    monkeypatch.setattr(agent_config, "final_answer_timeout_seconds", 0.5)

    class HungClient:
        async def complete(self, messages, tools=None, params=None):
            await asyncio.sleep(30.0)
            return ModelResponse(text="unreached")

    model = ResolvedModel("mock", "Any", HungClient(), Capabilities(streaming=False))
    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: model)

    cid = ConversationRepository().create("mock", "Any")
    director = Director(ToolRegistry(), stream=False, memory=False, retrieval=False)
    state = AgentState(conversation_id=cid)

    t0 = time.monotonic()
    events = [
        ev
        async for ev in director._guaranteed_final_answer(
            cid, model, "System prompt", [], state, "time limit reached"
        )
    ]
    elapsed = time.monotonic() - t0

    assert elapsed < 3.0
    done_events = [e for e in events if e.type == "done"]
    assert len(done_events) == 1
    assert done_events[0].data.get("text")
