"""Work that runs somewhere other than this turn.

Three things are new here and each has a way of going quietly wrong:

**A router that picks the wrong machine.** Routing is deterministic and takes no
network, so it is asserted directly rather than observed -- including the case
that matters most, which is an account nobody has configured. A lane that is not
set up must be routed *around*, not into: the failure it otherwise produces is a
briefing that stops arriving and says nothing about why.

**A fan-out that is secretly sequential.** The batch exists to stop a model
waiting through four lookups in a row. A test that only asserts the results are
right would pass just as happily on an implementation that ran them one after
another, so the parallel test asserts on overlap in time.

**Money and credentials leaving quietly.** A worker has nobody watching it, which
is exactly why "it used a paid provider" and "the payload had a token in it" are
tested rather than trusted. So is the thing the URL pipeline exists for: a
hundred pages must not become a hundred model calls.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from backend.jobs import JobStore
from backend.workers import batch as worker_batch
from backend.workers import collectors
from backend.workers.accounts import (
    AUTOMATION,
    SUBAGENT,
    WorkerAccount,
    WorkerSettings,
    load_workers,
    save_workers,
    token_ref,
)
from backend.workers.reports import WorkerReportStore
from backend.workers.router import (
    CLOUDFLARE,
    LOCAL,
    ExecutionRequest,
    choose,
)


@pytest.fixture(autouse=True)
def _quick(monkeypatch):
    """The heartbeat and the mailbox poll, at test speed.

    Both are tuned for a laptop that will be doing this for minutes; leaving
    them alone would make every batch test wait whole seconds to observe
    something that has already happened.
    """
    monkeypatch.setattr(worker_batch, "HEARTBEAT_SECONDS", 0.02)
    monkeypatch.setattr(worker_batch, "POLL_SECONDS", 0.02)


@pytest.fixture
def registry():
    """Collectors registered by a test, removed again afterwards."""
    saved = dict(collectors._COLLECTORS)
    yield collectors
    collectors._COLLECTORS.clear()
    collectors._COLLECTORS.update(saved)


def fake(name: str, run, **kwargs) -> None:
    collectors.register(collectors.Collector(name=name, run=run, **kwargs))


def configured(**overrides) -> WorkerSettings:
    """Both accounts set up, without touching the keychain or a config file."""
    accounts = {
        name: WorkerAccount(
            name=name,
            owner="someone",
            repo=f"amethyst-{name}",
            workflow=f"{name}.yml",
            source_repo="someone/amethyst",
        )
        for name in (AUTOMATION, SUBAGENT)
    }
    settings = WorkerSettings(
        accounts=accounts, relay_url="https://relay.example", **overrides
    )
    # `configured` asks the keychain; these accounts exist only in this object.
    for account in accounts.values():
        object.__setattr__(account, "_configured", True)
    return settings


@pytest.fixture
def lanes(monkeypatch):
    """Both GitHub accounts reachable, so routing can actually choose them."""
    from backend.workers import accounts as accounts_module

    monkeypatch.setattr(
        accounts_module.WorkerAccount, "configured", property(lambda self: bool(self.slug))
    )
    return configured()


def spec(nodes, **kwargs) -> worker_batch.BatchSpec:
    return worker_batch.BatchSpec.from_payload({"nodes": nodes, **kwargs})


async def run_batch(nodes, *, batch_id="b1", store=None, **kwargs):
    store = store or JobStore()
    job = worker_batch.enqueue(spec(nodes, **kwargs), batch_id=batch_id, store=store)
    result = await worker_batch.run(job, store)
    return job, result


def statuses(result) -> dict[str, str]:
    return {node["id"]: node["status"] for node in result["nodes"]}


# ------------------------------------------------------------------- routing


def test_a_scheduled_automation_goes_to_the_automation_account(db, lanes):
    decision = choose(ExecutionRequest(scheduled=True, interactive=False), settings=lanes)
    assert decision.lane == AUTOMATION
    assert "scheduled" in decision.reason


def test_a_parallel_batch_goes_to_the_subagent_account(db, lanes):
    decision = choose(ExecutionRequest(fanout=6, interactive=False), settings=lanes)
    assert decision.lane == SUBAGENT


def test_one_interactive_task_stays_on_this_machine(db, lanes):
    """The round trip to a runner costs more than the work, and someone is waiting."""
    assert choose(ExecutionRequest(interactive=True), settings=lanes).lane == LOCAL


def test_durable_offline_work_goes_to_the_relay(db, lanes):
    decision = choose(
        ExecutionRequest(task="url_ingest", interactive=False, offline_ok=True), settings=lanes
    )
    assert decision.lane == CLOUDFLARE


def test_the_relay_is_not_offered_work_it_cannot_run(db, lanes):
    """It runs three registered job kinds; `gmail` is not one of them."""
    decision = choose(
        ExecutionRequest(task="gmail", interactive=False, offline_ok=True), settings=lanes
    )
    assert decision.lane != CLOUDFLARE
    assert "does not run" in decision.rejected[CLOUDFLARE]


def test_work_needing_this_machines_data_never_leaves_it(db, lanes):
    """A GitHub runner cannot reach the keychain, and shipping it there is not the fix."""
    decision = choose(
        ExecutionRequest(scheduled=True, needs_local_data=True, fanout=9), settings=lanes
    )
    assert decision.lane == LOCAL
    assert "this machine's data" in decision.reason


def test_an_unconfigured_account_is_routed_around_rather_than_into(db):
    """The failure this prevents is a briefing that stops arriving and says nothing."""
    empty = WorkerSettings(accounts={}, relay_url="")
    decision = choose(ExecutionRequest(scheduled=True, interactive=False), settings=empty)
    assert decision.lane == LOCAL
    assert "no repository" in decision.rejected[AUTOMATION]


def test_a_named_lane_still_falls_back_when_it_is_not_configured(db):
    decision = choose(
        ExecutionRequest(prefer=SUBAGENT, fanout=4), settings=WorkerSettings(accounts={})
    )
    assert decision.lane == LOCAL


def test_a_decision_says_what_it_wanted_and_what_stopped_it(db):
    decision = choose(
        ExecutionRequest(scheduled=True, interactive=False), settings=WorkerSettings(accounts={})
    )
    explained = decision.explain()
    assert "local" in explained and "passed over" in explained


def test_the_two_accounts_never_share_a_credential(db):
    assert token_ref(AUTOMATION) != token_ref(SUBAGENT)
    assert "automation" in token_ref(AUTOMATION)
    assert "subagent" in token_ref(SUBAGENT)
    with pytest.raises(ValueError):
        token_ref("../../etc/passwd")


def test_a_worker_token_is_refused_in_the_config_file(db):
    """It would be written to disk in plain text. Refused, with where it goes."""
    with pytest.raises(ValueError, match="amethyst secrets set"):
        save_workers({"subagent": {"repo": "a/b", "token": "ghp_realtokenhere"}})
    save_workers({"subagent": {"repo": "a/b", "workflow": "s.yml"}})
    assert load_workers().account(SUBAGENT).slug == "a/b"


# ---------------------------------------------------------------- the graph


async def test_independent_tasks_run_at_the_same_time(db, registry):
    """The whole point of the batch. Asserted on overlap, not on results.

    A sequential implementation returns exactly the same three results, so
    anything weaker than this passes on the bug it exists to catch.
    """
    running = 0
    peak = 0

    async def slow(params):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.05)
        running -= 1
        return {"who": params.get("who")}

    fake("slow", slow)
    started = time.monotonic()
    _, result = await run_batch(
        [{"id": f"n{i}", "task": "slow", "params": {"who": i}} for i in range(4)]
    )
    elapsed = time.monotonic() - started

    assert peak == 4, "the nodes took turns"
    assert elapsed < 0.15, "four 50ms tasks took longer than two of them"
    assert set(statuses(result).values()) == {"ok"}


async def test_a_dependent_task_waits_and_receives_what_it_waited_for(db, registry):
    order: list[str] = []

    async def first(_params):
        order.append("first")
        await asyncio.sleep(0.02)
        return {"token": "abc"}

    async def second(params):
        order.append("second")
        return {"saw": params["depends"]["a"]["token"]}

    fake("first", first)
    fake("second", second)
    _, result = await run_batch(
        [
            {"id": "a", "task": "first"},
            {"id": "b", "task": "second", "depends_on": ["a"]},
        ]
    )
    assert order == ["first", "second"]
    node = {n["id"]: n for n in result["nodes"]}["b"]
    assert node["result"]["saw"] == "abc"


async def test_a_task_whose_dependency_failed_is_skipped_rather_than_run(db, registry):
    """"Its input never arrived" is a different fact from "it was tried and broke"."""

    async def boom(_params):
        raise RuntimeError("nope")

    async def never(_params):  # pragma: no cover - the assertion is that this is not called
        raise AssertionError("ran without its input")

    fake("boom", boom)
    fake("never", never)
    _, result = await run_batch(
        [
            {"id": "a", "task": "boom", "max_attempts": 1},
            {"id": "b", "task": "never", "depends_on": ["a"]},
        ]
    )
    assert statuses(result) == {"a": "failed", "b": "skipped"}
    assert "depends on a" in {n["id"]: n for n in result["nodes"]}["b"]["error"]


def test_a_circle_of_dependencies_is_refused_before_anything_runs(db, registry):
    fake("noop", lambda _p: asyncio.sleep(0))
    with pytest.raises(worker_batch.BadBatch, match="circle"):
        spec(
            [
                {"id": "a", "task": "noop", "depends_on": ["b"]},
                {"id": "b", "task": "noop", "depends_on": ["a"]},
            ]
        )


def test_a_batch_is_refused_when_it_names_something_nothing_can_run(db):
    with pytest.raises(worker_batch.BadBatch, match="not a collector"):
        spec([{"id": "a", "task": "telepathy"}])


def test_two_nodes_may_not_share_a_name(db, registry):
    fake("noop", lambda _p: asyncio.sleep(0))
    with pytest.raises(worker_batch.BadBatch, match="both called"):
        spec([{"id": "a", "task": "noop"}, {"id": "a", "task": "noop"}])


# ------------------------------------------------- failures, retries, idempotency


async def test_one_failing_task_does_not_fail_the_others(db, registry):
    """Nineteen useful answers and one explanation beats a failed batch."""

    async def ok(_params):
        return {"fine": True}

    async def boom(_params):
        raise RuntimeError("the host is down")

    fake("ok", ok)
    fake("boom", boom)
    _, result = await run_batch(
        [
            {"id": "a", "task": "ok"},
            {"id": "b", "task": "boom", "max_attempts": 1},
            {"id": "c", "task": "ok"},
        ]
    )
    assert statuses(result) == {"a": "ok", "b": "failed", "c": "ok"}
    assert "the host is down" in {n["id"]: n for n in result["nodes"]}["b"]["error"]


async def test_a_node_is_tried_again_and_its_attempts_are_recorded(db, registry):
    calls = {"n": 0}

    async def flaky(_params):
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("transient")
        return {"ok": True}

    fake("flaky", flaky)
    _, result = await run_batch([{"id": "a", "task": "flaky", "max_attempts": 3}])
    assert statuses(result) == {"a": "ok"}
    assert calls["n"] == 2
    assert result["nodes"][0]["provenance"]["attempts"] == 2


async def test_a_missing_credential_is_not_retried(db, registry):
    """Another attempt runs into the same missing credential."""
    calls = {"n": 0}

    async def unconfigured(_params):
        calls["n"] += 1
        raise collectors.NotConfigured("LinkedIn has no client")

    fake("linkedin_test", unconfigured)
    _, result = await run_batch([{"id": "a", "task": "linkedin_test", "max_attempts": 4}])
    assert statuses(result) == {"a": "failed"}
    assert calls["n"] == 1


async def test_a_batch_resumed_after_a_crash_does_not_re_run_what_finished(db, registry):
    """The step ledger, doing for nodes what it does for any other handler."""
    calls: list[str] = []

    async def once(params):
        calls.append(params["who"])
        return {"who": params["who"]}

    fake("once", once)
    store = JobStore()
    nodes = [
        {"id": "a", "task": "once", "params": {"who": "a"}},
        {"id": "b", "task": "once", "params": {"who": "b"}},
    ]
    job, first = await run_batch(nodes, store=store)
    assert calls == ["a", "b"] or calls == ["b", "a"]

    # The same job run again -- which is what a reclaimed lease does.
    again = await worker_batch.run(job, store)
    assert sorted(calls) == ["a", "b"], "a settled node ran a second time"
    assert statuses(again) == statuses(first)


def test_asking_for_the_same_batch_twice_creates_one_batch(db, registry):
    fake("noop", lambda _p: asyncio.sleep(0))
    store = JobStore()
    one = worker_batch.enqueue(spec([{"id": "a", "task": "noop"}]), batch_id="same", store=store)
    two = worker_batch.enqueue(spec([{"id": "a", "task": "noop"}]), batch_id="same", store=store)
    assert one.id == two.id


# ------------------------------------------------ progress, cancellation, timeouts


async def test_progress_is_written_as_the_batch_goes(db, registry):
    """So a person watching sees more than "waiting"."""
    seen: list[dict] = []

    async def slow(_params):
        await asyncio.sleep(0.05)
        return {}

    fake("slow", slow)
    store = JobStore()
    job = worker_batch.enqueue(
        spec([{"id": f"n{i}", "task": "slow"} for i in range(2)]), batch_id="p", store=store
    )

    async def watch():
        for _ in range(40):
            await asyncio.sleep(0.01)
            current = store.get(job.id)
            if current and current.checkpoint.get("progress"):
                seen.append(current.checkpoint["progress"])

    await asyncio.gather(worker_batch.run(job, store), watch())
    assert seen, "nothing wrote progress"
    assert seen[-1]["total"] == 2


async def test_cancelling_a_batch_stops_it_and_the_cancel_survives(db, registry):
    """The bug this holds: a handler finishing wrote `completed` over the cancel.

    `JobStore.complete` acts on the handler's in-memory copy, so a person
    pressing Cancel on a four-minute batch moved the row and nothing else --
    and the copy then overwrote it. `JobStore.settled` reads the row.
    """
    started = asyncio.Event()

    async def forever(_params):
        started.set()
        await asyncio.sleep(30)
        return {}  # pragma: no cover

    fake("forever", forever)
    store = JobStore()
    job = worker_batch.enqueue(spec([{"id": "a", "task": "forever"}]), batch_id="c", store=store)
    claimed = store.claim([worker_batch.KIND])
    assert claimed is not None

    async def cancel_soon():
        await started.wait()
        await asyncio.sleep(0.05)
        store.cancel(store.get(job.id))

    result, _ = await asyncio.wait_for(
        asyncio.gather(worker_batch.run(claimed, store), cancel_soon()), timeout=5
    )
    assert result["cancelled"] is True
    assert statuses(result) == {"a": "cancelled"}

    # The handler finished; completing it must not undo the cancel.
    store.complete(claimed, result)
    assert store.get(job.id).state == "cancelled"


async def test_a_batch_that_runs_out_of_time_returns_what_it_has(db, registry):
    async def quick(_params):
        return {"ok": True}

    async def slow(_params):
        await asyncio.sleep(30)
        return {}  # pragma: no cover

    fake("quick", quick)
    fake("slow", slow)
    _, result = await run_batch(
        [{"id": "a", "task": "quick"}, {"id": "b", "task": "slow"}], timeout_seconds=1
    )
    assert result["timed_out"] is True
    assert statuses(result)["a"] == "ok"
    assert statuses(result)["b"] in ("timeout", "cancelled")


async def test_a_node_that_overruns_its_own_timeout_is_marked_and_the_rest_go_on(db, registry):
    async def slow(_params):
        await asyncio.sleep(10)
        return {}  # pragma: no cover

    async def quick(_params):
        return {"ok": True}

    fake("slow", slow)
    fake("quick", quick)
    _, result = await run_batch(
        [
            {"id": "a", "task": "slow", "timeout_seconds": 1, "max_attempts": 1},
            {"id": "b", "task": "quick"},
        ]
    )
    assert statuses(result) == {"a": "timeout", "b": "ok"}


async def test_every_result_says_where_it_came_from(db, registry):
    fake("ok", lambda _p: asyncio.sleep(0, result={"v": 1}))
    _, result = await run_batch([{"id": "a", "task": "ok"}])
    provenance = result["nodes"][0]["provenance"]
    assert provenance["lane"] == LOCAL
    assert provenance["attempts"] == 1
    assert provenance["at"]


# --------------------------------------------------- dispatch and the mailbox


async def test_a_remote_node_dispatches_once_and_waits_for_its_report(db, registry, lanes,
                                                                      monkeypatch):
    from backend.workers import github

    sent: list[dict] = []

    async def dispatch(account, *, job_id, task, params, settings=None):
        sent.append({"account": account, "job_id": job_id, "task": task})
        return {"lane": account, "job_id": job_id}

    monkeypatch.setattr(github, "dispatch", dispatch)
    monkeypatch.setattr("backend.workers.router.load_workers", lambda: lanes)
    fake("remote_thing", lambda _p: asyncio.sleep(0), local_only=False)

    store = JobStore()
    reports = WorkerReportStore(store.conn)
    job = worker_batch.enqueue(
        spec(
            [{"id": "a", "task": "remote_thing", "lane": SUBAGENT}],
            timeout_seconds=10,
        ),
        batch_id="r",
        store=store,
    )

    async def answer():
        # What the relay hands over on the next /sync.
        for _ in range(200):
            await asyncio.sleep(0.01)
            if sent:
                reports.apply(
                    {
                        "job_id": sent[0]["job_id"],
                        "state": "completed",
                        "result": {"found": 3},
                        "lane": SUBAGENT,
                    }
                )
                return

    result, _ = await asyncio.wait_for(
        asyncio.gather(worker_batch.run(job, store), answer()), timeout=10
    )
    assert len(sent) == 1, "dispatched more than once"
    assert sent[0]["account"] == SUBAGENT
    assert statuses(result) == {"a": "ok"}
    assert result["nodes"][0]["result"] == {"found": 3}
    assert result["nodes"][0]["provenance"]["lane"] == SUBAGENT


async def test_a_replayed_batch_reattaches_rather_than_dispatching_twice(db, registry, lanes,
                                                                        monkeypatch):
    """`workflow_dispatch` has no idempotency key; the step ledger is the only one."""
    from backend.workers import github

    sent: list[str] = []

    async def dispatch(account, *, job_id, task, params, settings=None):
        sent.append(job_id)
        return {"lane": account, "job_id": job_id}

    monkeypatch.setattr(github, "dispatch", dispatch)
    monkeypatch.setattr("backend.workers.router.load_workers", lambda: lanes)
    fake("remote_thing", lambda _p: asyncio.sleep(0))

    store = JobStore()
    job = worker_batch.enqueue(
        spec([{"id": "a", "task": "remote_thing", "lane": SUBAGENT}], timeout_seconds=1),
        batch_id="rr",
        store=store,
    )
    await worker_batch.run(job, store)  # times out; nothing reported
    first = list(sent)
    assert len(first) == 1

    store.conn.execute("DELETE FROM job_steps WHERE step_key LIKE 'node:%'")
    store.conn.commit()
    await worker_batch.run(job, store)
    assert sent == first, "the same node was dispatched to GitHub twice"


async def test_a_worker_that_failed_says_so_rather_than_hanging(db, registry, lanes, monkeypatch):
    from backend.workers import github

    ids: list[str] = []

    async def dispatch(account, *, job_id, task, params, settings=None):
        ids.append(job_id)
        return {"lane": account}

    monkeypatch.setattr(github, "dispatch", dispatch)
    monkeypatch.setattr("backend.workers.router.load_workers", lambda: lanes)
    fake("remote_thing", lambda _p: asyncio.sleep(0))

    store = JobStore()
    reports = WorkerReportStore(store.conn)
    job = worker_batch.enqueue(
        spec(
            [{"id": "a", "task": "remote_thing", "lane": SUBAGENT, "max_attempts": 1}],
            timeout_seconds=10,
        ),
        batch_id="f",
        store=store,
    )

    async def answer():
        for _ in range(200):
            await asyncio.sleep(0.01)
            if ids:
                reports.apply(
                    {"job_id": ids[0], "state": "failed", "error": "the runner ran out of disk"}
                )
                return

    result, _ = await asyncio.wait_for(
        asyncio.gather(worker_batch.run(job, store), answer()), timeout=10
    )
    assert statuses(result) == {"a": "failed"}
    assert "out of disk" in result["nodes"][0]["error"]


def test_a_result_that_arrived_late_never_undoes_one_that_arrived(db):
    """Progress and the final answer race each other over the open internet."""
    store = WorkerReportStore()
    store.apply({"job_id": "j1", "state": "completed", "result": {"n": 1}})
    store.apply({"job_id": "j1", "state": "running", "progress": {"done": 0}})
    held = store.get("j1")
    assert held.state == "completed" and held.result == {"n": 1}


def test_a_report_that_is_not_one_is_dropped_at_the_boundary(db):
    """It came through a Worker this machine does not trust. Checked before a row exists."""
    store = WorkerReportStore()
    assert store.apply({"job_id": "x", "state": "taking-over-your-laptop"}) is None
    assert store.apply({"state": "completed"}) is None
    assert store.apply("completed") is None
    assert store.apply({"job_id": "y" * 500, "state": "completed"}) is None
    assert store.get("x") is None


def test_an_oversized_result_is_replaced_rather_than_truncated(db):
    """Half a JSON document is not a document."""
    store = WorkerReportStore()
    store.apply({"job_id": "big", "state": "completed", "result": {"blob": "x" * 400_000}})
    assert store.get("big").result["truncated"] is True


async def test_the_poller_writes_reports_down_and_acknowledges_them_late(db, monkeypatch):
    """The round trip's last leg: what /sync handed over becomes a local row."""
    from backend.instagram.relay import RelayPoller

    poller = RelayPoller()
    taken = poller._collect_workers(
        {
            "workers": [
                {"job_id": "w1", "state": "completed", "result": {"ok": 1}},
                {"job_id": "w2", "state": "running", "progress": {"done": 1}},
                {"job_id": "w3", "state": "not-a-state"},
            ]
        }
    )
    assert taken == 2
    assert WorkerReportStore().get("w1").result == {"ok": 1}
    # `w2` is still running: acknowledging it would mark it synced at the relay
    # while the result is still to come. `w3` is garbage and must not block it.
    assert sorted(poller._pending_worker_ack) == ["w1", "w3"]


