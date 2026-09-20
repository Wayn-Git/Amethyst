"""Comprehensive verification tests for Phase 1 Research Milestone."""

import os
import pytest
from backend.agent.tool_search import CORE_TOOLS
from backend.agent.tool_selector import select_tools
from backend.runtime.types import ToolCall, ToolSchema
from backend.tools.base import ToolContext, ToolResult
from backend.tools.builtin.web import search_web, tools as web_tools
from backend.web.search_service import _clean_html, configured_search_api


def test_tool_aliases_registered():
    registered = {t.name: t for t in web_tools()}
    assert "search_web" in registered
    assert "tavily_search" in registered
    assert "web_search" in registered
    assert registered["tavily_search"].handler == search_web
    assert registered["web_search"].handler == search_web


def test_core_tools_contain_aliases():
    assert "search_web" in CORE_TOOLS
    assert "tavily_search" in CORE_TOOLS
    assert "web_search" in CORE_TOOLS
    assert "research_web" in CORE_TOOLS


def test_tool_selector_matches_tavily():
    schemas = [
        ToolSchema(name="search_web", description="Search the web", parameters={}),
        ToolSchema(name="tavily_search", description="Tavily search", parameters={}),
        ToolSchema(name="fetch_url", description="Fetch url", parameters={}),
    ]
    selected, withheld = select_tools(schemas, "Use tavily bruh or firecrawl")
    names = {s.name for s in selected}
    assert "search_web" in names or "tavily_search" in names


def test_opaque_citation_sanitization():
    raw = (
        "Rockstar confirms GTA VI launches Nov 19 2026.【89ccb5-09】 "
        "Further details will be shared soon.【ef8947-04】"
    )
    cleaned = _clean_html(raw)
    assert "【89ccb5-09】" not in cleaned
    assert "【ef8947-04】" not in cleaned
    assert "Rockstar confirms GTA VI launches Nov 19 2026." in cleaned
    assert "Further details will be shared soon." in cleaned


def test_tavily_env_var_support(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-12345")
    api = configured_search_api()
    assert api == "tavily"


@pytest.mark.asyncio
async def test_search_web_alias_dispatch(monkeypatch):
    async def mock_search(q, limit=6, depth=None):
        return [
            {
                "title": "GTA 6 Official News",
                "url": "https://www.rockstargames.com/gta-vi",
                "snippet": "Rockstar Games confirmed release.",
                "domain": "rockstargames.com",
                "published_date": "2026-09-19",
            }
        ]

    from backend.web import search_service
    monkeypatch.setattr(search_service, "search_web", mock_search)

    ctx = ToolContext(conversation_id="test_conv", workspace_root="/tmp")
    res1 = await search_web({"query": "What is the latest information about GTA 6?"}, ctx)
    assert not res1.is_error
    assert "rockstargames.com" in res1.content

    res2 = await search_web({"topic": "What is the latest information about GTA 6?"}, ctx)
    assert not res2.is_error
    assert "rockstargames.com" in res2.content
