"""Delegated board backed by the same durable Director job lane."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from backend.dashboard import jobs
from backend.dashboard.items import save_draft
from backend.db.connection import get_connection


def draft(action, body):
    if action != "add" or body.id or not body.title.strip() or not body.prompt.strip():
        raise HTTPException(422, "A title and prompt are required")
    if body.run_at or body.interval_s:
        raise HTTPException(422, "Delegated tasks run once when the lane is free")
    return save_draft("agent.delegated", action, body, body.model_dump(mode="json"))


def apply(conn, action, body):
    if action != "add":
        raise HTTPException(404, "Unknown delegated action")
    body = {**body, "run_at": (datetime.now(UTC) + timedelta(seconds=10)).isoformat()}
    jobs.apply(conn, action, body)
    job_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute("INSERT INTO dashboard_delegated(job_id) VALUES(?)", (job_id,))


async def provide():
    return {
        "items": [
            {
                "id": row["id"],
                "title": row["title"],
                "status": row["status"] or "queued",
                "detail": row["error"],
                "run_id": row["run_id"],
                "trace_id": row["trace_id"],
            }
            for row in get_connection().execute(
                "SELECT j.id,j.title,r.id AS run_id,r.status,r.error,r.trace_id "
                "FROM dashboard_delegated d JOIN dashboard_jobs j ON j.id=d.job_id "
                "LEFT JOIN dashboard_job_runs r ON r.id=(SELECT MAX(id) FROM dashboard_job_runs "
                "WHERE job_id=j.id) ORDER BY j.id DESC LIMIT 50"
            )
        ]
    }
