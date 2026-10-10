"""A failed run always carries a reason (Phase 01, Task 7).

Five rows in the live database had `phase='failed'`, `error=NULL`,
`iteration=0` -- no terminal frame written. The producer is the backstop in
`Director.run`'s `finally`: it checkpointed `failed` without ensuring
`state.error`, and the reader hung up (GeneratorExit) is the common path into
it. Each test names the mutation that makes it fail.
"""

from __future__ import annotations

from backend.agent.director import Director
from backend.db.repositories import AgentRunRepository, ConversationRepository
from backend.runtime.types import Capabilities, ModelResponse, ResolvedModel
from backend.security.confirmation import ConfirmationService, auto_approve
from backend.tools.base import RiskLevel, Tool, ToolResult
from backend.tools.registry import ToolRegistry


def _registry() -> ToolRegistry:
    reg = ToolRegistry(ConfirmationService(auto_approve))

    async def echo(args, ctx):
        return ToolResult.ok("ok")

    reg.register(
        Tool(
            name="echo",
            description="echo",
            parameters={"type": "object", "properties": {}},
            handler=echo,
            risk=RiskLevel.LOW,
        )
    )
    return reg


class _Client:
    async def complete(self, messages, tools=None, params=None):
        return ModelResponse(text="an answer")


def _install_client(monkeypatch) -> None:
    from backend.agent import director as director_mod

    resolved = ResolvedModel(
        provider="fake",
        model="fake-1",
        client=_Client(),
        capabilities=Capabilities(streaming=False, context_window=32_000),
    )
    monkeypatch.setattr(director_mod, "resolve", lambda *a, **k: resolved)


async def test_a_reader_that_hangs_up_leaves_a_reason_on_the_row(db, monkeypatch):
    """The Task 7 producer: GeneratorExit re-raises without touching
    `state.error`, and the backstop used to write `failed` anyway.

    Mutation check: revert the backstop to a bare
    `self._checkpoint(state, "failed")` (no synthesized error).
    """
    _install_client(monkeypatch)
    cid = ConversationRepository().create("fake", "fake-1")

    stream = Director(_registry(), memory=False, retrieval=False).run(cid, "hi")
    async for _event in stream:
        break  # the reader hangs up right here
    await stream.aclose()

    state = AgentRunRepository().latest(cid)
    assert state is not None, "the row was opened before anything could fail"
    assert state.phase == "failed", f"phase={state.phase!r}"
    assert state.error, "phase='failed' with error=NULL is the bug itself"


async def test_an_exception_outside_the_loop_is_recorded_on_the_row(db, monkeypatch):
    """`run()`'s catch-all sets `state.error`, the backstop lands the phase.

    Mutation check: drop `state.error = message` from `Director.run`'s
    `except Exception`.
    """
    from backend.agent import director as director_mod

    def boom(*a, **k):
        raise RuntimeError("the chain could not be built")

    monkeypatch.setattr(director_mod, "build_chain", boom)
    cid = ConversationRepository().create("fake", "fake-1")

    events = [
        e
        async for e in Director(
            _registry(), memory=False, retrieval=False
        ).run(cid, "hi")
    ]

    assert events[-1].type == "error", "the stream ends with a terminal frame"
    state = AgentRunRepository().latest(cid)
    assert state is not None
    assert state.phase == "failed"
    assert state.error and "the chain could not be built" in state.error


async def test_a_loop_failure_lands_error_and_phase_together(db, monkeypatch):
    """A provider failure the loop classifies all the way out: terminal event
    on the wire, non-NULL error in the row.

    Mutation check: checkpoint `failed` before assigning `state.error`.
    """

    class AlwaysFails:
        async def complete(self, messages, tools=None, params=None):
            raise ConnectionError("provider gone")

    from backend.agent import director as director_mod

    resolved = ResolvedModel(
        provider="fake",
        model="fake-1",
        client=AlwaysFails(),
        capabilities=Capabilities(streaming=False, context_window=32_000),
    )
    monkeypatch.setattr(director_mod, "resolve", lambda *a, **k: resolved)
    cid = ConversationRepository().create("fake", "fake-1")

    events = [
        e
        async for e in Director(
            _registry(), memory=False, retrieval=False
        ).run(cid, "hi")
    ]

    assert events[-1].type in {"error", "guard"}, (
        f"the stream must end on a terminal frame, got {events[-1].type}"
    )
    state = AgentRunRepository().latest(cid)
    assert state is not None
    assert state.phase == "failed"
    assert state.error, "the row explains itself"


async def test_an_unknown_conversation_still_ends_with_a_terminal_frame():
    """An early `_run` return that yields nothing leaves an SSE reader waiting
    forever.

    Mutation check: drop the `yield Event("error", ...)` before that return.
    """
    events = [
        e
        async for e in Director(
            _registry(), memory=False, retrieval=False
        ).run("does-not-exist", "hi")
    ]

    assert events, "something must come back"
    assert events[-1].type == "error"
