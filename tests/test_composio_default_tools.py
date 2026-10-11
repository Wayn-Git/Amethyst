from __future__ import annotations

import pytest

from backend.agent.prompt import compress_tool_schemas
from backend.agent.tool_selector import CORE, select_tools
from backend.mcp.guidance import forget, ready_connectors_block
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.builtin.tasks import create_calendar_event
from backend.tools.registry import ToolRegistry, ToolSchema


@pytest.fixture(autouse=True)
def reset_mcp_caches():
    forget()
    yield
    forget()


@pytest.mark.asyncio
async def test_composio_router_tools_included_in_schemas(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"googlecalendar": {"status": "ACTIVE"}},
    )

    registry = ToolRegistry()
    registry.register(
        Tool(
            name="COMPOSIO_SEARCH_TOOLS__mcp__composio",
            description="Search tools across 500+ apps",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )
    registry.register(
        Tool(
            name="COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio",
            description="Execute tools",
            parameters={},
            handler=lambda args, ctx: ToolResult.ok("ok"),
            risk=RiskLevel.LOW,
            source=ToolSource.MCP,
            server_name="composio",
        )
    )

    schemas = registry.schemas()
    names = [s.name for s in schemas]
    assert "COMPOSIO_SEARCH_TOOLS__mcp__composio" in names
    assert "COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio" in names


def test_select_tools_keeps_composio_as_default():
    schemas = [
        ToolSchema(name="view_file", description="", parameters={}),
        ToolSchema(name="create_calendar_event", description="", parameters={}),
        ToolSchema(name="COMPOSIO_SEARCH_TOOLS__mcp__composio", description="", parameters={}),
        ToolSchema(name="COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio", description="", parameters={}),
    ]
    prompt = "Add a reminder on my calender tomorrow that I have to get grocceies at 3 in the afternoon"
    kept, withheld = select_tools(schemas, prompt)
    kept_names = [s.name for s in kept]

    assert "COMPOSIO_SEARCH_TOOLS__mcp__composio" in kept_names
    assert "COMPOSIO_MULTI_EXECUTE_TOOL__mcp__composio" in kept_names
    assert "COMPOSIO_SEARCH_TOOLS" in CORE
    assert "COMPOSIO_MULTI_EXECUTE_TOOL" in CORE


def test_compress_tool_schemas_preserves_composio_description():
    desc = """
    Tool Server Info: Composio connects 500+ apps—Slack, GitHub, Notion, Google Workspace.
    Call COMPOSIO_SEARCH_TOOLS to discover tools.
    """
    tool = ToolSchema(
        name="COMPOSIO_SEARCH_TOOLS__mcp__composio",
        description=desc,
        parameters={},
    )
    compressed = compress_tool_schemas([tool])
    assert len(compressed) == 1
    assert "Tool Server Info" in compressed[0].description
    assert len(compressed[0].description) > 20


def test_ready_connectors_guidance_for_composio(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"googlecalendar": {"status": "ACTIVE"}, "gmail": {"status": "ACTIVE"}},
    )

    forget()
    guidance = ready_connectors_block()
    assert guidance is not None
    assert "composio:googlecalendar" in guidance
    assert "COMPOSIO_SEARCH_TOOLS" in guidance
    assert "COMPOSIO_MULTI_EXECUTE_TOOL" in guidance


@pytest.mark.asyncio
async def test_create_calendar_event_redirects_to_composio_when_connected(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        composio_service,
        "get_connections",
        lambda: {"googlecalendar": {"status": "ACTIVE"}},
    )
    monkeypatch.setattr("backend.mcp.provider_ownership.is_provider_overridden_by_local", lambda p: False)

    ctx = ToolContext()
    result = await create_calendar_event(
        {"title": "Groceries", "start_hint": "tomorrow at 3pm"},
        ctx,
    )
    assert result.is_error
    assert "Google Calendar connected via Composio" in result.content
    assert "COMPOSIO_SEARCH_TOOLS" in result.content
