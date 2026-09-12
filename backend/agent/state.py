"""The canonical state of one turn: what it is doing, and what it may do next.

Everything a turn knew used to live as local variables on the stack of
`Director._run` -- how many times the answer had been picked up after a dropped
stream, which link of the fallback chain was answering, the half-written text the
reader could already see. The process was therefore the state: a `kill -9` took
all of it, and because that also skips the `finally` in `Director.run`, it skipped
`close_open_tool_calls` too -- the repair that stops one interrupted tool call
leaving a conversation broken on every provider afterwards.

What is here is only what has no other home. The messages a turn produced stay
normalized in `messages` (ADR-0017) and this object holds their ids; retrieved
context is referenced by row id rather than copied; the resolved model, the wire
history and the attempt budget are rebuilt, because rebuilding them is cheaper
and more truthful than storing a second copy that can go stale.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger(__name__)

#: Bumped when the shape of a serialized state changes. Separate from the
#: database schema on purpose: the column holding this never changes shape, so a
#: payload written by an older AMETHYST is a *data* migration (see `_UPGRADES`)
#: rather than an `ALTER TABLE` the schema bootstrap could do for us.
STATE_VERSION = 1

#: The phases a turn passes through, and the only values `phase` ever holds.
#:
#: Not `director.STATUSES`. That is a display vocabulary -- an interface styles
#: it -- and it names things whose durable fact is already a number here:
#: `switching` is `active`, `retrying` is `continuations`, `resuming` is
#: `resumes`. A phase for each of those would be the same fact stored twice, and
#: the two copies would disagree the first time one was missed.
PHASES = (
    "preparing",          # the user's message is written; context and chain being assembled
    "reasoning",          # waiting on a model, or picking an answer back up
    "acting",             # dispatching the tools the model asked for
    "awaiting_approval",  # suspended on the permission gate
    "awaiting_input",     # suspended on a clarifying question
    "completed",          # the turn answered
    "stopped",            # a guard ended it: time, iterations, or tool calls
    "cancelled",          # the user pressed Stop
    "failed",             # the chain gave up, or something raised
    "interrupted",        # the process died mid-turn; written by the boot sweep
)

#: Phases a turn does not leave. A row in one of these is finished, whatever
#: else happens to the process that wrote it.
TERMINAL = frozenset({"completed", "stopped", "cancelled", "failed", "interrupted"})

#: Every legal move, written out rather than derived, so the whole truth about
#: what a turn may do next is one table a reader can check against the loop.
#: Self-transitions are listed where they happen: `reasoning -> reasoning` is a
#: resume or a continuation of the same answer, `acting -> acting` the next call
#: in one batch.
TRANSITIONS: dict[str, frozenset[str]] = {
    "preparing": frozenset({"reasoning", "stopped", "cancelled", "failed", "interrupted"}),
    "reasoning": frozenset(
        {"reasoning", "acting", "completed", "stopped", "cancelled", "failed", "interrupted"}
    ),
    "acting": frozenset(
        {
            "acting",
            "reasoning",
            "awaiting_approval",
            "awaiting_input",
            "completed",
            "stopped",
            "cancelled",
            "failed",
            "interrupted",
        }
    ),
    "awaiting_approval": frozenset({"acting", "stopped", "cancelled", "failed", "interrupted"}),
    "awaiting_input": frozenset({"acting", "stopped", "cancelled", "failed", "interrupted"}),
    "completed": frozenset(),
    "stopped": frozenset(),
    "cancelled": frozenset(),
    "failed": frozenset(),
    "interrupted": frozenset(),
}


class IllegalTransition(Exception):
    """A phase change `TRANSITIONS` does not allow.

    Raised rather than logged, because the caller is the loop and a loop that
    thinks a finished turn is still running has a defect the tests should see.
    `Director._advance` is what keeps it from reaching the interface.
    """


class UnknownStateVersion(Exception):
    """A serialized state this AMETHYST cannot read.

    A payload from a *newer* version, or an older one with no upgrade to run.
    Carried out as an exception so the repository can answer `None` and the
    turn can start fresh, rather than a downgrade producing a run whose
    counters silently mean something else.
    """


def _now() -> str:
    """The same format SQLite's `datetime('now')` writes, so the two sort together."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%d %H:%M:%S")


