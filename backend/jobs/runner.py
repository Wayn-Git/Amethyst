"""A lane: one loop that claims jobs of certain kinds and runs them.

Lanes rather than one queue, because the reasons the existing runners are
separate have not changed. `backend/instagram/runner.py` says it plainly -- the
work there is minutes long, and queueing a reminder behind it would make neither
arrive when it should. A single job loop would put a reel ingest behind a
three-minute automation and undo that.

What a lane adds over the coroutine it replaces is the part a coroutine cannot
have: the work is written down before it starts, its progress is written down as
it goes, and a process that dies leaves a row saying so instead of nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from backend.jobs.state import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_CAP_SECONDS,
    LEASE_SECONDS,
    Job,
)
from backend.jobs.store import JobStore

log = logging.getLogger(__name__)

#: How often an idle lane looks for work. A job enqueued by a request nudges its
#: lane, so this is the floor for work that arrives without one -- a promotion
#: out of backoff, a reclaim -- not the latency of pressing a button.
TICK_SECONDS = 2.0


class Blocked(Exception):
    """The handler needs a person before it can go on.

    Distinct from a failure: nothing is wrong, and retrying on a timer would
    only ask the same unanswered question again. The job waits with no deadline
    until somebody resumes or cancels it.
    """


class Unretryable(Exception):
    """This will not work on the next attempt either.

    A deleted automation, a delivery naming nothing, a tool profile that no
    longer exists. Spending three attempts and an hour of backoff to prove that
    again is not resilience.
    """


@dataclass
class Handler:
    """What a lane knows about one kind of job."""

    kind: str
    run: Callable[[Job, JobStore], Awaitable[dict[str, Any] | None]]
    #: Bounded backoff for this kind. An automation waits minutes between
    #: attempts because its inputs change slowly; an ingest waits seconds
    #: because Instagram's asset URLs do not.
    backoff_base: float = BACKOFF_BASE_SECONDS
    backoff_cap: float = BACKOFF_CAP_SECONDS
    max_attempts: int = 3
    lease_seconds: float = LEASE_SECONDS
    #: Whether a job of this kind whose last attempt died mid-flight may be
    #: retried without asking. False means the handler cannot promise its work
    #: is replayable, and a reclaimed job of this kind waits for a person rather
    #: than repeating whatever the dead attempt had already done.
    #:
    #: A handler that wraps every externally visible operation in
    #: `JobStore.step` can set this True and mean it. One that runs an agent
    #: turn cannot: the model chooses the tool calls, so what the dead attempt
    #: did is not knowable in advance -- see `replayable_after_crash`.
    auto_retry_after_crash: bool = True


_HANDLERS: dict[str, Handler] = {}


def register(handler: Handler) -> Handler:
    """Make a kind runnable. Registering twice replaces, so a reload is safe."""
    _HANDLERS[handler.kind] = handler
    return handler


def handler_for(kind: str) -> Handler | None:
    return _HANDLERS.get(kind)


def registered_kinds() -> list[str]:
    return sorted(_HANDLERS)


def replayable_after_crash(job: Job, store: JobStore | None = None) -> tuple[bool, str]:
    """May this job be re-run automatically after its last attempt died?

    The rule the requirement "never duplicate tool calls after retry unless the
    operation is explicitly safe" turns into code.

    Three ways to be safe, in order:

    1. The kind says so. A handler whose every outward call goes through
       `JobStore.step` has made re-running a no-op for the parts that already
       happened, and says so with `auto_retry_after_crash`.
    2. Nothing has happened yet. A job that never started, or whose ledger is
       empty and whose turn made no tool calls, has nothing to repeat.
    3. What happened was read-only. `execution_logs.risk_level` records what the
       permission gate *decided* for every call, so a dead attempt that only
       read can be repeated; one that wrote, deleted, sent or ran a shell
       command cannot, and the job waits for a person.

    Asked of the audit table rather than of the model's own account of itself,
    because the audit table is the record the gate wrote.
    """
    handler = handler_for(job.kind)
    if handler is not None and handler.auto_retry_after_crash:
        return True, ""
    # Where the dead attempt's tool calls would be recorded, if it made any. The
    # handler writes it down as soon as it knows, so a job that died before that
    # cannot have called anything.
    conversation_id = job.checkpoint.get("conversation_id")
    if not conversation_id:
        return True, ""

    store = store or JobStore()
    try:
        rows = store.conn.execute(
            "SELECT DISTINCT tool_name, risk_level FROM execution_logs"
            " WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchall()
    except Exception as exc:
        # An unreadable audit table is not permission to repeat a write.
        log.warning("could not read the audit trail for job %s: %s", job.id, exc)
        return False, "its audit trail could not be read"

    unsafe = sorted(
        {row["tool_name"] for row in rows if (row["risk_level"] or "low").lower() != "low"}
    )
    if not unsafe:
        return True, ""
    named = ", ".join(unsafe[:4]) + ("…" if len(unsafe) > 4 else "")
    return False, (
        f"its last attempt stopped after running {named}, which may have changed"
        " something. Retry it if repeating that is safe, or cancel it."
    )


class JobRunner:
    """One lane. Claims jobs of `kinds`, runs them one at a time.

    One at a time within a lane deliberately, for the reason `AutomationRunner`
    already gives: three unattended turns reaching for the same machine at once
    is not something a single user gains anything from.
    """

    def __init__(self, kinds: list[str], *, name: str | None = None,
                 tick_seconds: float = TICK_SECONDS) -> None:
        self.kinds = list(kinds)
        self.name = name or "+".join(self.kinds)
        self.tick_seconds = tick_seconds
        self._task: asyncio.Task | None = None
        # Built in `start`, inside the loop that will use them. An asyncio.Event
        # created under one loop keeps waiters belonging to it, so a
        # module-level one reused across loops -- which every test's app
        # lifespan does -- waits on a future that can never resolve.
        self._wake: asyncio.Event | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._wake = asyncio.Event()
            self._task = asyncio.create_task(self._loop(), name=f"jobs:{self.name}")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._wake = None

    def nudge(self) -> None:
        """Something was enqueued. Look now rather than at the next tick."""
        if self._wake is not None:
            self._wake.set()

    async def _loop(self) -> None:
        wake = self._wake
        while True:
            try:
                if wake is not None:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(wake.wait(), timeout=self.tick_seconds)
                    wake.clear()
                else:
                    await asyncio.sleep(self.tick_seconds)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the lane
                log.exception("job lane %s failed a tick", self.name)

    async def tick(self, *, limit: int = 1) -> list[str]:
        """Promote, reclaim, and run what is waiting. Returns the job ids run."""
        store = JobStore()
        for kind in self.kinds:
            store.promote_due(kind=kind)
            for job in store.reclaim_expired(kind=kind):
                self._guard_replay(job, store)

        ran: list[str] = []
        for _ in range(limit):
            handler = None
            job = store.claim(self.kinds)
            if job is None:
                break
            handler = handler_for(job.kind)
            if handler is None:
                store.fail(job, f"nothing knows how to run a '{job.kind}' job", retry=False)
                continue
            # Asked after the claim, because the claim is what made this attempt
            # a fact. A job reclaimed from a dead process and then found unsafe
            # to repeat stops here rather than after the handler has run.
            safe, why = replayable_after_crash(job, store)
            if not safe and job.attempts > 1:
                store.block(job, why)
                continue
            await self._execute(job, handler, store)
            ran.append(job.id)
        return ran

    def _guard_replay(self, job: Job, store: JobStore) -> None:
        """A reclaimed job that must not be repeated waits for a person instead."""
        if job.state != "queued":
            return
        safe, why = replayable_after_crash(job, store)
        if not safe:
            store.block(job, why)

    async def _execute(self, job: Job, handler: Handler, store: JobStore) -> None:
        """Run one job, turning everything it raises into a state.

        Nothing raises out of a lane, the same rule the agent loop follows: a
        handler that blows up is a failed job with a reason on it, not a lane
        that stops taking work.
        """
        try:
            result = await handler.run(job, store)
        except Blocked as exc:
            store.block(job, str(exc) or "waiting on you")
        except Unretryable as exc:
            store.fail(job, f"{exc}", retry=False)
        except asyncio.CancelledError:
            # A shutdown. Put it back rather than failing it: nothing is wrong
            # with the job, and the lease would reclaim it anyway -- this is
            # only faster and says so in the row.
            store.fail(job, "AMETHYST shut down while this was running",
                       base=handler.backoff_base, cap=handler.backoff_cap)
            raise
        except Exception as exc:
            log.exception("job %s (%s) failed", job.id, job.kind)
            store.fail(
                job,
                f"{type(exc).__name__}: {exc}",
                base=handler.backoff_base,
                cap=handler.backoff_cap,
            )
        else:
            store.complete(job, result if isinstance(result, dict) else None)


def enqueue(
    kind: str,
    idempotency_key: str,
    *,
    payload: dict[str, Any] | None = None,
    store: JobStore | None = None,
) -> Job:
    """Put work on the board, using the registered kind's attempt budget."""
    handler = handler_for(kind)
    return (store or JobStore()).enqueue(
        kind,
        idempotency_key,
        payload=payload,
        max_attempts=handler.max_attempts if handler else 3,
    )
