from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from backend.agent.config import agent_config
from backend.agent.defaults import apply_tool_defaults
from backend.agent.director import Director
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolResult
from backend.tools.registry import ToolRegistry


def test_calendar_find_event_defaults():
    args = apply_tool_defaults("GOOGLECALENDAR_FIND_EVENT", {})
    assert "time_min" in args
    assert "time_max" in args
    assert args["max_results"] == 10
    assert args["single_events"] is True

    # Check 7 day window
    t_min = datetime.fromisoformat(args["time_min"])
    t_max = datetime.fromisoformat(args["time_max"])
    delta_days = (t_max - t_min).days
    assert delta_days == agent_config.default_date_window_days


def test_calendar_find_event_preserves_bounds_clamps_max_results():
    explicit = {
        "time_min": "2026-11-01T00:00:00Z",
        "time_max": "2026-11-15T00:00:00Z",
        "max_results": 100,
    }
    args = apply_tool_defaults("GOOGLECALENDAR_FIND_EVENT", explicit)
    assert args["time_min"] == "2026-11-01T00:00:00Z"
    assert args["time_max"] == "2026-11-15T00:00:00Z"
    assert args["max_results"] == 10


def test_gmail_fetch_emails_defaults():
    args = apply_tool_defaults("GMAIL_FETCH_EMAILS", {"query": "is:unread"})
    assert args["query"] == "is:unread"
    assert args["max_results"] == 10
    assert args["verbose"] is False


def test_gmail_fetch_emails_clamps_max_results():
    args = apply_tool_defaults("GMAIL_FETCH_EMAILS", {"query": "github", "max_results": 50})
    assert args["max_results"] == 10


def test_search_web_clamps_limit():
    args = apply_tool_defaults("search_web", {"query": "python", "limit": 25})
    assert args["limit"] == 10


def test_slack_and_notion_clamping():
    slack_args = apply_tool_defaults("SLACK_SEARCH_MESSAGES", {"query": "status", "count": 100})
    assert slack_args["count"] == 10

    notion_args = apply_tool_defaults("NOTION_SEARCH_NOTION_PAGE", {"query": "specs", "page_size": 50})
    assert notion_args["page_size"] == 10


@pytest.mark.asyncio
async def test_director_applies_defaults_to_dispatched_tool(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    received_args = {}

    async def calendar_handler(args, ctx):
        received_args.update(args)
        return ToolResult.ok("[]")

    registry.register(Tool(
        name="GOOGLECALENDAR_FIND_EVENT",
        description="Find events",
        parameters={},
        handler=calendar_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="1", name="GOOGLECALENDAR_FIND_EVENT", arguments={})
            ]
        ),
        ModelResponse(text="Found no events."),
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
    async for ev in director.run(cid, "what is on my calendar"):
        events.append(ev)

    assert "time_min" in received_args
    assert "time_max" in received_args
    assert received_args["max_results"] == 10


def test_model_initiated_offset_pagination_blocked_by_default():
    # 1. Model tries offset pagination without user asking
    args = apply_tool_defaults("search_web", {"query": "python", "offset": 10})
    assert args.get("offset") == 0

    # 2. Model tries page / token pagination without user asking
    args2 = apply_tool_defaults(
        "GMAIL_FETCH_EMAILS",
        {"query": "github", "page_token": "token123", "page": 2, "offset": 20},
    )
    assert "page_token" not in args2
    assert args2.get("page") == 1
    assert args2.get("offset") == 0

    # 3. Model tries cursor / skip / startIndex pagination
    args3 = apply_tool_defaults(
        "NOTION_SEARCH_NOTION_PAGE",
        {"query": "notes", "cursor": "cur_abc", "skip": 15, "startIndex": 30},
    )
    assert "cursor" not in args3
    assert args3.get("skip") == 0
    assert args3.get("startIndex") == 0


def test_user_requested_pagination_allowed():
    # When user explicitly asks for more, pagination arguments are preserved
    more_args = apply_tool_defaults(
        "search_web",
        {"query": "python", "offset": 10},
        user_prompt="show more results please",
    )
    assert more_args.get("offset") == 10

    next_page_args = apply_tool_defaults(
        "GMAIL_FETCH_EMAILS",
        {"query": "github", "page_token": "token123", "page": 2},
        user_prompt="load the next page of emails",
    )
    assert next_page_args.get("page_token") == "token123"
    assert next_page_args.get("page") == 2


@pytest.mark.asyncio
async def test_director_blocks_model_initiated_offset_pagination_during_run(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    received_args = {}

    async def search_handler(args, ctx):
        received_args.update(args)
        return ToolResult.ok("[]")

    registry.register(Tool(
        name="search_web",
        description="Search web",
        parameters={},
        handler=search_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="1", name="search_web", arguments={"query": "python", "offset": 50, "page": 3})
            ]
        ),
        ModelResponse(text="Found results."),
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
    # User did NOT ask for more/next page
    async for ev in director.run(cid, "what is python?"):
        events.append(ev)

    # Offset pagination was neutralized
    assert received_args.get("offset") == 0
    assert received_args.get("page") == 1

