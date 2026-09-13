"""The agent asking the user something, mid-turn, and waiting for the answer.

The design decision under all of these: the turn **suspends**, it does not end.
`submit_plan` ended the turn because a plan is handed over and the approval is a
new request. A clarifying question is the opposite -- the model is part-way
through work it means to continue, and everything it has read and concluded is
in that turn. Ending it would mean re-sending the user's message and hoping the
model rebuilds the same state.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.agent import questions as q
from backend.tools.base import ToolContext


# --- reading what the model asked -------------------------------------------


def test_a_bare_string_is_a_question():
    """A model that sends a string where a list belongs has asked a perfectly
    good question badly. Refusing costs a round trip to learn a schema it was
    already shown.

    Mutation check: require a list.
    """
    parsed = q.parse("Which tracker do you mean?")
    assert [x.question for x in parsed] == ["Which tracker do you mean?"]


def test_options_may_be_plain_strings_or_objects():
    parsed = q.parse(
        [
            {
                "question": "What should it track?",
                "options": ["Habits", {"label": "Money", "description": "expenses & income"}],
            }
        ]
    )
    assert [o.label for o in parsed[0].options] == ["Habits", "Money"]
    assert parsed[0].options[1].description == "expenses & income"


def test_a_form_is_refused_rather_than_asked():
    """Six questions is a form, and a form gets answered carelessly. The point
    is the smallest question that unblocks the work.

    Mutation check: drop the MAX_QUESTIONS check.
    """
    with pytest.raises(q.TooManyQuestions):
        q.parse([{"question": f"q{n}"} for n in range(q.MAX_QUESTIONS + 1)])


def test_options_are_capped_rather_than_the_question_refused():
    """A long option list is a bad question, not an unanswerable one."""
    parsed = q.parse([{"question": "pick", "options": [f"o{n}" for n in range(20)]}])
    assert len(parsed[0].options) == q.MAX_OPTIONS


@pytest.mark.parametrize("bad", [[], [{}], [{"question": "   "}], 42])
def test_nothing_to_ask_is_an_error_the_model_can_act_on(bad):
    with pytest.raises(ValueError):
        q.parse(bad)


# --- suspending, and being resumed ------------------------------------------


async def test_the_turn_waits_and_the_answer_is_what_the_tool_returns():
    """The whole mechanism in one test: the card is published while the call is
    still in flight, and the answer comes back as an ordinary tool result.

    Mutation check: return before awaiting the future.
    """
    events: asyncio.Queue = asyncio.Queue()
    asked = q.parse([{"question": "Which one?", "options": ["A", "B"]}])

    waiting = asyncio.ensure_future(q.ask("conv-1", asked, events))

    kind, payload = await asyncio.wait_for(events.get(), timeout=2)
    assert kind == "question_required", "the interface hears about it mid-call"
    assert payload["questions"][0]["options"][0]["label"] == "A"
    assert not waiting.done(), "and the turn is still suspended"

    assert q.answer(payload["id"], ["B"]) is True
    assert await asyncio.wait_for(waiting, timeout=2) == ["B"]


async def test_a_settled_question_publishes_that_it_stopped_waiting():
    """So a card that can no longer be submitted stops offering to be.

    Mutation check: drop the `question_settled` publish from the `finally`.
    """
    events: asyncio.Queue = asyncio.Queue()
    waiting = asyncio.ensure_future(q.ask(None, q.parse("Which one?"), events))
    _, payload = await asyncio.wait_for(events.get(), timeout=2)
    q.answer(payload["id"], ["A"])
    await asyncio.wait_for(waiting, timeout=2)

    kind, settled = await asyncio.wait_for(events.get(), timeout=2)
    assert kind == "question_settled"
    assert settled["id"] == payload["id"]


async def test_an_unanswered_question_tells_the_model_to_get_on_with_it():
    """Nobody is there. Holding the turn open until tomorrow is worse than
    continuing on a stated assumption.

    Mutation check: raise on timeout instead of returning UNANSWERED.
    """
    events: asyncio.Queue = asyncio.Queue()
    original = q.ANSWER_TIMEOUT_SECONDS
    q.ANSWER_TIMEOUT_SECONDS = 0.05
    try:
        answers = await q.ask(None, q.parse("Which one?"), events)
    finally:
        q.ANSWER_TIMEOUT_SECONDS = original

    assert answers == [q.UNANSWERED]
    assert "Continue with the most reasonable assumption" in answers[0]


async def test_an_unattended_run_is_not_held_open_for_half_an_hour():
    """No queue means nobody is listening -- a scheduled turn cannot be asked
    anything, and blocking one to find that out is the worst of both."""
    assert await q.ask(None, q.parse("Which one?"), None) == [q.UNANSWERED]


async def test_a_question_nobody_is_waiting_on_is_refused():
    """The turn timed out and carried on, or was stopped. A silent 200 would
    look to the interface like the answer landed."""
    assert q.answer("no-such-id", ["A"]) is False


async def test_outstanding_questions_survive_a_reload():
    """A turn survives the page; the card that asked does not."""
    events: asyncio.Queue = asyncio.Queue()
    waiting = asyncio.ensure_future(q.ask("conv-7", q.parse("Which one?"), events))
    _, payload = await asyncio.wait_for(events.get(), timeout=2)

    assert [r["id"] for r in q.outstanding()] == [payload["id"]]
    assert q.outstanding("conv-7"), "and can be narrowed to the conversation"
    assert q.outstanding("other-conv") == []

    q.answer(payload["id"], ["A"])
    await asyncio.wait_for(waiting, timeout=2)
    assert q.outstanding() == [], "and it is gone once it is answered"


# --- the tool ---------------------------------------------------------------


async def test_the_tool_reads_back_the_question_with_its_answer():
    """A bare "Habits" a few thousand tokens later is a word with no question
    attached, and the model has to guess which of the two it asked that was for.

    Mutation check: return the answers alone.
    """
    from backend.tools.builtin.ask import ask_user

    events: asyncio.Queue = asyncio.Queue()
    ctx = ToolContext(conversation_id="c1", events=events)
    call = asyncio.ensure_future(
        ask_user({"questions": [{"question": "What should it track?"}]}, ctx)
    )
    _, payload = await asyncio.wait_for(events.get(), timeout=2)
    q.answer(payload["id"], ["Habits & daily routines"])
    result = await asyncio.wait_for(call, timeout=2)

    assert not result.is_error
    assert "What should it track?" in result.content
    assert "Habits & daily routines" in result.content


async def test_a_turn_may_only_ask_twice():
    """A first answer can reasonably raise a second question. A model that
    would ask a third is one that should have been working.

    Mutation check: remove the per-turn counter.
    """
    from backend.tools.builtin.ask import ask_user

    ctx = ToolContext(conversation_id="c1", events=None)
    for _ in range(q.MAX_ASKS_PER_TURN):
        assert not (await ask_user({"questions": ["Which one?"]}, ctx)).is_error

    refused = await ask_user({"questions": ["And another?"]}, ctx)
    assert refused.is_error
    assert "already asked" in refused.content


async def test_the_counter_is_per_turn_not_per_process():
    """The registry is shared by every conversation, so a limit kept on the
    tool would be a limit across all of them."""
    from backend.tools.builtin.ask import ask_user

    for _ in range(3):
        fresh = ToolContext(conversation_id="c1", events=None)
        assert not (await ask_user({"questions": ["Which one?"]}, fresh)).is_error


def test_a_header_names_what_is_being_decided():
    """The question is a sentence and reads slowly; the header is what the eye
    lands on, and what makes a stack of answered cards scannable afterwards.

    Mutation check: drop `header` from `Question.as_dict`.
    """
    parsed = q.parse([{"question": "Which layout?", "header": "Panel layout"}])
    assert parsed[0].header == "Panel layout"
    assert parsed[0].as_dict()["header"] == "Panel layout"


def test_an_overlong_header_is_trimmed_not_refused():
    """A header that wraps is a worse card, not a failed question."""
    parsed = q.parse([{"question": "Which?", "header": "x" * 90}])
    assert len(parsed[0].header) == 24


def test_a_question_with_no_header_still_works():
    parsed = q.parse([{"question": "Which?"}])
    assert parsed[0].header == ""
    assert parsed[0].as_dict()["header"] == ""


def test_multi_select_reaches_the_interface():
    """The card renders checkboxes off this flag. It was accepted by the parser
    and published in the payload while the card ignored it entirely -- which is
    a feature that exists on one side of the wire only.

    Mutation check: drop `multi_select` from `Question.as_dict`.
    """
    parsed = q.parse([{"question": "Which of these?", "multi_select": True, "options": ["a", "b"]}])
    assert parsed[0].as_dict()["multi_select"] is True
    assert q.parse([{"question": "One only"}])[0].as_dict()["multi_select"] is False
