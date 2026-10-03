from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director
from backend.runtime.types import (
    Capabilities,
    ModelResponse,
    ResolvedModel,
    ToolCall,
)
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


@pytest.mark.asyncio
async def test_parallel_calls_count_as_one_step(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    registry.register(Tool(name="search_web", description="search", parameters={}, handler=dummy))
    registry.register(Tool(name="fetch_url", description="fetch", parameters={}, handler=dummy))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    # 1 round with 2 parallel tool calls, then 1 final round with answer
    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="1", name="search_web", arguments={"query": "python"}),
                ToolCall(id="2", name="fetch_url", arguments={"url": "https://python.org"}),
            ]
        ),
        ModelResponse(text="Here is the information."),
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
    async for ev in director.run(cid, "search and fetch"):
        events.append(ev)

    done_events = [e.data for e in events if e.type == "done"]
    assert len(done_events) == 1
    done_data = done_events[0]
    # 2 rounds = 2 steps
    assert done_data["steps"] == 2
    # 2 tools executed
    assert done_data["tools"] == 2


@pytest.mark.asyncio
async def test_step_budget_warning_and_done_count_aligned(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("ok")

    registry.register(Tool(name="search_web", description="search", parameters={}, handler=dummy))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    # Temporarily set a small step budget to test the limit alignment
    monkeypatch.setattr(agent_config, "default_step_budget", 3)

    # Yield tool calls until limit is reached
    responses = [
        ModelResponse(tool_calls=[ToolCall(id=f"c{i}", name="search_web", arguments={"q": f"{i}"})])
        for i in range(2)
    ]
    # The 3rd round will be the final step where tool_schemas=None, so model returns text
    responses.append(ModelResponse(text="Final answer after limit."))
    turns = iter(responses)

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
    async for ev in director.run(cid, "keep searching"):
        events.append(ev)

    warnings = [e.data for e in events if e.type == "warning"]
    assert any("3-step limit" in w.get("message", "") for w in warnings)

    done_events = [e.data for e in events if e.type == "done"]
    assert len(done_events) == 1
    assert done_events[0]["steps"] == 3
