from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.agent.director import (
    Director,
    _is_parallel_read_tool,
    _plan_tool_segments,
)
from backend.mcp.manager import MCPManager, normalize_result
from backend.runtime.types import (
    Capabilities,
    ModelResponse,
    ResolvedModel,
    ToolCall,
)
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.tools.registry import ToolRegistry


def test_is_parallel_read_tool_classification():
    # Read-only tools should be parallel-safe
    assert _is_parallel_read_tool("GOOGLECALENDAR_FIND_EVENT")
    assert _is_parallel_read_tool("GOOGLECALENDAR_LIST_CALENDARS")
    assert _is_parallel_read_tool("GMAIL_FETCH_EMAILS")
    assert _is_parallel_read_tool("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")
    assert _is_parallel_read_tool("GITHUB_GET_AN_ISSUE")
    assert _is_parallel_read_tool("SLACK_SEARCH_MESSAGES")
    assert _is_parallel_read_tool("NOTION_GET_PAGE_MARKDOWN")
    assert _is_parallel_read_tool("NOTION_QUERY_DATABASE")
    assert _is_parallel_read_tool("search_web")
    assert _is_parallel_read_tool("fetch_url")
    assert _is_parallel_read_tool("custom_fetch_data__mcp__service")

    # Mutation / write tools must NOT be parallel-safe
    assert not _is_parallel_read_tool("GOOGLECALENDAR_CREATE_EVENT")
    assert not _is_parallel_read_tool("GOOGLECALENDAR_UPDATE_EVENT")
    assert not _is_parallel_read_tool("GOOGLECALENDAR_DELETE_EVENT")
    assert not _is_parallel_read_tool("GMAIL_SEND_EMAIL")
    assert not _is_parallel_read_tool("GITHUB_CREATE_AN_ISSUE")
    assert not _is_parallel_read_tool("SLACK_SEND_MESSAGE")
    assert not _is_parallel_read_tool("NOTION_CREATE_NOTION_PAGE")
    assert not _is_parallel_read_tool("edit_file")
    assert not _is_parallel_read_tool("write_file")
    assert not _is_parallel_read_tool("run_shell_command")
    assert not _is_parallel_read_tool("ask_user")


def test_plan_tool_segments_parallel_reads():
    calls = [
        ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "team sync"}),
        ToolCall(id="c2", name="GMAIL_FETCH_EMAILS", arguments={"query": "github"}),
    ]
    segments = _plan_tool_segments(calls)
    assert len(segments) == 1
    seg_type, seg_calls = segments[0]
    assert seg_type == "parallel"
    assert len(seg_calls) == 2
    assert seg_calls[0].id == "c1"
    assert seg_calls[1].id == "c2"


def test_plan_tool_segments_separates_writers():
    calls = [
        ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "team sync"}),
        ToolCall(id="c2", name="GOOGLECALENDAR_CREATE_EVENT", arguments={"summary": "New Meeting"}),
    ]
    segments = _plan_tool_segments(calls)
    assert all(seg_type == "sequential" for seg_type, _ in segments)
    call_ids = [c.id for _, s_calls in segments for c in s_calls]
    assert call_ids == ["c1", "c2"]


@pytest.mark.asyncio
async def test_execute_composio_batch():
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry, open_browser=False)

    fake_conn = MagicMock()
    fake_conn.connected = True

    multi_res_payload = {
        "data": {
            "results": [
                {
                    "response": {
                        "successful": True,
                        "data": {"events": [{"id": "ev1", "summary": "Standup"}]},
                    }
                },
                {
                    "response": {
                        "successful": True,
                        "data": {"messages": [{"id": "m1", "snippet": "GitHub notification"}]},
                    }
                },
            ]
        }
    }
    fake_conn.call = AsyncMock(
        return_value={"content": [{"type": "text", "text": json.dumps(multi_res_payload)}]}
    )
    manager.connections["composio"] = fake_conn

    calls = [
        ToolCall(id="1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"query": "standup"}),
        ToolCall(id="2", name="GMAIL_FETCH_EMAILS", arguments={"query": "github"}),
    ]

    results = await manager.execute_composio_batch(calls)
    assert len(results) == 2
    assert not results[0].is_error
    assert "Standup" in results[0].content
    assert not results[1].is_error
    assert "GitHub notification" in results[1].content

    fake_conn.call.assert_awaited_once()
    called_tool_name, called_args = fake_conn.call.call_args[0]
    assert called_tool_name == "COMPOSIO_MULTI_EXECUTE_TOOL"
    assert len(called_args["tools"]) == 2
    assert called_args["tools"][0]["tool_slug"] == "GOOGLECALENDAR_FIND_EVENT"
    assert called_args["tools"][1]["tool_slug"] == "GMAIL_FETCH_EMAILS"


@pytest.mark.asyncio
async def test_director_parallel_batch_execution_yields_events(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))
    manager = MCPManager(registry, open_browser=False)

    fake_conn = MagicMock()
    fake_conn.connected = True
    multi_res_payload = {
        "data": {
            "results": [
                {"response": {"successful": True, "data": {"calendar": "ok"}}},
                {"response": {"successful": True, "data": {"emails": "ok"}}},
            ]
        }
    }
    fake_conn.call = AsyncMock(
        return_value={"content": [{"type": "text", "text": json.dumps(multi_res_payload)}]}
    )
    manager.connections["composio"] = fake_conn

    async def dummy_handler(args, ctx):
        return ToolResult.ok("individual")

    registry.register(
        Tool(
            name="GOOGLECALENDAR_FIND_EVENT",
            description="Find calendar event",
            parameters={"type": "object"},
            handler=dummy_handler,
            server_name="composio",
        )
    )
    registry.register(
        Tool(
            name="GMAIL_FETCH_EMAILS",
            description="Fetch emails",
            parameters={"type": "object"},
            handler=dummy_handler,
            server_name="composio",
        )
    )

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    turns = iter([
        ModelResponse(
            tool_calls=[
                ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"q": "cal"}),
                ToolCall(id="c2", name="GMAIL_FETCH_EMAILS", arguments={"q": "mail"}),
            ]
        ),
        ModelResponse(text="Here are your calendar and email results."),
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
    async for ev in director.run(cid, "check calendar and emails"):
        events.append(ev)

    tool_calls_emitted = [e.data for e in events if e.type == "tool_call"]
    assert len(tool_calls_emitted) == 2
    assert tool_calls_emitted[0]["name"] == "GOOGLECALENDAR_FIND_EVENT"
    assert tool_calls_emitted[1]["name"] == "GMAIL_FETCH_EMAILS"

    tool_results_emitted = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results_emitted) == 2
    assert "calendar" in tool_results_emitted[0]["content"]
    assert "emails" in tool_results_emitted[1]["content"]

    fake_conn.call.assert_awaited_once()
