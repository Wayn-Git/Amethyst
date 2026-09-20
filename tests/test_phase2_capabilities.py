"""Comprehensive verification tests for Phase 2 Capability Router."""

import pytest
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def test_capability_resolution():
    registry = ToolRegistry()
    search_tool = Tool(
        name="search_web",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("ok"),
        risk=RiskLevel.LOW,
    )
    fetch_tool = Tool(
        name="fetch_url",
        description="Fetch",
        parameters={"type": "object", "properties": {"url": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("ok"),
        risk=RiskLevel.LOW,
    )
    registry.register(search_tool)
    registry.register(fetch_tool)

    # 1. Exact match
    assert registry.get("search_web") == search_tool

    # 2. Canonical capability mappings
    assert registry.get("web_search") == search_tool
    assert registry.get("tavily") == search_tool
    assert registry.get("tavily_search") == search_tool
    assert registry.get("google_search") == search_tool
    assert registry.get("scrape") == fetch_tool
    assert registry.get("fetch_page") == fetch_tool


def test_mcp_loose_matching():
    registry = ToolRegistry()
    mcp_tavily = Tool(
        name="tavily_search__mcp__tavily",
        description="Tavily MCP tool",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("tavily mcp ok"),
        risk=RiskLevel.LOW,
        server_name="tavily",
    )
    mcp_firecrawl = Tool(
        name="scrape__mcp__firecrawl",
        description="Firecrawl scrape MCP tool",
        parameters={"type": "object", "properties": {"url": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("firecrawl mcp ok"),
        risk=RiskLevel.LOW,
        server_name="firecrawl",
    )
    registry.register(mcp_tavily)
    registry.register(mcp_firecrawl)

    # Model calling by base tool name
    assert registry.resolve_tool("tavily_search") == mcp_tavily
    assert registry.resolve_tool("scrape") == mcp_firecrawl

    # Model calling by server__tool or tool__server
    assert registry.resolve_tool("tavily__tavily_search") == mcp_tavily
    assert registry.resolve_tool("firecrawl__scrape") == mcp_firecrawl


def test_argument_normalization():
    tool = Tool(
        name="search_web",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("ok"),
        risk=RiskLevel.LOW,
    )
    norm = ToolRegistry.normalize_arguments(tool, {"q": "GTA 6 latest"})
    assert norm["query"] == "GTA 6 latest"

    norm_topic = ToolRegistry.normalize_arguments(tool, {"topic": "GTA 6 latest"})
    assert norm_topic["query"] == "GTA 6 latest"

    url_tool = Tool(
        name="fetch_url",
        description="Fetch",
        parameters={"type": "object", "properties": {"url": {"type": "string"}}},
        handler=lambda args, ctx: ToolResult.ok("ok"),
        risk=RiskLevel.LOW,
    )
    norm_url = ToolRegistry.normalize_arguments(url_tool, {"link": "https://rockstar.com"})
    assert norm_url["url"] == "https://rockstar.com"


@pytest.mark.asyncio
async def test_dispatch_via_capability_and_normalized_args():
    received_args = {}

    async def mock_handler(args, ctx):
        received_args.update(args)
        return ToolResult.ok(f"searched for {args.get('query')}")

    registry = ToolRegistry()
    search_tool = Tool(
        name="search_web",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
        handler=mock_handler,
        risk=RiskLevel.LOW,
    )
    registry.register(search_tool)

    # Model calls alias 'tavily_search' with parameter 'q'
    res = await registry.dispatch("tavily_search", {"q": "GTA 6 release date"}, ToolContext())
    assert not res.is_error
    assert "searched for GTA 6 release date" in res.content
    assert received_args["query"] == "GTA 6 release date"
