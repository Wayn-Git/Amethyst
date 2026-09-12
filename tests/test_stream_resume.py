"""An answer that is interrupted halfway is finished, not abandoned.

NVIDIA intermittently emits `{"error":{"message":"Error in input stream"}}`
*inside* an already-200 SSE body, after tokens have streamed. Every recovery
path was switched off once a byte had moved -- deliberately, so that a second
provider could not restart an answer underneath the half already on screen --
so the turn died and the user finished it by typing "continue" into the
transcript, over and over, several times a session.

Continuing is not restarting. These tests hold the line that the partial is
carried, the answer is finished, and nothing on screen is said twice.
"""

from __future__ import annotations

import pytest

from backend.agent.director import Director
from backend.db.repositories import ConversationRepository, MessageRepository
from backend.runtime import availability
from backend.runtime.failures import FailureKind
from backend.runtime.http import ProviderStreamError
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel, StreamEvent
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.registry import build_default_registry


def text(chunk: str) -> StreamEvent:
    return StreamEvent(type="text", text=chunk)


def done(answer: str) -> StreamEvent:
    return StreamEvent(type="done", response=ModelResponse(text=answer))


def mid_stream_failure() -> ProviderStreamError:
    """What NVIDIA actually sends, classified the way `failures.py` classifies it."""
    return ProviderStreamError("Error in input stream", kind=FailureKind.UPSTREAM_UNHEALTHY)


@pytest.fixture(autouse=True)
def forget_failures():
    """Provider health is process-wide, so one test's failure darkened the
    provider for the next one and its fallback chain came out a link short."""
    availability.forget()
    yield
    availability.forget()


@pytest.fixture
def streaming(monkeypatch):
    """A streaming provider running from a script, one script per attempt.

    Each script is a list of `StreamEvent`s, and an exception in the list is
    raised at that point in the stream -- which is the only way to reproduce a
    failure that arrives *after* tokens, the case every one of these tests is
    about.
    """

    class Streamer:
        def __init__(self, scripts):
            self.scripts = list(scripts)
            #: The wire of every attempt, so a test can assert what the second
            #: call was actually told about the first.
            self.seen: list[list[dict]] = []

        async def stream(self, messages, tools=None, params=None):
            self.seen.append(messages)
            script = self.scripts.pop(0) if self.scripts else [done("")]
            for chunk in script:
                if isinstance(chunk, Exception):
                    raise chunk
                yield chunk

        async def complete(self, messages, tools=None, params=None):
            self.seen.append(messages)
            return ModelResponse(text="done")

    def install(*scripts):
        client = Streamer(scripts)
        monkeypatch.setattr(
            "backend.agent.director.resolve",
            lambda *a, **k: ResolvedModel(
                provider="fake",
                model="fake-1",
                client=client,
                capabilities=Capabilities(streaming=True, context_window=32_000),
            ),
        )
        return client

    return install


def director(workspace):
    return Director(
        build_default_registry(ConfirmationService(auto_approve), workspace_root=str(workspace)),
        workspace_root=str(workspace),
        memory=False,
        retrieval=False,
        stream=True,
    )


async def run(workspace, message="write it"):
    cid = ConversationRepository().create("fake", "fake-1")
    return [event async for event in director(workspace).run(cid, message)], cid


def said(events) -> str:
    return "".join(e.data.get("text", "") for e in events if e.type == "assistant_delta")


async def test_a_stream_that_fails_after_text_finishes_the_answer(db, workspace, streaming):
    """The whole point: no red card, no typing "continue", one finished answer.

    Mutation check: remove the resume branch and this ends in an `error` event
    holding half a sentence.
    """
    streaming(
        [text("The first half"), mid_stream_failure()],
        [text(" and the rest."), done("The first half and the rest.")],
    )

    events, _ = await run(workspace)

    assert [e.type for e in events].count("error") == 0, "the turn ended instead of resuming"
    assert said(events) == "The first half and the rest."


async def test_the_resumed_call_is_told_what_was_already_said(db, workspace, streaming):
    """A continuation the model cannot see is a restart, and a restart says the
    first half twice.

    Mutation check: stop appending the partial and the second attempt has no
    idea an answer was already underway.
    """
    client = streaming(
        [text("The first half"), mid_stream_failure()],
        [text(" and the rest."), done("The first half and the rest.")],
    )

    await run(workspace)

    assert len(client.seen) == 2, "the turn did not make a second attempt"
    resumed = "\n".join(
        str(m.get("content", "")) for m in client.seen[1] if m.get("role") in ("assistant", "user")
    )
    assert "The first half" in resumed


