"""Comprehensive end-to-end regression test suite for the Amethyst agent overhaul.

Covers all 10 target integration scenarios defined in Task 26:
1. Combined calendar + GitHub email (<= 3 rounds, 0 errors, 0 duplicate queries).
2. Tomorrow's calendar + follow-up (read cache validation).
3. Unread mail summary for last 2 days (projection + defaults).
4. Long-tail tool discovery fallback.
5. Partial tool timeout handling.
6. Primary provider 429 fallback.
7. Expired connection re-auth handling.
8. Mid-turn tool result visibility test (regression for consumed bug).
9. Step counter accuracy test.
10. In-turn deduplication test.
"""

from __future__ import annotations

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

import backend.agent.director as director_module
from backend.agent.director import Director
from backend.agent.config import agent_config
from backend.agent.read_cache import read_cache
from backend.agent.defaults import apply_tool_defaults
from backend.agent.projection import project_tool_result_content
from backend.agent.prompt import build_system_prompt, enforce_token_budget
from backend.agent.scratch_store import scratch_store
from backend.agent.tool_repair import repair_and_validate_tool_call
from backend.db.repositories import ConversationRepository
from backend.runtime.types import (
    Capabilities,
    ModelResponse,
    ResolvedModel,
    ToolCall,
    ToolSchema,
)
from backend.security.confirmation import ConfirmationService, GuardedConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult, ToolSource, compute_idempotency_key
from backend.tools.registry import ToolRegistry


# -------------------------------------------------------------------------
# Scenario 1: Combined calendar + GitHub email (<= 3 rounds, 0 errors)
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_1_combined_calendar_and_github_email(monkeypatch):
    registry = ToolRegistry()
    cal_called = 0
    mail_called = 0

    async def _cal(args, ctx):
        nonlocal cal_called
        cal_called += 1
        return ToolResult.ok(json.dumps([{"summary": "Sprint Planning", "start": "2026-10-21T10:00:00Z"}]))

    async def _mail(args, ctx):
        nonlocal mail_called
        mail_called += 1
        return ToolResult.ok(json.dumps([{"subject": "GitHub: PR #42 merged", "from": "notifications@github.com"}]))

    registry.register(Tool(name="GOOGLECALENDAR_FIND_EVENT", description="find calendar", parameters={"type": "object"}, handler=_cal, risk=RiskLevel.LOW))
    registry.register(Tool(name="GMAIL_FETCH_EMAILS", description="fetch emails", parameters={"type": "object"}, handler=_mail, risk=RiskLevel.LOW))

    # Turn 1: Model issues parallel tool calls for Calendar & Gmail
    # Turn 2: Model synthesizes final answer grouped by domain
    turns = iter([
        ModelResponse(
            text=None,
            tool_calls=[
                ToolCall(id="call_cal", name="GOOGLECALENDAR_FIND_EVENT", arguments={"max_results": 5}),
                ToolCall(id="call_mail", name="GMAIL_FETCH_EMAILS", arguments={"query": "from:github", "max_results": 5}),
            ],
        ),
        ModelResponse(text="**Upcoming Schedule**:\n- Sprint Planning at 10:00 AM\n\n**Relevant Emails**:\n- GitHub: PR #42 merged"),
    ])

    round_count = 0
    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            nonlocal round_count
            round_count += 1
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("provider1", "model1", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "what's new in my calendar and search all emails related to github")]

    assert round_count <= 3
    assert cal_called == 1
    assert mail_called == 1
    assert any(e.type == "tool_call" and e.data["name"] == "GOOGLECALENDAR_FIND_EVENT" for e in events)
    assert any(e.type == "tool_call" and e.data["name"] == "GMAIL_FETCH_EMAILS" for e in events)
    assert any("Sprint Planning" in (e.data.get("text") or "") for e in events)


