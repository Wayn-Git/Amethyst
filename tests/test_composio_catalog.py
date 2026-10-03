from __future__ import annotations

import pytest
from backend.agent.tool_search_catalog import _classify_source, build_catalog, search_catalog
from backend.tools.base import Tool, ToolResult


def test_classify_composio_source():
    source, source_name = _classify_source("slack_chat_post_message__mcp__composio", "composio")
    assert source == "mcp"
    assert source_name == "composio:slack"

    source2, source_name2 = _classify_source("github_create_pull_request__mcp__composio", None)
    assert source2 == "mcp"
    assert source_name2 == "composio:github"


def test_search_catalog_with_composio_tools():
    tool = Tool(
        name="slack_chat_post_message__mcp__composio",
        description="Send a message to a channel on Slack.",
        parameters={
            "type": "object",
            "properties": {"channel": {"type": "string"}, "text": {"type": "string"}},
            "required": ["channel", "text"],
        },
        handler=lambda ctx, **kw: ToolResult(text="ok"),
    )
    catalog = build_catalog([tool])
    results = search_catalog(catalog, "slack post message")
    assert len(results) >= 1
    entry, score = results[0]
    assert entry.name == "slack_chat_post_message__mcp__composio"
    assert entry.source_name == "composio:slack"
