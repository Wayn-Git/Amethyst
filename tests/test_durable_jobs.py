"""Background work that survives the process running it.

An automation ran for minutes with nobody watching and an Instagram reel
arrived while the machine was asleep, and both were a Python coroutine and
nothing else. A crash took the work with no record that it had started, and the
retry repeated every outward call the first attempt had already made -- a
confirmation DM sent twice, a file written twice, a shell command run again.

A conversation turn is deliberately not one of these. It is interactive, a
person is watching it arrive, and `agent_runs` already records it; the tests for
that are in `test_agent_state.py`.

These hold the line that a job is written down before it starts, that each
outward call happens once however many attempts it takes, that a retry waits
rather than spins, and that work whose repeat could change something waits for a
person instead.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.db.repositories import ConversationRepository, ExecutionLogRepository
from backend.jobs import (
    STATES,
    TERMINAL,
    Handler,
    Job,
    JobRunner,
    JobStore,
    enqueue,
    register,
    replayable_after_crash,
)
from backend.jobs.state import IllegalTransition, backoff_for


@pytest.fixture
def api():
    """The API keeps process-global MCP and confirmation state; restore it."""
    from backend.api import main

    saved_mcp = dict(main._mcp)
    saved_pending = dict(main._pending)
    main._mcp.update({"manager": None, "registry": None, "workspace": None, "errors": {}})
    main._pending.clear()
    yield main
    main._mcp.clear()
    main._mcp.update(saved_mcp)
    main._pending.clear()
    main._pending.update(saved_pending)


def _lane(kind: str, run, **kwargs) -> JobRunner:
    register(Handler(kind=kind, run=run, backoff_base=0.01, **kwargs))
    return JobRunner([kind])


# --- identity ---------------------------------------------------------------


def test_asking_twice_for_the_same_work_gets_the_same_job(db):
    """The button, the scheduler and a reloaded page all arrive here.

    Pressing Run twice, a tick that overlapped a long run, a webhook Meta
    re-delivered: without one key per fact, each of those was a second job doing
    the same work at the same time.

    Mutation check: give `enqueue` a random key, or drop `idx_jobs_key`.
    """
    store = JobStore()
    first = store.enqueue("demo", "demo:7")
    second = store.enqueue("demo", "demo:7")

    assert first.id == second.id
    assert len(store.list(kind="demo")) == 1


def test_a_finished_job_is_not_reopened_by_asking_again(db):
    """Asking about work that is done is a question, not an instruction.

    Re-running it would answer a question nobody asked -- and for an automation
    that sent mail, would send it again.

    Mutation check: have `enqueue` return a fresh job when the existing one is
    terminal.
    """
    store = JobStore()
    job = store.enqueue("demo", "demo:8")
    store.save(job.enter("running"))
    store.complete(job, {"ok": True})

    again = store.enqueue("demo", "demo:8")
    assert again.id == job.id
    assert again.state == "completed"
    assert again.result == {"ok": True}


def test_the_live_job_for_a_thing_is_found_by_its_key_prefix(db):
    """What "reconnect rather than start a second" is made of on the read side.

    Mutation check: have `live_for` ignore the terminal-state filter and it
    returns a finished run as though it were in flight.
    """
    store = JobStore()
    done = store.enqueue("demo", "automation:3:2026-01-01 09:00:00")
    store.save(done.enter("running"))
    store.complete(done)

    assert store.live_for("automation:3:") is None

    live = store.enqueue("demo", "automation:3:2026-01-01 10:00:00")
    assert store.live_for("automation:3:").id == live.id
    assert store.live_for("automation:4:") is None


# --- states and transitions -------------------------------------------------


def test_the_seven_states_are_the_only_ones_a_job_holds(db):
    """A state an interface has to handle but can never see is a promise
    nothing keeps, and one it *can* see but does not expect renders as a raw
    name. The set is closed both ways.

    Mutation check: add a state to `STATES` that nothing writes.
    """
    from pathlib import Path

    written = ""
    for path in ("backend/jobs/store.py", "backend/jobs/state.py", "backend/api/main.py"):
        written += Path(path).read_text()

    assert set(STATES) == {
        "queued", "running", "waiting", "paused", "completed", "failed", "cancelled",
    }
    for state in STATES:
        assert f'"{state}"' in written or f"'{state}'" in written, f"nothing writes {state}"


def test_a_job_cannot_move_where_the_table_does_not_allow(db):
    """The transition table is the whole truth about what a job may do next.

    Mutation check: empty `TRANSITIONS`, or assign `state` without checking.
    """
    job = Job(kind="demo", idempotency_key="k")
    job.enter("running").enter("completed")

    with pytest.raises(IllegalTransition):
        job.enter("running")
    with pytest.raises(IllegalTransition):
        job.enter("nonsense")
    # A *completed* job goes nowhere at all. Work that is done is the answer to
    # "did this happen", and running it again answers a question nobody asked.
    with pytest.raises(IllegalTransition):
        job.enter("queued")
    assert job.state == "completed", "a refused move must not half-apply"

    # The one way out of a terminal state, and it is never automatic: a person
    # asking for another attempt at something that stopped.
    stopped = Job(kind="demo", idempotency_key="k2")
    stopped.enter("running").enter("failed").enter("queued")
    assert stopped.state == "queued"


def test_backoff_is_bounded_and_grows(db):
    """A retry loop with no ceiling is a spin, and one with no growth is a
    hammer. Both were what "it will try again" used to mean.

    Mutation check: drop the `min(...)` against the cap.
    """
    first = backoff_for(1, base=10, cap=100)
    later = backoff_for(4, base=10, cap=100)

    assert 10 <= first < 13, "the first wait is the base, plus jitter"
    assert later > first
    assert backoff_for(99, base=10, cap=100) <= 125, "capped, jitter included"


# --- the step ledger --------------------------------------------------------


async def test_an_outward_call_happens_once_however_many_attempts(db):
    """The requirement, in one test: never duplicate an operation after a retry.

    This is the Instagram confirmation that used to go out twice -- the reply
    was sent before `finish`, so an event reclaimed after a crash in that gap
    sent "Saved: …" for a second time.

    Mutation check: have `JobStore.step` call `run` without consulting the
    ledger.
    """
    sent: list[str] = []

    async def handler(job, store):
        async def send():
            sent.append(job.id)
            return {"sent": True}

        await store.step(job, "reply", send)
        if job.attempts == 1:
            raise RuntimeError("died after sending")
        return {"ok": True}

    lane = _lane("once", handler)
    job = enqueue("once", "once:1")

    await lane.tick()
    assert JobStore().get(job.id).state == "waiting"
    await asyncio.sleep(0.05)
    await lane.tick()

    finished = JobStore().get(job.id)
    assert finished.state == "completed"
    assert len(sent) == 1, f"the reply went out {len(sent)} times"
    assert JobStore().steps(finished) == ["reply"]


async def test_a_step_that_died_mid_flight_runs_again(db):
    """The ledger is written after the call returns, deliberately.

    Writing it first would turn a crash into work that is silently never done,
    and a reply that was never attempted is harder to notice than one sent
    twice. At-least-once for the step in flight, exactly-once for every step
    before it.

    Mutation check: record the step before awaiting `run`.
    """
    attempts: list[int] = []

    async def handler(job, store):
        async def flaky():
            attempts.append(job.attempts)
            if len(attempts) == 1:
                raise RuntimeError("died inside the step")
            return {"done": True}

        return await store.step(job, "work", flaky)

    lane = _lane("midflight", handler)
    job = enqueue("midflight", "midflight:1")

    await lane.tick()
    await asyncio.sleep(0.05)
    await lane.tick()

    assert attempts == [1, 2], "the interrupted step did not run again"
    assert JobStore().get(job.id).state == "completed"


async def test_a_retry_keeps_the_ledger_unless_a_person_clears_it(db):
    """Asking for another attempt must not re-send what already went.

    Only a person can tell a message that should be re-sent from one that must
    not, so only a person clears the ledger.

    Mutation check: make `reset_steps` the default in `JobStore.retry`.
    """
    store = JobStore()
    job = store.enqueue("demo", "demo:retry")
    store.save(job.enter("running"))
    store.record(job, "reply", True)
    store.fail(job, "boom", retry=False)

    store.retry(job)
    assert store.steps(job) == ["reply"], "the retry forgot what had already been sent"

    store.retry(job, reset_steps=True)
    assert store.steps(job) == []


# --- crashes ----------------------------------------------------------------


def test_a_job_whose_process_died_goes_back_on_the_board(db):
    """A lease that lapsed means the lane holding it is gone.

    Left alone the row reads as permanently running, which is what a person was
    looking at.

    Mutation check: have `recover_orphans` return the rows without writing them.
    """
    store = JobStore()
    job = store.begin("demo", "demo:orphan")
    assert job.state == "running"

    recovered = store.recover_orphans()

    assert [j.id for j in recovered] == [job.id]
    assert store.get(job.id).state == "queued"
    assert store.get(job.id).last_error
    # Idempotent: a second boot has nothing left to recover.
    assert store.recover_orphans() == []


def test_a_job_out_of_attempts_is_failed_rather_than_requeued_forever(db):
    """A lane that reclaims the same job every two minutes for ever is a spin
    with a longer period.

    Mutation check: always requeue in `recover_orphans`.
    """
    store = JobStore()
    job = store.enqueue("demo", "demo:spent", max_attempts=1)
    store.save(job.enter("running"))
    job.attempts = 1
    store.save(job)

    store.recover_orphans()
    assert store.get(job.id).state == "failed"


async def test_a_crashed_run_that_changed_something_waits_for_a_person(db):
    """"Never duplicate tool calls after retry unless the operation is
    explicitly safe", against the record the permission gate actually wrote.

    A handler that runs an agent turn cannot promise a replay is a no-op -- the
    model chooses the calls -- so what the dead attempt did is read out of
    `execution_logs`, where the gate recorded the risk it resolved to.

    Mutation check: return True unconditionally from `replayable_after_crash`.
    """
    store = JobStore()
    cid = ConversationRepository().create("fake", "fake-1")
    job = store.begin("risky", "risky:1")
    store.checkpoint(job, conversation_id=cid)
    register(Handler(kind="risky", run=_never_runs, auto_retry_after_crash=False))

    # A read-only attempt may be repeated.
    ExecutionLogRepository().record(
        tool_name="view_file", tool_source="builtin", conversation_id=cid, risk_level="low"
    )
    safe, why = replayable_after_crash(store.get(job.id), store)
    assert safe, why

    # One that wrote may not.
    ExecutionLogRepository().record(
        tool_name="write_file", tool_source="builtin", conversation_id=cid, risk_level="high"
    )
    safe, why = replayable_after_crash(store.get(job.id), store)
    assert not safe
    assert "write_file" in why


async def _never_runs(job, store):
    raise AssertionError("this handler must not be reached")


async def test_the_lane_blocks_a_reclaimed_job_it_must_not_repeat(db):
    """The guard has to fire before the handler, not after it.

    Mutation check: delete the `replayable_after_crash` check in `JobRunner.tick`.
    """
    store = JobStore()
    cid = ConversationRepository().create("fake", "fake-1")
    ExecutionLogRepository().record(
        tool_name="run_shell_command", tool_source="builtin",
        conversation_id=cid, risk_level="high",
    )
    lane = _lane("unsafe", _never_runs, auto_retry_after_crash=False)
    job = store.begin("unsafe", "unsafe:1")
    store.checkpoint(job, conversation_id=cid)
    store.recover_orphans()

    await lane.tick()

    blocked = store.get(job.id)
    assert blocked.state == "waiting"
    assert "run_shell_command" in (blocked.blocked_on or "")
    assert blocked.next_attempt_at is None, "a job waiting on a person has no deadline"


# --- the lane ---------------------------------------------------------------


async def test_a_transient_failure_waits_and_then_runs(db):
    """A failure and a permanent failure are different things, and the
    difference is whether anything tries again.

    Mutation check: have `JobStore.fail` go straight to `failed`.
    """
    tries: list[int] = []

    async def handler(job, store):
        tries.append(job.attempts)
        if len(tries) < 3:
            raise RuntimeError("upstream had a bad minute")
        return {"ok": True}

    lane = _lane("flaky", handler, max_attempts=5)
    job = enqueue("flaky", "flaky:1")

    for _ in range(3):
        await lane.tick()
        await asyncio.sleep(0.05)

    assert tries == [1, 2, 3]
    assert JobStore().get(job.id).state == "completed"


async def test_a_job_that_will_never_work_stops_asking(db):
    """Spending an hour of backoff to re-prove that an automation was deleted
    is not resilience.

    Mutation check: raise a plain `Exception` instead of `Unretryable`.
    """
    from backend.jobs import Unretryable

    async def handler(job, store):
        raise Unretryable("this automation no longer exists")

    lane = _lane("gone", handler, max_attempts=5)
    job = enqueue("gone", "gone:1")

    await lane.tick()

    failed = JobStore().get(job.id)
    assert failed.state == "failed"
    assert failed.attempts == 1, "it tried again anyway"
    assert "no longer exists" in failed.last_error


async def test_a_handler_needing_a_person_waits_without_a_deadline(db):
    """Backing off and being blocked are different. A timer cannot answer a
    question, so nothing promotes a job that is waiting on one.

    Mutation check: raise `RuntimeError` instead of `Blocked`.
    """
    from backend.jobs import Blocked

    async def handler(job, store):
        raise Blocked("needs permission for run_shell_command")

    lane = _lane("asks", handler)
    job = enqueue("asks", "asks:1")

    await lane.tick()
    waiting = JobStore().get(job.id)
    assert waiting.state == "waiting"
    assert waiting.next_attempt_at is None

    JobStore().promote_due()
    assert JobStore().get(job.id).state == "waiting", "a timer answered the question"

    JobStore().resume(waiting)
    assert JobStore().get(job.id).state == "queued"


async def test_nothing_a_handler_raises_stops_the_lane(db):
    """The same rule the agent loop follows: a handler that blows up is a
    failed job with a reason on it, not a lane that stops taking work.

    Mutation check: remove the `except Exception` in `JobRunner._execute`.
    """
    async def explodes(job, store):
        raise ZeroDivisionError("nonsense")

    lane = _lane("boom", explodes, max_attempts=1)
    first = enqueue("boom", "boom:1")
    await lane.tick()

    async def fine(job, store):
        return {"ok": True}

    register(Handler(kind="boom", run=fine, backoff_base=0.01, max_attempts=1))
    second = enqueue("boom", "boom:2")
    await lane.tick()

    assert JobStore().get(first.id).state == "failed"
    assert JobStore().get(second.id).state == "completed"


def test_finished_jobs_are_pruned_and_live_ones_are_not(db):
    """A row per unit of background work grows with reels captured, not with
    anything a person reads.

    Mutation check: drop `state IN (...)` from the subquery in `JobStore.prune`
    -- it is the one that decides which rows are counted as prunable at all.
    """
    store = JobStore()
    for index in range(5):
        job = store.enqueue("demo", f"demo:prune:{index}")
        store.save(job.enter("running"))
        store.complete(job)
    live = store.enqueue("demo", "demo:prune:live")

    store.prune(keep=2)

    remaining = {job.idempotency_key for job in store.list(kind="demo", limit=50)}
    assert live.idempotency_key in remaining
    assert len([k for k in remaining if k != live.idempotency_key]) == 2


# --- the interface ----------------------------------------------------------


def test_the_endpoints_read_and_steer_a_job(db, api):
    """Pause, resume, cancel and retry, and the steps a person needs to see
    before asking for one.

    Mutation check: have `GET /api/jobs/{id}` omit `steps`.
    """
    store = JobStore()
    job = store.enqueue("demo", "demo:api")
    store.save(job.enter("running"))
    store.record(job, "reply", True)
    store.fail(job, "upstream said no", retry=False)

    with TestClient(api.app) as client:
        body = client.get(f"/api/jobs/{job.id}").json()
        assert body["state"] == "failed"
        assert body["steps"] == ["reply"]

        assert client.post(f"/api/jobs/{job.id}/retry").json()["state"] == "queued"
        assert store.steps(job) == ["reply"], "the retry cleared the ledger"

        assert client.post(f"/api/jobs/{job.id}/pause").json()["state"] == "paused"
        assert client.post(f"/api/jobs/{job.id}/cancel").json()["state"] == "cancelled"
        # A refusal, not a fault: a cancelled job cannot be paused.
        assert client.post(f"/api/jobs/{job.id}/pause").status_code == 409
        assert client.post(f"/api/jobs/{job.id}/nonsense").status_code == 400
        assert client.get("/api/jobs/nope").status_code == 404

        listing = client.get("/api/jobs").json()
        assert any(row["id"] == job.id for row in listing["jobs"])
        assert listing["counts"].get("cancelled")


def test_terminal_is_the_set_the_board_treats_as_finished(db):
    """`TERMINAL` decides what `live_for` hides and what `prune` removes. A
    state added to one and not the other leaves a finished job offered as
    though it were in flight.

    Mutation check: remove a state from `TERMINAL`.
    """
    assert TERMINAL == {"completed", "failed", "cancelled"}
    assert TERMINAL < set(STATES)


# --- the two workloads that were actually moved -----------------------------


async def test_pressing_run_twice_runs_an_automation_once(db, api):
    """The endpoint used to await the whole run, and a second press queued a
    second run behind a lock. Now both presses get the job already in flight.

    Mutation check: drop the `live_for` check in `enqueue_run`.
    """
    from backend.automation import AutomationRepository, enqueue_run

    repo = AutomationRepository()
    automation = repo.create(name="tidy", prompt="tidy up", every_minutes=60)

    with TestClient(api.app) as client:
        first = client.post(f"/api/automations/{automation.id}/run").json()
        second = client.post(f"/api/automations/{automation.id}/run").json()

        assert first["id"] == second["id"], "the second press started a second run"
        assert first["state"] in ("queued", "running")
        # And the page reconnects to it on open rather than offering to start one.
        assert client.get(f"/api/automations/{automation.id}/job").json()["id"] == first["id"]

    # The scheduler arriving while that one is live does not add a second either.
    assert enqueue_run(repo.get(automation.id)).id == first["id"]


async def test_a_scheduled_run_is_one_job_per_due_slot(db):
    """A tick that overlapped a long run, or a restart that re-read the same due
    row, used to start the automation again underneath the run already going.

    Mutation check: key `enqueue_run` on the current time rather than the slot.
    """
    from backend.automation import AutomationRepository, enqueue_run

    repo = AutomationRepository()
    automation = repo.create(name="digest", prompt="digest", every_minutes=15)

    first = enqueue_run(automation)
    JobStore().complete(JobStore().save(JobStore().get(first.id).enter("running")))
    # Same slot, because nothing rescheduled it: the same job, already finished.
    assert enqueue_run(repo.get(automation.id)).id == first.id


async def test_an_automation_deleted_mid_flight_fails_without_retrying(db):
    """Three attempts and an hour of backoff to re-prove a row is gone is not
    resilience.

    Mutation check: raise a plain `Exception` in `run_job`.
    """
    from backend.automation import JOB_KIND, run_job
    from backend.jobs import Unretryable

    store = JobStore()
    job = store.begin(JOB_KIND, f"{JOB_KIND}:999:slot", payload={"automation_id": 999})

    with pytest.raises(Unretryable):
        await run_job(job, store, director_for=lambda callback: None)


async def test_a_retried_automation_writes_into_the_transcript_it_started(db):
    """One attempt used to leave a half-finished conversation behind and open
    another, so the runs list -- the thing a person reads to find out what an
    automation did -- showed three entries for one run.

    Mutation check: stop wrapping the conversation in a step.
    """
    from backend.automation import AutomationRepository, run_once

    class Answers:
        def __init__(self, callback=None):
            pass

        async def run(self, conversation_id, prompt):
            from backend.agent.director import Event

            yield Event("done", {"text": "did it"})

    repo = AutomationRepository()
    automation = repo.create(name="note", prompt="note", every_minutes=60)
    store = JobStore()
    job = store.begin("automation", "automation:test:slot")

    first = await run_once(automation, director_for=Answers, repo=repo, job=job, store=store)
    second = await run_once(automation, director_for=Answers, repo=repo, job=job, store=store)

    assert first["conversation_id"] == second["conversation_id"]
    assert len(ConversationRepository().runs_of(str(automation.id))) == 1


async def test_an_ingest_reclaimed_after_a_crash_does_not_reply_twice(db, workspace, monkeypatch):
    """The defect this whole layer exists for.

    `_maybe_reply` ran before `finish`, so an event whose process died in that
    gap was requeued by `reclaim_stale` and the sender got "Saved: …" twice for
    one reel. Worse, the retry took the `already_logged` path and reported
    "already in the library" without ever coming back for the transcript it had
    not finished.

    Mutation check: call `self._maybe_reply(...)` directly instead of through
    `step`, or unwrap the `transcript` step.
    """
    from backend.instagram.service import IngestService
    from backend.instagram.store import InstagramEventStore

    replies: list[str] = []
    transcribed: list[int] = []

    class Client:
        async def send_text(self, sender_id, message):
            replies.append(message)

    class Library:
        class store:
            @staticmethod
            def update(*args, **kwargs):
                return None

        def __init__(self):
            self.captured = 0

        async def capture_media(self, **item):
            # Idempotent by construction, the way the real one is.
            self.captured += 1
            return type(
                "Captured",
                (),
                {
                    "item": {"id": 1, "title": "a reel"},
                    "already_logged": self.captured > 1,
                },
            )()

        async def enrich(self, item_id):
            return None

    class Service(IngestService):
        async def _resolve(self, route, payload):
            return {"item": {"url": "https://example.test/r", "capture_note": ""}}

        async def _add_thumbnail(self, item_id, url):
            return ""

        async def _add_transcript(self, item_id, url):
            transcribed.append(item_id)
            if len(transcribed) == 1:
                raise RuntimeError("ffmpeg died")
            return "transcribed"

    from backend.config import save_instagram

    save_instagram({"enabled": True, "allow_senders": ["s1"], "reply_on_save": True,
                    "enrich": False})

    events = InstagramEventStore()
    # A real row, because `instagram_events.library_item_id` is a foreign key and
    # `finish` writes it.
    events.conn.execute(
        "INSERT INTO library_items (id, kind, title, consumed_on)"
        " VALUES (1, 'video', 'a reel', '2026-01-01')"
    )
    events.conn.execute(
        "INSERT INTO instagram_events (delivery_key, route, sender_id, payload)"
        " VALUES ('dm:1', 'dm_reel', 's1', '{}')"
    )
    events.conn.commit()

    jobs_store = JobStore()
    service = Service(library=Library(), client=Client(), store=events)

    key = "instagram_ingest:dm:1"

    async def attempt():
        event = events.claim_next()
        return await service.process(
            event, job=jobs_store.begin("instagram_ingest", key), jobs=jobs_store
        )

    # Crash one: inside the transcript, which is where minutes of work live.
    with pytest.raises(RuntimeError):
        await attempt()
    events.requeue(1)

    # Crash two: after the reply has gone out, before the event is finished.
    # This is the exact gap that sent "Saved: …" twice -- the reply was the last
    # thing before `finish`, and nothing recorded that it had happened.
    finished = events.finish

    def explode_once(*args, **kwargs):
        events.finish = finished
        raise RuntimeError("died between the reply and the row")

    events.finish = explode_once
    with pytest.raises(RuntimeError):
        await attempt()
    assert replies == ["Saved: a reel"], "the reply had not gone out yet"
    events.requeue(1)

    # The attempt that gets through.
    await attempt()

    assert replies == ["Saved: a reel"], f"the sender was told {len(replies)} times"
    assert transcribed == [1, 1], "the interrupted transcript never ran again"
    assert events.get(1)["status"] == "done"


async def test_the_boot_sweep_holds_back_a_job_it_must_not_repeat(db, api):
    """Found by running it, not by reading it.

    The sweep put an orphaned job back on the board and then tried to hold it
    there -- and `queued -> waiting` was not a move the table allowed, so the
    whole recovery pass raised on the first such job and settled none of them.
    The guarantee survived only because the lane's own guard caught it a tick
    later; the sweep, which is the mechanism meant to catch it first, did
    nothing at all.

    Mutation check: remove `waiting` from the `queued` row of `TRANSITIONS`, or
    put the per-job `try` back around the loop instead of inside it.
    """
    store = JobStore()
    cid = ConversationRepository().create("fake", "fake-1")
    ExecutionLogRepository().record(
        tool_name="run_shell_command", tool_source="builtin",
        conversation_id=cid, risk_level="high",
    )
    register(Handler(kind="swept", run=_never_runs, auto_retry_after_crash=False))
    job = store.begin("swept", "swept:1")
    store.checkpoint(job, conversation_id=cid)
    # A second orphan behind it, to prove one awkward job does not eat the rest.
    other = store.begin("swept", "swept:2")

    with TestClient(api.app):
        pass

    held = store.get(job.id)
    assert held.state == "waiting"
    assert "run_shell_command" in (held.blocked_on or "")
    assert held.next_attempt_at is None
    assert store.get(other.id).state == "queued", "the second orphan was never recovered"
