"""What a durable job is, and the only moves it may make.

The agent's own state (`backend/agent/state.py`) records what one interactive
turn did. This is the layer above it, and it exists for a different reason: some
work has nobody watching it. An automation runs for minutes with no reader, an
Instagram reel arrives while the machine is asleep, and both used to be a Python
coroutine and nothing else -- so a crash re-ran the whole thing, including every
tool call that had already written a file or sent a message.

A job is therefore two things a turn is not: **retryable**, with a bounded
backoff rather than a loop; and **idempotent**, through a ledger of steps that
have already happened (`job_steps`). Retrying a job re-enters its handler from
the top and every finished step returns its recorded answer instead of running
again. That is the whole mechanism, and it is deliberately the same one
Cloudflare Workflows uses, so the local and remote halves of this are the same
idea in two places rather than two ideas.
"""

from __future__ import annotations

import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

#: The states a job passes through, and the only values `state` ever holds.
STATES = (
    "queued",     # ready to run, waiting only for a lane to pick it up
    "running",    # a lane holds its lease
    "waiting",    # backing off after a transient failure, or blocked on a person
    "paused",     # a person stopped it; it stays where it is until resumed
    "completed",
    "failed",
    "cancelled",
)

#: Once here a job does not run again. `failed` is included: a job that has spent
#: its attempts needs a decision, not another automatic try -- and "retry" is an
#: explicit gesture that creates the next attempt.
TERMINAL = frozenset({"completed", "failed", "cancelled"})

#: Which a lane will pick up. `waiting` becomes `queued` when its deadline
#: passes, so only one state is ever claimable.
RUNNABLE = frozenset({"queued"})

TRANSITIONS: dict[str, frozenset[str]] = {
    # `waiting` from `queued` is the boot sweep holding a job back: it was put
    # on the board by the recovery pass, and then found to be one whose repeat
    # might change something. Without this move the sweep could only raise, and
    # the job stayed claimable.
    "queued": frozenset({"running", "waiting", "paused", "cancelled", "failed"}),
    # `queued` from `running` is the lease being reclaimed after a crash.
    "running": frozenset(
        {"queued", "waiting", "paused", "completed", "failed", "cancelled"}
    ),
    "waiting": frozenset({"queued", "running", "paused", "cancelled", "failed"}),
    "paused": frozenset({"queued", "waiting", "cancelled"}),
    # Terminal, except that a person may ask for another attempt, which is the
    # one move out and is never automatic.
    "completed": frozenset(),
    "failed": frozenset({"queued"}),
    "cancelled": frozenset({"queued"}),
}

#: Bounded backoff. Doubling from 15 seconds, capped at an hour: long enough
#: that a provider having a bad minute is not hammered, short enough that a
#: reel captured at breakfast is not still queued at lunch.
BACKOFF_BASE_SECONDS = 15.0
BACKOFF_CAP_SECONDS = 3600.0
#: Up to a quarter of the delay, added. Two jobs that failed against the same
#: unreachable provider in the same second would otherwise retry in the same
#: second, forever.
BACKOFF_JITTER = 0.25

#: How long a lane's claim on a job is good for without a heartbeat. Longer than
#: any single step is expected to take and shorter than a person's patience: a
#: job whose process died is reclaimed within this, not on the next restart.
LEASE_SECONDS = 120.0


class IllegalTransition(Exception):
    """A state change `TRANSITIONS` does not allow."""


def backoff_for(attempts: int, *, base: float = BACKOFF_BASE_SECONDS,
                cap: float = BACKOFF_CAP_SECONDS) -> float:
    """Seconds to wait before attempt `attempts + 1`.

    Deterministic except for the jitter, so a test can assert the shape of the
    curve without asserting the exact number.
    """
    raw = min(base * (2 ** max(attempts - 1, 0)), cap)
    return raw + random.random() * raw * BACKOFF_JITTER


def now() -> datetime:
    """Local naive, like every other timestamp in this schema.

    Not UTC: SQLite compares these as strings, and a UTC value on one side of a
    comparison against a local one is silently off by the machine's offset --
    which is how reminders once arrived five and a half hours late.
    """
    return datetime.now()


def iso(moment: datetime) -> str:
    return moment.isoformat(sep=" ", timespec="seconds")