async def test_a_capped_resume_moves_to_the_next_provider_and_keeps_every_fragment(
    db, workspace, streaming
):
    """Three failures in a row is a provider that is down, not a blip -- so the
    resumes stop and the *chain* continues the answer instead.

    Two rules meet here. The cap holds: the provider that was talking gets two
    resumes and no more, or a provider failing in a loop keeps the turn alive
    forever. What changed is what happens next. The turn used to die at that
    point, holding half a sentence, with healthy providers still in the chain
    -- which is the "Error in input stream" a user sees over and over, because
    NVIDIA's NIM emits exactly that *after* tokens have moved. The partial is
    carried across the hand-over now, so the next provider continues it.

    The other half of the rule is unchanged and is what the fragments assert:
    `streamed_text` is reset per attempt, so an answer gathered across several
    attempts is only whole if every piece was carried.

    Mutation check: restore `not streamed_text` in `can_hand_over` (the turn
    errors again), or drop the carry (the fragments are lost).
    """
    streaming(
        [text("one "), mid_stream_failure()],
        [text("two "), mid_stream_failure()],
        [text("three "), mid_stream_failure()],
        [text("four"), done("one two three four")],
    )

    events, cid = await run(workspace)

    assert [e.type for e in events].count("error") == 0, "the chain gave up instead of moving on"
    assistant = [m for m in MessageRepository().history(cid) if m.role == "assistant"]
    assert assistant, "nothing of the answer was kept"
    kept = assistant[-1].content
    for fragment in ("one", "two", "three"):
        assert fragment in kept, f"{fragment!r} reached the screen and was then lost"


async def test_a_failure_before_any_text_still_falls_back_rather_than_resuming(
    db, workspace, streaming
):
    """Nothing on screen means there is nothing to continue from, and the
    existing behaviour -- hand the whole question to the next provider -- is
    still the right one.

    Mutation check: resume unconditionally and the second attempt is told to
    continue an answer that was never started.
    """
    client = streaming(
        [mid_stream_failure()],
        [text("A clean answer."), done("A clean answer.")],
    )

    events, _ = await run(workspace)

    assert said(events) == "A clean answer."
    retried = "\n".join(
        str(m.get("content", "")) for m in client.seen[1] if m.get("role") == "assistant"
    )
    assert "continue" not in retried.lower()



def test_a_repeated_seam_is_not_shown_twice():
    """A model asked to continue sometimes restates the clause it was cut off
    in, and across a hand-over it does it more often -- the provider being
    asked to carry on never wrote the text it is carrying on from.

    The user reads that as the answer glitching, not as two providers having
    been involved, so the overlap is dropped once at the join.

    Mutation check: make `merge_partial` a plain `carried + fragment`.
    """
    from backend.agent.director import merge_partial

    # The ordinary case: nothing repeated, nothing touched.
    assert merge_partial("one ", "two ") == "one two "
    # A whole restatement, which is what a fallback provider tends to produce.
    assert merge_partial("half an ans", "half an ans") == "half an ans"
    # A partial restatement of the last few words.
    assert merge_partial("the reason is that", " is that the cat") == "the reason is that the cat"
    # Either side empty is the other side, not a crash.
    assert merge_partial("", "abc") == "abc"
    assert merge_partial("abc", "") == "abc"


def test_a_long_coincidental_repeat_is_left_alone():
    """The seam repair is bounded, and deliberately.

    Deleting a paragraph because it happened to match the end of another one is
    far worse than leaving a repeated paragraph in: one is a formatting
    annoyance, the other is silently losing what the model said.

    Mutation check: remove the `_MAX_SEAM` bound from `merge_partial`.
    """
    from backend.agent.director import _MAX_SEAM, merge_partial

    repeated = "x" * (_MAX_SEAM + 50)
    assert merge_partial(repeated, repeated) == repeated + "x" * 50


async def test_a_complete_answer_followed_by_a_dead_stream_is_not_an_error(
    db, workspace, streaming
):
    """The whole answer arrived, then the connection fell over. That is not a
    failed turn, and saying so is the worst thing the interface can do.

    Observed: a turn fetched a feed, searched the library, listed a folder and
    wrote several hundred words, all of it on screen and correct -- and then
    closed on a red `Error in input stream` card, because the provider sent an
    error frame instead of shutting the stream down cleanly. The reader has the
    work in front of them and is being told it failed.

    What decides it is what is in hand, not how the connection ended. With an
    answer: a `guard` frame, which the interface draws as a neutral note, and
    the `stopped` phase, which keeps the pickup offer alive. Without one it is
    still an error -- that case is the test below.

    Mutation check: yield `Event("error", ...)` whenever the chain is exhausted,
    regardless of `partial`.
    """
    # Every attempt dies the same way, so the chain is genuinely exhausted and
    # the terminal path is the one under test rather than a resume.
    answer = "SQLite is a small embedded database."
    streaming(
        *[[text(answer), mid_stream_failure()] for _ in range(6)],
    )

    events, cid = await run(workspace)

    kinds = [e.type for e in events]
    assert "error" not in kinds, "a delivered answer was reported as a failure"
    assert kinds[-1] == "guard"
    assert answer in events[-1].data["text"]

    # And it is in the transcript as the answer, not as an answer with an error
    # note stapled underneath it.
    kept = [m for m in MessageRepository().history(cid) if m.role == "assistant"][-1].content
    assert answer in kept
    assert "[model error]" not in kept


async def test_a_turn_that_produced_nothing_is_still_an_error(db, workspace, streaming):
    """The other side of the rule. Nothing was produced, nothing can be shown,
    and a neutral note over an empty turn would hide a real failure.

    Mutation check: drop the `if partial:` branch and take the delivery path
    unconditionally.
    """
    streaming(*[[mid_stream_failure()] for _ in range(6)])

    events, _ = await run(workspace)

    assert [e.type for e in events][-1] == "error"
