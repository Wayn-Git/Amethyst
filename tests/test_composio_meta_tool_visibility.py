from __future__ import annotations

import pytest

from backend.agent.director import Director, Guards
from backend.agent.tool_search import (
    COMPOSIO_META_TOOLS,
    CORE_TOOLS,
    assemble_tool_defs,
    classify_tools,
    dispatch_tool_search,
)
from backend.agent.tool_search_catalog import build_catalog, build_catalog_listing
from backend.agent.tool_selector import CORE, select_tools
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall, ToolSchema
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource
from backend.tools.registry import ToolRegistry


def test_composio_meta_tools_in_core_and_not_deferrable():
    for meta_tool in COMPOSIO_META_TOOLS:
        assert meta_tool in CORE_TOOLS
        assert meta_tool in CORE


def test_composio_meta_tools_always_visible_under_deferral(monkeypatch):
    from backend.mcp.composio_service import composio_service

    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    registry = ToolRegistry()
    # Register 100 dummy MCP tools to exceed 2000 catalog tokens threshold
    for i in range(100):
        registry.register(
            Tool(
                name=f"custom_tool_{i}__mcp__custom",
                description=f"A custom deferred tool number {i} with a detailed description explaining what it does in extensive text and more details for the catalog tokens threshold.",
                parameters={"type": "object", "properties": {"arg": {"type": "string"}}},
                handler=lambda args, ctx: ToolResult.ok("ok"),
                source=ToolSource.MCP,
                server_name="custom",
            )
        )

    # Register the 4 Composio meta-tools
    for meta_name in COMPOSIO_META_TOOLS:
        registry.register(
            Tool(
                name=f"{meta_name}__mcp__composio",
                description=f"Composio meta tool: {meta_name}",
                parameters={"type": "object", "properties": {"query": {"type": "string"}}},
                handler=lambda args, ctx: ToolResult.ok("ok"),
                source=ToolSource.MCP,
                server_name="composio",
            )
        )

    raw_schemas = registry.schemas()
    visible, catalog = classify_tools(raw_schemas, registry=registry)

    visible_names = {s.name for s in visible}
    catalog_names = {e.name for e in catalog}

    # Verify all 4 Composio meta tools are visible and not in catalog
    for meta_name in COMPOSIO_META_TOOLS:
        full_name = f"{meta_name}__mcp__composio"
        assert full_name in visible_names, f"{full_name} should be in visible tools"
        assert full_name not in catalog_names, f"{full_name} must NOT be deferred to catalog"

    # Verify assemble_tool_defs keeps them visible and excludes from listing
    final_schemas, final_catalog = assemble_tool_defs(raw_schemas, registry=registry)
    assert final_catalog is not None, "Deferral should be active with 100 tools"

    final_schema_names = {s.name for s in final_schemas}
    for meta_name in COMPOSIO_META_TOOLS:
        full_name = f"{meta_name}__mcp__composio"
        assert full_name in final_schema_names

    # Check listing string inside tool_search does not list Composio meta-tools
    tool_search_schema = next(s for s in final_schemas if s.name == "tool_search")
    for meta_name in COMPOSIO_META_TOOLS:
        assert f"- {meta_name}" not in tool_search_schema.description


@pytest.mark.asyncio
async def test_tool_search_returns_full_schema_for_top_matches():
    tools = [
        Tool(
            name=f"gmail_search_emails_{i}__mcp__mail",
            description=f"Search user emails with query and filters variant {i}",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Maximum results"},
                },
                "required": ["query"],
            },
            handler=lambda args, ctx: ToolResult.ok("ok"),
            source=ToolSource.MCP,
            server_name="mail",
        )
        for i in range(5)
    ]
    catalog = build_catalog(tools)
    result = await dispatch_tool_search(["search emails"], catalog)

    assert "results" in result
    matches = result["results"][0]["matches"]
    assert len(matches) <= 3, "tool_search should return at most top 3 matches"

    first_match = matches[0]
    assert "name" in first_match
    assert "source" in first_match
    assert "description" in first_match
    assert "parameters" in first_match
    assert first_match["parameters"]["type"] == "object"
    assert "query" in first_match["parameters"]["properties"]
    assert first_match["parameters"]["required"] == ["query"]


class ScriptedClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.seen_tools = []

    async def complete(self, messages, tools=None, params=None):
        self.seen_tools.append([t.name for t in tools or []])
        return self.responses.pop(0) if self.responses else ModelResponse(text="done")


@pytest.mark.asyncio
async def test_director_promotes_tool_search_matches_into_live_tools(db, monkeypatch):
    reg = ToolRegistry(ConfirmationService(auto_approve))
    # Register enough dummy MCP tools to activate tool deferral
    for i in range(100):
        reg.register(
            Tool(
                name=f"slack_channel_tool_{i}__mcp__slack",
                description=f"Manage slack channels and conversations {i} with lots of tokens so deferral activates",
                parameters={"type": "object", "properties": {"channel": {"type": "string"}}},
                handler=lambda args, ctx: ToolResult.ok("slack-ok"),
                source=ToolSource.MCP,
                server_name="slack",
            )
        )

    # Scripted LLM:
    # Call 1: model calls tool_search(queries=["slack channel"])
    # Call 2: model sees promoted tool directly and finishes
    scripted_client = ScriptedClient([
        ModelResponse(tool_calls=[
            ToolCall(id="c1", name="tool_search", arguments={"queries": ["slack channel"]})
        ]),
        ModelResponse(text="Found the tool and ready to use it."),
    ])

    resolved_model = ResolvedModel(
        provider="test",
        model="test-model",
        client=scripted_client,
        capabilities=Capabilities(streaming=False, context_window=32_000, tools=True),
    )
    monkeypatch.setattr("backend.agent.director.resolve", lambda *a, **k: resolved_model)

    cid = ConversationRepository().create("test", "test-model")
    director = Director(reg, memory=False, retrieval=False)
    events = [e async for e in director.run(cid, "help me with slack channel")]

    # Verification:
    # In iteration 0 (seen_tools[0]), deferral is active so slack_channel_tool_0 is NOT in seen_tools.
    # It has bridge tools: tool_search, tool_call.
    assert len(scripted_client.seen_tools) >= 2
    assert "tool_search" in scripted_client.seen_tools[0]
    assert "slack_channel_tool_0__mcp__slack" not in scripted_client.seen_tools[0]

    # In iteration 1 (seen_tools[1]), tool_search matches were promoted into live tool schemas!
    iter1_tools = scripted_client.seen_tools[1]
    has_promoted = any("slack_channel_tool_" in t for t in iter1_tools)
    assert has_promoted, f"Matched tool should be promoted into iteration 1 schemas, got: {iter1_tools}"
