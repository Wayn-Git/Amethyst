"""What a remote worker said, once it has reached this machine.

The round trip, end to end:

    batch handler -> GitHub Actions (workflow_dispatch, carrying a job id we chose)
                  -> runner does the work
                  -> POST {relay}/worker/report  (its own bearer token)
                  -> relay holds it in D1
    RelayPoller   -> POST /sync                  (the poll it was making anyway)
                  -> `apply` writes the rows here
    batch handler -> `get` sees the result and the node settles

The id is the only thing tying the two ends together, and it is one *this*
machine generated: `workflow_dispatch` returns no run id, so there is nothing
GitHub could have told us that would serve. It is derived rather than random --
`{batch job id}:{node id}` -- so a dispatch replayed after a crash reattaches to
the run already in flight instead of starting a second one.

**A report is data, never an instruction.** It arrives through a Worker this
machine does not trust with anything (`backend/instagram/relay.py` says why at
length) and it is written by a runner executing a spec the agent composed. So
every field is bounded here, at the boundary, before a row exists: an id that
does not name a job this machine started is dropped, and a result too large to
be a summary is truncated rather than stored.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from typing import Any

from backend.db.connection import get_connection

log = logging.getLogger(__name__)

#: The states a worker may claim. Anything else is a report we did not write the
#: other half of, and it is dropped rather than stored as an unknown string that
#: the batch handler would then wait on forever.
STATES = ("queued", "running", "completed", "failed")
TERMINAL = frozenset({"completed", "failed"})

#: A result is a summary, not a corpus. The relay refuses more than this too, so
#: the cap is stated in both places on purpose -- a worker that wants to send a
#: library sends references and the laptop fetches them itself.
MAX_RESULT_BYTES = 256 * 1024
MAX_ERROR_CHARS = 2_000
#: `{uuid}:{node}` -- long enough for both, short enough not to be a payload.
MAX_ID_CHARS = 200


@dataclass(frozen=True)
class WorkerReport:
    job_id: str
    state: str
    progress: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    lane: str | None = None
    updated_at: str | None = None

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL

    def as_json(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "state": self.state,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
            "lane": self.lane,
            "updated_at": self.updated_at,
        }


def _small(value: Any, *, limit: int) -> Any:
    """`value` if it fits, a note in its place if it does not.

    Truncating the JSON text would produce something that no longer parses, so
    an oversized result is *replaced*. The worker is told the cap; one that
    exceeds it has a bug, and storing half of its answer would hide that.
    """
    if value is None:
        return None
    encoded = json.dumps(value, default=str)
    if len(encoded.encode("utf-8")) <= limit:
        return value
    return {"truncated": True, "bytes": len(encoded.encode("utf-8")), "limit": limit}


def parse(raw: Any) -> WorkerReport | None:
    """One row from the relay, checked. `None` means it is not a report."""
    if not isinstance(raw, dict):
        return None
    job_id = str(raw.get("job_id") or "").strip()
    state = str(raw.get("state") or "").strip()
    if not job_id or len(job_id) > MAX_ID_CHARS or state not in STATES:
        return None
    progress = raw.get("progress")
    lane = str(raw.get("lane") or "").strip() or None
    error = raw.get("error")
    return WorkerReport(
        job_id=job_id,
        state=state,
        progress=progress if isinstance(progress, dict) else None,
        result=_small(raw.get("result"), limit=MAX_RESULT_BYTES),
        error=str(error)[:MAX_ERROR_CHARS] if error else None,
        lane=lane[:32] if lane else None,
        updated_at=str(raw.get("updated_at") or "") or None,
    )


class WorkerReportStore:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()

    def apply(self, raw: Any) -> WorkerReport | None:
        """Write one report down. Returns what was stored, or None if refused.

        Last write wins, deliberately: a worker reports progress several times
        and a result once, and the only row worth keeping is the newest. There
        is no ordering guarantee across the relay, so a late `running` landing
        after a `completed` would undo the answer -- which is why a terminal row
        is never overwritten by a non-terminal one.
        """
        report = parse(raw)
        if report is None:
            log.debug("dropped a worker report that was not one: %r", raw)
            return None

        existing = self.get(report.job_id)
        if existing is not None and existing.terminal and not report.terminal:
            return existing

        self.conn.execute(
            "INSERT INTO worker_reports (job_id, state, progress, result, error, lane)"
            " VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(job_id) DO UPDATE SET state = excluded.state,"
            "  progress = excluded.progress, result = excluded.result,"
            "  error = excluded.error, lane = COALESCE(excluded.lane, worker_reports.lane),"
            "  updated_at = datetime('now')",
            (
                report.job_id,
                report.state,
                json.dumps(report.progress) if report.progress is not None else None,
                json.dumps(report.result) if report.result is not None else None,
                report.error,
                report.lane,
            ),
        )
        self.conn.commit()
        return report

    def get(self, job_id: str) -> WorkerReport | None:
        row = self.conn.execute(
            "SELECT * FROM worker_reports WHERE job_id = ?", (job_id,)
        ).fetchone()
        if row is None:
            return None
        return WorkerReport(
            job_id=row["job_id"],
            state=row["state"],
            progress=json.loads(row["progress"]) if row["progress"] else None,
            result=json.loads(row["result"]) if row["result"] else None,
            error=row["error"],
            lane=row["lane"],
            updated_at=row["updated_at"],
        )

    def open(self, job_id: str, *, lane: str | None = None) -> WorkerReport:
        """Record that work was dispatched, before anything has answered.

        So a batch that is waiting can tell "dispatched, nothing back yet" from
        "never dispatched" -- which is the difference between waiting and
        retrying, and the two are not interchangeable when the far side may
        already be running.
        """
        self.conn.execute(
            "INSERT INTO worker_reports (job_id, state, lane) VALUES (?, 'queued', ?)"
            " ON CONFLICT(job_id) DO NOTHING",
            (job_id, lane),
        )
        self.conn.commit()
        return self.get(job_id) or WorkerReport(job_id=job_id, state="queued", lane=lane)

    def clear(self, job_ids: list[str]) -> int:
        """Forget these. Called once the batch that asked for them has settled."""
        if not job_ids:
            return 0
        marks = ", ".join("?" * len(job_ids))
        cursor = self.conn.execute(
            f"DELETE FROM worker_reports WHERE job_id IN ({marks})", job_ids
        )
        self.conn.commit()
        return cursor.rowcount

    def prune(self, *, days: int = 7) -> int:
        """Reports nobody came back for. A mailbox, not a record."""
        cursor = self.conn.execute(
            "DELETE FROM worker_reports WHERE updated_at < datetime('now', ?)",
            (f"-{int(days)} days",),
        )
        self.conn.commit()
        return cursor.rowcount
