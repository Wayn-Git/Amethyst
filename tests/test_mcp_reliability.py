"""Phase 2: MCP reliability hardening.

- The tool cap must not zero out a whole connector when several are ready.
- A server exposing more than the per-server cap records the overflow.
- A confirmed-dead, unrecoverable session demotes immediately instead of being
  advertised as ready for the rest of the cooldown window.
"""

from __future__ import annotations

import pytest

from backend.mcp.config import ServerConfig, Transport
from backend.mcp.manager import MAX_TOOLS_PER_SERVER, MCPManager
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import ToolResult
from backend.tools.registry import ToolRegistry


def test_the_cap_gives_every_ready_connector_a_share():
    """Grouped by server, a cap dropped whole connectors; interleaving keeps a
    fair slice of each, which is the fix for 'the model ignores my connector'.

    Mutation check: drop `_interleave_by_server` from `cap_tools`.
    """
    from backend.agent.prompt import cap_tools
    from backend.runtime.types import ToolSchema

    def schema(name):
        return ToolSchema(name=name, description="d", parameters={})

    tools = [
        schema("view_file"),
        *[schema(f"a{n}__mcp__alpha") for n in range(5)],
        *[schema(f"b{n}__mcp__bravo") for n in range(5)],
    ]
    # Room for the builtin + 4 connector tools across two ready servers.
    kept, _ = cap_tools(tools, 5, priority_servers={"alpha", "bravo"})
    kept_servers = {name.split("__mcp__")[1] for t in kept if "__mcp__" in (name := t.name)}
    assert kept_servers == {"alpha", "bravo"}, "neither ready connector is zeroed"


class _Conn:
    def __init__(self, tool_count, *, call_error=None):
        from backend.mcp.client import CircuitBreaker, DiscoveredTool

        self.tools = [
            DiscoveredTool(name=f"t{i}", description="d", input_schema={"type": "object"})
            for i in range(tool_count)
        ]
        self.breaker = CircuitBreaker()
        self.connected = True
        self._call_error = call_error

    async def call(self, name, arguments):
        if self._call_error is not None:
            raise self._call_error
        return type("R", (), {"is_error": False, "content": [], "artifacts": []})()


def test_overflow_beyond_the_cap_is_recorded():
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(name="big", transport=Transport.STDIO, command="x")
    manager._register_tools(config, _Conn(MAX_TOOLS_PER_SERVER + 7))
    assert manager.truncated["big"] == 7


@pytest.mark.asyncio
async def test_a_dead_unrecoverable_session_demotes_now(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(name="ghost", transport=Transport.STDIO, command="x")
    conn = _Conn(2, call_error=Exception("Connection closed"))
    manager.connections["ghost"] = conn
    manager._register_tools(config, conn)
    assert manager.is_ready("ghost")  # tools registered, session "connected"

    monkeypatch.setattr("backend.mcp.manager.load_servers", lambda: {"ghost": config})

    async def _cannot_reconnect(cfg, interactive=False):
        raise Exception("Connection closed")

    monkeypatch.setattr(manager, "connect_server", _cannot_reconnect)

    handler = manager._make_handler("ghost", "t0")
    result = await handler({}, None)
    assert isinstance(result, ToolResult) and result.is_error
    # The dead connector must no longer claim readiness, and must be scheduled
    # for a backed-off retry rather than advertised to the model.
    assert not manager.is_ready("ghost")
    assert manager.registered_tool_count("ghost") == 0
    assert manager._retry_in("ghost", ready=False) > 0