# -------------------------------------------------------------------------
# Scenario 2: Tomorrow's calendar + follow-up (read cache validation)
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_2_calendar_read_cache_validation():
    read_cache.clear()
    tool_name = "GOOGLECALENDAR_FIND_EVENT"
    args = {"time_min": "2026-10-21T00:00:00Z", "time_max": "2026-10-21T23:59:59Z"}

    # Initially not in cache
    assert read_cache.get(tool_name, args) is None

    # First execution sets the cache
    read_cache.set(tool_name, args, content='[{"summary": "Team Standup"}]')

    # Immediate follow-up retrieves cached entry
    cached = read_cache.get(tool_name, args)
    assert cached is not None
    assert "Team Standup" in cached.content
    assert not cached.is_expired


# -------------------------------------------------------------------------
# Scenario 3: Unread mail summary for last 2 days (projection + defaults)
# -------------------------------------------------------------------------
def test_scenario_3_unread_mail_summary_projection_and_defaults():
    raw_args = {"query": "is:unread", "max_results": 100}
    enforced = apply_tool_defaults("GMAIL_FETCH_EMAILS", raw_args)
    assert enforced["max_results"] == 10  # Capped to 10 by defaults enforcement

    raw_payload = {
        "id": "msg_123",
        "snippet": "Here is your 2FA security code: 482910",
        "raw_headers": ["Received: from mail.example.com", "DKIM-Signature: v=1; ..."],
        "mime_parts": [{"type": "text/html", "base64": "PGh0bWw+...VERY_LONG_BLOB..."}],
    }
    projected = project_tool_result_content(json.dumps(raw_payload), tool_name="GMAIL_FETCH_EMAILS")
    assert "raw_headers" not in projected
    assert "base64" not in projected
    assert "482910" in projected


# -------------------------------------------------------------------------
# Scenario 4: Long-tail tool discovery fallback
# -------------------------------------------------------------------------
def test_scenario_4_long_tail_tool_discovery_fallback():
    from backend.agent.tool_selector import select_tools

    all_schemas = [
        ToolSchema(name="COMPOSIO_SEARCH_TOOLS", description="discover tools", parameters={"type": "object"}),
        ToolSchema(name="SPOTIFY_SEARCH_TRACKS", description="spotify search", parameters={"type": "object"}),
    ]

    kept, withheld = select_tools(all_schemas, "Look up recent Salesforce leads")
    kept_names = [s.name for s in kept]
    assert "COMPOSIO_SEARCH_TOOLS" in kept_names


# -------------------------------------------------------------------------
# Scenario 5: Partial tool timeout handling
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_5_partial_tool_timeout_handling(monkeypatch):
    registry = ToolRegistry()

    async def _fast_tool(args, ctx):
        return ToolResult.ok("Fast tool succeeded")

    async def _hanging_tool(args, ctx):
        await asyncio.sleep(2.0)
        return ToolResult.ok("Should have timed out")

    registry.register(Tool(name="fast_tool", description="fast", parameters={"type": "object"}, handler=_fast_tool, risk=RiskLevel.LOW))
    registry.register(Tool(name="hanging_tool", description="hangs", parameters={"type": "object"}, handler=_hanging_tool, risk=RiskLevel.LOW))

    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 0.05)

    turns = iter([
        ModelResponse(
            text=None,
            tool_calls=[
                ToolCall(id="call_fast", name="fast_tool", arguments={}),
                ToolCall(id="call_hang", name="hanging_tool", arguments={}),
            ],
        ),
        ModelResponse(text="Recovered: Fast tool succeeded while hanging tool timed out."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("provider1", "model1", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "run fast and hanging tools in parallel")]

    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2
    assert any("Fast tool succeeded" in r["content"] for r in tool_results)
    assert any("timed out" in r["content"].lower() for r in tool_results)


# -------------------------------------------------------------------------
# Scenario 6: Primary provider 429 fallback
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_6_primary_provider_429_fallback(monkeypatch):
    registry = ToolRegistry()
    primary_called = 0
    secondary_called = 0

    class PrimaryClient:
        async def complete(self, messages, tools=None, params=None):
            nonlocal primary_called
            primary_called += 1
            raise RuntimeError("429 Too Many Requests: Rate limit exceeded")

    class SecondaryClient:
        async def complete(self, messages, tools=None, params=None):
            nonlocal secondary_called
            secondary_called += 1
            return ModelResponse(text="Answer from fallback provider")

    clients = [
        ResolvedModel("primary", "model-heavy", PrimaryClient(), Capabilities(streaming=False)),
        ResolvedModel("secondary", "model-backup", SecondaryClient(), Capabilities(streaming=False)),
    ]

    def _mock_resolve(*args, **kwargs):
        if primary_called == 0:
            return clients[0]
        return clients[1]

    monkeypatch.setattr(director_module, "resolve", _mock_resolve)

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "hello provider")]
    assert any("Answer from fallback provider" in (e.data.get("text") or "") for e in events)


