from __future__ import annotations

import pytest

from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


@pytest.mark.asyncio
async def test_capability_alias_resolution():
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    registry.register(Tool(name="fetch_url", description="fetch", parameters={}, handler=dummy))
    registry.register(Tool(name="search_web", description="search", parameters={}, handler=dummy))
    registry.register(Tool(name="GOOGLECALENDAR_FIND_EVENT", description="cal", parameters={}, handler=dummy))

    # Aliases with different casing and spaces
    assert registry.resolve_tool("Fetch Page") is not None
    assert registry.resolve_tool("Fetch Page").name == "fetch_url"
    assert registry.resolve_tool("fetch_page").name == "fetch_url"
    assert registry.resolve_tool("fetch").name == "fetch_url"

    assert registry.resolve_tool("Web Search").name == "search_web"
    assert registry.resolve_tool("web_search").name == "search_web"

    assert registry.resolve_tool("google_calendar").name == "GOOGLECALENDAR_FIND_EVENT"
    assert registry.resolve_tool("Google Calendar").name == "GOOGLECALENDAR_FIND_EVENT"
    assert registry.resolve_tool("find_event").name == "GOOGLECALENDAR_FIND_EVENT"


@pytest.mark.asyncio
async def test_unknown_tool_repair_error_message():
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    registry.register(Tool(name="fetch_url", description="fetch", parameters={}, handler=dummy))
    registry.register(Tool(name="search_web", description="search", parameters={}, handler=dummy))
    registry.register(Tool(name="view_file", description="view", parameters={}, handler=dummy))

    # Misspelled tool name
    res = await registry.dispatch("fetch_urll", {})
    assert res.is_error
    assert "Unknown tool 'fetch_urll'" in res.content
    assert "Valid tools: [" in res.content
    assert "Closest match: 'fetch_url'" in res.content

    # Another unknown tool
    res2 = await registry.dispatch("search_weeb", {})
    assert res2.is_error
    assert "Unknown tool 'search_weeb'" in res2.content
    assert "Closest match: 'search_web'" in res2.content
