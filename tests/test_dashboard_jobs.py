import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.dashboard import jobs
from backend.dashboard.items import decide
from backend.db.connection import reset_connection
from backend.db.repositories import ConfirmationPreferenceRepository


async def add_job(at, interval=None):
    draft = jobs.draft(
        "add",
        jobs.JobInput(title="Test job", prompt="Read something", run_at=at, interval_s=interval),
    )
    await decide("agent.jobs", draft["draft_id"], True)


async def test_job_drafts_persist_and_reject(db):
    at = datetime.now(UTC) + timedelta(hours=1)
    draft = jobs.draft("add", jobs.JobInput(title="Test", prompt="Read", run_at=at))
    assert db.execute("SELECT count(*) FROM dashboard_jobs").fetchone()[0] == 0
    await decide("agent.jobs", draft["draft_id"], False)
    await add_job(at, 900)
    reset_connection()
    assert len((await jobs.provide())["items"]) == 1
    with pytest.raises(ValueError):
        jobs.JobInput(interval_s=899)
    with pytest.raises(HTTPException):
        jobs.draft("add", jobs.JobInput(title="Test", prompt="Read", run_at=at - timedelta(days=1)))


async def test_scheduler_skips_missed_and_caps_concurrency(db, monkeypatch):
    now = datetime.now(UTC)
    await add_job(now + timedelta(hours=1), 900)
    await add_job(now + timedelta(hours=1))
    factory = AsyncMock()
    scheduler = jobs.Scheduler(factory)
    await scheduler.tick(now + timedelta(hours=2))
    assert [r["status"] for r in db.execute("SELECT * FROM dashboard_job_runs")] == [
        "skipped",
        "skipped",
    ]
    factory.assert_not_called()
    assert (
        db.execute(
            "SELECT count(*) FROM execution_logs WHERE tool_name=?", ("agent.jobs",)
        ).fetchone()[0]
        == 2
    )
    await add_job(now + timedelta(hours=3))
    await add_job(now + timedelta(hours=3))
    hold = asyncio.Event()

    async def execute(*args):
        await hold.wait()

    monkeypatch.setattr(jobs, "execute", execute)
    await scheduler.tick(now + timedelta(hours=3))
    assert (
        db.execute("SELECT count(*) FROM dashboard_job_runs WHERE status='running'").fetchone()[0]
        == 1
    )
    hold.set()
    await scheduler.active
    scheduler.recover()
    assert (
        db.execute("SELECT count(*) FROM dashboard_job_runs WHERE status='running'").fetchone()[0]
        == 0
    )


async def test_scheduled_gate_ignores_standing_write_approval(db, monkeypatch):
    from backend.security.confirmation import ConfirmationService
    from backend.tools.base import RiskLevel, Tool, ToolResult
    from backend.tools.registry import ToolRegistry

    ConfirmationPreferenceRepository().remember("test_write", "allow", "high")
    handler = AsyncMock(return_value=ToolResult.ok("written"))
    tool = Tool(
        name="test_write", description="write", parameters={}, handler=handler, risk=RiskLevel.HIGH
    )
    denied = AsyncMock(return_value=False)
    registry = ToolRegistry(
        confirmation=ConfirmationService(callback=denied, preferences=jobs.NoStandingWrites())
    )
    registry.register(tool)
    from backend.tools.base import ToolContext

    result = await registry.dispatch("test_write", {}, ToolContext())
    assert result.is_error
    denied.assert_awaited_once()
    handler.assert_not_called()
