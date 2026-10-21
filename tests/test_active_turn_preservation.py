from __future__ import annotations

import json
import pytest

from backend.agent.director import Director
from backend.agent.prompt import compact_consumed_tool_results
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, ToolCall
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import Tool, ToolResult
from backend.tools.registry import ToolRegistry


def test_active_turn_tool_results_are_never_compacted():
    """Tool results in the active turn must stay intact across iterations."""
    messages = [
        {"role": "user", "content": "check calendar and search emails"},
        # Round 1: Model calls calendar and email
        {
            "role": "assistant",
            "tool_calls": [
                {"id": "c1", "function": {"name": "GOOGLECALENDAR_FIND_EVENT"}},
                {"id": "c2", "function": {"name": "GMAIL_FETCH_EMAILS"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "tool_name": "GOOGLECALENDAR_FIND_EVENT", "content": "Meeting at 10am"},
        {"role": "tool", "tool_call_id": "c2", "tool_name": "GMAIL_FETCH_EMAILS", "content": "Subject: GitHub Release"},
        # Round 2: Model calls search_web before final answer
        {
            "role": "assistant",
            "tool_calls": [
                {"id": "c3", "function": {"name": "search_web"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c3", "tool_name": "search_web", "content": "Release notes online"},
    ]

    compacted = compact_consumed_tool_results(messages, preserve_active_turn=True)

    # In the active turn, ALL tool results must be preserved in full
    assert compacted[2]["content"] == "Meeting at 10am"
    assert compacted[3]["content"] == "Subject: GitHub Release"
    assert compacted[5]["content"] == "Release notes online"


def test_previous_turn_tool_results_are_compacted_but_active_turn_preserved():
    """Tools from earlier turns are compacted; tools in the current turn remain full."""
    messages = [
        # Turn 1
        {"role": "user", "content": "create reminder"},
        {"role": "assistant", "tool_calls": [{"id": "t1", "function": {"name": "create_task"}}]},
        {"role": "tool", "tool_call_id": "t1", "tool_name": "create_task", "content": "Task #1 created"},
        {"role": "assistant", "content": "Reminder created for you."},
        # Turn 2 (active)
        {"role": "user", "content": "now search my calendar"},
        {"role": "assistant", "tool_calls": [{"id": "t2", "function": {"name": "list_calendar"}}]},
        {"role": "tool", "tool_call_id": "t2", "tool_name": "list_calendar", "content": "Dentist at 3pm"},
        {"role": "assistant", "tool_calls": [{"id": "t3", "function": {"name": "fetch_url"}}]},
        {"role": "tool", "tool_call_id": "t3", "tool_name": "fetch_url", "content": "Clinic directions"},
    ]

    compacted = compact_consumed_tool_results(messages, preserve_active_turn=True, preserve_recent_turns=0)

    # Turn 1 tool result was followed by an assistant answer and a new user message: compacted
    assert compacted[2]["content"] == "[create_task executed, result consumed]"

    # Turn 2 tool results are within the active turn: preserved
    assert compacted[6]["content"] == "Dentist at 3pm"
    assert compacted[8]["content"] == "Clinic directions"


@pytest.mark.asyncio
async def test_director_preserves_active_turn_results_across_iterations(monkeypatch):
    registry = ToolRegistry(ConfirmationService(auto_approve))

    async def dummy(args, ctx):
        return ToolResult.ok("Tool 1 data: release notes")

    registry.register(Tool(
        name="tool_1",
        description="Tool 1",
        parameters={},
        handler=dummy,
    ))

    async def dummy2(args, ctx):
        return ToolResult.ok("Tool 2 data: calendar events")

    registry.register(Tool(
        name="tool_2",
        description="Tool 2",
        parameters={},
        handler=dummy2,
    ))

    import backend.agent.director as director_module
    from backend.db.repositories import ConversationRepository

    received_messages_in_round3 = []

    # Round 1 calls tool_1
    # Round 2 calls tool_2
    # Round 3 sees history and outputs answer
    responses = iter([
        ModelResponse(tool_calls=[ToolCall(id="c1", name="tool_1", arguments={})]),
        ModelResponse(tool_calls=[ToolCall(id="c2", name="tool_2", arguments={})]),
        ModelResponse(text="Final synthesis of tool 1 and tool 2."),
    ])

    round_idx = 0

    class Client:
        async def complete(self, messages, tools=None, params=None):
            nonlocal round_idx
            round_idx += 1
            if round_idx == 3:
                received_messages_in_round3.extend(messages)
            return next(responses)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("f", "f", Client(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("f", "f")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = []
    async for ev in director.run(cid, "do two step lookup"):
        events.append(ev)

    # Check that in round 3, tool_1's result was NOT replaced by [tool_1 executed, result consumed]
    tool_messages = [m for m in received_messages_in_round3 if m.get("role") == "tool"]
    assert len(tool_messages) == 2
    assert "Tool 1 data: release notes" in tool_messages[0]["content"]
    assert "result consumed" not in tool_messages[0]["content"]
    assert "Tool 2 data: calendar events" in tool_messages[1]["content"]
    assert "result consumed" not in tool_messages[1]["content"]
