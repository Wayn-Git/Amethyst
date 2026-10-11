from __future__ import annotations

import pytest
from backend.agent.tool_selector import select_tools
from backend.mcp.guidance import forget
from backend.tools.registry import ToolSchema


@pytest.fixture(autouse=True)
def reset_caches():
    forget()
    yield
    forget()


def test_select_tools_withholds_offline_calendar_when_composio_connected(monkeypatch):
    """Bug 1: Agent calls create_calendar_event because select_tools includes it

    even when Google Calendar is actively connected via Composio.
    """
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"googlecalendar": {"status": "ACTIVE"}},
    )
    monkeypatch.setattr("backend.mcp.provider_ownership.is_provider_overridden_by_local", lambda p: False)

    schemas = [
        ToolSchema(name="view_file", description="", parameters={}),
        ToolSchema(name="create_calendar_event", description="Local calendar", parameters={}),
        ToolSchema(name="COMPOSIO_SEARCH_TOOLS__mcp__composio", description="", parameters={}),
        ToolSchema(name="COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio", description="", parameters={}),
    ]
    prompt = "Add an event on my calendar tomorrow at 3pm to get groceries"
    kept, withheld = select_tools(schemas, prompt)
    kept_names = [s.name for s in kept]

    # Offline create_calendar_event must NOT be offered when Google Calendar is active on Composio
    assert "create_calendar_event" not in kept_names
    assert "COMPOSIO_SEARCH_TOOLS__mcp__composio" in kept_names
    assert "COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio" in kept_names


def test_normalize_composio_multi_execute_args():
    """Bug 2: COMPOSIO_MULTI_EXECUTE_TOOL fails when arguments are not formatted

    as {"tools": [{"tool_slug": "...", "arguments": {...}}]}.
    """
    from backend.mcp.manager import normalize_composio_multi_execute_args

    # Case 1: user / LLM passes tool_slug at top level
    args1 = {
        "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
        "arguments": {"summary": "Get groceries", "start_datetime": "2026-10-12T15:00:00"},
    }
    norm1 = normalize_composio_multi_execute_args(args1)
    assert norm1 == {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries", "start_datetime": "2026-10-12T15:00:00"},
        }]
    }

    # Case 2: tools array provided, but uses 'name' or lacks 'tool_slug'
    args2 = {
        "tools": [{
            "name": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries"},
        }]
    }
    norm2 = normalize_composio_multi_execute_args(args2)
    assert norm2 == {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries"},
        }]
    }

    # Case 3: tools array provided, but parameters flattened without inner 'arguments'
    args3 = {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "summary": "Get groceries",
            "start": "tomorrow",
        }]
    }
    norm3 = normalize_composio_multi_execute_args(args3)
    assert norm3 == {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries", "start": "tomorrow"},
        }]
    }

    # Case 4: top-level parameters without tools or arguments keys
    args4 = {
        "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
        "summary": "Get groceries",
    }
    norm4 = normalize_composio_multi_execute_args(args4)
    assert norm4 == {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries"},
        }]
    }

    # Case 5: already perfectly structured
    args5 = {
        "tools": [{
            "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "arguments": {"summary": "Get groceries"},
        }]
    }
    norm5 = normalize_composio_multi_execute_args(args5)
    assert norm5 == args5


def test_catalog_search_and_cache_invalidation(monkeypatch):
    """Bug 3: Apps are not searchable on connectors and only 31 provided ones are visible.

    Catalog should support search queries, invalidate cache on key update, and expose all toolkits.
    """
    from backend.mcp.composio_service import composio_service

    # Invalidate cache when setting API key
    composio_service._catalog_cache = (9999999999.0, {"source": "stale", "cards": []})
    composio_service.set_api_key("comp_test_new_key")
    assert composio_service._catalog_cache is None

    # Search capability in list_catalog
    catalog = composio_service.list_catalog(search="telegram")
    # Even unauthenticated or offline, searching should find toolkits matching the query
    cards = catalog.get("cards", [])
    assert any("telegram" in c["slug"] or "telegram" in c.get("label", "").lower() for c in cards)
