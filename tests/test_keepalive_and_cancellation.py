import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from backend.agent.config import AgentConfig, agent_config
from backend.agent.director import Director, Event
from backend.agent.state import AgentState
from backend.api.main import (
    HEARTBEAT_SECONDS,
    _HEARTBEAT,
    _with_heartbeats,
)
from backend.db.repositories import ConversationRepository
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolResult
from backend.tools.registry import ToolRegistry


class ScriptedClient:
    def __init__(self, responses):
        self.responses = list(responses)

    async def complete(self, messages, tools=None, params=None):
        return self.responses.pop(0) if self.responses else ModelResponse(text="done")


def scripted_model(responses) -> ResolvedModel:
    return ResolvedModel(
        provider="fake",
        model="fake-1",
        client=ScriptedClient(responses),
        capabilities=Capabilities(context_window=32000),
    )


@pytest.fixture
def patched_resolve(monkeypatch):
    def install(responses):
        model = scripted_model(responses)
        monkeypatch.setattr("backend.agent.director.resolve", lambda *a, **k: model)
        return model

    return install


def test_sse_keepalive_interval_configuration():
    assert agent_config.sse_keepalive_interval_seconds == 15.0
    cfg = AgentConfig()
    assert cfg.sse_keepalive_interval_seconds == 15.0


@pytest.mark.asyncio
async def test_with_heartbeats_emits_ping_during_long_silence():
    async def slow_stream():
        await asyncio.sleep(0.08)
        yield Event("tool_call", {"id": "1", "name": "test"})
        await asyncio.sleep(0.08)
        yield Event("done", {"text": "finished"})

    heartbeats = 0
    real_events = []

    async for item in _with_heartbeats(slow_stream(), interval=0.02):
        if item is _HEARTBEAT:
            heartbeats += 1
        else:
            real_events.append(item.type)

    assert heartbeats >= 2, f"Expected at least 2 keepalives, got {heartbeats}"
    assert real_events == ["tool_call", "done"]


@pytest.mark.asyncio
async def test_disconnect_watcher_triggers_cancel_event():
    cancel = asyncio.Event()
    is_disconnected = False

    class MockRequest:
        async def is_disconnected(self):
            return is_disconnected

    req = MockRequest()

    async def _watch():
        while not cancel.is_set():
            if await req.is_disconnected():
                cancel.set()
                break
            await asyncio.sleep(0.01)

    watcher = asyncio.create_task(_watch())
    assert not cancel.is_set()

    # Simulate client disconnect
    is_disconnected = True
    await asyncio.sleep(0.03)
    assert cancel.is_set()
    assert watcher.done()


@pytest.mark.asyncio
async def test_director_cancels_inflight_tools_immediately_on_cancel_event(db, patched_resolve):
    patched_resolve([
        ModelResponse(tool_calls=[ToolCall(id="call_hang_1", name="hanging_tool", arguments={})]),
        ModelResponse(text="done after cancel"),
    ])
    tool_started = asyncio.Event()
    tool_was_cancelled = False

    async def hanging_tool(args, ctx):
        nonlocal tool_was_cancelled
        tool_started.set()
        try:
            await asyncio.sleep(10.0)
            return ToolResult.ok("done")
        except asyncio.CancelledError:
            tool_was_cancelled = True
            raise

    registry = ToolRegistry(ConfirmationService(auto_approve))
    registry.register(
        Tool(
            name="hanging_tool",
            description="Tool that takes a long time",
            parameters={"type": "object", "properties": {}},
            risk=RiskLevel.LOW,
            handler=hanging_tool,
        )
    )

    cid = ConversationRepository().create("fake", "fake-1")
    director = Director(registry=registry, mode="chat")

    cancel = asyncio.Event()
    events = []

    async def run_turn():
        async for ev in director.run(cid, "run tool", cancel=cancel):
            events.append(ev)

    turn_task = asyncio.create_task(run_turn())
    await tool_started.wait()
    assert len(director._inflight) > 0

    # Signal cancellation (e.g. from client disconnect)
    cancel.set()
    await turn_task

    assert tool_was_cancelled
    assert len(director._inflight) == 0
    assert any(ev.type == "status" and ev.data.get("state") == "cancelled" for ev in events)


@pytest.mark.asyncio
async def test_director_run_cleans_up_inflight_tools_on_task_cancel(db, patched_resolve):
    patched_resolve([
        ModelResponse(tool_calls=[ToolCall(id="call_hang_2", name="hanging_tool", arguments={})]),
    ])
    tool_started = asyncio.Event()
    tool_was_cancelled = False

    async def hanging_tool(args, ctx):
        nonlocal tool_was_cancelled
        tool_started.set()
        try:
            await asyncio.sleep(10.0)
            return ToolResult.ok("done")
        except asyncio.CancelledError:
            tool_was_cancelled = True
            raise

    registry = ToolRegistry(ConfirmationService(auto_approve))
    registry.register(
        Tool(
            name="hanging_tool",
            description="Tool that takes a long time",
            parameters={"type": "object", "properties": {}},
            risk=RiskLevel.LOW,
            handler=hanging_tool,
        )
    )

    cid = ConversationRepository().create("fake", "fake-1")
    director = Director(registry=registry, mode="chat")

    cancel = asyncio.Event()

    async def run_turn():
        async for _ in director.run(cid, "run tool", cancel=cancel):
            pass

    turn_task = asyncio.create_task(run_turn())
    await tool_started.wait()
    assert len(director._inflight) > 0

    # Task cancellation on client drop
    turn_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn_task

    assert tool_was_cancelled
    assert len(director._inflight) == 0
