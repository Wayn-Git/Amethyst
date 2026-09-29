"""Turns that say they are waiting on someone who is no longer there.

A suspension is a promise held in two places at once: the gate or the question
service owns the future in process memory, and the run row records which one.
They only stay in step while the process that opened them is the one answering
them -- so a disagreement is a turn that stopped waiting without the row
finding out, and the conversation reads as "Thinking" until the next boot.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

from backend.agent import questions as q
from backend.agent.state import AgentState
from backend.db.repositories import AgentRunRepository, ConversationRepository

#: How the schema writes a timestamp, so backdating one is a string comparison
#: against what the sweep will read -- local naive, to the second.
_STAMP = "%Y-%m-%d %H:%M:%S"


def _conversation() -> str:
    return ConversationRepository().create("sweep", "sweep-1")


def _write(state: AgentState, age_seconds: float) -> AgentRunRepository:
    """Insert and checkpoint a run as though it was last written that long ago.

    The stamp has to be substituted at write time rather than updated
    afterwards: `updated_at` lives in the JSON blob `_load` deserializes, not
    only in its column, so rewriting the column alone leaves the sweep reading
    a turn that looks a second old however long the row has been sitting.
    """
    from backend.db import repositories

    stamp = (datetime.now() - timedelta(seconds=age_seconds)).strftime(_STAMP)
    original = repositories._now
    repositories._now = lambda: stamp
    try:
        runs = AgentRunRepository()
        runs.open(state)
        runs.save(state)
    finally:
        repositories._now = original
    return runs


def _suspended(age_seconds: float, conversation_id: str | None = None) -> str:
    """A run parked on a prompt, last touched `age_seconds` ago. Returns its
    conversation."""
    conversation_id = conversation_id or _conversation()
    state = AgentState(conversation_id=conversation_id, mode="chat")
    state.enter("reasoning")
    state.enter("acting")
    state.enter("awaiting_approval")
    _write(state, age_seconds)
    return conversation_id


def _patch(monkeypatch, *, pending=None, active=None, repaired=None):
    from backend.api import main

    monkeypatch.setattr(main, "_pending", pending or {})
    monkeypatch.setattr(main, "_active_turns", active or {})
    if repaired is not None:
        monkeypatch.setattr(main, "close_open_tool_calls", lambda cid: repaired.append(cid))
    return main


def test_a_turn_waiting_on_nothing_is_closed(db, monkeypatch):
    repaired: list[str] = []
    main = _patch(monkeypatch, repaired=repaired)

    conversation_id = _suspended(age_seconds=600)
    main._sweep_abandoned_suspensions()

    state = AgentRunRepository().latest(conversation_id)
    assert state.phase == "interrupted"
    assert "no longer there" in (state.error or "")
    # The tool it was suspended on never produced a result, so the transcript
    # has an assistant message ending in an unanswered tool call -- which
    # breaks every later turn in the conversation on every provider.
    assert repaired == [conversation_id]


def test_a_fresh_suspension_is_left_alone(db, monkeypatch):
    """The decision removes its prompt from `_pending` a moment before the turn
    wakes and leaves `awaiting_*`. A grace period is the only thing that tells
    that apart from a turn nobody is coming back for."""
    main = _patch(monkeypatch)

    conversation_id = _suspended(age_seconds=1)
    main._sweep_abandoned_suspensions()

    assert AgentRunRepository().latest(conversation_id).phase == "awaiting_approval"


def test_a_turn_with_a_prompt_still_outstanding_is_left_alone(db, monkeypatch):
    conversation_id = _suspended(age_seconds=600)
    payload = SimpleNamespace(conversation_id=conversation_id)
    main = _patch(monkeypatch, pending={"r1": {"payload": payload}})

    main._sweep_abandoned_suspensions()

    assert AgentRunRepository().latest(conversation_id).phase == "awaiting_approval"


def test_a_turn_this_process_is_driving_is_left_alone(db, monkeypatch):
    conversation_id = _suspended(age_seconds=600)
    main = _patch(monkeypatch, active={conversation_id: asyncio.Event()})

    main._sweep_abandoned_suspensions()

    assert AgentRunRepository().latest(conversation_id).phase == "awaiting_approval"


async def test_a_turn_waiting_on_a_question_is_left_alone(db, monkeypatch):
    """The question service holds its future independently of `_pending`, so it
    has to be asked as well -- otherwise every question in flight for thirty
    minutes would look like the thing this sweep exists to close."""
    conversation_id = _suspended(age_seconds=600)
    main = _patch(monkeypatch)

    events: asyncio.Queue = asyncio.Queue()
    waiting = asyncio.ensure_future(q.ask(conversation_id, q.parse("Which?"), events))
    _, payload = await asyncio.wait_for(events.get(), timeout=2)

    try:
        main._sweep_abandoned_suspensions()
        assert AgentRunRepository().latest(conversation_id).phase == "awaiting_approval"
    finally:
        q.answer(payload["id"], ["A"])
        await asyncio.wait_for(waiting, timeout=2)


def test_a_finished_turn_is_not_considered(db, monkeypatch):
    """Only the two suspension phases are swept. A background run working with
    nobody watching has no prompt in flight and no streaming turn, and sweeping
    on that would end every automation the moment it started."""
    main = _patch(monkeypatch)

    conversation_id = _conversation()
    state = AgentState(conversation_id=conversation_id, mode="chat")
    state.enter("reasoning")
    state.enter("acting")
    _write(state, age_seconds=600)

    main._sweep_abandoned_suspensions()

    assert AgentRunRepository().latest(conversation_id).phase == "acting"
