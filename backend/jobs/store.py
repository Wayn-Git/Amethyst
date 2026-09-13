"""The jobs table, and the claim that makes a lane safe to crash.

Nothing above this module issues SQL for jobs, the same rule
`backend/db/repositories.py` states for everything else. It lives here rather
than there because the step ledger is not a repository method -- it is a control
structure a handler runs its work inside, and putting it beside the table it
reads keeps the two honest about each other.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from backend.db.connection import get_connection
from backend.jobs.state import (
    LEASE_SECONDS,
    RUNNABLE,
    TERMINAL,
    Job,
    iso,
    now,
)

log = logging.getLogger(__name__)

#: Identifies the process holding a lease. Not for security -- there is one user
#: and one process -- but so a reclaimed lease says in the log whose it was.
OWNER = f"{socket.gethostname()}:{os.getpid()}"

#: Newest jobs kept. A job is a row per unit of background work, so this grows
#: with reels captured and automations fired rather than with anything a person
#: reads. Terminal rows are pruned; live ones never are.
KEEP = 1000


class JobStore:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()

    # ---- creating

    def enqueue(
        self,
        kind: str,
        idempotency_key: str,
        *,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> Job:
        """The job for this key, creating it only if there is not one already.

        This is what "the interface reconnects rather than creating" is made of.
        Pressing Run twice, a webhook Meta re-delivers, a page reloaded while a
        job is in flight: all three arrive here with the same key and all three
        get the job that already exists.

        A *finished* job is not re-opened. Asking again for work that is done
        gets the record of it, which is the answer to "did this happen" --
        running it a second time would be the answer to a question nobody asked.
        """
        existing = self.by_key(idempotency_key)
        if existing is not None:
            return existing
        job = Job(
            kind=kind,
            idempotency_key=idempotency_key,
            payload=payload or {},
            max_attempts=max_attempts,
        )
        row = job.to_row()
        try:
            self.conn.execute(
                f"INSERT INTO jobs ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                tuple(row.values()),
            )
            self.conn.commit()
        except sqlite3.IntegrityError:
            # Two lanes, or a lane and a request, reaching the same key at once.
            # The unique index is the arbiter rather than the read above, which
            # can only ever be advisory.
            found = self.by_key(idempotency_key)
            if found is None:
                raise
            return found
        return job

    def begin(
        self,
        kind: str,
        idempotency_key: str,
        *,
        payload: dict[str, Any] | None = None,
        max_attempts: int = 3,
        lease_seconds: float = LEASE_SECONDS,
    ) -> Job:
        """The durable record for work the caller is about to do itself.

        For a caller that is already its own lane -- the Instagram drain claims
        its deliveries from `instagram_events`, which is where Meta's retries
        collide, and moving that claim here would leave two queues disagreeing
        about the same reel. What it wants from a job is the part a queue does
        not give it: a ledger of what has already been done, so a re-delivery or
        a reclaimed event does not send a second confirmation.

        Re-entrant on purpose. A job left `queued` by a crash, or reclaimed from
        a lapsed lease, is taken up again with its steps intact.
        """
        job = self.enqueue(kind, idempotency_key, payload=payload, max_attempts=max_attempts)
        if job.terminal:
            return job
        if job.state != "running":
            if job.state in ("waiting", "paused"):
                job.next_attempt_at = None
                job.blocked_on = None
                job.enter("queued")
            job.enter("running")
        job.attempts += 1
        job.lease(OWNER, seconds=lease_seconds)
        return self.save(job)

    # ---- reading

    def get(self, job_id: str) -> Job | None:
        row = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return Job.from_row(row) if row else None

    def by_key(self, idempotency_key: str) -> Job | None:
        row = self.conn.execute(
            "SELECT * FROM jobs WHERE idempotency_key = ?", (idempotency_key,)
        ).fetchone()
        return Job.from_row(row) if row else None

    def list(self, *, kind: str | None = None, state: str | None = None,
             limit: int = 50) -> list[Job]:
        sql = "SELECT * FROM jobs"
        clauses: list[str] = []
        params: list[Any] = []
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if state:
            clauses.append("state = ?")
            params.append(state)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        params.append(limit)
        return [Job.from_row(row) for row in self.conn.execute(sql, params).fetchall()]

    def live_for(self, prefix: str) -> Job | None:
        """A job for this thing that has not finished, if there is one.

        What "reconnect rather than create" is made of on the read side. The
        idempotency key carries the fact the job is about, so a prefix of it --
        `automation:7:` -- names every job about that automation, and at most one
        of them is ever live.
        """
        states = ", ".join(f"'{state}'" for state in sorted(TERMINAL))
        row = self.conn.execute(
            f"SELECT * FROM jobs WHERE idempotency_key LIKE ? AND state NOT IN ({states})"
            " ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (f"{prefix}%",),
        ).fetchone()
        return Job.from_row(row) if row else None

    def counts(self, *, kind: str | None = None) -> dict[str, int]:
        sql = "SELECT state, COUNT(*) AS n FROM jobs"
        params: tuple = ()
        if kind:
            sql += " WHERE kind = ?"
            params = (kind,)
        sql += " GROUP BY state"
        return {row["state"]: row["n"] for row in self.conn.execute(sql, params)}

    # ---- writing

    def save(self, job: Job) -> Job:
        row = job.to_row()
        assignments = ", ".join(f"{column} = ?" for column in row if column != "id")
        values = [value for column, value in row.items() if column != "id"]
        self.conn.execute(f"UPDATE jobs SET {assignments} WHERE id = ?", (*values, job.id))
        self.conn.commit()
        return job

    def checkpoint(self, job: Job, **fields: Any) -> Job:
        """Write down what the handler has learned, and keep the lease alive.

        The two together on purpose: a handler that has made progress is a
        handler that is still alive, and a heartbeat written at a different
        moment from the progress it proves is a heartbeat that can outlive it.
        """
        job.checkpoint.update(fields)
        job.lease(OWNER)
        return self.save(job)

    # ---- claiming

    def promote_due(self, *, kind: str | None = None) -> int:
        """Waiting jobs whose backoff has run out become claimable.

        Separate from `claim` so the promotion is visible in the table rather
        than implied by a query, and so a person looking at `waiting` sees the
        same set the lane does.
        """
        sql = (
            "UPDATE jobs SET state = 'queued', updated_at = ?, blocked_on = NULL"
            " WHERE state = 'waiting' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?"
        )
        params: list[Any] = [iso(now()), iso(now())]
        if kind:
            sql += " AND kind = ?"
            params.append(kind)
        cursor = self.conn.execute(sql, params)
        self.conn.commit()
        return cursor.rowcount

    def claim(self, kinds: list[str], *, lease_seconds: float = LEASE_SECONDS) -> Job | None:
        """Take the oldest runnable job of these kinds, atomically.

        The `UPDATE ... WHERE id = (SELECT ...)` shape is the same one
        `InstagramEventStore.claim_next` uses, and for the same reason: a read
        followed by a write is two statements a second lane can interleave.
        """
        if not kinds:
            return None
        placeholders = ", ".join("?" * len(kinds))
        states = ", ".join(f"'{state}'" for state in sorted(RUNNABLE))
        deadline = iso(now() + timedelta(seconds=lease_seconds))
        cursor = self.conn.execute(
            "UPDATE jobs SET state = 'running', attempts = attempts + 1,"
            " lease_owner = ?, lease_expires_at = ?, updated_at = ?,"
            " started_at = COALESCE(started_at, ?)"
            " WHERE id = (SELECT id FROM jobs"
            f"  WHERE kind IN ({placeholders}) AND state IN ({states})"
            "   ORDER BY created_at, rowid LIMIT 1)",
            (OWNER, deadline, iso(now()), iso(now()), *kinds),
        )
        self.conn.commit()
        if not cursor.rowcount:
            return None
        row = self.conn.execute(
            "SELECT * FROM jobs WHERE lease_owner = ? AND state = 'running'"
            " ORDER BY updated_at DESC, rowid DESC LIMIT 1",
            (OWNER,),
        ).fetchone()
        return Job.from_row(row) if row else None

    def reclaim_expired(self, *, kind: str | None = None) -> list[Job]:
        """Jobs whose lane stopped answering. Returns what was reclaimed.

        A lease that lapsed means the process holding it is gone -- killed,
        crashed, or shut down mid-step. The job goes back to `queued` if it has
        attempts left and `failed` if it does not, and either way the row stops
        claiming to be running, which is what a person was reading.

        Handlers decide whether re-running is safe; this only decides whether it
        is *allowed* to be tried. See `JobRunner` for the rule that stops a job
        whose last attempt made an unsafe call.
        """
        sql = "SELECT * FROM jobs WHERE state = 'running' AND lease_expires_at < ?"
        params: list[Any] = [iso(now())]
        if kind:
            sql += " AND kind = ?"
            params.append(kind)
        reclaimed: list[Job] = []
        for row in self.conn.execute(sql, params).fetchall():
            job = Job.from_row(row)
            job.release()
            job.last_error = job.last_error or "the process running this job stopped"
            if job.attempts >= job.max_attempts:
                job.enter("failed")
            else:
                # Straight back to queued rather than into a backoff: the lease
                # has already been the wait, and it is longer than the first
                # backoff step would have been.
                job.enter("queued")
            self.save(job)
            log.info("reclaimed job %s (%s) from %s", job.id, job.kind, row["lease_owner"])
            reclaimed.append(job)
        return reclaimed

    # ---- finishing

    def complete(self, job: Job, result: dict[str, Any] | None = None) -> Job:
        job.result = result
        job.last_error = None
        job.blocked_on = None
        job.release()
        return self.save(job.enter("completed"))

    def fail(self, job: Job, error: str, *, retry: bool = True,
             base: float | None = None, cap: float | None = None) -> Job:
        """Back off and try again, or stop having said why.

        `retry=False` is for a failure another attempt cannot fix -- a deleted
        automation, a delivery that names nothing. Spending three attempts and
        an hour of backoff to prove that again is not resilience.
        """
        job.release()
        if not retry:
            job.last_error = error
            job.blocked_on = None
            return self.save(job.enter("failed"))
        kwargs: dict[str, Any] = {}
        if base is not None:
            kwargs["base"] = base
        if cap is not None:
            kwargs["cap"] = cap
        return self.save(job.schedule_retry(error, **kwargs))

    def block(self, job: Job, reason: str) -> Job:
        """Stop until a person acts. Nothing promotes this; `resume` moves it."""
        job.release()
        return self.save(job.block_on(reason))

    def pause(self, job: Job) -> Job:
        job.release()
        return self.save(job.enter("paused"))

    def resume(self, job: Job) -> Job:
        """Back into the lane, now. A resumed job keeps its steps, so it carries
        on rather than starting over."""
        job.blocked_on = None
        job.next_attempt_at = None
        if job.state == "queued":
            # Already on the board. Resuming it again is the same instruction
            # arriving twice -- two tabs, a double click -- not a state change.
            return self.save(job)
        return self.save(job.enter("queued"))

    def cancel(self, job: Job) -> Job:
        job.release()
        job.blocked_on = None
        return self.save(job.enter("cancelled"))

    def retry(self, job: Job, *, reset_steps: bool = False) -> Job:
        """Another attempt at a job that stopped, asked for by a person.

        The steps are kept by default, which is the point: retrying a job that
        sent a message and then failed must not send it again. `reset_steps` is
        for the case where a person has decided the earlier work is void, and it
        is theirs to decide -- nothing here can tell a message that should be
        re-sent from one that must not.
        """
        if reset_steps:
            self.conn.execute("DELETE FROM job_steps WHERE job_id = ?", (job.id,))
            self.conn.commit()
        job.attempts = 0
        job.last_error = None
        job.blocked_on = None
        job.next_attempt_at = None
        job.finished_at = None
        job.release()
        if job.state == "queued":
            return self.save(job)
        return self.save(job.enter("queued"))

    # ---- the step ledger

    def recorded(self, job: Job, step_key: str) -> tuple[bool, Any]:
        """Has this step already happened, and what did it answer?"""
        row = self.conn.execute(
            "SELECT result FROM job_steps WHERE job_id = ? AND step_key = ?",
            (job.id, step_key),
        ).fetchone()
        if row is None:
            return False, None
        return True, json.loads(row["result"]) if row["result"] else None

    def record(self, job: Job, step_key: str, result: Any = None) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO job_steps (job_id, step_key, result) VALUES (?, ?, ?)",
            (job.id, step_key, json.dumps(result) if result is not None else None),
        )
        self.conn.commit()

    def steps(self, job: Job) -> list[str]:
        return [
            row["step_key"]
            for row in self.conn.execute(
                "SELECT step_key FROM job_steps WHERE job_id = ? ORDER BY created_at, rowid",
                (job.id,),
            )
        ]

    async def step(
        self,
        job: Job,
        step_key: str,
        run: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Run this once across every attempt at this job.

        The shape of durable execution, and the only thing an externally visible
        operation should be called inside. On the first attempt `run` is called
        and its answer written down; on every later attempt the written answer
        is returned and `run` is not called.

        The write happens *after* `run` returns, so a crash in the middle leaves
        no row and the step runs again. At-least-once for the step in flight,
        exactly-once for every step before it. Making it the other way round --
        writing first -- would turn a crash into silently skipped work, which is
        worse: a lost reply is visible, a reply that was never attempted is not.
        """
        done, result = self.recorded(job, step_key)
        if done:
            log.debug("job %s step %s already done", job.id, step_key)
            return result
        result = await run()
        self.record(job, step_key, result)
        # The lease is renewed by the progress itself: finishing a step is the
        # proof of life, and a heartbeat on any other schedule can outlive it.
        job.lease(OWNER)
        self.save(job)
        return result

    # ---- housekeeping

    def recover_orphans(self, *, note: str | None = None) -> list[Job]:
        """Every job the last process left running, at boot.

        One uvicorn worker is a non-negotiable (CLAUDE.md), so a job still
        holding a lease when this process starts cannot be one somebody else is
        driving -- its lane is gone. Unlike `reclaim_expired` this does not wait
        for the lease to lapse, because the lease was granted by a process that
        no longer exists.
        """
        reclaimed: list[Job] = []
        for row in self.conn.execute(
            "SELECT * FROM jobs WHERE state = 'running'"
        ).fetchall():
            job = Job.from_row(row)
            job.release()
            job.last_error = note or "the process running this job stopped"
            job.enter("queued" if job.attempts < job.max_attempts else "failed")
            self.save(job)
            reclaimed.append(job)
        return reclaimed

    def prune(self, *, keep: int = KEEP) -> int:
        """Keep the newest `keep` finished jobs. Live ones are never pruned."""
        states = ", ".join(f"'{state}'" for state in sorted(TERMINAL))
        cursor = self.conn.execute(
            f"DELETE FROM jobs WHERE state IN ({states}) AND rowid <"
            f" (SELECT COALESCE(MIN(rowid), 0) FROM"
            f"  (SELECT rowid FROM jobs WHERE state IN ({states})"
            "    ORDER BY rowid DESC LIMIT ?))",
            (keep,),
        )
        self.conn.commit()
        return cursor.rowcount
