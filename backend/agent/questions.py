"""Asking the user a question, mid-turn, and waiting for the answer.

The turn **suspends**; it does not end. That is the whole design decision, and
it is the opposite of what `submit_plan` and the old `escalate` did.

Those two ended the turn because there was nothing to wait for: a plan is
handed over for approval and the approval is a new request. A clarifying
question is different -- the model is part-way through work it wants to
continue, and everything it has read, called and concluded so far is in the
turn. Ending it would mean re-sending the user's message and hoping the model
reconstructs the same state; suspending means the answer arrives as an ordinary
tool result and the loop carries on with its context intact.

`backend/security/confirmation.py` already does exactly this for a permission
prompt, and this is the same shape: an event published on the dispatch queue so
the interface hears about it while the call is still in flight, and a future the
HTTP layer resolves.

It lives in its own module rather than in the tool or the API because both ends
need it and neither should import the other -- the tool would be dragging in
FastAPI, and the route would be dragging in the tool registry.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

#: How long a question waits before the turn gives up on it.
#:
#: Shorter than a confirmation's six hours on purpose. A permission prompt
#: guards something that must not happen without a person, so waiting all day is
#: correct. A question is the model checking an assumption -- if nobody is
#: there, the useful behaviour is to get on with it and say what was assumed,
#: not to hold a turn open until tomorrow.
ANSWER_TIMEOUT_SECONDS = 60 * 30

#: What the model is told when nobody answered. Phrased as an instruction
#: because a bare "timed out" reads as a tool failure, and the model's next move
#: should be to continue rather than to retry the question.
UNANSWERED = (
    "The user did not answer in time. Do not ask again. Continue with the most"
    " reasonable assumption, and say plainly at the end which assumption you"
    " made so they can correct it."
)

#: Bounds. A model that asks six questions with nine options each has built a
#: form, and a form is not a conversation -- the point is to unblock the work
#: with the smallest question that does it.
MAX_QUESTIONS = 4
MAX_OPTIONS = 5

#: How many times one turn may ask. Two, not one: a first answer can reasonably
#: raise a second question. A model that would ask a third is one that should
#: have been working.
MAX_ASKS_PER_TURN = 2


class TooManyQuestions(ValueError):
    """The model asked more than a turn is allowed to."""


@dataclass
class Option:
    label: str
    description: str = ""

    def as_dict(self) -> dict[str, str]:
        return {"label": self.label, "description": self.description}


@dataclass
class Question:
    question: str
    options: list[Option] = field(default_factory=list)
    multi_select: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "options": [o.as_dict() for o in self.options],
            "multi_select": self.multi_select,
        }


@dataclass
class Ask:
    id: str
    conversation_id: str | None
    questions: list[Question]

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "questions": [q.as_dict() for q in self.questions],
        }


def parse(raw: Any) -> list[Question]:
    """The model's argument into questions, or a refusal it can act on.

    Lenient about shape, strict about size. A model that sends a bare string
    where a list belongs has asked a perfectly good question badly, and
    rejecting it would cost the turn a round trip to learn the schema it was
    already shown.
    """
    if isinstance(raw, str):
        raw = [{"question": raw}]
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        raise ValueError("questions must be a non-empty list")
    if len(raw) > MAX_QUESTIONS:
        raise TooManyQuestions(
            f"at most {MAX_QUESTIONS} questions at a time; ask the ones that"
            " actually block the work"
        )

    out: list[Question] = []
    for item in raw:
        if isinstance(item, str):
            item = {"question": item}
        if not isinstance(item, dict):
            raise ValueError("each question must be an object with a 'question' field")
        text = str(item.get("question") or "").strip()
        if not text:
            raise ValueError("each question needs a 'question'")

        options: list[Option] = []
        for candidate in (item.get("options") or [])[:MAX_OPTIONS]:
            if isinstance(candidate, str):
                options.append(Option(label=candidate.strip()))
                continue
            if not isinstance(candidate, dict):
                continue
            label = str(candidate.get("label") or "").strip()
            if label:
                options.append(
                    Option(label=label, description=str(candidate.get("description") or "").strip())
                )
        out.append(
            Question(
                question=text,
                options=options,
                multi_select=bool(item.get("multi_select")),
            )
        )
    return out


#: Questions waiting on an answer, by id. Process-wide for the same reason the
#: confirmation store is: the turn holding the future and the request carrying
#: the answer are two different requests in one process.
_waiting: dict[str, dict[str, Any]] = {}


def outstanding(conversation_id: str | None = None) -> list[dict[str, Any]]:
    """Questions still waiting, so a reloaded interface can put them back.

    A turn survives the page; the card that asked does not. Without this, a
    refresh mid-question left the user with a turn that never finished and no
    way to see what it was waiting for.
    """
    rows = [entry["ask"].as_dict() for entry in _waiting.values()]
    if conversation_id is None:
        return rows
    return [r for r in rows if r["conversation_id"] == conversation_id]


def answer(ask_id: str, answers: list[str]) -> bool:
    """Resolve a waiting question. False when nothing was waiting for it."""
    entry = _waiting.get(ask_id)
    if entry is None:
        return False
    future: asyncio.Future = entry["future"]
    loop: asyncio.AbstractEventLoop = entry["loop"]
    if future.done():
        return False
    # The answer arrives on the HTTP request's task; the future belongs to the
    # turn's. Same process, and usually the same loop, but resolving it directly
    # from another thread is the kind of thing that works until it does not.
    loop.call_soon_threadsafe(lambda: None if future.done() else future.set_result(answers))
    return True


async def ask(conversation_id: str | None, questions: list[Question], events) -> list[str]:
    """Publish a question and wait for the answer.

    `events` is `ToolContext.events`, the queue the dispatch path drains into
    the turn's stream -- so the card reaches the interface while this call is
    still in flight, which is the only reason suspending works at all.
    """
    if events is None:
        # Nothing is listening. An unattended run cannot be asked anything, and
        # blocking one for half an hour to discover that is worse than saying so.
        return [UNANSWERED]

    ask_id = uuid.uuid4().hex
    pending = Ask(id=ask_id, conversation_id=conversation_id, questions=questions)
    loop = asyncio.get_running_loop()
    future: asyncio.Future[list[str]] = loop.create_future()
    _waiting[ask_id] = {"future": future, "loop": loop, "ask": pending}
    events.put_nowait(("question_required", pending.as_dict()))
    try:
        return await asyncio.wait_for(future, timeout=ANSWER_TIMEOUT_SECONDS)
    except TimeoutError:
        log.info("nobody answered %s within %ss", ask_id, ANSWER_TIMEOUT_SECONDS)
        return [UNANSWERED]
    except asyncio.CancelledError:
        # The turn was stopped or the reader hung up. The card is stale either
        # way and must not be left in the store for a later turn to inherit.
        raise
    finally:
        _waiting.pop(ask_id, None)
        events.put_nowait(("question_settled", {"id": ask_id}))