# ------------------------------------------------------------------ security


def test_a_dispatch_carrying_a_credential_is_refused(db):
    """Workflow inputs are visible in the run's log and to anyone with read access."""
    from backend.workers.github import DispatchRefused, inputs_for

    account = WorkerAccount(name=SUBAGENT, owner="a", repo="b", workflow="s.yml",
                            source_repo="a/amethyst")
    with pytest.raises(DispatchRefused, match="credential"):
        inputs_for(
            job_id="j", task="urls", account=account, relay_url="https://r",
            params={"api_key": "sk-abcdefghijklmnopqrstuvwx"},
        )
    with pytest.raises(DispatchRefused, match="credential"):
        inputs_for(
            job_id="j", task="urls", account=account, relay_url="https://r",
            params={"note": "use ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
        )


def test_a_dispatch_that_would_send_too_much_is_refused(db):
    """Minimising what reaches somebody else's log, not a protocol limit."""
    from backend.workers.github import DispatchRefused, inputs_for

    account = WorkerAccount(name=SUBAGENT, owner="a", repo="b", workflow="s.yml",
                            source_repo="a/amethyst")
    with pytest.raises(DispatchRefused, match="Send references"):
        inputs_for(
            job_id="j", task="urls", account=account, relay_url="https://r",
            params={"urls": ["https://example.com/" + "p" * 100] * 400},
        )


def test_an_ordinary_payload_carries_only_what_the_runner_needs(db):
    from backend.workers.github import inputs_for

    account = WorkerAccount(name=SUBAGENT, owner="a", repo="b", workflow="s.yml",
                            source_repo="a/amethyst", source_ref="v1")
    sent = inputs_for(
        job_id="j1", task="urls", account=account, relay_url="https://r",
        params={"urls": ["https://example.com"]},
    )
    assert set(sent) == {"job_id", "task", "params", "relay_url", "source_repo", "source_ref"}
    assert "token" not in " ".join(sent.values()).lower()


async def test_dispatch_refuses_before_reaching_github_when_nothing_is_set_up(db):
    from backend.workers.github import DispatchRefused, dispatch

    with pytest.raises(DispatchRefused, match="no repository"):
        await dispatch(SUBAGENT, job_id="j", task="urls", settings=WorkerSettings(accounts={}))


def test_the_collectors_that_touch_private_data_are_marked_local_only(db):
    """A GitHub runner has no route to these, and giving it one is not the fix."""
    for name in ("gmail", "briefing", "todo"):
        assert collectors.get(name).local_only, name


def test_a_collector_with_no_client_says_so_by_name(db):
    for name in ("linkedin", "whatsapp"):
        collector = collectors.get(name)
        assert collector is not None
        with pytest.raises(collectors.NotConfigured, match="no client"):
            asyncio.run(collector.run({}))


# ------------------------------------------------------------ the URL pipeline


def test_the_same_page_shared_twice_is_fetched_once(db):
    """Canonicalisation happens before a single request is made."""
    from backend.workers.urls import canonicalize

    a = canonicalize("https://Example.COM/story?utm_source=x&b=2&a=1#top")
    b = canonicalize("example.com/story/?a=1&b=2&fbclid=zzz")
    assert a == b == "https://example.com/story?a=1&b=2"


def test_canonicalising_keeps_the_parts_that_change_the_document(db):
    from backend.workers.urls import canonicalize

    # Path case is kept: plenty of sites serve different documents from each.
    assert canonicalize("https://e.com/A") != canonicalize("https://e.com/a")
    assert canonicalize("not a url at all") == ""
    assert canonicalize("https://e.com") == "https://e.com/"


async def test_a_batch_of_urls_deduplicates_before_and_after_fetching(db, monkeypatch):
    from backend.web.reader import FetchedPage
    from backend.workers import urls as pipeline

    fetched: list[str] = []

    async def fake_fetch(url, *, timeout=25.0):
        fetched.append(url)
        # Two different addresses serving the same wire story.
        body = "syndicated wire copy about batteries" if "wire" in url else f"unique {url}"
        return FetchedPage(url=url, final_url=url, title="t", text=body)

    monkeypatch.setattr(pipeline, "fetch_readable", fake_fetch)
    result = await pipeline.run_batch(
        [
            "https://a.com/x?utm_source=twitter",
            "https://a.com/x",           # the same page, different tracking
            "https://wire1.com/story",
            "https://wire2.com/story",   # the same text, a different site
            "not a url",
        ]
    )
    assert len(fetched) == 3, "a canonical duplicate was fetched"
    assert result.counts["fetched"] == 2, "a content duplicate was kept"
    assert result.counts["duplicates"] == 2
    assert result.counts["skipped"] == 1


async def test_one_unreachable_host_does_not_end_the_batch(db, monkeypatch):
    from backend.web.reader import FetchedPage, FetchError
    from backend.workers import urls as pipeline

    async def fake_fetch(url, *, timeout=25.0):
        if "bad" in url:
            raise FetchError("connection refused")
        return FetchedPage(url=url, final_url=url, title="t", text="words here")

    monkeypatch.setattr(pipeline, "fetch_readable", fake_fetch)
    result = await pipeline.run_batch(["https://bad.com/1", "https://good.com/1"])
    assert result.counts == {**result.counts, "fetched": 1, "failed": 1}


def test_relevance_scores_coverage_rather_than_frequency(db):
    """"Mentions all four things" beats "says one of them forty times"."""
    from backend.workers.urls import relevance

    query = "solid state battery recycling"
    broad = relevance("solid state battery recycling plant opens", "news", query)
    narrow = relevance("battery " * 60, "news", query)
    assert broad > narrow
    assert relevance("anything", "t", "") == 1.0


async def test_a_hundred_urls_do_not_become_a_hundred_model_calls(db, monkeypatch):
    """The reason this pipeline exists at all."""
    from backend.web.reader import FetchedPage
    from backend.workers import llm
    from backend.workers import urls as pipeline

    calls = {"n": 0}

    async def fake_ask(prompt, **kwargs):
        calls["n"] += 1
        return {"calls": 1, "text": "a summary", "provider": "test"}

    async def fake_fetch(url, *, timeout=25.0):
        return FetchedPage(url=url, final_url=url, title=f"t{url[-3:]}",
                           text=f"batteries and recycling {url}")

    monkeypatch.setattr(pipeline, "fetch_readable", fake_fetch)
    monkeypatch.setattr(llm, "ask", fake_ask)

    result = await pipeline.run_batch(
        [f"https://site{i}.com/story" for i in range(100)],
        query="batteries",
        summarize=True,
    )
    assert result.counts["fetched"] == 100
    assert calls["n"] == 1, f"made {calls['n']} model calls for 100 pages"
    assert len(result.llm["sources"]) <= pipeline.LLM_BATCH


# -------------------------------------------------------------- spending money


def test_a_provider_is_free_only_when_the_catalogue_says_so(db):
    """Declared, never inferred. A worker deciding by grepping prose starts
    charging the day somebody rewords a sentence."""
    from backend.config import ProviderConfig
    from backend.workers.llm import is_free

    assert is_free(ProviderConfig(name="groq"))
    assert is_free(ProviderConfig(name="ollama"))
    assert not is_free(ProviderConfig(name="anthropic"))
    assert not is_free(ProviderConfig(name="openai"))
    # An endpoint nobody has catalogued is treated as paid: the safe direction.
    assert not is_free(ProviderConfig(name="some-new-gateway"))


async def test_a_worker_returns_no_summary_rather_than_spending_money(db, monkeypatch):
    """A briefing quietly billing every morning is not a choice anyone made."""
    from backend.runtime.router import RouteDecision
    from backend.workers import llm

    monkeypatch.setattr(
        llm, "route_for_tier",
        lambda *a, **k: RouteDecision(
            order=["anthropic"], head=None, candidates=[], offline=False
        ),
    )
    monkeypatch.setattr(llm, "free_providers", lambda: [])
    monkeypatch.setattr(llm, "resolve", lambda *a, **k: pytest.fail("reached a paid provider"))

    answer = await llm.ask("summarise this", paid_ok=False)
    assert answer["calls"] == 0
    assert "cost money" in answer["note"]


async def test_the_paid_gate_lifts_only_when_it_is_asked_to(db, monkeypatch):
    from backend.runtime.router import RouteDecision
    from backend.workers import llm

    reached: list[str] = []

    class FakeClient:
        async def complete(self, messages, tools, params):
            reached.append("called")

            class R:
                text = "done"
                input_tokens = 10
                output_tokens = 5

            return R()

    class Resolved:
        client = FakeClient()
        model = "m"

    monkeypatch.setattr(
        llm, "route_for_tier",
        lambda *a, **k: RouteDecision(
            order=["anthropic"], head=None, candidates=[], offline=False
        ),
    )
    monkeypatch.setattr(llm, "resolve", lambda *a, **k: Resolved())

    answer = await llm.ask("go", paid_ok=True)
    assert reached == ["called"]
    assert answer["text"] == "done" and answer["calls"] == 1


# ------------------------------------------------------------------ the tools


async def test_the_dispatch_tool_hands_back_a_batch_id_rather_than_blocking(db, registry):
    """The main agent must not sit through four lookups in a row."""
    from backend.tools.base import ToolContext
    from backend.tools.builtin.workers import dispatch_parallel_jobs

    fake("slow", lambda _p: asyncio.sleep(5))
    started = time.monotonic()
    result = await dispatch_parallel_jobs(
        {"jobs": [{"id": "a", "task": "slow"}], "wait_seconds": 0.3},
        ToolContext(conversation_id="c1", workspace_root="."),
    )
    assert time.monotonic() - started < 2
    assert not result.is_error
    assert result.content["batch_id"]
    assert "collect_jobs" in result.content["note"]


async def test_the_dispatch_tool_explains_a_graph_it_cannot_run(db):
    from backend.tools.base import ToolContext
    from backend.tools.builtin.workers import dispatch_parallel_jobs

    result = await dispatch_parallel_jobs(
        {"jobs": [{"id": "a", "task": "telepathy"}]},
        ToolContext(conversation_id="c1", workspace_root="."),
    )
    assert result.is_error
    assert "not a collector" in result.content


async def test_collecting_a_finished_batch_returns_its_results(db, registry):
    from backend.tools.base import ToolContext
    from backend.tools.builtin.workers import collect_jobs

    fake("ok", lambda _p: asyncio.sleep(0, result={"v": 7}))
    store = JobStore()
    worker_batch.enqueue(spec([{"id": "a", "task": "ok"}]), batch_id="done", store=store)
    # Through the claim, like the lane does: `queued -> completed` is not a move
    # the table allows, and a test that skipped it would be testing a shortcut.
    job = store.claim([worker_batch.KIND])
    store.complete(job, await worker_batch.run(job, store))

    result = await collect_jobs(
        {"batch_id": "done"}, ToolContext(conversation_id="c1", workspace_root=".")
    )
    assert not result.is_error
    assert result.content["state"] == "completed"
    assert result.content["nodes"][0]["result"]["v"] == 7


def test_a_batch_appears_in_the_jobs_list_like_any_other_work(db, registry):
    fake("noop", lambda _p: asyncio.sleep(0))
    store = JobStore()
    worker_batch.enqueue(spec([{"id": "a", "task": "noop"}]), batch_id="listed", store=store)
    assert [job.kind for job in store.list(kind=worker_batch.KIND)] == [worker_batch.KIND]


# ------------------------------------------------- which account, from where


async def _dispatch_through_the_tool(conversation_id, nodes, monkeypatch, lanes):
    """The tool, then the lane's work, by hand.

    Split because the tool deliberately does not run the batch -- it enqueues it
    and hands back an id so the turn can carry on. In the application a lane
    claims it; here the test is the lane.
    """
    from backend.tools.base import ToolContext
    from backend.tools.builtin.workers import dispatch_parallel_jobs
    from backend.workers import github

    sent: list[str] = []

    async def dispatch(account, *, job_id, task, params, settings=None):
        sent.append(account)
        return {"lane": account}

    monkeypatch.setattr(github, "dispatch", dispatch)
    monkeypatch.setattr("backend.workers.router.load_workers", lambda: lanes)

    result = await dispatch_parallel_jobs(
        {"jobs": nodes, "wait_seconds": 0, "timeout_seconds": 1},
        ToolContext(conversation_id=conversation_id, workspace_root="."),
    )
    assert not result.is_error, result.content

    store = JobStore()
    job = store.claim([worker_batch.KIND])
    assert job is not None, "the tool did not put a batch on the board"
    await worker_batch.run(job, store)
    return sent


async def test_a_batch_an_automation_asked_for_goes_to_the_automation_account(
    db, registry, lanes, monkeypatch
):
    """The two accounts are separate so that a briefing and a fan-out the agent
    invented do not share a credential. This is the line that keeps them apart.
    """
    from backend.db.repositories import ConversationRepository

    fake("collect_it", lambda _p: asyncio.sleep(0))
    scheduled = ConversationRepository().create("p", "m", "nightly", automation_id="7")
    sent = await _dispatch_through_the_tool(
        scheduled, [{"id": "a", "task": "collect_it"}], monkeypatch, lanes
    )
    assert sent == [AUTOMATION], f"a scheduled batch went to {sent}"


async def test_a_batch_the_agent_asked_for_goes_to_the_subagent_account(
    db, registry, lanes, monkeypatch
):
    from backend.db.repositories import ConversationRepository

    fake("collect_it", lambda _p: asyncio.sleep(0))
    chat = ConversationRepository().create("p", "m", "a chat")
    sent = await _dispatch_through_the_tool(
        chat,
        [{"id": "a", "task": "collect_it"}, {"id": "b", "task": "collect_it"}],
        monkeypatch,
        lanes,
    )
    assert set(sent) == {SUBAGENT}, f"an on-demand batch went to {sent}"


async def test_asking_not_to_wait_is_honoured(db, registry):
    """Zero is falsy: `raw or default` turned "hand it back now" into 25 seconds."""
    from backend.tools.base import ToolContext
    from backend.tools.builtin.workers import dispatch_parallel_jobs

    fake("slow", lambda _p: asyncio.sleep(30))
    started = time.monotonic()
    result = await dispatch_parallel_jobs(
        {"jobs": [{"id": "a", "task": "slow"}], "wait_seconds": 0},
        ToolContext(conversation_id="c1", workspace_root="."),
    )
    assert time.monotonic() - started < 1.0
    assert result.content["state"] == "queued"


async def test_a_node_whose_account_refuses_it_falls_back_to_the_next_lane(
    db, registry, lanes, monkeypatch
):
    """`local` is last in every order and never refuses, so there is always one left.

    The failure this prevents is a whole batch lost to a revoked PAT. The work
    can still be done here; it is only slower.
    """
    from backend.workers import github

    ran_here = {"n": 0}

    async def refuse(account, *, job_id, task, params, settings=None):
        raise github.DispatchRefused("the credential was refused by GitHub")

    async def locally(_params):
        ran_here["n"] += 1
        return {"done": "on this machine"}

    monkeypatch.setattr(github, "dispatch", refuse)
    monkeypatch.setattr("backend.workers.router.load_workers", lambda: lanes)
    fake("collect_it", locally)

    _, result = await run_batch(
        [{"id": "a", "task": "collect_it", "lane": SUBAGENT, "max_attempts": 2}],
        batch_id="fallback",
        timeout_seconds=10,
    )
    assert statuses(result) == {"a": "ok"}
    assert ran_here["n"] == 1
    assert result["nodes"][0]["provenance"]["lane"] == LOCAL


def test_the_router_hands_back_provider_names_not_resolved_models(db):
    """The shape this file got wrong once, asserted against the real router.

    `RouteDecision.order` is a list of provider *names*. The worker LLM path
    read it as a list of objects with `.provider` and `.model`, which every
    hand-built test double happily satisfied -- so the suite was green and the
    first real batch died on `'str' object has no attribute 'provider'`.
    """
    from backend.runtime.router import route_for_tier

    decision = route_for_tier("fast", needs_tools=False)
    assert all(isinstance(name, str) for name in decision.order), decision.order


def test_a_free_model_on_a_paid_gateway_is_free(db):
    """The account flag cannot express this, and getting it wrong blocks everything.

    A gateway sells metered models and gives away others on the same key, so
    "is this provider free" has no answer -- only "is this *model* free" does.
    Without the model test, a machine whose providers are all gateways had no
    free provider at all and every worker refused to reason, explaining that a
    model id ending in `:free` would have cost money.
    """
    from backend.workers.llm import free_to_use

    assert free_to_use("kilocode", "kilocode/stepfun/step-3.7-flash:free")
    assert not free_to_use("kilocode", "anthropic/claude-opus-4")
    # A declared no-card account is free whatever model it is asked for.
    assert free_to_use("groq", "llama-3.3-70b-versatile")
    assert not free_to_use("anthropic", "claude-opus-4")
