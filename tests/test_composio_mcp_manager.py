from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest

from backend.mcp.manager import MCPManager
from backend.tools.registry import ToolRegistry


def test_mcp_manager_registers_composio_server():
    registry = ToolRegistry()
    manager = MCPManager(registry=registry)

    with patch("backend.mcp.composio_service.composio_service.get_mcp_config") as mock_conf:
        mock_conf.return_value = {
            "transport": "streamable-http",
            "url": "https://mcp.composio.dev/session_123",
            "headers": {"x-api-key": "test_key"},
        }
        server = manager.get_server_config("composio")
        assert server is not None, "composio server must be discovered"
        assert server.transport == "streamable-http"
        assert server.url == "https://mcp.composio.dev/session_123"
        assert server.resolved_headers().get("x-api-key") == "test_key"