# -------------------------------------------------------------------------
# Scenario 7: Expired connection re-auth handling
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_7_expired_connection_reauth_handling(monkeypatch):
    registry = ToolRegistry()

    async def _oauth_tool(args, ctx):
        return ToolResult.error("Google Calendar needs re-auth: visit https://connect.amethyst.app/oauth/calendar")

    registry.register(Tool(name="GOOGLECALENDAR_FIND_EVENT", description="calendar", parameters={"type": "object"}, handler=_oauth_tool, risk=RiskLevel.LOW))

    turns = iter([
        ModelResponse(
            text=None,
            tool_calls=[ToolCall(id="call_auth", name="GOOGLECALENDAR_FIND_EVENT", arguments={})],
        ),
        ModelResponse(text="Google Calendar requires re-authentication. Please visit https://connect.amethyst.app/oauth/calendar to reconnect."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("provider1", "model1", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "check my schedule")]
    assert any("re-auth" in (e.data.get("text") or "").lower() or "reconnect" in (e.data.get("text") or "").lower() for e in events)


# -------------------------------------------------------------------------
# Scenario 8: Mid-turn tool result visibility test (regression for consumed bug)
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_8_mid_turn_tool_result_visibility(monkeypatch):
    registry = ToolRegistry()

    async def _step1(args, ctx):
        return ToolResult.ok("RESULT_FROM_STEP_ONE")

    async def _step2(args, ctx):
        return ToolResult.ok("RESULT_FROM_STEP_TWO")

    registry.register(Tool(name="tool_step1", description="step 1", parameters={"type": "object"}, handler=_step1, risk=RiskLevel.LOW))
    registry.register(Tool(name="tool_step2", description="step 2", parameters={"type": "object"}, handler=_step2, risk=RiskLevel.LOW))

    observed_messages = []
    turns = iter([
        ModelResponse(text=None, tool_calls=[ToolCall(id="c1", name="tool_step1", arguments={})]),
        ModelResponse(text=None, tool_calls=[ToolCall(id="c2", name="tool_step2", arguments={})]),
        ModelResponse(text="Completed both steps."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            observed_messages.append(list(messages))
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "run multi-step job")]

    # In round 3, observed_messages[2] MUST contain the tool result from round 1!
    round_3_msgs = observed_messages[2]
    tool_contents = [m.get("content") for m in round_3_msgs if isinstance(m, dict) and m.get("role") == "tool"]
    assert any("RESULT_FROM_STEP_ONE" in str(c) for c in tool_contents)
    assert any("RESULT_FROM_STEP_TWO" in str(c) for c in tool_contents)


# -------------------------------------------------------------------------
# Scenario 9: Step counter accuracy test
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_9_step_counter_accuracy(monkeypatch):
    registry = ToolRegistry()

    async def _quick_tool(args, ctx):
        return ToolResult.ok("quick result")

    registry.register(Tool(name="quick_tool", description="quick", parameters={"type": "object"}, handler=_quick_tool, risk=RiskLevel.LOW))

    turns = iter([
        ModelResponse(text=None, tool_calls=[ToolCall(id="c1", name="quick_tool", arguments={})]),
        ModelResponse(text="All done."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "test steps")]

    done_events = [e.data for e in events if e.type == "done"]
    # 2 model rounds = 2 steps, 1 tool executed
    assert len(done_events) == 1
    assert done_events[0]["steps"] == 2
    assert done_events[0]["tools"] == 1


# -------------------------------------------------------------------------
# Scenario 10: In-turn deduplication test
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_10_in_turn_deduplication(monkeypatch):
    registry = ToolRegistry()
    execution_count = 0

    async def _search(args, ctx):
        nonlocal execution_count
        execution_count += 1
        return ToolResult.ok("Search results for Python 3.12")

    registry.register(Tool(name="search_web", description="search", parameters={"type": "object"}, handler=_search, risk=RiskLevel.LOW))

    # Model accidentally emits duplicate calls with identical arguments across rounds in one turn
    turns = iter([
        ModelResponse(
            text=None,
            tool_calls=[ToolCall(id="c1", name="search_web", arguments={"query": "python 3.12"})],
        ),
        ModelResponse(
            text=None,
            tool_calls=[ToolCall(id="c2", name="search_web", arguments={"query": "python 3.12"})],
        ),
        ModelResponse(text="Synthesized from search."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(
        director_module,
        "resolve",
        lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)),
    )

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "search python")]

    # Real handler should only be executed ONCE despite two tool calls in the turn
    assert execution_count == 1
    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2
    assert any("[already fetched this turn: using cached result]" in r["content"] for r in tool_results)


# -------------------------------------------------------------------------
# Scenario 11: Calendar tomorrow + follow-up "and tomorrow?"
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_11_calendar_followup_and_tomorrow(monkeypatch):
    registry = ToolRegistry()
    cal_calls = []

    async def _cal(args, ctx):
        cal_calls.append(args)
        return ToolResult.ok(json.dumps([{"summary": "Design Sync", "start": "2026-10-22T14:00:00Z"}]))

    registry.register(Tool(name="GOOGLECALENDAR_FIND_EVENT", description="calendar", parameters={"type": "object"}, handler=_cal, risk=RiskLevel.LOW))

    turn1_responses = iter([
        ModelResponse(tool_calls=[ToolCall(id="c1", name="GOOGLECALENDAR_FIND_EVENT", arguments={"max_results": 5})]),
        ModelResponse(text="Tomorrow you have Design Sync at 2 PM."),
    ])

    class Client1:
        async def complete(self, messages, tools=None, params=None):
            return next(turn1_responses)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", Client1(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    # Turn 1
    events1 = [e async for e in director.run(cid, "what is on my calendar tomorrow")]
    assert any("Design Sync" in (e.data.get("text") or "") for e in events1)
    assert len(cal_calls) == 1

    # Turn 2: Follow-up "and tomorrow?"
    turn2_responses = iter([
        ModelResponse(tool_calls=[ToolCall(id="c2", name="GOOGLECALENDAR_FIND_EVENT", arguments={"max_results": 5})]),
        ModelResponse(text="The day after you have Design Sync at 2 PM as well."),
    ])

    class Client2:
        async def complete(self, messages, tools=None, params=None):
            return next(turn2_responses)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", Client2(), Capabilities(streaming=False)))

    events2 = [e async for e in director.run(cid, "and tomorrow?")]
    assert any("Design Sync" in (e.data.get("text") or "") for e in events2)
    # Cross-turn read cache hit: calendar API only invoked once
    assert len(cal_calls) == 1


# -------------------------------------------------------------------------
# Scenario 12: Confirmation-required write operation
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_12_confirmation_required_write(monkeypatch):
    executed = False

    async def _delete_item(args, ctx):
        nonlocal executed
        executed = True
        return ToolResult.ok("deleted")

    tool = Tool(name="delete_account", description="delete", parameters={"type": "object"}, handler=_delete_item, risk=RiskLevel.HIGH)

    async def _user_denies(request):
        return False

    gate = GuardedConfirmationService("guard", callback=_user_denies)
    registry = ToolRegistry(confirmation=gate)
    registry.register(tool)

    events_q = asyncio.Queue()
    ctx = ToolContext(conversation_id="c_1", turn_id="t_1", events=events_q, extra={"state": None})
    outcome = await gate.check(tool, {"confirm": True}, ctx)
    assert outcome.allowed is False
    assert outcome.decision == "denied"
    assert executed is False
    event_type, payload = events_q.get_nowait()
    assert event_type == "confirmation_required"
    assert payload["tool_name"] == "delete_account"


# -------------------------------------------------------------------------
# Scenario 13: Mutating write operation blocked in read-only mode
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_13_mutating_write_blocked_in_read_only():
    async def _write(args, ctx):
        return ToolResult.ok("written")

    tool = Tool(name="update_db", description="update", parameters={"type": "object"}, handler=_write, risk=RiskLevel.HIGH)
    registry = ToolRegistry(confirmation=GuardedConfirmationService("read-only"))
    registry.register(tool)

    ctx = ToolContext(conversation_id="c_1", turn_id="t_1", read_only=True)
    outcome = await registry.confirmation.check(tool, {}, ctx)
    assert outcome.allowed is False
    assert outcome.decision == "blocked_by_mode"


# -------------------------------------------------------------------------
# Scenario 14: Unknown tool auto-repair for read-only tools
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_14_unknown_tool_repair_read_only(monkeypatch):
    searched = False

    async def _web(args, ctx):
        nonlocal searched
        searched = True
        return ToolResult.ok("Search results for AI")

    registry = ToolRegistry()
    registry.register(Tool(name="search_web", description="web search", parameters={"type": "object"}, handler=_web, risk=RiskLevel.LOW))

    # Model emits a known read-only alias from CAPABILITY_MAP
    resolved = registry.resolve_tool("web_search")
    assert resolved is not None
    assert resolved.name == "search_web"

    res = await registry.dispatch("web_search", {"query": "AI"}, ToolContext(conversation_id="c", turn_id="t"))
    assert not res.is_error
    assert searched is True


# -------------------------------------------------------------------------
# Scenario 15: Unknown tool auto-repair for write tools strictly blocked
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_15_unknown_tool_write_never_fuzzy_matched():
    async def _dummy(a, c):
        return ToolResult.ok("")

    registry = ToolRegistry()
    registry.register(Tool(name="send_email", description="send email", parameters={"type": "object"}, handler=_dummy, risk=RiskLevel.HIGH))

    # Calling an unknown write tool name must NOT fuzzy match
    resolved = registry.resolve_tool("send_mail")
    assert resolved is None

    res = await registry.dispatch("send_mail", {"to": "a@b.com"}, ToolContext(conversation_id="c", turn_id="t"))
    assert res.is_error
    assert "Unknown tool 'send_mail'" in res.content
    assert "send_email" in res.content


# -------------------------------------------------------------------------
# Scenario 16: Unrepairable tool call returns exact bad/missing field
# -------------------------------------------------------------------------
def test_scenario_16_unrepairable_call_names_exact_field():
    async def _dummy(a, c):
        return ToolResult.ok("")

    registry = ToolRegistry()
    registry.register(Tool(
        name="send_invite",
        description="invite",
        parameters={
            "type": "object",
            "properties": {"email": {"type": "string"}, "role": {"type": "string"}},
            "required": ["email", "role"],
        },
        handler=_dummy,
        risk=RiskLevel.MEDIUM,
    ))

    call = ToolCall(id="c1", name="send_invite", arguments={"email": "alice@example.com"})
    _, err = repair_and_validate_tool_call(call, registry)
    assert err is not None
    assert "Missing required parameter 'role'" in err


# -------------------------------------------------------------------------
# Scenario 17: Large payload scratch store compaction
# -------------------------------------------------------------------------
def test_scenario_17_large_payload_scratch_store_compaction():
    items = [{"id": f"item_{i}", "data": f"content_{i}"} for i in range(25)]
    raw_json = json.dumps(items)
    notice, handle = scratch_store.compact_payload(raw_json, tool_name="LIST_ITEMS", max_chars=100)
    assert "truncated, 25 items total, showing first 10" in notice
    assert handle is not None
    assert f"Full payload stored under handle '{handle}'" in notice


# -------------------------------------------------------------------------
# Scenario 18: Token budget drop order under pressure
# -------------------------------------------------------------------------
def test_scenario_18_token_budget_drop_order():
    history = [
        {"role": "user", "content": "hello initial query"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "function": {"name": "t1"}}]},
        {"role": "tool", "content": "VERY LONG OLD TOOL RESULT " * 100, "tool_call_id": "c1", "tool_name": "t1"},
        {"role": "assistant", "content": "summary of turn 1"},
        {"role": "user", "content": "recent user query"},
    ]
    schemas = [ToolSchema(name="t1", description="desc", parameters={})]
    # Enforce budget where step 1 compacts the old tool result without dropping turns
    budgeted, kept_schemas, drops = enforce_token_budget(
        wire_messages=history,
        tool_schemas=schemas,
        context_window=600,
        threshold=0.85,
    )
    # The old tool result must be truncated first
    tool_msg = next((m for m in budgeted if m.get("role") == "tool"), None)
    assert tool_msg is not None
    assert "[t1 executed, result consumed]" in tool_msg["content"]
    # User message preserved
    assert any(m.get("content") == "recent user query" for m in budgeted)


# -------------------------------------------------------------------------
# Scenario 19: Final round enforces tool_choice='none' and returns text
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_19_final_round_tool_choice_none(monkeypatch):
    async def _dummy(a, c):
        return ToolResult.ok("dummy output")

    registry = ToolRegistry()
    registry.register(Tool(name="dummy_tool", description="dummy", parameters={"type": "object"}, handler=_dummy, risk=RiskLevel.LOW))

    received_tool_choices = []

    # Round 1: Model calls a tool
    # Round 2: Final step (hit budget), model must receive tool_choice="none"
    turns = iter([
        ModelResponse(tool_calls=[ToolCall(id="c1", name="dummy_tool", arguments={})]),
        ModelResponse(text="Final synthesis answer after round cap."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            if params and hasattr(params, "tool_choice"):
                received_tool_choices.append(params.tool_choice)
            return next(turns)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    monkeypatch.setattr(agent_config, "default_step_budget", 2)
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "do something")]
    assert "none" in received_tool_choices
    assert any("Final synthesis answer" in (e.data.get("text") or "") for e in events)


# -------------------------------------------------------------------------
# Scenario 20: Model-initiated offset pagination blocked on web search
# -------------------------------------------------------------------------
def test_scenario_20_model_initiated_offset_blocked():
    args = {"query": "deep learning", "offset": 30}
    enforced = apply_tool_defaults("search_web", args, user_prompt="search deep learning")
    assert enforced.get("offset") == 0


# -------------------------------------------------------------------------
# Scenario 21: User-requested pagination preserved
# -------------------------------------------------------------------------
def test_scenario_21_user_requested_pagination_preserved():
    args = {"query": "deep learning", "offset": 30}
    enforced = apply_tool_defaults("search_web", args, user_prompt="show more results starting at offset 30")
    assert enforced.get("offset") == 30


# -------------------------------------------------------------------------
# Scenario 22: Intra-batch parallel deduplication for duplicate reads
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_22_intra_batch_parallel_deduplication(monkeypatch):
    call_count = 0

    async def _fetch(args, ctx):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)
        return ToolResult.ok(f"data for {args.get('id')}")

    registry = ToolRegistry()
    registry.register(Tool(name="fetch_record", description="fetch", parameters={"type": "object"}, handler=_fetch, risk=RiskLevel.LOW))

    turns = iter([
        ModelResponse(tool_calls=[
            ToolCall(id="c1", name="fetch_record", arguments={"id": "rec_1"}),
            ToolCall(id="c2", name="fetch_record", arguments={"id": "rec_1"}),
        ]),
        ModelResponse(text="Fetched successfully."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "fetch record")]
    assert call_count == 1
    tool_results = [e.data for e in events if e.type == "tool_result"]
    assert len(tool_results) == 2


# -------------------------------------------------------------------------
# Scenario 23: Write idempotency blocks re-issued identical write
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_23_write_idempotency_blocks_reissued_write(monkeypatch):
    write_count = 0

    async def _save(args, ctx):
        nonlocal write_count
        write_count += 1
        return ToolResult.ok("saved")

    registry = ToolRegistry(confirmation=GuardedConfirmationService("full-access"))
    registry.register(Tool(name="save_db", description="save", parameters={"type": "object"}, handler=_save, risk=RiskLevel.MEDIUM))

    # Turn emits first write, then re-emits same write with different call_id
    turns = iter([
        ModelResponse(tool_calls=[ToolCall(id="w1", name="save_db", arguments={"key": "v1"})]),
        ModelResponse(tool_calls=[ToolCall(id="w2_retry", name="save_db", arguments={"key": "v1"})]),
        ModelResponse(text="Saved to database."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "save item")]
    assert write_count == 1


# -------------------------------------------------------------------------
# Scenario 24: Expired OAuth returns immediate re-auth message
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_24_expired_oauth_immediate_guidance(monkeypatch):
    async def _slack(args, ctx):
        return ToolResult.error("Slack OAuth token expired (401 Unauthorized)")

    registry = ToolRegistry()
    registry.register(Tool(name="SLACK_POST_MESSAGE", description="post slack", parameters={"type": "object"}, handler=_slack, risk=RiskLevel.LOW))

    turns = iter([
        ModelResponse(tool_calls=[ToolCall(id="s1", name="SLACK_POST_MESSAGE", arguments={"channel": "general"})]),
        ModelResponse(text="Your Slack connection has expired. Please reconnect in Capabilities."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "post to slack")]
    assert any("expired" in (e.data.get("text") or "").lower() for e in events)


# -------------------------------------------------------------------------
# Scenario 25: Forced tool timeout in parallel batch yields partial answer
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_scenario_25_forced_tool_timeout_partial_answer(monkeypatch):
    registry = ToolRegistry()

    async def _fast(args, ctx):
        return ToolResult.ok("Calendar: 1 meeting found")

    async def _slow(args, ctx):
        await asyncio.sleep(1.0)
        return ToolResult.ok("Emails: 5 emails found")

    registry.register(Tool(name="fast_cal", description="cal", parameters={"type": "object"}, handler=_fast, risk=RiskLevel.LOW))
    registry.register(Tool(name="slow_mail", description="mail", parameters={"type": "object"}, handler=_slow, risk=RiskLevel.LOW))

    monkeypatch.setattr(agent_config, "tool_timeout_seconds", 0.05)

    turns = iter([
        ModelResponse(tool_calls=[
            ToolCall(id="t1", name="fast_cal", arguments={}),
            ToolCall(id="t2", name="slow_mail", arguments={}),
        ]),
        ModelResponse(text="Calendar shows 1 meeting. Note: Email lookup timed out, so email details are not included."),
    ])

    class MockClient:
        async def complete(self, messages, tools=None, params=None):
            return next(turns)

    monkeypatch.setattr(director_module, "resolve", lambda *a, **k: ResolvedModel("p", "m", MockClient(), Capabilities(streaming=False)))

    cid = ConversationRepository().create("p", "m")
    director = Director(registry, stream=False, memory=False, retrieval=False)

    events = [e async for e in director.run(cid, "check calendar and mail")]
    assert any("1 meeting" in (e.data.get("text") or "") for e in events)
    assert any("timed out" in (e.data.get("text") or "").lower() for e in events)

