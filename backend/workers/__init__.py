"""Work that runs somewhere other than this turn.

Four lanes, one router, one fan-out primitive:

  `router`      decides *where* -- local, the Cloudflare relay, the automation
                GitHub account, or the sub-agent GitHub account.
  `batch`       one durable job that runs a graph of tasks in parallel.
  `collectors`  what a worker actually does. API clients, not MCP agents.
  `github`      dispatching to an account. `accounts` holds the two, isolated.
  `reports`     what a remote worker said, once the relay has handed it over.
  `llm`         the only place a worker may spend a model, and the rules it obeys.
  `remote`      the entry point that runs inside a GitHub Actions runner.

Nothing here is a source of truth. A worker collects and reports; the answer
lands back in the local database through `backend/jobs/`, which is where it was
always going to live.
"""

from backend.workers.accounts import (
    AUTOMATION,
    SUBAGENT,
    WorkerAccount,
    WorkerSettings,
    load_workers,
    save_workers,
    token_ref,
)
from backend.workers.batch import KIND, BadBatch, BatchSpec, Node, enqueue
from backend.workers.reports import WorkerReport, WorkerReportStore
from backend.workers.router import (
    CLOUDFLARE,
    LANES,
    LOCAL,
    ExecutionDecision,
    ExecutionRequest,
    choose,
)

__all__ = [
    "AUTOMATION",
    "BadBatch",
    "BatchSpec",
    "CLOUDFLARE",
    "ExecutionDecision",
    "ExecutionRequest",
    "KIND",
    "LANES",
    "LOCAL",
    "Node",
    "SUBAGENT",
    "WorkerAccount",
    "WorkerReport",
    "WorkerReportStore",
    "WorkerSettings",
    "choose",
    "enqueue",
    "load_workers",
    "save_workers",
    "token_ref",
]
