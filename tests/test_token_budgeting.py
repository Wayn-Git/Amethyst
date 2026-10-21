from __future__ import annotations

import pytest

from backend.agent.prompt import (
    enforce_token_budget,
    estimate_prompt_tokens,
    ToolSchema,
)


def test_token_budgeting_no_drop_when_under_ceiling():
    messages = [
        {"role": "system", "content": "You are Amethyst."},
        {"role": "user", "content": "hello there"},
        {"role": "assistant", "content": "Hi!"},
    ]
    tools = [
        ToolSchema(name="fetch_weather", description="Check weather", parameters={}),
    ]

    # Ample context window (32,000)
    budgeted_msgs, budgeted_tools, dropped = enforce_token_budget(
        messages,
        tool_schemas=tools,
        context_window=32000,
        tokens_per_minute=None,
        threshold=0.85,
    )

    assert len(budgeted_msgs) == 3
    assert len(budgeted_tools) == 1
    assert dropped == []


def test_token_budgeting_step1_drops_old_tool_results_first():
    """When over ceiling, step 1 compacts old tool results before dropping turns or tools."""
    messages = [
        {"role": "system", "content": "system prompt"},
        # Turn 1: has bulky tool result
        {"role": "user", "content": "query 1"},
        {"role": "assistant", "tool_calls": [{"id": "c1", "function": {"name": "search"}}]},
        {"role": "tool", "tool_call_id": "c1", "tool_name": "search", "content": "x" * 2000},
        {"role": "assistant", "content": "summary 1"},
        # Turn 2: active turn
        {"role": "user", "content": "query 2 active"},
    ]
    tools = [
        ToolSchema(name="search", description="Search tool", parameters={}),
    ]

    # Set ceiling such that with 2000 chars tool result (~500 tokens) it exceeds ceiling (300),
    # but after compacting tool result to ~10 tokens it easily fits under ceiling.
    target_ceiling = 300
    # context_window * 0.85 = target_ceiling => context_window = ~353
    ctx_window = int(target_ceiling / 0.85)

    budgeted_msgs, budgeted_tools, dropped = enforce_token_budget(
        messages,
        tool_schemas=tools,
        context_window=ctx_window,
        tokens_per_minute=None,
        threshold=0.85,
    )

    # 1. Tool result was compacted
    tool_msg = next(m for m in budgeted_msgs if m.get("role") == "tool")
    assert tool_msg["content"] == "[search executed, result consumed]"

    # 2. Both turns are still present (no turns dropped!)
    user_msgs = [m for m in budgeted_msgs if m.get("role") == "user"]
    assert len(user_msgs) == 2
    assert user_msgs[0]["content"] == "query 1"
    assert user_msgs[1]["content"] == "query 2 active"

    # 3. Tools were NOT dropped
    assert len(budgeted_tools) == 1
    assert dropped == []


def test_token_budgeting_step2_drops_oldest_turns_when_compaction_insufficient():
    """When tool compaction is insufficient, step 2 drops the oldest completed turn."""
    messages = [
        {"role": "system", "content": "system"},
        # Turn 1: 1000 chars text
        {"role": "user", "content": "turn 1: " + ("word " * 150)},
        {"role": "assistant", "content": "ans 1: " + ("word " * 150)},
        # Turn 2: 1000 chars text
        {"role": "user", "content": "turn 2: " + ("word " * 150)},
        {"role": "assistant", "content": "ans 2: " + ("word " * 150)},
        # Turn 3: active turn
        {"role": "user", "content": "turn 3 active"},
    ]
    tools = [
        ToolSchema(name="tool_a", description="tool a", parameters={}),
    ]

    # Ceiling allows ~2 turns but not 3 turns
    ctx_window = 650

    budgeted_msgs, budgeted_tools, dropped = enforce_token_budget(
        messages,
        tool_schemas=tools,
        context_window=ctx_window,
        tokens_per_minute=None,
        threshold=0.85,
    )

    # Turn 1 was dropped, Turn 2 and Turn 3 remain
    user_msgs = [m for m in budgeted_msgs if m.get("role") == "user"]
    assert len(user_msgs) == 2
    assert "turn 2" in user_msgs[0]["content"]
    assert "turn 3 active" in user_msgs[1]["content"]

    # Tool was not dropped
    assert len(budgeted_tools) == 1
    assert dropped == []


def test_token_budgeting_step3_trims_tools_when_history_drop_insufficient():
    """When dropping history is still insufficient, step 3 trims low-priority tool schemas."""
    messages = [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "large prompt: " + ("query " * 80)},
    ]
    # 4 tool schemas
    tools = [
        ToolSchema(name="builtin_core", description="Core builtin tool", parameters={}),
        ToolSchema(name="mcp__serverA__tool1", description="Server A tool 1", parameters={}),
        ToolSchema(name="mcp__serverA__tool2", description="Server A tool 2", parameters={}),
        ToolSchema(name="mcp__serverB__tool3", description="Server B tool 3", parameters={}),
    ]

    ctx_window = 260

    budgeted_msgs, budgeted_tools, dropped = enforce_token_budget(
        messages,
        tool_schemas=tools,
        context_window=ctx_window,
        tokens_per_minute=None,
        threshold=0.85,
    )

    # Builtin tool is preserved; lower priority MCP tools are trimmed
    assert len(budgeted_tools) < len(tools)
    tool_names = [t.name for t in budgeted_tools]
    assert "builtin_core" in tool_names
    assert len(dropped) > 0


def test_token_budgeting_tpm_ceiling_takes_precedence():
    """Model with huge context window but small TPM enforces the TPM ceiling."""
    messages = [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "prompt: " + ("info " * 200)},
        {"role": "assistant", "content": "ans: " + ("info " * 200)},
        {"role": "user", "content": "active: " + ("info " * 100)},
    ]

    # Context window is 128k, but TPM is small (e.g. 500)
    # Target ceiling will be 500 / 1.25 = 400 tokens!
    budgeted_msgs, budgeted_tools, dropped = enforce_token_budget(
        messages,
        tool_schemas=[],
        context_window=128000,
        tokens_per_minute=500,
        margin=1.25,
        threshold=0.85,
    )

    # Prior turn was pruned because TPM ceiling of 400 tokens was enforced!
    user_msgs = [m for m in budgeted_msgs if m.get("role") == "user"]
    assert len(user_msgs) == 1
    assert "active" in user_msgs[0]["content"]
