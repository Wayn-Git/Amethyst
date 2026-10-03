from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.agent.director import Director, execution_cache_key
from backend.agent.state import AgentState
from backend.runtime.types import (
    Capabilities,
    ModelResponse,
    ResolvedModel,
    ToolCall,
)
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def test_execution_cache_key_normalization():
    key1 = execution_cache_key("view_file", {"path": "README.md", "encoding": "utf-8"})
    key2 = execution_cache_key("view_file", {"encoding": "utf-8", "path": "README.md"})
    assert key1 == key2

    # Bare vs composite MCP name normalization
    key_bare = execution_cache_key("GOOGLECALENDAR_FIND_EVENT", {"query": "sync"})
    key_comp = execution_cache_key("GOOGLECALENDAR_FIND_EVENT__mcp__composio", {"query": "sync"})
    assert key_bare == key_comp


@pytest.mark.asyncio
async def test_in_turn_dedupe_prevents_duplicate_tool_execution(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    call_count = {"calendar": 0}

    async def counting_calendar_handler(args, ctx):
        call_count["calendar"] += 1
        return ToolResult.ok(json.dumps({"events": ["Meeting 1", "Meeting 2"]}))

    registry.register(
        Tool(
            name="GOOGLECALENDAR_FIND_EVENT",
            description="Find calendar event",
            parameters={"type": "object"},
            handler=counting_calendar_handler,
        )
    )

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    # Turn 1: model calls calendar in round 1, then again in round 2 with identical arguments
    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "team"}),
            ]
        ),
        ModelResponse(
            tool_calls=[
                ToolCall(id="c2", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "team"}),
            ]
        ),
        ModelResponse(text="Done."),
    ])

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "what is on my calendar?"):
        events.append(ev)

    # The tool handler must only have been invoked ONCE
    assert call_count["calendar"] == 1

    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2

    # First result was genuine
    assert "Meeting 1" in tool_results[0]["content"]
    assert "[already fetched this turn" not in tool_results[0]["content"]

    # Second result came from in-turn cache with dedupe note
    assert "[already fetched this turn: using cached result]" in tool_results[1]["content"]
    assert "Meeting 1" in tool_results[1]["content"]