@dataclass
class Job:
    """One unit of durable work.

    `payload` is what the handler needs to start; `checkpoint` is what it has
    learned since. Neither holds anything that has a home elsewhere: an
    automation job carries an automation id, not a copy of its prompt, and an
    ingest job carries an event id, not a copy of the delivery.
    """

    kind: str
    #: The "same job" test, and the reason pressing Run twice does not run twice.
    #: Chosen by the caller from the fact the job is about -- an automation and
    #: the minute it came due, a delivery and its key -- never randomly.
    idempotency_key: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    state: str = "queued"
    payload: dict[str, Any] = field(default_factory=dict)
    #: What the handler has worked out so far, carried across attempts. Small
    #: and handler-defined; the step ledger is what carries results.
    checkpoint: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    attempts: int = 0
    max_attempts: int = 3
    #: When a `waiting` job becomes claimable again.
    next_attempt_at: str | None = None
    lease_expires_at: str | None = None
    lease_owner: str | None = None
    #: The turn this job ran, when it ran one. A reference: what that turn did is
    #: in `agent_runs` and in the transcript, and a second copy here would be the
    #: one that went stale.
    run_id: str | None = None
    last_error: str | None = None
    #: Why a `waiting` job is waiting, in a sentence a person can read.
    blocked_on: str | None = None
    created_at: str = field(default_factory=lambda: iso(now()))
    updated_at: str = field(default_factory=lambda: iso(now()))
    started_at: str | None = None
    finished_at: str | None = None

    # ---- lifecycle

    def enter(self, state: str) -> Job:
        """Move to `state`, or refuse. The only way `state` changes."""
        if state not in STATES:
            raise IllegalTransition(f"{state!r} is not a job state")
        if state not in TRANSITIONS.get(self.state, frozenset()):
            raise IllegalTransition(f"{self.state} -> {state}")
        self.state = state
        self.updated_at = iso(now())
        if state == "running" and self.started_at is None:
            self.started_at = self.updated_at
        if state in TERMINAL:
            self.finished_at = self.updated_at
        return self

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL

    @property
    def due(self) -> bool:
        """Whether a `waiting` job's deadline has passed.

        A job waiting on a person has no deadline and is never due: it is
        `resume` or `cancel` that moves it, which is the difference between
        backing off and being blocked.
        """
        if self.next_attempt_at is None:
            return False
        return self.next_attempt_at <= iso(now())

    def schedule_retry(self, error: str, *, base: float = BACKOFF_BASE_SECONDS,
                       cap: float = BACKOFF_CAP_SECONDS) -> Job:
        """Back off and try again, or give up having said why."""
        self.last_error = error
        if self.attempts >= self.max_attempts:
            self.blocked_on = None
            return self.enter("failed")
        delay = backoff_for(self.attempts, base=base, cap=cap)
        self.next_attempt_at = iso(now() + timedelta(seconds=delay))
        self.blocked_on = f"retrying after {error}"
        return self.enter("waiting")

    def block_on(self, reason: str) -> Job:
        """Stop until a person does something. No deadline, so nothing promotes it."""
        self.next_attempt_at = None
        self.blocked_on = reason
        return self.enter("waiting")

    def lease(self, owner: str, *, seconds: float = LEASE_SECONDS) -> Job:
        self.lease_owner = owner
        self.lease_expires_at = iso(now() + timedelta(seconds=seconds))
        return self

    @property
    def lease_expired(self) -> bool:
        return self.lease_expires_at is not None and self.lease_expires_at < iso(now())

    def release(self) -> Job:
        self.lease_owner = None
        self.lease_expires_at = None
        return self

    # ---- serialization

    def to_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "idempotency_key": self.idempotency_key,
            "state": self.state,
            "payload": json.dumps(self.payload),
            "checkpoint": json.dumps(self.checkpoint),
            "result": json.dumps(self.result) if self.result is not None else None,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "next_attempt_at": self.next_attempt_at,
            "lease_expires_at": self.lease_expires_at,
            "lease_owner": self.lease_owner,
            "run_id": self.run_id,
            "last_error": self.last_error,
            "blocked_on": self.blocked_on,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    @classmethod
    def from_row(cls, row: Any) -> Job:
        keys = row.keys() if hasattr(row, "keys") else row
        data = {key: row[key] for key in keys}
        return cls(
            id=data["id"],
            kind=data["kind"],
            idempotency_key=data["idempotency_key"],
            state=data["state"],
            payload=json.loads(data["payload"] or "{}"),
            checkpoint=json.loads(data["checkpoint"] or "{}"),
            result=json.loads(data["result"]) if data.get("result") else None,
            attempts=data["attempts"],
            max_attempts=data["max_attempts"],
            next_attempt_at=data["next_attempt_at"],
            lease_expires_at=data["lease_expires_at"],
            lease_owner=data["lease_owner"],
            run_id=data["run_id"],
            last_error=data["last_error"],
            blocked_on=data["blocked_on"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            started_at=data["started_at"],
            finished_at=data["finished_at"],
        )

    def to_json(self) -> dict[str, Any]:
        """What an interface reads. The payload stays out: it is handler-private."""
        return {
            "id": self.id,
            "kind": self.kind,
            "key": self.idempotency_key,
            "state": self.state,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "next_attempt_at": self.next_attempt_at,
            "blocked_on": self.blocked_on,
            "last_error": self.last_error,
            "result": self.result,
            "run_id": self.run_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
