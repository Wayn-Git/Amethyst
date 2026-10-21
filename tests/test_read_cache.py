from __future__ import annotations

import time
import pytest

from backend.agent.config import agent_config
from backend.agent.director import Director
from backend.agent.read_cache import (
    ReadCache,
    detect_tool_domain,
    is_mutation_tool,
    normalize_cache_args,
    read_cache,
)
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolResult
from backend.tools.registry import ToolRegistry


def test_read_cache_ttl_and_domain_detection():
    cache = ReadCache()

    assert detect_tool_domain("GOOGLECALENDAR_FIND_EVENT") == "calendar"
    assert detect_tool_domain("list_calendar_events") == "calendar"
    assert detect_tool_domain("GMAIL_FETCH_EMAILS") == "email"
    assert detect_tool_domain("search_email_messages") == "email"
    assert detect_tool_domain("run_shell_command") is None

    assert is_mutation_tool("GOOGLECALENDAR_CREATE_EVENT") is True
    assert is_mutation_tool("send_email") is True
    assert is_mutation_tool("GOOGLECALENDAR_FIND_EVENT") is False
    assert is_mutation_tool("GMAIL_FETCH_EMAILS") is False

    assert cache.get_ttl_for_tool("GOOGLECALENDAR_FIND_EVENT") == 60.0
    assert cache.get_ttl_for_tool("GMAIL_FETCH_EMAILS") == 180.0
    assert cache.get_ttl_for_tool("GOOGLECALENDAR_CREATE_EVENT") is None
    assert cache.get_ttl_for_tool("run_shell_command") is None


def test_read_cache_hit_and_expiry(monkeypatch):
    cache = ReadCache()
    tool = "GOOGLECALENDAR_FIND_EVENT"
    args = {"query": "dentist", "time_min": "2026-10-20T10:00:00Z"}

    # Initially empty
    assert cache.get(tool, args) is None

    # Set cache
    cache.set(tool, args, "Dentist appointment at 3pm")
    entry = cache.get(tool, args)
    assert entry is not None
    assert entry.content == "Dentist appointment at 3pm"

    # Advance time by 30s: still valid (< 60s)
    current_time = time.time()
    monkeypatch.setattr(time, "time", lambda: current_time + 30)
    assert cache.get(tool, args) is not None

    # Advance time by 61s: expired!
    monkeypatch.setattr(time, "time", lambda: current_time + 61)
    assert cache.get(tool, args) is None


def test_read_cache_mutation_invalidation():
    cache = ReadCache()
    cal_tool = "GOOGLECALENDAR_FIND_EVENT"
    mail_tool = "GMAIL_FETCH_EMAILS"

    cache.set(cal_tool, {"q": "sync"}, "Sync at 10am")
    cache.set(mail_tool, {"q": "github"}, "3 emails")

    assert cache.get(cal_tool, {"q": "sync"}) is not None
    assert cache.get(mail_tool, {"q": "github"}) is not None

    # Mutating calendar tool invalidates calendar domain only
    cache.invalidate_for_tool("GOOGLECALENDAR_CREATE_EVENT")
    assert cache.get(cal_tool, {"q": "sync"}) is None
    assert cache.get(mail_tool, {"q": "github"}) is not None

    # Mutating email tool invalidates email domain
    cache.invalidate_for_tool("GMAIL_SEND_EMAIL")
    assert cache.get(mail_tool, {"q": "github"}) is None


def test_read_cache_never_caches_errors():
    cache = ReadCache()
    cache.set("GOOGLECALENDAR_FIND_EVENT", {"q": "test"}, "Error 500", is_error=True)
    assert cache.get("GOOGLECALENDAR_FIND_EVENT", {"q": "test"}) is None


@pytest.mark.asyncio
async def test_director_uses_read_cache_across_turns(monkeypatch):
    read_cache.clear()
    registry = ToolRegistry(ConfirmationService(auto_approve))
    call_counts = {"calendar_find": 0, "calendar_create": 0}

    async def find_event_handler(args, ctx):
        call_counts["calendar_find"] += 1
        return ToolResult.ok(f"Event found: meeting #{call_counts["calendar_find"]}")

    async def create_event_handler(args, ctx):
        call_counts["calendar_create"] += 1
        return ToolResult.ok("Event created")

    registry.register(Tool(
        name="GOOGLECALENDAR_FIND_EVENT",
        description="Find events",
        parameters={},
        handler=find_event_handler,
    ))
    registry.register(Tool(
        name="GOOGLECALENDAR_CREATE_EVENT",
        description="Create event",
        parameters={},
        handler=create_event_handler,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    cid = ConversationRepository().create("f", "f")

    # Turn 1: Model calls GOOGLECALENDAR_FIND_EVENT
    # Turn 2: Model calls GOOGLECALENDAR_FIND_EVENT again with same args -> served from read_cache!
    # Turn 3: Model calls GOOGLECALENDAR_CREATE_EVENT -> invalidates calendar cache!
    # Turn 4: Model calls GOOGLECALENDAR_FIND_EVENT -> cache miss, runs handler again!

    current_responses = []

    class Client:
        async def complete(self, messages, tools=None, params=None):
            return current_responses.pop(0)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    director = Director(registry, stream=False, memory=False, retrieval=False)

    # --- Turn 1 ---
    current_responses = [
        ModelResponse(tool_calls=[ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"q": "dentist"})]),
        ModelResponse(text="Found the meeting."),
    ]
    async for _ in director.run(cid, "find my dentist appointment"):
        pass
    assert call_counts["calendar_find"] == 1

    # --- Turn 2 ---
    current_responses = [
        ModelResponse(tool_calls=[ToolCall(id="c2", name="GOOGLECALENDAR_FIND_EVENT", arguments={"q": "dentist"})]),
        ModelResponse(text="Found it again."),
    ]
    async for _ in director.run(cid, "find dentist appointment again"):
        pass
    # Must NOT have run the handler again (served from read_cache!)
    assert call_counts["calendar_find"] == 1

    # --- Turn 3 ---
    current_responses = [
        ModelResponse(tool_calls=[ToolCall(id="c3", name="GOOGLECALENDAR_CREATE_EVENT", arguments={"summary": "New meeting"})]),
        ModelResponse(text="Created new meeting."),
    ]
    async for _ in director.run(cid, "create a new meeting"):
        pass
    assert call_counts["calendar_create"] == 1

    # --- Turn 4 ---
    current_responses = [
        ModelResponse(tool_calls=[ToolCall(id="c4", name="GOOGLECALENDAR_FIND_EVENT", arguments={"q": "dentist"})]),
        ModelResponse(text="Found meeting."),
    ]
    async for _ in director.run(cid, "find dentist after mutation"):
        pass
    # Cache was invalidated by Turn 3 mutation, so handler executed!
    assert call_counts["calendar_find"] == 2
