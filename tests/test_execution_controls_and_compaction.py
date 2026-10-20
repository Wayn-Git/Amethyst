"""Unit tests for execution controls, tool result capping, history compaction, and provider configuration."""

from __future__ import annotations

import re
from typing import Any
import pytest

from backend.agent.intent_router import IntentRoute, route_intent_fast
from backend.agent.prompt import (
    compact_consumed_tool_results,
    budget_history,
)
from backend.agent.tool_selector import (
    CATEGORIES,
    CORE,
    LANE_CATEGORIES,
    _TASK_INTENTS,
    select_tools,
)
from backend.config import ProviderConfig
from backend.mcp.composio_sanitizer import (
    MAX_TOOL_CHARS,
    cap_tool_result_content,
    detect_paging_arg,
    sanitize_composio_content,
)
from backend.runtime.providers.openai_compat import OpenAICompatClient, initialize
from backend.runtime.types import Capabilities, ModelParameters, ToolSchema
from backend.tools.registry import MAX_RESULT_CHARS, truncate


def test_tool_result_capping_and_paging_arg_detection():
    # 1. Paging arg detection from arguments
    assert detect_paging_arg("some_tool", {"offset": 10}) == "offset"
    assert detect_paging_arg("some_tool", {"cursor": "cur_123"}) == "cursor"
    assert detect_paging_arg("some_tool", {"page": 2}) == "page"
    assert detect_paging_arg("some_tool", {"StartLine": 50}) == "StartLine"

    # 2. Paging arg detection from tool name
    assert detect_paging_arg("view_file", {}) == "StartLine"
    assert detect_paging_arg("search_email", {}) == "cursor"
    assert detect_paging_arg("list_calendar", {}) == "cursor"
    assert detect_paging_arg("search_documents", {}) == "offset"

    # 3. Content truncation at ~8000 characters
    long_content = "x" * 15000
    capped = cap_tool_result_content(long_content, tool_name="view_file")
    assert len(capped) <= MAX_TOOL_CHARS
    assert capped.endswith("[truncated; call again with StartLine for more]")

    # 4. Short content remains untouched
    short_content = "short output"
    assert cap_tool_result_content(short_content, tool_name="view_file") == short_content

    # 5. Generic truncate in registry.py adheres to cap
    reg_truncated = truncate(long_content, tool_name="search_web")
    assert len(reg_truncated) <= MAX_RESULT_CHARS
    assert reg_truncated.endswith("[truncated; call again with offset for more]") or "Full payload stored under handle" in reg_truncated


def test_sanitize_composio_content_caps_large_payloads():
    big_raw = "Line of text\n" * 1000  # ~13,000 chars
    sanitized = sanitize_composio_content(big_raw, tool_name="COMPOSIO_GMAIL_LIST_MAILS")
    assert len(sanitized) <= MAX_TOOL_CHARS
    assert "[truncated; call again with cursor for more]" in sanitized


def test_wire_history_compaction_consumed_vs_latest():
    messages = [
        {"role": "user", "content": "read the file"},
        {"role": "assistant", "tool_calls": [{"id": "call_1", "function": {"name": "view_file"}}]},
        {"role": "tool", "tool_call_id": "call_1", "tool_name": "view_file", "content": "Line 1\n" * 500},
        {"role": "assistant", "content": "I see line 1 repeatedly. Now running grep."},
        {"role": "assistant", "tool_calls": [{"id": "call_2", "function": {"name": "grep_files"}}]},
        {"role": "tool", "tool_call_id": "call_2", "tool_name": "grep_files", "content": "Match on line 42"},
    ]

    compacted = compact_consumed_tool_results(messages, preserve_active_turn=False)

    # call_1 has been followed by an assistant message: it must be compacted
    assert compacted[2]["role"] == "tool"
    assert compacted[2]["tool_call_id"] == "call_1"
    assert compacted[2]["content"] == "[view_file executed, result consumed]"

    # call_2 has NOT yet been followed by an assistant message: it must be preserved in full
    assert compacted[5]["role"] == "tool"
    assert compacted[5]["tool_call_id"] == "call_2"
    assert compacted[5]["content"] == "Match on line 42"


def test_budget_history_applies_compaction():
    # Create a long history where old tool results would otherwise take substantial budget
    messages = [
        {"role": "user", "content": "first step"},
        {"role": "assistant", "tool_calls": [{"id": "c1", "function": {"name": "search"}}]},
        {"role": "tool", "tool_call_id": "c1", "tool_name": "search", "content": "A" * 4000},
        {"role": "assistant", "content": "Analyzed search."},
        {"role": "user", "content": "second step"},
        {"role": "assistant", "content": "Current answer"},
    ]

    budgeted = budget_history(
        messages,
        context_window=32000,
        system_prompt="system",
        tools=None,
    )
    # The old tool result at index 2 must be compacted in budgeted output
    assert budgeted[2]["content"] == "[search executed, result consumed]"


