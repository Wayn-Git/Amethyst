"""Fan-out: many tasks at once, some waiting on others, one structured answer.

    Main agent
        v  decompose
    parallel jobs -- Gmail | LinkedIn | GitHub | 20 URLs
        v  collect
    Main agent synthesises

A batch is **one durable job** (`backend/jobs/`) whose handler runs the graph,
rather than one job per node. That is the whole design decision and it is worth
saying why: a job per node would need a second table to remember which nodes
belonged together, a second thing to reconcile when half of them finished, and
an answer to "what does a half-finished batch mean" that the job layer already
has. One job means one lease, one retry budget, one cancel, one row in
`/api/jobs`, and the step ledger already in the store doing the idempotency.

What the handler adds on top is the graph:

* **parallel** -- every node whose dependencies are met runs at once, on
  whichever lane `backend/workers/router.py` picks for it. Twenty URLs and a
  GitHub lookup do not take turns.
* **dependencies** -- `depends_on` names nodes, and a node whose dependency
  failed is *skipped* rather than run against missing input. Cycles are refused
  when the batch is built, not discovered when it hangs.
* **idempotency** -- a node's outcome is written to the step ledger the moment
  it settles, so a batch resumed after a crash re-runs only what had not
  finished, and a dispatch already sent to GitHub is never sent twice.
* **timeouts** -- per node and for the batch as a whole. A batch that runs out
  of time returns what it has, marked, rather than failing everything.
* **cancellation** -- the existing `POST /api/jobs/{id}/cancel`. The handler
  notices within a heartbeat, stops dispatching, and drops what is in flight.
* **provenance** -- every node's result says which collector produced it, on
  which lane, at what time, after how many attempts.

Nothing here waits for nodes in sequence, and nothing here makes the main agent
wait for the batch: `backend/tools/builtin/workers.py` hands the model a batch
id after a short window and lets it collect later.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from backend.jobs import Job, JobStore, Unretryable
from backend.workers import collectors
from backend.workers.reports import WorkerReportStore
from backend.workers.router import LOCAL, ExecutionRequest, choose

log = logging.getLogger(__name__)

KIND = "worker_batch"

#: How often the handler surfaces: writes progress, renews its lease, and looks
#: to see whether somebody has cancelled it. Short enough that Cancel feels like
#: a button, long enough not to be a busy loop.
HEARTBEAT_SECONDS = 2.0
#: How often a node waiting on a remote runner checks the mailbox. The relay is
#: polled every fifteen seconds, so anything faster than this only burns CPU.
POLL_SECONDS = 3.0

DEFAULT_NODE_TIMEOUT = 300.0
DEFAULT_BATCH_TIMEOUT = 900.0
#: A batch, not a campaign. Above this somebody wanted a different tool, and the
#: cap is what stops one sentence from a model becoming four hundred dispatches.
MAX_NODES = 50


class BadBatch(ValueError):
    """The graph is not runnable, and re-sending it unchanged will not help."""


@dataclass(frozen=True)
class Node:
    id: str
    task: str
    params: dict[str, Any] = field(default_factory=dict)
    #: Node ids that must settle successfully first. Their results are injected
    #: into this node's params under `depends`, so a node can actually use them.
    depends_on: tuple[str, ...] = ()
    #: Pin a lane. Usually left alone -- the router reads the task.
    lane: str | None = None
    timeout_seconds: float = DEFAULT_NODE_TIMEOUT
    max_attempts: int = 2

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "task": self.task,
            "depends_on": list(self.depends_on),
            "lane": self.lane,
            "timeout_seconds": self.timeout_seconds,
            "max_attempts": self.max_attempts,
        }


@dataclass(frozen=True)
class BatchSpec:
    nodes: tuple[Node, ...]
    timeout_seconds: float = DEFAULT_BATCH_TIMEOUT
    #: The turn this came from, for the transcript. A reference, never a copy.
    conversation_id: str | None = None
    #: Whether the clock asked for this rather than a person. It is what sends
    #: recurring work to the *automation* account and on-demand work to the
    #: sub-agent one -- the two are separate accounts precisely so that a
    #: briefing and a fan-out the agent invented do not share a credential.
    scheduled: bool = False
    reason: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "nodes": [
                {**node.as_json(), "params": node.params} for node in self.nodes
            ],
            "timeout_seconds": self.timeout_seconds,
            "conversation_id": self.conversation_id,
            "scheduled": self.scheduled,
            "reason": self.reason,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> BatchSpec:
        raw = payload.get("nodes")
        if not isinstance(raw, list) or not raw:
            raise BadBatch("a batch needs at least one node")
        if len(raw) > MAX_NODES:
            raise BadBatch(f"{len(raw)} nodes is more than the {MAX_NODES} a batch takes")

        nodes: list[Node] = []
        seen: set[str] = set()
        for index, entry in enumerate(raw):
            if not isinstance(entry, dict):
                raise BadBatch(f"node {index} is not an object")
            node_id = str(entry.get("id") or f"n{index + 1}").strip()[:64]
            if not node_id:
                raise BadBatch(f"node {index} has an empty id")
            if node_id in seen:
                raise BadBatch(f"two nodes are both called {node_id!r}")
            seen.add(node_id)
            task = str(entry.get("task") or "").strip()
            if not task:
                raise BadBatch(f"node {node_id!r} does not say what to run")
            if collectors.get(task) is None:
                raise BadBatch(
                    f"node {node_id!r} asks for {task!r}, which is not a collector."
                    f" Available: {', '.join(collectors.names())}"
                )
            params = entry.get("params")
            depends = entry.get("depends_on") or []
            nodes.append(
                Node(
                    id=node_id,
                    task=task,
                    params=params if isinstance(params, dict) else {},
                    depends_on=tuple(str(d) for d in depends if str(d)),
                    lane=str(entry["lane"]) if entry.get("lane") else None,
                    timeout_seconds=_seconds(
                        entry.get("timeout_seconds"), DEFAULT_NODE_TIMEOUT, 1.0, 3600.0
                    ),
                    max_attempts=max(1, min(int(entry.get("max_attempts") or 2), 5)),
                )
            )

        _check_graph(nodes, seen)
        return cls(
            nodes=tuple(nodes),
            timeout_seconds=_seconds(
                payload.get("timeout_seconds"), DEFAULT_BATCH_TIMEOUT, 1.0, 7200.0
            ),
            conversation_id=payload.get("conversation_id"),
            scheduled=payload.get("scheduled") is True,
            reason=str(payload.get("reason") or "")[:500],
        )


def _seconds(raw: Any, default: float, low: float, high: float) -> float:
    try:
        return max(low, min(float(raw), high))
    except (TypeError, ValueError):
        return default


def _check_graph(nodes: list[Node], ids: set[str]) -> None:
    """Refuse a graph that cannot finish, before anything is dispatched.

    A cycle found at run time is a batch that sits at "0 of 4 done" until its
    timeout, having told nobody why. Found here it is a sentence naming the
    nodes involved.
    """
    for node in nodes:
        for dependency in node.depends_on:
            if dependency not in ids:
                raise BadBatch(f"node {node.id!r} depends on {dependency!r}, which is not here")
            if dependency == node.id:
                raise BadBatch(f"node {node.id!r} depends on itself")

    # Kahn's algorithm: if anything is left when nothing is ready, it is a cycle.
    remaining = {node.id: set(node.depends_on) for node in nodes}
    while remaining:
        ready = [node_id for node_id, deps in remaining.items() if not deps]
        if not ready:
            raise BadBatch(
                "these nodes depend on each other in a circle: "
                + ", ".join(sorted(remaining))
            )
        for node_id in ready:
            remaining.pop(node_id)
        for deps in remaining.values():
            deps.difference_update(ready)


# ------------------------------------------------------------------ enqueueing


#: The lane that runs batches, set by `backend/api/main.py` at boot. Held here
#: rather than imported, for the reason `backend/automation.py` holds its own:
#: the API owns the runners' lifetimes, and a module reaching back into it would
#: be an import cycle. `None` in a test that never starts one -- enqueueing still
#: works, it is only the nudge that is skipped, and the lane's own tick finds it.
lane: Any = None


def nudge() -> None:
    if lane is not None:
        lane.nudge()


def key_for(batch_id: str) -> str:
    return f"batch:{batch_id}"


def enqueue(spec: BatchSpec, *, batch_id: str, store: JobStore | None = None) -> Job:
    """Put a batch on the board. Asking twice with one id gets one batch."""
    store = store or JobStore()
    return store.enqueue(
        KIND,
        key_for(batch_id),
        payload=spec.to_payload(),
        # One: a whole batch replayed from the top because one node's host was
        # down would re-do every settled node's outward call. The retries that
        # matter are per node, inside the handler, where the ledger is.
        max_attempts=1,
    )


# -------------------------------------------------------------------- running


def _outcome(
    node: Node,
    *,
    status: str,
    lane: str = "",
    result: Any = None,
    error: str = "",
    attempts: int = 0,
    started: float = 0.0,
) -> dict[str, Any]:
    """One node's answer, in the shape every node answers in.

    Uniform on purpose: a synthesis step reading twenty of these should not have
    to branch on which collector produced which. `status` is the only field a
    caller must look at, and `provenance` is what makes the answer checkable.
    """
    return {
        "id": node.id,
        "task": node.task,
        "status": status,  # ok | failed | skipped | timeout | cancelled
        "result": result,
        "error": error,
        "provenance": {
            "lane": lane,
            "attempts": attempts,
            "seconds": round(time.monotonic() - started, 2) if started else 0.0,
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    }


async def _run_remote(
    node: Node,
    *,
    lane: str,
    worker_id: str,
    job: Job,
    store: JobStore,
    step_key: str,
    deadline: float,
) -> Any:
    """Dispatch to a GitHub account and wait for its report.

    The dispatch goes through `JobStore.step`, so a batch resumed after a crash
    reattaches to the run already in flight instead of starting a second one --
    `workflow_dispatch` has no idempotency key of its own, and this ledger is
    the only thing standing between a reclaimed lease and a duplicate run.
    """
    from backend.workers import github

    reports = WorkerReportStore(store.conn)
    reports.open(worker_id, lane=lane)
    await store.step(
        job,
        step_key,
        lambda: github.dispatch(lane, job_id=worker_id, task=node.task, params=node.params),
    )

    while True:
        report = reports.get(worker_id)
        if report is not None and report.terminal:
            if report.state == "failed":
                raise RuntimeError(report.error or "the worker failed without saying why")
            return report.result
        if time.monotonic() >= deadline:
            raise TimeoutError(f"no report from the {lane} worker")
        if store.settled(job):
            raise asyncio.CancelledError
        await asyncio.sleep(POLL_SECONDS)


async def _run_node(
    node: Node,
    *,
    job: Job,
    store: JobStore,
    fanout: int,
    scheduled: bool,
    settled: dict[str, dict[str, Any]],
    batch_deadline: float,
) -> dict[str, Any]:
    """One node, on whichever lane suits it, with its own retry budget.

    Never raises. A node that fails is a *result* with `status: failed`, because
    a batch of twenty where one host was down is nineteen useful answers and one
    explanation -- not a failed batch.
    """
    started = time.monotonic()
    collector = collectors.get(node.task)
    if collector is None:  # `from_payload` checked, but the registry is mutable
        return _outcome(node, status="failed", error=f"no '{node.task}' collector", started=started)

    decision = choose(
        ExecutionRequest(
            task=node.task,
            prefer=node.lane,
            fanout=fanout,
            scheduled=scheduled,
            interactive=False,
            needs_local_data=collector.local_only,
        )
    )

    # A dependency's answer, handed to the node that asked for it. By reference
    # to the settled map rather than copied into the payload at build time,
    # because at build time it did not exist yet.
    params = dict(node.params)
    if node.depends_on:
        params["depends"] = {
            dependency: settled.get(dependency, {}).get("result")
            for dependency in node.depends_on
        }

    lanes = list(decision.order) or [LOCAL]
    last_error = ""
    attempts = 0
    for attempt in range(1, node.max_attempts + 1):
        lane = lanes[min(attempt - 1, len(lanes) - 1)]
        attempts = attempt
        remaining = batch_deadline - time.monotonic()
        if remaining <= 0:
            return _outcome(
                node, status="timeout", lane=lane, error="the batch ran out of time",
                attempts=attempt - 1, started=started,
            )
        budget = min(node.timeout_seconds, remaining)
        try:
            if lane == LOCAL:
                value = await asyncio.wait_for(
                    collectors.run(node.task, params), timeout=budget
                )
            else:
                value = await _run_remote(
                    node,
                    lane=lane,
                    worker_id=f"{job.id}:{node.id}:{attempt}",
                    job=job,
                    store=store,
                    step_key=f"dispatch:{node.id}:{attempt}",
                    deadline=time.monotonic() + budget,
                )
        except asyncio.CancelledError:
            # Either the batch was cancelled or the layer's deadline dropped it.
            # Both mean stop, and neither is a failure of this node.
            raise
        except (collectors.NotConfigured, Unretryable) as exc:
            # Another attempt runs into the same missing credential.
            return _outcome(
                node, status="failed", lane=lane, error=str(exc),
                attempts=attempt, started=started,
            )
        except TimeoutError:
            last_error = f"took longer than {budget:.0f}s"
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            log.info("batch node %s failed on %s: %s", node.id, lane, last_error)
        else:
            return _outcome(
                node, status="ok", lane=lane, result=value,
                attempts=attempt, started=started,
            )

    return _outcome(
        node,
        status="timeout" if "longer than" in last_error else "failed",
        lane=lanes[0],
        error=last_error,
        attempts=attempts,
        started=started,
    )


def _progress(settled: dict[str, dict[str, Any]], total: int) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for outcome in settled.values():
        counts[outcome["status"]] = counts.get(outcome["status"], 0) + 1
    return {"done": len(settled), "total": total, "by_status": counts}


async def run(job: Job, store: JobStore) -> dict[str, Any]:
    """The handler. Walks the graph, layer by layer, everything in a layer at once."""
    try:
        spec = BatchSpec.from_payload(job.payload)
    except BadBatch as exc:
        raise Unretryable(str(exc)) from exc

    settled: dict[str, dict[str, Any]] = {}
    # What a previous attempt finished. This is the step ledger doing exactly
    # what it does for any other handler -- a settled node is never re-run.
    for node in spec.nodes:
        done, recorded = store.recorded(job, f"node:{node.id}")
        if done and isinstance(recorded, dict):
            settled[node.id] = recorded

    deadline = time.monotonic() + spec.timeout_seconds
    cancelled = False

    while len(settled) < len(spec.nodes) and not cancelled:
        # Nodes whose dependencies did not succeed never run. Settled here
        # rather than dispatched-and-failed, so the answer says *why* -- "its
        # input never arrived" is a different fact from "it was tried and broke".
        for node in spec.nodes:
            if node.id in settled:
                continue
            blocked = [
                dependency
                for dependency in node.depends_on
                if settled.get(dependency, {}).get("status") not in (None, "ok")
            ]
            if blocked:
                settled[node.id] = _outcome(
                    node,
                    status="skipped",
                    error=f"depends on {', '.join(blocked)}, which did not succeed",
                )
                store.record(job, f"node:{node.id}", settled[node.id])

        ready = [
            node
            for node in spec.nodes
            if node.id not in settled
            and all(dependency in settled for dependency in node.depends_on)
        ]
        if not ready:
            break

        tasks: dict[asyncio.Task, Node] = {
            asyncio.create_task(
                _run_node(
                    node,
                    job=job,
                    store=store,
                    fanout=len(ready),
                    scheduled=spec.scheduled,
                    settled=settled,
                    batch_deadline=deadline,
                ),
                name=f"batch:{job.id}:{node.id}",
            ): node
            for node in ready
        }

        pending = set(tasks)
        while pending:
            # The heartbeat is what makes this handler safe to run for minutes:
            # each pass writes progress, and writing progress renews the lease.
            done_now, pending = await asyncio.wait(pending, timeout=HEARTBEAT_SECONDS)
            for task in done_now:
                node = tasks[task]
                try:
                    outcome = task.result()
                except asyncio.CancelledError:
                    outcome = _outcome(node, status="cancelled", error="the batch stopped")
                except Exception as exc:  # a node must not take the batch with it
                    log.exception("batch node %s raised", node.id)
                    outcome = _outcome(node, status="failed", error=f"{type(exc).__name__}: {exc}")
                settled[node.id] = outcome
                store.record(job, f"node:{node.id}", outcome)

            store.checkpoint(job, progress=_progress(settled, len(spec.nodes)))

            if store.settled(job):
                # Somebody pressed Cancel. `JobStore.settled` reads the row
                # rather than this handler's copy, which is the only way to see
                # a change made while the handler was running.
                cancelled = True
            elif time.monotonic() >= deadline:
                cancelled = True

            if cancelled and pending:
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in pending:
                    node = tasks[task]
                    settled.setdefault(
                        node.id, _outcome(node, status="cancelled", error="the batch stopped")
                    )
                pending = set()

    timed_out = time.monotonic() >= deadline
    for node in spec.nodes:
        settled.setdefault(
            node.id,
            _outcome(
                node,
                status="timeout" if timed_out else "cancelled",
                error="the batch ran out of time" if timed_out else "the batch stopped",
            ),
        )

    # The mailbox is a queue, not a record. What the workers said is in the
    # result below; leaving the rows would be a second copy going stale.
    WorkerReportStore(store.conn).clear(
        [
            f"{job.id}:{node.id}:{attempt}"
            for node in spec.nodes
            for attempt in range(1, node.max_attempts + 1)
        ]
    )

    ordered = [settled[node.id] for node in spec.nodes]
    return {
        "batch": job.idempotency_key.removeprefix("batch:"),
        "reason": spec.reason,
        "nodes": ordered,
        "progress": _progress(settled, len(spec.nodes)),
        "cancelled": cancelled and not timed_out,
        "timed_out": timed_out,
    }
