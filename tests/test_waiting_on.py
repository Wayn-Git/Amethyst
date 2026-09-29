"""What a heartbeat says when a turn is not working but waiting.

A keepalive and a suspended turn are indistinguishable from outside: a stream
that is alive and producing nothing. The tag is the difference between a
spinner and an ask, and it has to be derived from the two places that already
record why a turn is parked -- not from the silence, which is the same either
way.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from backend.agent import questions as q
from backend.api import main


def test_a_turn_with_a_prompt_outstanding_is_waiting_on_approval(db, monkeypatch):
    payload = SimpleNamespace(conversation_id="c1")
    monkeypatch.setattr(main, "_pending", {"r1": {"payload": payload}})

    assert main._waiting_on("c1") == "approval"
    assert main._waiting_on("c2") is None, "another conversation's prompt is not this one's"


async def test_a_turn_with_a_question_outstanding_is_waiting_on_an_answer(db, monkeypatch):
    monkeypatch.setattr(main, "_pending", {})

    assert main._waiting_on("c1") is None

    events: asyncio.Queue = asyncio.Queue()
    waiting = asyncio.ensure_future(q.ask("c1", q.parse("Which?"), events))
    _, payload = await asyncio.wait_for(events.get(), timeout=2)
    try:
        assert main._waiting_on("c1") == "answer"
    finally:
        q.answer(payload["id"], ["A"])
        await asyncio.wait_for(waiting, timeout=2)


def test_a_turn_that_is_merely_busy_says_so_by_saying_nothing(db, monkeypatch):
    """No tag is the answer for the case this was built around: a long tool
    call. Everything the interface can already infer stays inferable."""
    monkeypatch.setattr(main, "_pending", {})

    assert main._waiting_on("c1") is None
