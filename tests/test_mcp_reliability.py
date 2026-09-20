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


@pytest.mark.asyncio
async def test_account_mismatch_prevents_readiness_and_marks_degraded(monkeypatch):
    """If configured account is Account A but authenticated token is Account B,
    the server must never claim to be ready or connected to Account A."""
    from backend.mcp.status import MCPState

    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(
        name="workspace",
        transport=Transport.STDIO,
        command="x",
        account="alice@example.com",
    )
    conn = _Conn(3)
    manager.connections["workspace"] = conn
    manager._register_tools(config, conn)

    monkeypatch.setattr("backend.mcp.manager.load_servers", lambda: {"workspace": config})
    monkeypatch.setattr(
        "backend.mcp.commands.verify_account",
        lambda name, expected: ("bob@example.com", True),
    )

    status = manager.authoritative_status("workspace")
    assert status.state == MCPState.ACCOUNT_MISMATCH
    assert status.account_mismatch is True
    assert status.account == "bob@example.com"
    assert status.expected_account == "alice@example.com"
    assert status.is_connected is True
    assert status.is_usable is False
    assert manager.is_ready("workspace") is False

    state = manager.state()["workspace"]
    assert state["connected"] is True
    assert state["ready"] is False
    assert state["account_mismatch"] is True


@pytest.mark.asyncio
async def test_tool_execution_auth_error_disconnects_and_unregisters_immediately():
    """When a tool returns an authentication failure or 401 error block,
    the server must immediately disconnect, unregister all tools, and transition to auth error."""
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(name="cloud", transport=Transport.STDIO, command="x")

    class _AuthFailingConn(_Conn):
        async def call(self, name, arguments):
            return type(
                "R",
                (),
                {
                    "is_error": True,
                    "content": [
                        type(
                            "B",
                            (),
                            {
                                "type": "text",
                                "text": "401 Unauthorized: Invalid credentials or token expired",
                            },
                        )()
                    ],
                    "artifacts": [],
                },
            )()

    conn = _AuthFailingConn(3)
    manager.connections["cloud"] = conn
    manager._register_tools(config, conn)

    assert manager.registered_tool_count("cloud") == 3
    assert "cloud" in manager.connections

    handler = manager._make_handler("cloud", "t0")
    result = await handler({}, None)

    assert result.is_error is True
    # Server must be disconnected and its tools unregistered
    assert "cloud" not in manager.connections
    assert manager.registered_tool_count("cloud") == 0
    assert not manager.is_ready("cloud")
    assert "Authentication" in manager.errors["cloud"]


@pytest.mark.asyncio
async def test_disconnected_server_never_claims_connected_in_state():
    """An unstarted or disconnected server must have connected=False in authoritative state."""
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(name="remote", transport=Transport.STREAMABLE_HTTP, url="http://localhost:9999")

    # Manager created, reconciled, no connection
    manager.reconciled_once = True
    status = manager.authoritative_status("remote")
    assert status.is_connected is False
    assert status.is_usable is False

    state = manager.state()
    # It must not report connected
    assert state.get("remote", {}).get("connected") is not True


@pytest.mark.asyncio
async def test_token_expiration_detected_generically(monkeypatch):
    """Generic token expiration check flags token_expired and refuses readiness."""
    import time
    from backend.mcp.commands import verify_token_health
    from backend.mcp.status import MCPState

    config = ServerConfig(
        name="oauth_server",
        transport=Transport.STREAMABLE_HTTP,
        url="http://localhost:8000",
        oauth=True,
    )

    import json

    # Simulate expired token in keychain
    expired_token = {
        "access_token": "expired_abc",
        "expires_at": time.time() - 3600,
    }
    monkeypatch.setattr("backend.mcp.commands.get_secret", lambda ref: json.dumps(expired_token))
    monkeypatch.setattr("backend.secrets.get_secret", lambda ref: json.dumps(expired_token))
    monkeypatch.setattr("backend.mcp.oauth.has_stored_token", lambda name: True)

    healthy, err = verify_token_health(config)
    assert healthy is False
    assert "expired" in err.lower()

    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    monkeypatch.setattr("backend.mcp.manager.load_servers", lambda: {"oauth_server": config})

    status = manager.authoritative_status("oauth_server")
    assert status.state == MCPState.TOKEN_EXPIRED
    assert status.is_usable is False
    assert status.action == "sign_in"
