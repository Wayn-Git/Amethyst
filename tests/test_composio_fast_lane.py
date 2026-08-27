from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from backend.mcp.composio_service import (
    ALL_FAST_LANE_SLUGS,
    DASHBOARD_READ_SCHEMAS,
    FAST_LANE_CONFIG,
    FAST_LANE_TTL,
    composio_service,
    trim_composio_tool_schema,
)
from backend.agent.tool_search import _is_deferrable, classify_tools
from backend.agent.tool_selector import CORE, select_tools
from backend.runtime.types import ToolSchema
from backend.tools.base import Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


def test_fast_lane_config_structure():
    expected_toolkits = {"googlecalendar", "gmail", "github", "slack", "notion", "google_maps"}
    assert set(FAST_LANE_CONFIG.keys()) == expected_toolkits
    for tk, slugs in FAST_LANE_CONFIG.items():
        if tk == "google_maps":
            assert set(slugs) == {"GOOGLE_MAPS_GET_ROUTE"}
            continue
        assert len(slugs) == 5 + len(
            set(DASHBOARD_READ_SCHEMAS.get(tk, {})) - {
                "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION"
            }
        )
    assert len(ALL_FAST_LANE_SLUGS) == sum(map(len, FAST_LANE_CONFIG.values()))


def test_trim_composio_tool_schema():
    raw_schema = {
        "type": "object",
        "title": "FindEventRequest",
        "properties": {
            "query": {
                "type": "string",
                "title": "Query",
                "examples": ["Team sync"],
                "description": "Free-text search terms to find events.\nExtra long multi-paragraph explanation that should be truncated.",
                "human_parameter_name": "Search Query",
            },
            "calendar_id": {
                "type": "string",
                "default": "primary",
                "description": "Calendar identifier.",
            },
            "unwanted_bulk_param": {
                "type": "object",
                "description": "Very bulky parameter with large sub-schemas",
            },
            "required_field": {
                "type": "string",
                "description": "A field marked as required.",
            },
        },
        "required": ["required_field"],
    }

    allowed_optional = ["query", "calendar_id"]
    trimmed = trim_composio_tool_schema("GOOGLECALENDAR_FIND_EVENT", raw_schema, allowed_optional)

    assert trimmed["type"] == "object"
    assert trimmed["required"] == ["required_field"]
    props = trimmed["properties"]
    assert "required_field" in props
    assert "query" in props
    assert "calendar_id" in props
    assert "unwanted_bulk_param" not in props
    # Bulky fields like examples and human_parameter_name stripped
    assert "examples" not in props["query"]
    assert "human_parameter_name" not in props["query"]
    # Multiline description truncated to first line
    assert "\n" not in props["query"]["description"]


def test_fast_lane_cache_ttl_and_refresh(monkeypatch):
    mock_tools = [
        {
            "slug": "GOOGLECALENDAR_FIND_EVENT",
            "name": "Find event",
            "description": "Finds events in Google Calendar",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": []},
        }
    ]

    monkeypatch.setattr(composio_service, "_fetch_fast_lane_tools_sync", lambda toolkits: {"googlecalendar": mock_tools})
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)

    # Clear cache
    composio_service._fast_lane_cache.clear()
    composio_service._fast_lane_cache_time.clear()

    # 1. First call: fetches and populates cache
    res1 = composio_service.get_fast_lane_tools("googlecalendar")
    assert len(res1) == 1
    assert res1[0]["slug"] == "GOOGLECALENDAR_FIND_EVENT"

    # 2. Immediate second call: returns from fresh cache without fetch
    monkeypatch.setattr(composio_service, "_fetch_fast_lane_tools_sync", lambda toolkits: (_ for _ in ()).throw(AssertionError("should not fetch")))
    res2 = composio_service.get_fast_lane_tools("googlecalendar")
    assert res2 == res1

    # 3. Simulate expired TTL: returns stale cache and triggers background refresh
    composio_service._fast_lane_cache_time["googlecalendar"] = time.monotonic() - (FAST_LANE_TTL + 10)
    bg_called = []
    monkeypatch.setattr(composio_service, "_trigger_background_fast_lane_refresh", lambda toolkits: bg_called.append(toolkits))

    res3 = composio_service.get_fast_lane_tools("googlecalendar")
    assert res3 == res1
    assert bg_called == [["googlecalendar"]]


def test_fast_lane_slugs_not_deferrable():
    for slug in ALL_FAST_LANE_SLUGS:
        full_name = f"{slug}__mcp__composio"
        assert not _is_deferrable(full_name, "composio")
        assert not _is_deferrable(slug, None)
    assert "COMPOSIO_SEARCH_TOOLS" in CORE
    assert "COMPOSIO_MULTI_EXECUTE_TOOL" in CORE


def test_fast_lane_tools_always_visible_under_deferral(monkeypatch):
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {"googlecalendar": True})

    registry = ToolRegistry()
    # Register 100 dummy MCP tools to activate catalog deferral
    for i in range(100):
        registry.register(
            Tool(
                name=f"slack_tool_{i}__mcp__slack",
                description="Long description exceeding tokens threshold for deferred catalog",
                parameters={"type": "object", "properties": {"a": {"type": "string"}}},
                handler=lambda args, ctx: ToolResult.ok("ok"),
                source=ToolSource.MCP,
                server_name="slack",
            )
        )

    # Register fast lane tool
    registry.register(
        Tool(
            name="GOOGLECALENDAR_FIND_EVENT__mcp__composio",
            description="Finds events in Google Calendar",
            parameters={"type": "object", "properties": {"query": {"type": "string"}}},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    visible, catalog = classify_tools(registry.schemas(), registry=registry)
    visible_names = {s.name for s in visible}
    catalog_names = {e.name for e in catalog}

    assert "GOOGLECALENDAR_FIND_EVENT__mcp__composio" in visible_names
    assert "GOOGLECALENDAR_FIND_EVENT__mcp__composio" not in catalog_names


@pytest.mark.asyncio
async def test_fast_lane_execution_unpacks_response():
    from backend.mcp.manager import MCPManager

    mock_connection = MagicMock()
    mock_connection.connected = True
    raw_payload = {
        "data": {
            "results": [
                {
                    "tool_slug": "GOOGLECALENDAR_FIND_EVENT",
                    "response": {
                        "successful": True,
                        "data": {
                            "events": [{"summary": "Design Sync", "start": "2026-10-18T10:00:00Z"}]
                        },
                    },
                }
            ]
        }
    }
    mock_connection.call = AsyncMock(return_value=json.dumps(raw_payload))

    manager = MCPManager(registry=ToolRegistry())
    manager.connections["composio"] = mock_connection

    handler = manager._make_composio_fast_lane_handler("composio", "GOOGLECALENDAR_FIND_EVENT")
    result = await handler({"query": "Design"}, ToolContext())

    assert not result.is_error
    data = json.loads(result.content)
    # The output is cleanly unpacked to response.data directly!
    assert "events" in data
    assert data["events"][0]["summary"] == "Design Sync"
