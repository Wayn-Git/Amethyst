from __future__ import annotations

import json
import pytest

from backend.agent.projection import (
    project_calendar_item,
    project_email_item,
    project_github_item,
    project_tool_result_content,
)
from backend.agent.director import Director
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolResult
from backend.tools.registry import ToolRegistry


def test_project_email_item():
    raw_email = {
        "id": "18c2f10",
        "threadId": "18c2f10",
        "labelIds": ["INBOX", "UNREAD"],
        "snippet": "Here is the release note for Amethyst v2.0",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": "GitHub <notifications@github.com>"},
                {"name": "Subject", "value": "Release v2.0"},
                {"name": "Date", "value": "Tue, 20 Oct 2026 12:00:00 +0000"},
                {"name": "DKIM-Signature", "value": "v=1; a=rsa-sha256; ..."},
                {"name": "Received", "value": "from mail.github.com ..."},
            ],
            "body": {"size": 0},
        },
    }
    projected = project_email_item(raw_email)
    assert projected["id"] == "18c2f10"
    assert projected["from"] == "GitHub <notifications@github.com>"
    assert projected["subject"] == "Release v2.0"
    assert projected["date"] == "Tue, 20 Oct 2026 12:00:00 +0000"
    assert "Here is the release note" in projected["snippet"]
    assert projected["unread"] is True
    assert "payload" not in projected
    assert "headers" not in projected


def test_project_calendar_item():
    raw_event = {
        "id": "evt123",
        "kind": "calendar#event",
        "etag": '"3284918239"',
        "status": "confirmed",
        "htmlLink": "https://calendar.google.com/event?eid=123",
        "summary": "Design Sync",
        "creator": {"email": "boss@company.com", "displayName": "Boss"},
        "start": {"dateTime": "2026-10-21T10:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-10-21T10:30:00Z", "timeZone": "UTC"},
        "location": "Room A",
        "attendees": [
            {"email": "boss@company.com", "responseStatus": "accepted"},
            {"email": "wayne@company.com", "responseStatus": "accepted"},
        ],
    }
    projected = project_calendar_item(raw_event)
    assert projected["id"] == "evt123"
    assert projected["title"] == "Design Sync"
    assert projected["start"] == "2026-10-21T10:00:00Z"
    assert projected["end"] == "2026-10-21T10:30:00Z"
    assert projected["location"] == "Room A"
    assert projected["attendees"] == ["boss@company.com", "wayne@company.com"]
    assert "creator" not in projected
    assert "kind" not in projected
    assert "etag" not in projected


def test_project_github_item():
    raw_issue = {
        "number": 42,
        "title": "Fix memory leak in background worker",
        "state": "open",
        "user": {"login": "octocat", "avatar_url": "https://avatars.githubusercontent.com/u/1"},
        "created_at": "2026-10-19T08:00:00Z",
        "body": "Detailed description of the memory leak issue with stack traces...",
        "html_url": "https://github.com/org/repo/issues/42",
        "labels": [{"name": "bug"}, {"name": "priority:high"}],
    }
    projected = project_github_item(raw_issue)
    assert projected["number"] == 42
    assert projected["title"] == "Fix memory leak in background worker"
    assert projected["state"] == "open"
    assert projected["author"] == "octocat"
    assert projected["created_at"] == "2026-10-19T08:00:00Z"
    assert "labels" in projected
    assert projected["labels"] == ["bug", "priority:high"]
    assert "avatar_url" not in projected


def test_project_tool_result_content_email_list():
    raw_content = json.dumps({
        "messages": [
            {
                "id": "1",
                "snippet": "Hello world snippet",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "alice@example.com"},
                        {"name": "Subject", "value": "Hello"},
                    ]
                },
            }
        ]
    })
    projected_str = project_tool_result_content(raw_content, tool_name="GMAIL_FETCH_EMAILS")
    data = json.loads(projected_str)
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["from"] == "alice@example.com"
    assert data[0]["subject"] == "Hello"
    assert data[0]["snippet"] == "Hello world snippet"


@pytest.mark.asyncio
async def test_director_projects_tool_result(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    raw_response = json.dumps({
        "items": [
            {
                "id": "e1",
                "summary": "Team Standup",
                "kind": "calendar#event",
                "etag": "12345",
                "start": {"dateTime": "2026-10-21T09:00:00Z"},
                "end": {"dateTime": "2026-10-21T09:15:00Z"},
            }
        ]
    })

    async def calendar_handler(args, ctx):
        return ToolResult.ok(raw_response)

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
        ModelResponse(text="Got events."),
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

    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 1
    content_obj = json.loads(tool_results[0]["content"])
    assert isinstance(content_obj, list)
    assert content_obj[0]["title"] == "Team Standup"
    assert "kind" not in content_obj[0]
    assert "etag" not in content_obj[0]
