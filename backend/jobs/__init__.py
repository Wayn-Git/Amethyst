"""Durable background work: jobs, lanes, and the ledger that makes retries safe.

See `docs/architecture/decisions/0022-durable-jobs.md` for why an interactive
turn is deliberately not one of these.
"""

from backend.jobs import state
from backend.jobs.runner import (
    Blocked,
    Handler,
    JobRunner,
    Unretryable,
    enqueue,
    handler_for,
    register,
    registered_kinds,
    replayable_after_crash,
)
from backend.jobs.state import STATES, TERMINAL, Job
from backend.jobs.store import JobStore

__all__ = [
    "STATES",
    "TERMINAL",
    "Blocked",
    "Handler",
    "Job",
    "JobRunner",
    "JobStore",
    "Unretryable",
    "enqueue",
    "handler_for",
    "register",
    "registered_kinds",
    "replayable_after_crash",
    "state",
]
