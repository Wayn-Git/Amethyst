from __future__ import annotations

import json
import pytest

from backend.agent.config import agent_config
from backend.agent.prompt import compact_consumed_tool_results, to_wire_messages
from backend.db.repositories import Message


def test_history_compaction_keeps_recent_turns_verbatim_and_compacts_older_turns():
    """Verify that older completed turns are compacted with item counts, while recent turns remain verbatim."""
    messages = [
        # Turn 1: 3 turns ago (older completed turn)
        {"role": "user", "content": "fetch my emails"},
        {"role": "assistant", "tool_calls": [{"id": "c1", "function": {"name": "GMAIL_FETCH_EMAILS"}}]},
        {
            "role": "tool",
            "tool_call_id": "c1",
            "tool_name": "GMAIL_FETCH_EMAILS",
            "content": json.dumps([
                {"id": "m1", "subject": "Quarterly Report"},
                {"id": "m2", "subject": "All Hands"},
                {"id": "m3", "subject": "Design Review"},
            ]),
        },
        {"role": "assistant", "content": "You have 3 emails."},

        # Turn 2: 2 turns ago (recent completed turn)
        {"role": "user", "content": "check my calendar"},
        {"role": "assistant", "tool_calls": [{"id": "c2", "function": {"name": "GOOGLECALENDAR_FIND_EVENT"}}]},
        {
            "role": "tool",
            "tool_call_id": "c2",
            "tool_name": "GOOGLECALENDAR_FIND_EVENT",
            "content": json.dumps({"events": [{"title": "Team Sync", "start": "10:00"}]}),
        },
        {"role": "assistant", "content": "You have a Team Sync at 10:00."},

        # Turn 3: 1 turn ago (recent completed turn)
        {"role": "user", "content": "search the web for weather"},
        {"role": "assistant", "tool_calls": [{"id": "c3", "function": {"name": "search_web"}}]},
        {
            "role": "tool",
            "tool_call_id": "c3",
            "tool_name": "search_web",
            "content": "Sunny, 22C in San Francisco.",
        },
        {"role": "assistant", "content": "It is sunny in SF."},

        # Turn 4: Active turn
        {"role": "user", "content": "what should I wear?"},
        {"role": "assistant", "tool_calls": [{"id": "c4", "function": {"name": "consult_wardrobe"}}]},
        {
            "role": "tool",
            "tool_call_id": "c4",
            "tool_name": "consult_wardrobe",
            "content": "Light jacket recommended.",
        },
    ]

    # With preserve_recent_turns=2 (default):
    # - Turn 1 (c1) is older -> compacted to "[GMAIL_FETCH_EMAILS: processed 3 items]"
    # - Turn 2 (c2) is within last 2 completed turns -> verbatim
    # - Turn 3 (c3) is within last 2 completed turns -> verbatim
    # - Turn 4 (c4) is active -> verbatim
    compacted = compact_consumed_tool_results(messages, preserve_active_turn=True, preserve_recent_turns=2)

    assert compacted[2]["role"] == "tool"
    assert compacted[2]["tool_call_id"] == "c1"
    assert compacted[2]["tool_name"] == "GMAIL_FETCH_EMAILS"
    assert compacted[2]["content"] == "[GMAIL_FETCH_EMAILS: processed 3 items]"

    assert "Team Sync" in compacted[6]["content"]
    assert compacted[6]["tool_call_id"] == "c2"

    assert compacted[10]["content"] == "Sunny, 22C in San Francisco."
    assert compacted[10]["tool_call_id"] == "c3"

    assert compacted[14]["content"] == "Light jacket recommended."
    assert compacted[14]["tool_call_id"] == "c4"


def test_history_compaction_item_count_heuristics():
    """Test extraction of item counts from lists and dictionary keys."""
    # List of 4 items
    list_msgs = [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "get_items"}}]},
        {"role": "tool", "tool_call_id": "1", "tool_name": "get_items", "content": json.dumps([1, 2, 3, 4])},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
    ]
    res = compact_consumed_tool_results(list_msgs, preserve_recent_turns=0)
    assert res[2]["content"] == "[get_items: processed 4 items]"

    # Dict with single item
    single_item_msgs = [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "find_lead"}}]},
        {"role": "tool", "tool_call_id": "1", "tool_name": "find_lead", "content": json.dumps({"results": [{"id": 99}]})},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
    ]
    res_single = compact_consumed_tool_results(single_item_msgs, preserve_recent_turns=0)
    assert res_single[2]["content"] == "[find_lead: processed 1 item]"

    # Plain text / non-countable
    plain_msgs = [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "run_shell"}}]},
        {"role": "tool", "tool_call_id": "1", "tool_name": "run_shell", "content": "Build succeeded without error."},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
    ]
    res_plain = compact_consumed_tool_results(plain_msgs, preserve_recent_turns=0)
    assert res_plain[2]["content"] == "[run_shell executed, result consumed]"


def test_to_wire_messages_integrates_history_compaction():
    """Verify to_wire_messages applies history compaction on Message objects."""
    history = [
        Message(id=1, role="user", content="fetch items"),
        Message(
            id=2,
            role="assistant",
            content="",
            tool_calls=[{"id": "call_1", "type": "function", "function": {"name": "fetch_list", "arguments": "{}"}}],
        ),
        Message(
            id=3,
            role="tool",
            content=json.dumps([{"id": i} for i in range(5)]),
            tool_call_id="call_1",
            tool_name="fetch_list",
        ),
        Message(id=4, role="assistant", content="Found 5 items."),
        Message(id=5, role="user", content="turn 2"),
        Message(id=6, role="assistant", content="turn 2 ans"),
        Message(id=7, role="user", content="turn 3"),
        Message(id=8, role="assistant", content="turn 3 ans"),
        Message(id=9, role="user", content="turn 4 active"),
    ]

    wire = to_wire_messages(history)
    tool_msg = next(m for m in wire if m.get("role") == "tool")
    assert tool_msg["content"] == "[fetch_list: processed 5 items]"
    assert tool_msg["tool_call_id"] == "call_1"