@dataclass
class AgentState:
    """One turn's execution state. Every field here is persisted.

    Nothing derivable is stored: the wire history is rebuilt from `messages`, the
    model is resolved fresh each turn (docs/architecture/ai-runtime.md), and the
    attempt budget is rebuilt from `budget_spent`. `time.monotonic()` is
    deliberately absent -- it means nothing in the next process, so the wall-clock
    guard keeps using a local and `created_at` is what a restart can read.
    """

    conversation_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    mode: str = "chat"
    phase: str = "preparing"

    # The user's request, by reference: the row was already written before
    # anything that can fail, and storing the text here would be the second copy.
    request_message_id: int | None = None
    # The plan, by reference: plan mode persists it as markdown.
    plan_message_id: int | None = None

    # -- working memory: the loop's scratch, none of which belongs in the transcript.
    #
    # `carried` is the half-written answer from earlier attempts at *this* one. It
    # only reaches `messages` if the turn gives up, so this row is its only durable
    # home -- and the reader can already see it on screen.
    carried: str = ""
    # An instruction about how to continue, not part of what was said.
    nudge: str | None = None
    call_fingerprints: dict[str, int] = field(default_factory=dict)
    warned_about_tools: bool = False
    warned_about_cap: bool = False
    degraded: bool = False
    blind_noted: bool = False
    step_open: int | None = None

    # -- tool calls and results, by reference. The arguments and the results are
    # already rows in `messages` and `execution_logs`; what is missing without
    # this is which of those rows this turn produced.
    tool_message_ids: list[int] = field(default_factory=list)
    tool_calls_made: int = 0

    # -- retrieved context, by reference.
    #
    # `{"kind": "memory", "id": int}` -- `memories.id` is permanently stable
    # because a fact is superseded, never deleted. `{"kind": "chunk", "id": int,
    # "label": str}` -- a chunk id is not stable: the indexer removes and
    # re-inserts a chunk whose text changed, so the label it was shown under (a
    # path and a heading) rides along as what a reader could still find.
    retrieved: list[dict[str, Any]] = field(default_factory=list)

    # -- what the turn is suspended on: an approval request id, or a question's.
    pending: list[dict[str, Any]] = field(default_factory=list)

    # -- which provider answered. "provider/model", the form `library_items`
    # already uses for the same question.
    chain: list[str] = field(default_factory=list)
    active: int = 0
    link: str | None = None
    #: Why the chain above looks the way it does, when the router built it:
    #: every provider considered, its score, and the terms that got it there.
    #: `None` when the conversation named its own provider and its own fallback
    #: order, because then there was no decision to explain.
    #:
    #: Stored rather than recomputed, unlike the wire history and the budget.
    #: Those are rebuilt because rebuilding them is more truthful; this is the
    #: opposite case -- headroom and availability are both time-varying, so
    #: recomputing it an hour later would answer a question nobody asked and
    #: quietly disagree with the chain it is supposed to explain.
    route: dict[str, Any] | None = None

    # -- retry and checkpoint bookkeeping.
    iteration: int = 0
    continuations: int = 0
    resumes: int = 0
    budget_spent: int = 0
    #: Incremented on every write. A turn that is making progress has a rising
    #: checkpoint; one that is wedged does not, which is the only way to tell
    #: those apart from outside the process.
    checkpoint: int = 0

    # -- resumability.
    #: High-water mark for the incremental history read, so a resumed or
    #: recovered turn appends the rows it has not seen rather than all of them.
    seen_message_id: int = 0

    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    error: str | None = None

    # ---- lifecycle

    def enter(self, phase: str) -> AgentState:
        """Move to `phase`, or refuse.

        The only way `phase` changes. Returns self so a caller can checkpoint the
        result in one expression.
        """
        if phase not in PHASES:
            raise IllegalTransition(f"{phase!r} is not a phase")
        allowed = TRANSITIONS.get(self.phase, frozenset())
        if phase not in allowed:
            raise IllegalTransition(f"{self.phase} -> {phase}")
        self.phase = phase
        self.updated_at = _now()
        return self

    def begin_iteration(self, iteration: int) -> AgentState:
        """Start a round trip, clearing what belongs to one answer rather than the turn.

        `carried`, `resumes` and `blind_noted` used to be re-declared inside the
        loop body, so their reset was a property of Python scoping and invisible
        to anything reading the state. It is a step now, named where it happens.
        """
        self.iteration = iteration
        self.carried = ""
        self.resumes = 0
        self.blind_noted = False
        self.updated_at = _now()
        return self

    @property
    def terminal(self) -> bool:
        return self.phase in TERMINAL

    @property
    def resumable(self) -> bool:
        """Whether there is a half-written answer worth picking up.

        A completed turn is never resumable however much it carried on the way:
        the answer landed, and offering to continue it invites the model to
        write a second one.
        """
        return bool(self.carried.strip()) and self.phase != "completed"

    # ---- serialization

    def to_json(self) -> dict[str, Any]:
        return {"version": STATE_VERSION, **asdict(self)}

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> AgentState:
        payload = dict(payload)
        version = payload.pop("version", 0)
        if not isinstance(version, int) or version > STATE_VERSION:
            raise UnknownStateVersion(f"state version {version!r} is newer than {STATE_VERSION}")
        while version < STATE_VERSION:
            upgrade = _UPGRADES.get(version)
            if upgrade is None:
                raise UnknownStateVersion(f"no upgrade from state version {version}")
            payload = upgrade(payload)
            version += 1
        known = {f.name for f in fields(cls)}
        # A key this version has no field for is dropped rather than raising.
        # `Message.from_row` reads defensively for the same reason: a database
        # written by a slightly different build should not take a turn down.
        unknown = set(payload) - known
        if unknown:
            log.debug("ignoring unknown agent state keys: %s", ", ".join(sorted(unknown)))
        return cls(**{k: v for k, v in payload.items() if k in known})


#: How to read a payload written by an older `STATE_VERSION`, keyed by the
#: version it upgrades *from*. Empty at version 1 -- there is nothing older -- but
#: the walk in `from_json` is what makes the first real entry a one-line change
#: instead of a scheme invented under pressure, and the round-trip test drives it
#: with a registered upgrade so the mechanism is exercised before it is needed.
_UPGRADES: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}
