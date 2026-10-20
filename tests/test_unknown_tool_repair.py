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


@pytest.mark.asyncio
async def test_write_tools_never_auto_repaired():
    from backend.tools.base import RiskLevel

    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    registry.register(Tool(name="search_web", description="search", parameters={}, handler=dummy, risk=RiskLevel.LOW))
    registry.register(Tool(name="GOOGLECALENDAR_CREATE_EVENT", description="create event", parameters={}, handler=dummy, risk=RiskLevel.HIGH))
    registry.register(Tool(name="GMAIL_SEND_EMAIL", description="send email", parameters={}, handler=dummy, risk=RiskLevel.HIGH))
    registry.register(Tool(name="delete_file", description="delete file", parameters={}, handler=dummy, risk=RiskLevel.HIGH))

    # Exact name matches are allowed
    assert registry.resolve_tool("GOOGLECALENDAR_CREATE_EVENT") is not None
    assert registry.resolve_tool("GMAIL_SEND_EMAIL") is not None
    assert registry.resolve_tool("delete_file") is not None

    # Write tools must NEVER be fuzzy matched or aliased
    assert registry.resolve_tool("create_event") is None
    assert registry.resolve_tool("create_an_event") is None
    assert registry.resolve_tool("send_email") is None
    assert registry.resolve_tool("send_mail") is None
    assert registry.resolve_tool("delete_a_file") is None
    assert registry.resolve_tool("Delete File") is None

    # Unknown write tool returns formatted error with closest match
    res = await registry.dispatch("create_event", {})
    assert res.is_error
    assert "Unknown tool 'create_event'" in res.content
    assert "Valid tools: [" in res.content
    assert "Closest match: 'GOOGLECALENDAR_CREATE_EVENT'" in res.content

    res2 = await registry.dispatch("send_mail", {})
    assert res2.is_error
    assert "Unknown tool 'send_mail'" in res2.content
    assert "Valid tools: [" in res2.content
    assert "Closest match: 'GMAIL_SEND_EMAIL'" in res2.content

