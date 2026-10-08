"""Tests for MCP session auto-reconnection and Streamable HTTP failure recovery."""

from __future__ import annotations

import pytest
from mcp.shared.exceptions import MCPError

from backend.mcp.client import _is_transport_failure as client_is_transport_failure
from backend.mcp.config import ServerConfig, Transport
from backend.mcp.manager import (
    MCPManager,
    _is_transport_failure as manager_is_transport_failure,
)
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import ToolResult
from backend.tools.registry import ToolRegistry


def test_is_transport_failure_detects_session_termination():
    failures = [
        MCPError(-32600, "Session terminated"),
        MCPError(-32001, "Session not found"),
        MCPError(-32600, "Session expired"),
        MCPError(-32600, "Invalid session"),
        Exception("Stream closed"),
        Exception("stream is closed"),
        Exception("stream disconnected"),
        Exception("stream terminated"),
        ExceptionGroup("TaskGroup", [MCPError(-32600, "Session terminated")]),
    ]
    for exc in failures:
        assert client_is_transport_failure(exc), f"client failed to detect: {exc}"
        assert manager_is_transport_failure(exc), f"manager failed to detect: {exc}"

    non_failures = [
        MCPError(-32602, "Invalid params: missing url"),
        MCPError(-32603, "Internal error in tool execution"),
        ValueError("bad argument"),
        KeyError("not found in dictionary"),
    ]
    for exc in non_failures:
        assert not client_is_transport_failure(exc), f"client wrongly flagged: {exc}"
        assert not manager_is_transport_failure(exc), f"manager wrongly flagged: {exc}"


class _MockSessionConn:
    def __init__(self, name: str, *, call_error=None):
        from backend.mcp.client import CircuitBreaker, DiscoveredTool

        self.name = name
        self.tools = [
            DiscoveredTool(
                name="browser_evaluate",
                description="eval",
                input_schema={"type": "object", "properties": {}},
            )
        ]
        self.breaker = CircuitBreaker()
        self.connected = True
        self.call_error = call_error
        self.call_count = 0

    async def call(self, name, arguments):
        self.call_count += 1
        if self.call_error is not None:
            raise self.call_error
        return type(
            "Result",
            (),
            {
                "is_error": False,
                "content": [type("Text", (), {"type": "text", "text": "cart updated"})()],
                "artifacts": [],
            },
        )()

    async def disconnect(self):
        self.connected = False


@pytest.mark.asyncio
async def test_make_handler_reconnects_with_force_true_on_session_termination(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(
        name="playwright",
        transport=Transport.STREAMABLE_HTTP,
        url="http://localhost:8931/mcp",
    )

    dead_conn = _MockSessionConn(
        "playwright", call_error=MCPError(-32600, "Session terminated")
    )
    manager.connections["playwright"] = dead_conn
    manager._register_tools(config, dead_conn)

    monkeypatch.setattr("backend.mcp.manager.load_servers", lambda: {"playwright": config})

    connect_calls = []

    async def _mock_connect_server(cfg, *, interactive=True, force=False):
        connect_calls.append({"config": cfg, "interactive": interactive, "force": force})
        # Simulate revived connection
        fresh_conn = _MockSessionConn("playwright")
        manager.connections["playwright"] = fresh_conn
        manager._register_tools(cfg, fresh_conn)
        return len(fresh_conn.tools)

    monkeypatch.setattr(manager, "connect_server", _mock_connect_server)

    handler = manager._make_handler("playwright", "browser_evaluate")
    result = await handler({}, None)

    assert not result.is_error
    assert "cart updated" in result.content
    assert len(connect_calls) == 1
    assert connect_calls[0]["force"] is True, "connect_server must be called with force=True on reconnect"
    assert connect_calls[0]["interactive"] is False


@pytest.mark.asyncio
async def test_connect_server_locked_probed_dead_rebuilds_connection(monkeypatch):
    import time
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(
        name="playwright",
        transport=Transport.STREAMABLE_HTTP,
        url="http://localhost:8931/mcp",
    )

    old_conn = _MockSessionConn("playwright")
    manager.connections["playwright"] = old_conn
    manager._register_tools(config, old_conn)

    # Mark as probed dead
    manager.probes["playwright"] = (time.monotonic(), False)
    assert manager.probed_dead("playwright")

    # Calling _connect_server_locked with force=False must NOT return early
    disconnect_called = []

    async def _mock_disconnect(name):
        disconnect_called.append(name)
        manager.registry.unregister_server(name)

    monkeypatch.setattr(manager, "disconnect_server", _mock_disconnect)

    class _MockFreshMCPConnection:
        def __init__(self, cfg, **kwargs):
            self.tools = old_conn.tools
            self.connected = True
        async def connect(self):
            pass

    monkeypatch.setattr("backend.mcp.manager.MCPConnection", _MockFreshMCPConnection)

    count = await manager._connect_server_locked(config, interactive=False, force=False)
    assert count == 1
    assert "playwright" in disconnect_called, "Should have torn down the probed-dead connection"


@pytest.mark.asyncio
async def test_reconcile_probed_dead_avoids_racing_disconnect(monkeypatch):
    import time
    from backend.capabilities import CapabilityService, Kind

    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry)
    config = ServerConfig(
        name="playwright",
        transport=Transport.STREAMABLE_HTTP,
        url="http://localhost:8931/mcp",
        enabled=True,
    )

    conn = _MockSessionConn("playwright")
    manager.connections["playwright"] = conn
    manager._register_tools(config, conn)

    monkeypatch.setattr("backend.mcp.manager.load_servers", lambda: {"playwright": config})

    async def _mock_probe_live_servers():
        pass

    monkeypatch.setattr(manager, "_probe_live_servers", _mock_probe_live_servers)
    manager.probes["playwright"] = (time.monotonic(), False)

    service = CapabilityService()
    monkeypatch.setattr(service, "is_enabled", lambda kind, name: True)
    monkeypatch.setattr(service, "switched_off", lambda kind, name: False)
    monkeypatch.setattr("backend.capabilities.CapabilityService", lambda: service)

    connected_with_force = []

    async def _mock_connect_server(cfg, *, interactive=False, force=False):
        connected_with_force.append(force)
        return 1

    disconnected = []

    async def _mock_disconnect_server(name):
        disconnected.append(name)

    monkeypatch.setattr(manager, "connect_server", _mock_connect_server)
    monkeypatch.setattr(manager, "disconnect_server", _mock_disconnect_server)

    await manager.reconcile()

    # playwright should be reconnected with force=True, and NOT in disconnected
    assert True in connected_with_force
    assert "playwright" not in disconnected, "probed_dead enabled server must not be concurrently disconnected"
