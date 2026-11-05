"""Usage accounting: the numbers the panel shows come from the provider.

The failure this replaces is specific. The activity panel used to estimate every
token from a character count and a magic per-turn average, and it reported a
dollar figure from a price table nobody maintained. Both looked like measurements.
These tests hold the line: the counts come from `ModelResponse`, they survive the
trip to the `agent_runs` row, and the analytics endpoint aggregates those columns
instead of inventing anything.
"""

from __future__ import annotations

import time

import pytest

from backend.agent.state import AgentState
from backend.db.repositories import AgentRunRepository, ConversationRepository
from backend.runtime.providers.openai_compat import _cache_tokens
from backend.runtime.types import ModelResponse


def test_model_response_cache_fields_are_optional_and_distinct_from_zero():
    plain = ModelResponse(text="hi")
    assert plain.cache_read_tokens is None
    assert plain.cache_write_tokens is None

    cached = ModelResponse(text="hi", cache_read_tokens=0, cache_write_tokens=12)
    assert cached.cache_read_tokens == 0
    assert cached.cache_write_tokens == 12


def test_openai_compatible_cache_shapes():
    assert _cache_tokens(
        {"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": 40}}
    ) == (40, None)
    assert _cache_tokens({"cache_read_input_tokens": 7, "cache_creation_input_tokens": 9}) == (7, 9)
    assert _cache_tokens({"num_cached_tokens": 3}) == (3, None)
    assert _cache_tokens({}) == (None, None)


def test_record_usage_writes_the_columns_analytics_reads(amethyst_home):
    conversation_id = ConversationRepository().create("test", "model-x")
    state = AgentState(conversation_id=conversation_id)
    state.input_tokens = 1200
    state.output_tokens = 340
    state.cache_read_tokens = 900
    state.cache_write_tokens = 25
    state.tool_calls_made = 4
    state.duration_ms = 1234.5
    state.link = "test/model-x"

    runs = AgentRunRepository()
    runs.open(state)
    runs.record_usage(state)

    row = runs.conn.execute(
        "SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,"
        " tool_call_count, duration_ms, link FROM agent_runs WHERE id = ?",
        (state.id,),
    ).fetchone()
    assert row["input_tokens"] == 1200
    assert row["output_tokens"] == 340
    assert row["cache_read_tokens"] == 900
    assert row["cache_write_tokens"] == 25
    assert row["tool_call_count"] == 4
    assert row["duration_ms"] == 1234.5
    assert row["link"] == "test/model-x"


def test_state_round_trip_keeps_usage_and_survives_an_old_row(amethyst_home):
    state = AgentState(conversation_id="c1")
    state.input_tokens = 10
    state.output_tokens = 20
    state.cache_read_tokens = 30
    state.cache_write_tokens = 40
    state.duration_ms = 50.5
    state.tools_used = ["search", "filesystem"]

    restored = AgentState.from_json(state.to_json())
    assert restored.input_tokens == 10
    assert restored.cache_write_tokens == 40
    assert restored.tools_used == ["search", "filesystem"]

    # A row written before these fields existed must load with defaults, not
    # raise: `from_json` filters to known fields and the dataclass fills the rest.
    payload = state.to_json()
    for key in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "tools_used"):
        payload.pop(key, None)
    old = AgentState.from_json(payload)
    assert old.input_tokens == 0
    assert old.tools_used == []


@pytest.mark.asyncio
async def test_activity_endpoint_reports_recorded_tokens_not_estimates(amethyst_home):
    """No pricing table ships, so cost says `unknown` rather than a fake bill."""
    import httpx

    from backend.api.main import app

    conversation_id = ConversationRepository().create("test", "model-y")
    state = AgentState(conversation_id=conversation_id)
    state.input_tokens = 500
    state.output_tokens = 250
    state.cache_read_tokens = 400
    state.link = "test/model-y"
    runs = AgentRunRepository()
    runs.open(state)
    runs.record_usage(state)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/analytics/activity?days=30")

    body = response.json()
    assert body["tokens"]["input"] == 500
    assert body["tokens"]["output"] == 250
    assert body["tokens"]["cache_read"] == 400
    assert body["tokens"]["is_estimated"] is False
    assert body["total_spend_formatted"] == "unknown"
    assert body["recent_runs"][0]["input_tokens"] == 500
    assert body["recent_runs"][0]["cost_display"] == "unknown"
