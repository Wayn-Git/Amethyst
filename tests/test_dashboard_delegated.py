import asyncio
import sys
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from backend.agent.trace import TurnTrace
from backend.dashboard import delegated, jobs
from backend.dashboard.items import decide
from backend.db.connection import reset_connection


async def test_delegated_queue_waits_and_persists(db, monkeypatch):
    draft = delegated.draft("add", jobs.JobInput(title="Fixture task", prompt="Read fixture"))
    assert await delegated.provide() == {"items": []}
    await decide("agent.delegated", draft["draft_id"], True)
    reset_connection()
    items = (await delegated.provide())["items"]
    assert items[0]["status"] == "queued"
    assert (await jobs.provide())["items"] == []
    hold = asyncio.Event()
    scheduler = jobs.Scheduler()
    scheduler.active = asyncio.create_task(hold.wait())
    await scheduler.tick(datetime.now(UTC) + timedelta(hours=2))
    assert (await delegated.provide())["items"][0]["status"] == "queued"
    scheduler.active.cancel()
    await asyncio.gather(scheduler.active, return_exceptions=True)


async def test_delegated_run_approval_and_durable_trace(db, monkeypatch):
    from backend.agent import trace
    from backend.dashboard.router import delegated_trace

    job = {"title": "Fixture task", "prompt": "Read"}
    run = db.execute(
        "INSERT INTO dashboard_job_runs(title,status) VALUES('Fixture','running')"
    ).lastrowid
    db.commit()
    recorded = []

    async def approve(request):
        assert (
            db.execute("SELECT status FROM dashboard_job_runs WHERE id=?", (run,)).fetchone()[0]
            == "needs approval"
        )
        return False

    monkeypatch.setitem(
        sys.modules, "backend.api.main", SimpleNamespace(_await_confirmation=approve)
    )
    monkeypatch.setattr(trace, "get_recent_traces", lambda: recorded)

    async def factory(callback):
        class Director:
            async def run(self, conversation, prompt):
                assert not await callback(SimpleNamespace())
                recorded.append(TurnTrace(conversation_id=conversation, user_message=prompt))
                yield SimpleNamespace(type="done", data={})

        return Director()

    await jobs.execute(run, job, factory)
    row = db.execute("SELECT * FROM dashboard_job_runs WHERE id=?", (run,)).fetchone()
    assert row["status"] == "done"
    assert row["trace_id"] == recorded[0].turn_id
    reset_connection()
    assert delegated_trace(run)["turn_id"] == recorded[0].turn_id
