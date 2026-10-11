"""The connection gate suspends a call on the app it needs, and only then.

The permission gate proved the shape: announce what the turn is parked on,
then trust the interface to resolve it. These tests hold three things the
connector card depends on:

- the gate only makes an interactive turn wait -- automation and subagent
  failures return as errors, the way they always did;
- the same conversation touching the same dead app twice is one wait, not two;
- a resume runs the failed work again, fresh, and a dismissal or a timeout
  is answered with the original error, which the model already knows how to
  relay.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


@pytest.fixture()
def gate():
    from backend.mcp import connection_gate

    gate = connection_gate.gate
    gate._waits.clear()
    gate._joins.clear()
    yield gate
    # Never let a test's leftover card outlive it.
    for entry in list(gate._waits.values()):
        if not entry.future.done():
            entry.future.set_result("dismiss")
    gate._waits.clear()
    gate._joins.clear()


def _interactive_ctx():
    return ToolContext(
        conversation_id="conv_1",
        events=asyncio.Queue(),
        extra={"interactive": True},
    )


def _composio_tool(handler):
    return Tool(
        name="gmail_send__mcp__composio",
        description="send",
        parameters={},
        handler=handler,
        risk=RiskLevel.LOW,
        source=ToolSource.MCP,
        server_name="composio",
    )


# -------------------------------------------------------------- the gate


@pytest.mark.asyncio
async def test_wait_without_conversation_or_event_is_unavailable(gate):
    from backend.mcp.connection_gate import wait_for_connection

    assert await wait_for_connection(toolkit="gmail", service="Gmail", conversation_id=None, events=None) == "unavailable"
    assert await wait_for_connection(toolkit="gmail", service="Gmail", conversation_id="conv_1", events=None) == "unavailable"
    assert gate.snapshot() == []


@pytest.mark.asyncio
async def test_connected_app_wakes_every_waiter_on_it(gate):
    from backend.mcp.connection_gate import wait_for_connection

    ctx = _interactive_ctx()
    id_a, fut = gate.begin(toolkit="gmail", service="Gmail", conversation_id="conv_1")

    async def waiter():
        return await wait_for_connection(
            toolkit="gmail", service="Gmail", conversation_id="conv_1", events=ctx.events
        )

    task = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    assert gate.resolve(id_a, "resume")
    assert await task == "resume"
    assert fut.result() == "resume"


@pytest.mark.asyncio
async def test_same_conversation_toolkit_joins_one_wait(gate):
    from backend.mcp.connection_gate import wait_for_connection

    id_a, _ = gate.begin(toolkit="gmail", service="Gmail", conversation_id="conv_1")
    id_b, _ = gate.begin(toolkit="gmail", service="Gmail", conversation_id="conv_1")
    assert id_a == id_b
    assert len(gate.snapshot()) == 1

    ctx = _interactive_ctx()
    joined = asyncio.create_task(
        wait_for_connection(toolkit="gmail", service="Gmail", conversation_id="conv_1", events=ctx.events)
    )
    await asyncio.sleep(0)
    assert gate.resolve(id_a, "resume")  # one answer settles one wait
    assert await joined == "resume"


@pytest.mark.asyncio
async def test_settled_wait_is_never_joined_again(gate):
    id_a, fut_a = gate.begin(toolkit="slack", service="Slack", conversation_id="conv_1")
    assert gate.resolve(id_a, "dismiss")
    id_b, fut_b = gate.begin(toolkit="slack", service="Slack", conversation_id="conv_1")
    assert id_b != id_a
    assert fut_a.done() and not fut_b.done()
    # Settling again after the fact answers False -- the first answer wins.
    assert gate.resolve(id_a, "resume") is False
    gate.finish(id_b)
    assert gate.snapshot() == []


@pytest.mark.asyncio
async def test_wait_times_out_without_an_answer(gate, monkeypatch):
    from backend.mcp import connection_gate

    monkeypatch.setattr(connection_gate, "CONNECTION_WAIT_SECONDS", 0.05)
    outcome = await connection_gate.wait_for_connection(
        toolkit="gmail", service="Gmail", conversation_id="conv_1",
        events=_interactive_ctx().events,
    )
    assert outcome == "timeout"
    assert gate.snapshot() == []


def test_connection_required_text_matches_both_shapes():
    from backend.mcp.connection_gate import is_connection_required_text

    assert is_connection_required_text("Gmail needs re-auth: https://… Do not retry this tool in this turn.")
    assert is_connection_required_text(
        "'composio:gmail' is available but no account is connected to it, so none of its"
        " tools can work yet. This is not an outage and not a bug."
    )
    assert not is_connection_required_text("file not found")
    assert not is_connection_required_text("")


@pytest.mark.parametrize(
    ("phase", "event"),
    [("awaiting_connection", "connection_required"), ("acting", "something_else")],
)
def test_state_phase_wiring(phase, event):
    from backend.agent import state as state_module

    assert phase in state_module.PHASES
    assert "acting" in state_module.TRANSITIONS[phase] if phase not in state_module.TERMINAL else True


# ------------------------------------------------------------ the registry


@pytest.mark.asyncio
async def test_unconnected_call_parks_and_resumes(gate, monkeypatch):
    from backend.mcp.composio_service import composio_service

    connections: dict[str, dict] = {}
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: connections)

    ran: list[bool] = []

    async def handler(args, ctx):
        ran.append(True)
        return ToolResult.ok("sent")

    registry = ToolRegistry()
    registry.register(_composio_tool(handler))

    ctx = _interactive_ctx()

    async def connect_it():
        await asyncio.sleep(0.05)
        connections["gmail"] = {"status": "ACTIVE"}
        for wait in gate.snapshot():
            gate.resolve(wait["id"], "resume")

    async def call():
        return await registry.dispatch("gmail_send__mcp__composio", {}, ctx)

    outcome, _ = await asyncio.gather(call(), connect_it())
    assert outcome.content == "sent"
    assert outcome.is_error is False
    assert ran == [True]  # the handler ran once, on the retry
    assert gate.snapshot() == []


@pytest.mark.asyncio
async def test_unconnected_call_refused_to_non_interactive_turn(gate, monkeypatch):
    from backend.mcp.composio_service import composio_service

    connections: dict[str, dict] = {}
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: connections)

    ran: list[bool] = []

    async def handler(args, ctx):
        ran.append(True)
        return ToolResult.ok("sent")

    registry = ToolRegistry()
    registry.register(_composio_tool(handler))

    result = await registry.dispatch(
        "gmail_send__mcp__composio",
        {},
        ToolContext(conversation_id="conv_1"),  # no interactive flag: nobody is being asked
    )
    assert result.is_error
    assert "no account is connected" in result.content
    assert ran == []
    assert gate.snapshot() == []


@pytest.mark.asyncio
async def test_dismissed_call_returns_its_original_error(gate, monkeypatch):
    from backend.mcp.composio_service import composio_service

    connections: dict[str, dict] = {}
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: connections)

    ran: list[bool] = []

    async def handler(args, ctx):
        ran.append(True)
        return ToolResult.ok("sent")

    registry = ToolRegistry()
    registry.register(_composio_tool(handler))

    ctx = _interactive_ctx()

    async def decline_it():
        await asyncio.sleep(0.05)
        for wait in gate.snapshot():
            gate.resolve(wait["id"], "dismiss")

    async def call():
        return await registry.dispatch("gmail_send__mcp__composio", {}, ctx)

    outcome, _ = await asyncio.gather(call(), decline_it())
    assert outcome.is_error
    assert "no account is connected" in outcome.content
    assert ran == []


# ---------------------------------------------------------------- the batch


@pytest.mark.asyncio
async def test_batch_suspends_once_per_missing_toolkit(gate, monkeypatch):
    from backend.mcp import manager as manager_module
    from backend.mcp.manager import MCPManager

    recorded: list[tuple[str, str]] = []

    async def fake_wait(toolkit, service, detail="", conversation_id=None, events=None):
        recorded.append((toolkit, conversation_id))
        return "resume"

    monkeypatch.setattr(manager_module, "normalize_result",
                        lambda raw: ToolResult.ok('{"results": ['
                                                  '{"response": {"successful": true, "data": 11}},'
                                                  '{"response": {"successful": true, "data": 22}}]}'))
    monkeypatch.setattr("backend.mcp.connection_gate.wait_for_connection", fake_wait)

    manager = MCPManager.__new__(MCPManager)
    manager.connections = {}
    manager.errors = {}

    calls = [
        type("C", (), {"name": "gmail_read__mcp__composio", "arguments": {"q": "a"}})(),
        type("C", (), {"name": "gmail_send__mcp__composio", "arguments": {"to": "x"}})(),
        type("C", (), {"name": "view_file", "arguments": {}})(),
    ]
    base = [
        ToolResult.error("Gmail needs re-auth: https://…"),
        ToolResult.error("Gmail needs re-auth: https://…"),
        ToolResult.ok("ok file"),
    ]

    ctx = _interactive_ctx()

    async def conn_call(cmd, args):
        return {"results": [42]}

    manager.connections["composio"] = type(
        "Conn", (), {"connected": True, "call": staticmethod(conn_call)},
    )()

    settled = await manager._suspend_batch_on_connections(calls, base, ctx)
    # One wait, not two: two failing calls are one dead app, and the third call
    # never failed, so it never waited.
    assert len(recorded) == 1
    assert recorded[0][0] == "gmail"
    assert recorded[0][1] == "conv_1"
    # The results kept their positions, and the retried rows are the retried data.
    assert not settled[0].is_error and not settled[1].is_error
    assert settled[2].content == "ok file"

    non_interactive = ToolContext(conversation_id="conv_1")
    assert await manager._suspend_batch_on_connections(calls, base, non_interactive) is None


# ------------------------------------------------- the tool timeout boundary


@pytest.mark.asyncio
async def test_connection_wait_survives_the_tool_timeout_window(gate, monkeypatch):
    """The fix that took the approval bug down with it: a call parked on a
    connection card is not a wedged tool, so `_execute`'s window re-arms while
    the gate holds. Today this used to fire "'tool' timed out and was stopped"
    the moment the user spent longer than `tool_timeout_seconds` on Connect."""
    from backend.agent.config import agent_config
    from backend.agent.director import Director
    from backend.mcp.composio_service import composio_service
    from backend.runtime.types import ToolCall

    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 0.2)
    monkeypatch.setattr(agent_config, "suspended_tool_window_seconds", 5.0)

    connections: dict[str, dict] = {}
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: connections)

    ran: list[bool] = []

    async def handler(args, ctx):
        ran.append(True)
        return ToolResult.ok("sent")

    registry = ToolRegistry()
    registry.register(_composio_tool(handler))
    director = Director(registry, stream=False, memory=False)

    ctx = _interactive_ctx()
    call = ToolCall(id="c1", name="gmail_send__mcp__composio", arguments={})

    async def connect_later():
        # Just over one whole tool window: the user connected after the
        # window expired, which is exactly the stretch that used to break.
        await asyncio.sleep(0.6)
        connections["gmail"] = {"status": "ACTIVE"}
        for wait in gate.snapshot():
            gate.resolve(wait["id"], "resume")

    result, _ = await asyncio.gather(
        director._execute(call, ctx),
        connect_later(),
    )
    assert result.content == "sent"
    assert result.is_error is False
    assert "timed out" not in result.content
    assert ran == [True]
    assert gate.snapshot() == []


@pytest.mark.asyncio
async def test_a_call_with_no_gate_still_times_out_normally(gate, monkeypatch):
    """The re-arm exists only for parked calls: despite the shielded wait,
    a call with no gate live is cancelled by the same window as before."""
    from backend.agent.config import agent_config
    from backend.agent.director import Director
    from backend.mcp.composio_service import composio_service
    from backend.runtime.types import ToolCall

    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 0.2)

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {"gmail": {"status": "ACTIVE"}})

    async def handler(args, ctx):
        await asyncio.sleep(5.0)
        return ToolResult.ok("done")

    registry = ToolRegistry()
    registry.register(_composio_tool(handler))
    director = Director(registry, stream=False, memory=False)

    ctx = _interactive_ctx()
    call = ToolCall(id="c1", name="gmail_send__mcp__composio", arguments={})

    result = await asyncio.wait_for(director._execute(call, ctx), timeout=3)
    assert result.is_error is True
    assert "timed out" in result.content
