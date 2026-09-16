"""Durable dashboard jobs. One Director turn at a time; never replay missed work."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from pydantic import Field, field_validator

from backend.dashboard.items import save_draft
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection, transaction
from backend.db.repositories import ConversationRepository, ExecutionLogRepository
from backend.security.confirmation import ConfirmationService

log = logging.getLogger(__name__)
MIN_INTERVAL = 900


class JobInput(StrictModel):
    id: int | None = None
    title: str = Field(default="", max_length=500)
    prompt: str = Field(default="", max_length=10000)
    run_at: datetime | None = None
    interval_s: int | None = Field(default=None, ge=MIN_INTERVAL, le=2592000)

    @field_validator("run_at")
    @classmethod
    def aware(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Run time requires a timezone")
        return value.astimezone(UTC) if value else None


def draft(action, body):
    if action not in ("add", "delete"):
        raise HTTPException(404, "Unknown job action")
    payload = body.model_dump(mode="json")
    if action == "add":
        if body.id or not body.title.strip() or not body.prompt.strip() or not body.run_at:
            raise HTTPException(422, "Title, prompt and run time are required")
        if body.run_at <= datetime.now(UTC):
            raise HTTPException(422, "Run time must be in the future")
    else:
        row = (
            get_connection()
            .execute("SELECT * FROM dashboard_jobs WHERE id=?", (body.id,))
            .fetchone()
        )
        if row is None:
            raise HTTPException(404, "Job not found")
        payload["expected"] = dict(row)
    return save_draft("agent.jobs", action, body, payload)


def apply(conn, action, body):
    if action == "add":
        parsed = JobInput.model_validate(body)
        if parsed.run_at <= datetime.now(UTC):
            raise HTTPException(409, "Run time has passed; review a new draft")
        if conn.execute("SELECT count(*) FROM dashboard_jobs").fetchone()[0] >= 50:
            raise HTTPException(409, "At most 50 jobs")
        conn.execute(
            "INSERT INTO dashboard_jobs(title,prompt,next_run,interval_s) VALUES(?,?,?,?)",
            (parsed.title, parsed.prompt, parsed.run_at.isoformat(), parsed.interval_s),
        )
    elif action == "delete":
        current = conn.execute("SELECT * FROM dashboard_jobs WHERE id=?", (body["id"],)).fetchone()
        if current is None or dict(current) != body["expected"]:
            raise HTTPException(409, "Job changed; review a new draft")
        conn.execute("DELETE FROM dashboard_jobs WHERE id=?", (body["id"],))
    else:
        raise HTTPException(404, "Unknown job action")
    conn.execute("DELETE FROM widget_cache WHERE widget_id='agent.jobs'")


async def provide():
    conn = get_connection()
    return {
        "items": [
            {
                "id": row["id"],
                "title": row["title"],
                "detail": f"{row['next_run'] or 'Finished'} · {row['interval_s'] or 'Once'}",
            }
            for row in conn.execute("SELECT * FROM dashboard_jobs ORDER BY id DESC")
        ],
        "runs": [
            dict(row)
            for row in conn.execute(
                "SELECT id,job_id,status,error,trace_id,conversation_id "
                "FROM dashboard_job_runs ORDER BY id DESC LIMIT 50"
            )
        ],
    }


class NoStandingWrites:
    """A prior chat preference cannot approve a scheduled write."""

    def get(self, key):
        from backend.db.repositories import ConfirmationPreferenceRepository

        value = ConfirmationPreferenceRepository().get(key)
        return value if value == "deny" else None


async def director_for(callback):
    from backend.api.main import _unattended_director

    director = await _unattended_director(callback)
    director.registry = director.registry.with_confirmation(
        ConfirmationService(callback=callback, preferences=NoStandingWrites())
    )
    return director


async def execute(run_id, job, factory=director_for):
    from backend.agent.trace import get_recent_traces
    from backend.api.main import _await_confirmation

    conversation = ConversationRepository().create("auto", "auto", job["title"])
    with transaction() as conn:
        conn.execute(
            "UPDATE dashboard_job_runs SET conversation_id=? WHERE id=?", (conversation, run_id)
        )

    async def approve(request):
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_job_runs SET status='needs approval' WHERE id=?", (run_id,)
            )
        try:
            return await _await_confirmation(request)
        finally:
            with transaction() as conn:
                conn.execute("UPDATE dashboard_job_runs SET status='running' WHERE id=?", (run_id,))

    status, error = "done", None
    try:
        director = await factory(approve)
        async with asyncio.timeout(180):
            async for event in director.run(conversation, job["prompt"]):
                if event.type in ("error", "guard"):
                    status, error = "failed", str(event.data)[:1000]
    except asyncio.CancelledError:
        status, error = "failed", "Interrupted; not replayed"
        raise
    except Exception as exc:
        status, error = "failed", str(exc)[:1000]
    finally:
        traces = [t for t in get_recent_traces() if t.conversation_id == conversation]
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_job_runs SET status=?,error=?,trace_id=? WHERE id=?",
                (status, error, traces[-1].turn_id if traces else None, run_id),
            )
            conn.execute(
                "DELETE FROM widget_cache WHERE widget_id IN ('agent.jobs','agent.delegated')"
            )
        log.info("widget=agent.jobs run=%s result=%s", run_id, status)


class Scheduler:
    def __init__(self, factory=director_for):
        self.factory = factory
        self.active = None

    def recover(self):
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_job_runs SET status='failed',error='Interrupted; not replayed' "
                "WHERE status IN ('running','needs approval')"
            )

    async def tick(self, now=None):
        now = now or datetime.now(UTC)
        due = (
            get_connection()
            .execute(
                "SELECT * FROM dashboard_jobs WHERE next_run IS NOT NULL "
                "AND next_run<=? ORDER BY next_run",
                (now.isoformat(),),
            )
            .fetchall()
        )
        for raw in due:
            job = dict(raw)
            missed = now - datetime.fromisoformat(job["next_run"]) > timedelta(seconds=60)
            busy = self.active is not None and not self.active.done()
            status = "skipped" if missed or busy else "running"
            with transaction() as conn:
                claimed = conn.execute(
                    "UPDATE dashboard_jobs SET next_run=? WHERE id=? AND next_run=?",
                    (
                        (now + timedelta(seconds=job["interval_s"])).isoformat()
                        if job["interval_s"]
                        else None,
                        job["id"],
                        job["next_run"],
                    ),
                )
                if not claimed.rowcount:
                    continue
                run_id = conn.execute(
                    "INSERT INTO dashboard_job_runs(job_id,title,status,error) VALUES(?,?,?,?)",
                    (
                        job["id"],
                        job["title"],
                        status,
                        "Missed run" if missed else "Concurrency cap" if busy else None,
                    ),
                ).lastrowid
            if status == "skipped":
                ExecutionLogRepository().record(
                    tool_name="agent.jobs",
                    tool_source="director",
                    result_summary=f"{run_id}: skipped",
                )
            else:
                self.active = asyncio.create_task(execute(run_id, job, self.factory))

    async def run(self):
        self.recover()
        try:
            while True:
                try:
                    await self.tick()
                except Exception:
                    log.exception("widget=agent.jobs scheduler failed")
                await asyncio.sleep(10)
        finally:
            if self.active and not self.active.done():
                self.active.cancel()
                await asyncio.gather(self.active, return_exceptions=True)
