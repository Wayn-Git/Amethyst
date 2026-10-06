from __future__ import annotations

import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock

from backend.agent.trace import (
    TurnTrace,
    LLMCallRecord,
    ToolDispatchRecord,
    start_turn_trace,
    finish_turn_trace,
    get_current_trace,
    record_error,
    record_cache_hit,
    record_provider,
    record_steps_used,
    get_recent_traces,
)
from backend.agent.state import AgentState
from backend.agent.config import agent_config


def test_turn_trace_to_dict_metrics_structure():
    trace = TurnTrace(
        conversation_id="conv-123",
        user_message="Find my meetings and emails",
        turn_id="turn-abc",
    )
    trace.llm_calls.append(
        LLMCallRecord(
            call_index=1,
            provider="anthropic",
            model="claude-3-7-sonnet",
            ttft_ms=120.5,
            total_ms=450.0,
            input_tokens=1500,
            output_tokens=120,
        )
    )
    trace.tool_dispatches.append(
        ToolDispatchRecord(
            dispatch_index=1,
            tool_name="GOOGLECALENDAR_FIND_EVENT",
            duration_ms=85.0,
        )
    )
    trace.tool_dispatches.append(
        ToolDispatchRecord(
            dispatch_index=2,
            tool_name="GMAIL_FETCH_EMAILS",
            duration_ms=110.0,
        )
    )
    trace.errors.append("Connection to Slack timed out")
    trace.cache_hits = 2
    trace.steps_used = 1

    d = trace.to_dict()

    assert d["turn_id"] == "turn-abc"
    assert d["conversation_id"] == "conv-123"
    assert d["user_message"] == "Find my meetings and emails"
    assert d["steps_used"] == 1
    assert d["tool_calls"] == ["GOOGLECALENDAR_FIND_EVENT", "GMAIL_FETCH_EMAILS"]
    assert "latencies" in d
    assert d["latencies"]["tools_total_ms"] == 195.0
    assert d["latencies"]["llm_total_ms"] == 450.0
    assert d["errors"] == ["Connection to Slack timed out"]
    assert d["tokens"] == {"input_tokens": 1500, "output_tokens": 120, "total_tokens": 1620}
    assert d["provider_used"] == "anthropic"
    assert d["cache_hits"] == 2


def test_turn_trace_lifecycle_and_recording(tmp_path: Path, monkeypatch):
    trace_file = tmp_path / "test_traces.jsonl"
    monkeypatch.setattr(agent_config, "trace_log_path", str(trace_file))
    monkeypatch.setattr(agent_config, "enable_turn_tracing", True)

    trace, watchdog, token = start_turn_trace(
        conversation_id="conv-456",
        user_message="Hello turn trace",
        turn_id="turn-789",
    )
    assert trace is not None
    assert get_current_trace() is trace

    record_cache_hit()
    record_cache_hit()
    record_error("Temporary 429 warning")
    record_provider("openai")
    record_steps_used(2)

    state = AgentState(conversation_id="conv-456")
    state.id = "turn-789"
    state.budget_spent = 2
    state.failed_calls.append({"tool": "search", "reason": "rate limit"})

    finish_turn_trace(trace, watchdog, token, state=state)

    assert get_current_trace() is None
    assert trace.cache_hits == 2
    assert "Temporary 429 warning" in trace.errors
    assert "rate limit" in trace.errors
    assert trace.provider_used == "openai"
    assert trace.steps_used == 2

    # Verify JSONL persistence
    assert trace_file.is_file()
    lines = trace_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    persisted = json.loads(lines[0])
    assert persisted["turn_id"] == "turn-789"
    assert persisted["cache_hits"] == 2
    assert "rate limit" in persisted["errors"]
