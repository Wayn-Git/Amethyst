"""Reminders: the one thing PSOK says without being asked.

`tasks.due_at` has existed since the first schema and nothing ever read it, so a
deadline was a value you could store and then had to remember yourself. This is
the loop that reads it.

Two rules, both stated rather than implied:

**Reminders fire while PSOK is open.** Same rule as automations, for the same
reason ([architecture/automation.md](../docs/architecture/automation.md)): a
daemon that outlives the interface is a second process with its own lifecycle,
and nothing here is worth that. A reminder that came due while PSOK was shut is
delivered when it next starts -- late, and marked late, rather than silently
dropped.

**A reminder is announced exactly once.** `reminded_at` is claimed with a
conditional update before the notification is sent, so a restart mid-tick, or
two ticks overlapping, cannot produce two of them.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import datetime, timedelta

from backend.db.repositories import TaskRepository
from backend.notify import notify
from backend.sync.microsoft_todo import SyncUnavailable
from backend.sync.microsoft_todo import sync as sync_microsoft_todo

log = logging.getLogger(__name__)

# Matched to the automation runner's tick. A reminder is not a stopwatch, but
# ten seconds is the difference between "due now" arriving when it is due and
# arriving when it has already been true for a while, and the scan is one
# indexed read against a table that changes a few times a day.
TICK_SECONDS = 10

# Past this, a reminder is delivered with a note saying when it was actually
# due, rather than as if it had just come round. Being told "due now" about
# something that was due yesterday is worse than being told nothing.
LATE_AFTER = timedelta(minutes=5)

# How often to pull external task sources. Slower than the reminder scan, but
# not by the fifteen minutes it used to be: a task ticked off on the phone took
# up to a quarter of an hour to reach the screen, which reads as the sync being
# broken rather than periodic. One `list_task_lists` plus one `list_tasks` per
# list, against a process that is already running and signed in -- and the list
# pulls now go out together rather than one after another. A sync is also
# available on demand from the API and the CLI, and the Tasks page asks for one
# when it opens.
SYNC_EVERY_SECONDS = 90

#: How often the audit log is pruned. Every tool call from every source writes
#: a row and nothing else retires them, so unattended runs grow a table nothing
#: reads past its first page -- an hour between prunes is far under any growth
#: rate that matters, and the prune itself is one statement.
PRUNE_LOGS_EVERY_SECONDS = 3600.0


def _now() -> datetime:
    """Local wall-clock time, naive -- the same clock `due_at` was written on.

    Load-bearing, and not obvious. `resolve_date_hint` resolves "tomorrow at
    five" against `datetime.now()`, so every `due_at` and `reminder_at` in the
    database is local naive. Comparing those against UTC delivers every reminder
    late by the machine's offset -- five and a half hours, silently, on the
    machine this was found on. Timestamps here are compared as strings by
    SQLite, so the two have to be the same clock or nothing lines up.
    """
    return datetime.now()


def _describe(due: str, now: datetime) -> str:
    """The body of the notification: when this was due, in words."""
    try:
        when = datetime.fromisoformat(due)
    except ValueError:
        return f"Due {due}"
    when = when.replace(tzinfo=None)
    late = now - when
    if late < LATE_AFTER:
        return f"Due {when:%H:%M}"
    if late < timedelta(days=1):
        hours = int(late.total_seconds() // 3600)
        if hours < 1:
            return f"Was due at {when:%H:%M}, {int(late.total_seconds() // 60)} minutes ago"
        return f"Was due at {when:%H:%M}, {hours} hour{'s' if hours != 1 else ''} ago"
    return f"Was due {when:%d %b at %H:%M}"


async def fire_due(now: datetime | None = None) -> int:
    """Announce every reminder that has come round. Returns how many were sent.

    The claim happens before the notification, not after. A notifier that hangs
    or a process killed between the two costs one missed reminder; doing it the
    other way round costs a repeat every thirty seconds until it succeeds, which
    on a machine with no notification daemon is forever.
    """
    moment = now or _now()
    repository = TaskRepository()
    sent = 0
    for task in repository.due_reminders(moment.isoformat(sep=" ", timespec="seconds")):
        if not repository.mark_reminded(task["id"], moment.isoformat(sep=" ", timespec="seconds")):
            continue  # another tick got there first
        due = task["reminder_at"] or task["due_at"]
        await notify(task["title"], _describe(due, moment))
        sent += 1
    return sent


class ReminderRunner:
    """Wakes twice a minute and announces whatever has come due.

    Deliberately not merged into `AutomationRunner`, whose lock serializes model
    turns that can take five minutes each. A reminder is a database read and a
    subprocess; queueing it behind a browser automation would make it arrive
    whenever that finished, which is not a reminder.
    """

    def __init__(self, manager_for=None) -> None:
        self._task: asyncio.Task | None = None
        # How the connector sync reaches the live MCP manager. Optional: without
        # it this loop is reminders only, which is what the CLI and the tests want.
        self.manager_for = manager_for
        self._next_sync = 0.0
        self._next_prune_logs = 0.0
        # The in-flight sync, if one is running. The sync is network round
        # trips (and possibly a connector spawn); the reminder scan is one
        # indexed read. Awaiting the sync inside the tick made reminder
        # delivery wait out every Graph call -- the same stall this runner was
        # split out of the automation loop to avoid, arriving from its other
        # neighbour. Tracked so a slow sync cannot overlap itself either.
        self._sync_task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="reminders")

    async def stop(self) -> None:
        tasks = [t for t in (self._task, self._sync_task) if t is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._task = None
        self._sync_task = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(TICK_SECONDS)
                if sent := await fire_due():
                    log.info("delivered %d reminder(s)", sent)
                self._maybe_sync()
                self._maybe_prune_logs()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("reminder tick failed")

    def _maybe_prune_logs(self) -> None:
        """Retire old audit rows. Runs whether or not anything else is set up."""
        if time.monotonic() < self._next_prune_logs:
            return
        self._next_prune_logs = time.monotonic() + PRUNE_LOGS_EVERY_SECONDS
        try:
            from backend.db.repositories import ExecutionLogRepository

            ExecutionLogRepository().prune()
        except Exception:
            log.exception("could not prune the execution log")

    def _maybe_sync(self) -> None:
        """Kick off a connector sync without waiting for it.

        The cadence is unchanged; what changed is that a tick no longer blocks
        on it. A connector that is not signed in is a normal state, logged at
        debug and not retried harder.
        """
        if self.manager_for is None or time.monotonic() < self._next_sync:
            return
        if self._sync_task is not None and not self._sync_task.done():
            return  # the last sync is still running; the next tick will retry
        self._next_sync = time.monotonic() + SYNC_EVERY_SECONDS
        self._sync_task = asyncio.create_task(self._run_sync(), name="reminders:sync")

    async def _run_sync(self) -> None:
        try:
            report = await sync_microsoft_todo(await self.manager_for())
        except SyncUnavailable as exc:
            log.debug("Microsoft To Do sync skipped: %s", exc)
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Microsoft To Do sync failed")
            return
        if report.created or report.updated or report.cancelled or report.pushed:
            log.info("%s", report.summary())
