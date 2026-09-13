"""Fanning work out, and picking it back up. Two tools, one durable batch.

The problem these exist for: "get my recent mail, find two people on LinkedIn,
check GitHub, and read these twenty URLs" is four independent pieces of work and
a synthesis. Run through ordinary tool calls it is four sequential round trips
with a model waiting through each -- and the twenty URLs are twenty more.

`dispatch_parallel_jobs` turns that into one durable batch (`backend/workers/
batch.py`) that runs everything whose dependencies are met at once, on whichever
lane suits each task. The model describes the graph; it does not drive it.

**The model does not sit and wait.** The tool waits a short, bounded window --
long enough that most batches simply come back within the same tool call -- and
otherwise returns the batch id with whatever has already settled. The turn
carries on, and `collect_jobs` picks the rest up later. A batch outlives the
turn that started it: it is a job, so it survives a restart, it appears in the
jobs list, and Cancel works on it.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from backend.jobs import JobStore
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult
from backend.workers import batch as worker_batch
from backend.workers import collectors

#: How long a dispatch waits before handing back a batch id. Chosen so the
#: common case -- a handful of URLs, a lookup -- returns inside the tool call,
#: and the uncommon case does not hold a turn open for minutes.
DEFAULT_WAIT = 25.0
MAX_WAIT = 120.0
POLL = 0.5


def _catalogue_sentence() -> str:
    return ", ".join(
        f"{item['name']}{' (this machine only)' if item['local_only'] else ''}"
        for item in collectors.catalogue()
    )


def _wait_for(raw: Any, default: float) -> float:
    """Seconds to wait, honouring a caller that asked for none.

    Not `raw or default`: zero is falsy, so "hand it back immediately" became
    "wait the full twenty-five seconds" -- the exact opposite of what was asked,
    and silent.
    """
    if raw is None:
        return default
    try:
        return max(0.0, min(float(raw), MAX_WAIT))
    except (TypeError, ValueError):
        return default


def _is_scheduled(conversation_id: str | None) -> bool:
    if not conversation_id:
        return False
    try:
        from backend.db.repositories import ConversationRepository

        row = ConversationRepository().get(conversation_id)
    except Exception:
        return False
    return bool(row and row["automation_id"])


def _view(job: Any, *, full: bool) -> dict[str, Any]:
    """One batch, as the model reads it.

    The node list is trimmed hard when the batch is still running: a model
    re-reading twenty half-finished results on every poll is the token bill this
    tool exists to avoid.
    """
    result = job.result or {}
    view: dict[str, Any] = {
        "batch_id": job.idempotency_key.removeprefix("batch:"),
        "state": job.state,
        "progress": result.get("progress") or job.checkpoint.get("progress") or {},
    }
    if job.last_error:
        view["error"] = job.last_error
    nodes = result.get("nodes")
    if nodes and full:
        view["nodes"] = nodes
    elif nodes:
        view["nodes"] = [
            {"id": n.get("id"), "task": n.get("task"), "status": n.get("status")}
            for n in nodes
        ]
    if result.get("timed_out"):
        view["timed_out"] = True
    if result.get("cancelled"):
        view["cancelled"] = True
    return view


async def dispatch_parallel_jobs(args: dict, context: ToolContext) -> ToolResult:
    jobs_in = args.get("jobs") or args.get("nodes") or []
    if not isinstance(jobs_in, list) or not jobs_in:
        return ToolResult.error(
            "Give a `jobs` list. Each entry needs a `task` and may have `params`,"
            f" an `id`, and `depends_on`. Tasks available: {_catalogue_sentence()}"
        )

    payload = {
        "nodes": jobs_in,
        "timeout_seconds": args.get("timeout_seconds"),
        "conversation_id": context.conversation_id,
        # Read from the conversation rather than threaded down from the caller.
        # An automation's turn already opens its conversation with an
        # `automation_id` on it, so the fact is in the database and a second
        # copy travelling through Director and ToolContext would be the one that
        # went stale. This is what sends scheduled work to the automation
        # account and everything else to the sub-agent one.
        "scheduled": _is_scheduled(context.conversation_id),
        "reason": str(args.get("reason") or "")[:500],
    }
    try:
        spec = worker_batch.BatchSpec.from_payload(payload)
    except worker_batch.BadBatch as exc:
        # The model can fix every one of these from the sentence, which is why
        # they are sentences rather than a validation code.
        return ToolResult.error(str(exc))

    batch_id = uuid.uuid4().hex[:12]
    store = JobStore()
    job = worker_batch.enqueue(spec, batch_id=batch_id, store=store)
    worker_batch.nudge()

    wait = _wait_for(args.get("wait_seconds"), DEFAULT_WAIT)
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        await asyncio.sleep(POLL)
        current = store.get(job.id)
        if current is None:
            break
        job = current
        if job.terminal:
            break

    view = _view(job, full=job.terminal)
    if not job.terminal:
        view["note"] = (
            f"{len(spec.nodes)} task(s) still running. Carry on with the turn and call"
            f" collect_jobs with batch_id '{batch_id}' when you need the results."
        )
    return ToolResult.ok(view)


async def collect_jobs(args: dict, context: ToolContext) -> ToolResult:
    batch_id = str(args.get("batch_id") or "").strip()
    if not batch_id:
        return ToolResult.error("Give the `batch_id` that dispatch_parallel_jobs returned.")

    store = JobStore()
    job = store.by_key(worker_batch.key_for(batch_id))
    if job is None:
        return ToolResult.error(f"There is no batch '{batch_id}'.")

    wait = _wait_for(args.get("wait_seconds"), 0.0)
    deadline = time.monotonic() + wait
    while not job.terminal and time.monotonic() < deadline:
        await asyncio.sleep(POLL)
        job = store.by_key(worker_batch.key_for(batch_id)) or job

    view = _view(job, full=job.terminal)
    if not job.terminal:
        view["note"] = "Still running. Call again, or carry on without it."
    return ToolResult.ok(view)


def tools() -> list[Tool]:
    tasks = _catalogue_sentence()
    return [
        Tool(
            name="dispatch_parallel_jobs",
            description=(
                "Run several data-gathering tasks at once instead of one after"
                " another, and get their results together. Use it whenever a request"
                " needs more than one lookup, or the same lookup over many inputs"
                " (a batch of URLs). Tasks run in parallel unless one lists another"
                " in `depends_on`, in which case it waits and receives the earlier"
                f" result. Tasks: {tasks}."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "jobs": {
                        "type": "array",
                        "description": (
                            "The tasks to run. Independent unless depends_on says otherwise."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "A short name, so other tasks can depend on it.",
                                },
                                "task": {
                                    "type": "string",
                                    "description": f"Which collector to run. One of: {tasks}",
                                },
                                "params": {
                                    "type": "object",
                                    "description": (
                                        "Its arguments, e.g. {'urls': [...], 'query': '...'}"
                                    ),
                                },
                                "depends_on": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Ids that must finish first. Omit for parallel.",
                                },
                            },
                            "required": ["task"],
                        },
                    },
                    "reason": {
                        "type": "string",
                        "description": "One line on what this batch is for. Shown to the user.",
                    },
                    "wait_seconds": {
                        "type": "number",
                        "description": (
                            "How long to wait before handing back a batch id (default 25)."
                        ),
                    },
                    "timeout_seconds": {
                        "type": "number",
                        "description": "Give up on the whole batch after this (default 900).",
                    },
                },
                "required": ["jobs"],
            },
            handler=dispatch_parallel_jobs,
            # The batch only reads: every collector fetches or lists. The one
            # that writes (`todo`) reconciles rather than creates, and the
            # permission gate still sees each tool the turn itself calls.
            risk=RiskLevel.LOW,
        ),
        Tool(
            name="collect_jobs",
            description=(
                "Get the results of a batch that dispatch_parallel_jobs handed back"
                " a batch_id for. Call it once you have done whatever else the turn"
                " needed; it returns whatever has settled so far."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "batch_id": {"type": "string", "description": "From dispatch_parallel_jobs"},
                    "wait_seconds": {
                        "type": "number",
                        "description": "Wait up to this long for it to finish (default 0).",
                    },
                },
                "required": ["batch_id"],
            },
            handler=collect_jobs,
            risk=RiskLevel.LOW,
        ),
    ]