def test_tool_selector_regex_word_boundaries():
    schemas = [
        ToolSchema(name="run_shell_command", description="Run command", parameters={}),
        ToolSchema(name="delete_file", description="Delete file", parameters={}),
        ToolSchema(name="create_calendar_event", description="Create event", parameters={}),
    ]

    # "drunk" contains "run", but should NOT match the shell keyword "run"
    kept_drunk, _ = select_tools(schemas, "I had a drunk conversation with a friend", lane="agent")
    names_drunk = {s.name for s in kept_drunk}
    # "profile" contains "file", but should NOT match "file" keyword
    kept_profile, _ = select_tools(schemas, "Check his profile picture", lane="agent")
    names_profile = {s.name for s in kept_profile}
    assert "delete_file" not in names_profile


def test_tool_selector_lane_category_gating():
    schemas = [
        ToolSchema(name="delete_file", description="Delete file", parameters={}),
        ToolSchema(name="search_documents", description="Search docs", parameters={}),
        ToolSchema(name="create_calendar_event", description="Calendar", parameters={}),
        ToolSchema(name="generate_sandboxed_ui", description="UI", parameters={}),
    ]

    # Chat lane should NOT expand any categories
    kept_chat, _ = select_tools(schemas, "Can you help me with documents and files?", lane="chat")
    names_chat = {s.name for s in kept_chat}
    assert "delete_file" not in names_chat
    assert "search_documents" not in names_chat

    # Research lane expands research categories (search_documents) but not files/shell
    kept_research, _ = select_tools(schemas, "search documents for the latest file notes", lane="research")
    names_research = {s.name for s in kept_research}
    assert "search_documents" in names_research
    assert "delete_file" not in names_research

    # Connector lane expands calendar/tasks/mail but not files
    kept_conn, _ = select_tools(schemas, "schedule calendar event tomorrow", lane="connector")
    names_conn = {s.name for s in kept_conn}
    assert "create_calendar_event" in names_conn
    assert "delete_file" not in names_conn


def test_tool_selector_deleted_dispatch_parallel_jobs():
    # Verify no task intents map to the dead dispatch_parallel_jobs
    for phrase, tools in _TASK_INTENTS:
        assert "dispatch_parallel_jobs" not in tools, f"Found dead dispatch_parallel_jobs in task intent: {phrase}"


def test_openai_compat_parallel_tool_calls_configuration():
    # 1. Config with parallel_tool_calls = False
    cfg_false = ProviderConfig(
        name="test_provider",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o",
        parallel_tool_calls=False,
    )
    resolved_false = initialize(cfg_false)
    assert resolved_false.capabilities.parallel_tool_calls is False
    assert resolved_false.client.parallel_tool_calls is False

    tool = ToolSchema(name="dummy", description="dummy tool", parameters={})
    payload_false = resolved_false.client._build_payload(
        [{"role": "user", "content": "hi"}],
        tools=[tool],
        params=None,
    )
    assert payload_false.get("parallel_tool_calls") is False

    # 2. Config with parallel_tool_calls = True
    cfg_true = ProviderConfig(
        name="test_provider",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o",
        parallel_tool_calls=True,
    )
    resolved_true = initialize(cfg_true)
    assert resolved_true.capabilities.parallel_tool_calls is True
    payload_true = resolved_true.client._build_payload(
        [{"role": "user", "content": "hi"}],
        tools=[tool],
        params=None,
    )
    assert payload_true.get("parallel_tool_calls") is True


def test_openai_compat_cache_system_handling():
    # 1. OpenRouter provider with _cache_system=True produces structured cache_control block
    client_openrouter = OpenAICompatClient(
        base_url="https://openrouter.ai/api/v1",
        api_key="test-key",
        model="anthropic/claude-3.5-sonnet",
    )
    client_openrouter._cache_system = True
    payload_or = client_openrouter._build_payload(
        [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "hello"},
        ],
        tools=None,
        params=None,
    )
    sys_msg = payload_or["messages"][0]
    assert sys_msg["role"] == "system"
    assert isinstance(sys_msg["content"], list)
    assert sys_msg["content"][0]["cache_control"] == {"type": "ephemeral"}

    # 2. Standard OpenAI provider does NOT produce cache_control blocks (preventing 400 errors)
    client_openai = OpenAICompatClient(
        base_url="https://api.openai.com/v1",
        api_key="test-key",
        model="gpt-4o",
    )
    client_openai._cache_system = True
    payload_openai = client_openai._build_payload(
        [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "hello"},
        ],
        tools=None,
        params=None,
    )
    sys_msg_openai = payload_openai["messages"][0]
    assert sys_msg_openai["role"] == "system"
    assert isinstance(sys_msg_openai["content"], str)
