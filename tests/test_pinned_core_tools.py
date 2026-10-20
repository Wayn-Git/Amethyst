"""Tests for Task 1: Pinned core tools and process-lifetime schema cache."""

import json
from unittest.mock import AsyncMock, MagicMock
import pytest

from backend.mcp.composio_service import (
    ALL_FAST_LANE_SLUGS,
    STATIC_PINNED_SCHEMAS,
    composio_service,
    get_cached_pinned_schema,
)
from backend.mcp.manager import MCPManager, ServerConfig
from backend.tools.registry import ToolRegistry


def test_pinned_core_tools_exist_for_common_connectors():
    """Verify core toolkits have static pinned schemas defined."""
    assert "googlecalendar" in STATIC_PINNED_SCHEMAS
    assert "gmail" in STATIC_PINNED_SCHEMAS
    assert "github" in STATIC_PINNED_SCHEMAS
    assert "slack" in STATIC_PINNED_SCHEMAS
    assert "notion" in STATIC_PINNED_SCHEMAS

    # Verify calendar and gmail core tools have proper parameters
    cal_tools = {t["slug"]: t for t in STATIC_PINNED_SCHEMAS["googlecalendar"]}
    assert "GOOGLECALENDAR_FIND_EVENT" in cal_tools
    assert "query" in cal_tools["GOOGLECALENDAR_FIND_EVENT"]["parameters"]["properties"]
    assert "max_results" in cal_tools["GOOGLECALENDAR_FIND_EVENT"]["parameters"]["properties"]

    gmail_tools = {t["slug"]: t for t in STATIC_PINNED_SCHEMAS["gmail"]}
    assert "GMAIL_FETCH_EMAILS" in gmail_tools
    assert "query" in gmail_tools["GMAIL_FETCH_EMAILS"]["parameters"]["properties"]


def test_cold_start_loads_pinned_schemas_without_network(monkeypatch):
    """When unconfigured or cold start, get_fast_lane_tools returns static pinned schemas."""
    monkeypatch.setattr(composio_service, "is_configured", lambda: False)
    composio_service._fast_lane_cache.clear()
    composio_service._fast_lane_cache_time.clear()

    tools = composio_service.get_fast_lane_tools("googlecalendar")
    assert len(tools) >= 5
    slugs = {t["slug"] for t in tools}
    assert "GOOGLECALENDAR_FIND_EVENT" in slugs
    assert "GOOGLECALENDAR_CREATE_EVENT" in slugs


def test_process_lifetime_cache_lookup():
    """Verify get_cached_pinned_schema resolves pinned slugs immediately."""
    schema = get_cached_pinned_schema("GOOGLECALENDAR_FIND_EVENT")
    assert schema is not None
    assert schema["slug"] == "GOOGLECALENDAR_FIND_EVENT"

    gmail_schema = get_cached_pinned_schema("GMAIL_FETCH_EMAILS")
    assert gmail_schema is not None
    assert gmail_schema["slug"] == "GMAIL_FETCH_EMAILS"


@pytest.mark.asyncio
async def test_composio_get_tool_schemas_intercepts_pinned_tools():
    """COMPOSIO_GET_TOOL_SCHEMAS returns cached schemas without calling remote MCP."""
    registry = ToolRegistry()
    manager = MCPManager(registry=registry)
    mock_conn = MagicMock()
    mock_conn.connected = True
    mock_conn.call = AsyncMock()
    manager.connections["composio"] = mock_conn

    handler = manager._make_handler("composio", "COMPOSIO_GET_TOOL_SCHEMAS")
    res = await handler({"tools": ["GOOGLECALENDAR_FIND_EVENT", "GMAIL_FETCH_EMAILS"]}, MagicMock())

    assert not res.is_error
    data = json.loads(res.content)
    assert "schemas" in data
    found_slugs = {s["slug"] for s in data["schemas"]}
    assert "GOOGLECALENDAR_FIND_EVENT" in found_slugs
    assert "GMAIL_FETCH_EMAILS" in found_slugs

    # mock_conn.call should NOT have been called because all tools were resolved locally
    mock_conn.call.assert_not_called()


def test_fast_lane_registers_both_key_and_slug_direct_tools(monkeypatch):
    """Manager registers both composite key and direct slug alias in registry."""
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {})

    registry = ToolRegistry()
    manager = MCPManager(registry=registry)
    cfg = ServerConfig(name="composio", command="", transport="stdio")
    tools_for_cache = []

    count = manager._register_composio_fast_lane_tools(cfg, tools_for_cache)
    assert count > 0

    # Both composite key and bare slug are registered
    assert registry.get("GOOGLECALENDAR_FIND_EVENT__mcp__composio") is not None
    assert registry.get("GOOGLECALENDAR_FIND_EVENT") is not None
    assert registry.get("GMAIL_FETCH_EMAILS") is not None
