"""Automations: a turn that runs without anyone typing. **Beta.**

The smallest thing that is honestly a scheduled turn, and no more. A prompt, an
interval, and a record of what happened -- with two decisions made explicitly
rather than left to be discovered later:

**Who decides it is time.** This process, while `amethyst serve` is running. A
cron-like daemon would keep automations running when the API is down, which
sounds better until you ask what it does with a turn that needs a permission
answer at 3am. Tying them to the server means "automations run while AMETHYST is
open", which is a rule that can be stated in one sentence and is true.

**What the permission gate does when nobody is watching.** It denies. An
unattended turn cannot raise a prompt -- there is no one to answer it, and a
prompt that blocks forever is worse than a refusal -- so the gate runs with a
callback that says no to everything not already covered by a standing approval
the user granted deliberately. An automation that needs more than that records
`blocked` and says which operation it wanted, so the fix is to approve that one
operation rather than to loosen anything globally.

Both are beta positions, not final ones. See docs/architecture/automation.md.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, tzinfo
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.db.connection import get_connection

log = logging.getLogger(__name__)

# Below this an "automation" is a busy loop wearing a schedule. One minute, not
# five: five was chosen against a runner that woke every thirty seconds, so the
# floor and the tick together made "as often as possible" mean "somewhere
# between five and six minutes from now", which is not a schedule anyone can
# use for anything that is meant to feel responsive. A minute is still far above
# the tick, so the guarantee the old floor was protecting -- that an interval is
# honoured rather than approximated -- survives at the tighter number.
MIN_MINUTES = 1
MAX_MINUTES = 60 * 24 * 30

# How often the runner wakes to look for due work. The check is one indexed
# read, so this is cheap; it also bounds how late a run can be -- which is the
# reason it came down from thirty seconds: a run due now waited up to half a
# minute for nothing, and on a one-minute interval that is a third of the period
# spent asleep.
TICK_SECONDS = 10

# An automation that hangs must not wedge the runner for the rest of the session.
# Three minutes rather than five: the runner is serial, so this is also how long
# one stuck automation can hold up every other one that comes due behind it.
RUN_TIMEOUT_SECONDS = 180

# How many past runs of one automation to keep. Enough to compare a failure
# against the run before it, which is the usual reason to look at all, without
# keeping every run an enabled automation has ever made.
KEEP_RUNS = 20


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime) -> str:
    return moment.replace(microsecond=0).isoformat()


def parse_iso(value: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _known_zone(name: str | None) -> str | None:
    if not name:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None
    return name


@lru_cache(maxsize=1)
def system_timezone() -> str | None:
    """This machine's IANA zone name, read without adding a dependency.

    `datetime.now().astimezone()` gives the offset that applies *today*, which
    is not the same thing: a schedule written in March and read in July under a
    frozen offset drifts by an hour, which for a daily alarm is the whole point.
    The name survives the clock change; the offset does not.

    Three places, in the order they are authoritative, and `None` if none of
    them answers -- the caller falls back to the fixed offset, which is wrong
    only across a DST boundary rather than wrong by hours.
    """
    if name := _known_zone(os.environ.get("TZ")):
        return name
    etc = Path("/etc/timezone")
    if etc.is_file():
        try:
            if name := _known_zone(etc.read_text().strip()):
                return name
        except OSError:
            pass
    link = Path("/etc/localtime")
    try:
        if link.is_symlink():
            parts = link.resolve().parts
            if "zoneinfo" in parts:
                index = parts.index("zoneinfo") + 1
                if name := _known_zone("/".join(parts[index:])):
                    return name
    except OSError:
        pass
    return None


def _zone(name: str | None) -> tzinfo:
    """The zone a wall-clock schedule is read in.

    The automation's own zone when it has one -- that is the user's, sent by
    whichever interface created it. Otherwise this machine's. **Never UTC as a
    default**: that was the bug. `timezone` was a parameter both of these
    functions accepted and neither used, so every "daily at 07:30" was 07:30
    UTC, and the morning briefing it was written for arrived at half past two
    in the morning.
    """
    if name:
        if _known_zone(name):
            return ZoneInfo(name)
        log.warning("automation names an unknown timezone %r; using this machine's", name)
    if local := system_timezone():
        return ZoneInfo(local)
    return datetime.now().astimezone().tzinfo or UTC


def _hhmm(time_str: str | None) -> tuple[int, int]:
    """Parse "07:30". Callers validate first; this is the last resort."""
    try:
        hour, minute = (int(part) for part in str(time_str).split(":")[:2])
    except (ValueError, TypeError):
        return 7, 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return 7, 0
    return hour, minute


def valid_time_of_day(time_str: str | None) -> bool:
    """Whether this is a time, rather than something that will silently become 07:00."""
    try:
        hour, minute = (int(part) for part in str(time_str).split(":"))
    except (ValueError, TypeError):
        return False
    return 0 <= hour <= 23 and 0 <= minute <= 59


def _next_daily_run(
    time_str: str, timezone: str | None = None, *, after: datetime | None = None
) -> datetime:
    """The next time it is `time_str` in `timezone`, as a UTC instant.

    Wall-clock arithmetic on purpose: adding a day to an aware datetime keeps
    the local time and lets the offset move, so "daily at 07:30" is still 07:30
    the morning the clocks change rather than 06:30 for half the year.
    """
    zone = _zone(timezone)
    now = (after or _now()).astimezone(zone)
    hour, minute = _hhmm(time_str)
    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return next_run.astimezone(UTC)


def _next_weekly_run(
    time_str: str,
    weekly_day: int,
    timezone: str | None = None,
    *,
    after: datetime | None = None,
) -> datetime:
    """The next `weekly_day` at `time_str` in `timezone`. 0=Mon .. 6=Sun."""
    zone = _zone(timezone)
    now = (after or _now()).astimezone(zone)
    hour, minute = _hhmm(time_str)
    wanted = int(weekly_day) % 7
    days_ahead = (wanted - now.weekday()) % 7
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if days_ahead == 0 and candidate <= now:
        days_ahead = 7
    return (candidate + timedelta(days=days_ahead)).astimezone(UTC)


def next_run_for(
    *,
    schedule_type: str,
    every_minutes: int,
    daily_at_time: str | None,
    weekly_day: int | None,
    timezone: str | None,
    after: datetime | None = None,
) -> datetime:
    """One place that answers "when does this run next", for every schedule.

    It existed three times -- `create`, `update` and `record` -- and the copies
    had already drifted: only one of them passed the timezone through, so
    editing an automation moved its next run into a different zone from the one
    that created it.
    """
    moment = after or _now()
    if schedule_type == "daily_at" and daily_at_time:
        return _next_daily_run(daily_at_time, timezone, after=moment)
    if schedule_type == "weekly_at" and daily_at_time and weekly_day is not None:
        return _next_weekly_run(daily_at_time, weekly_day, timezone, after=moment)
    return moment + timedelta(minutes=every_minutes)


def decode_actions(raw: str | None) -> list[str]:
    """The granted tool names, from the JSON column. Never raises.

    A column that cannot be parsed reads as *no* grants rather than as an error:
    the fallback has to be the safe direction, because the alternative is an
    unattended turn deciding it may send mail because a string was malformed.
    """
    if not raw:
        return []
    try:
        loaded = json.loads(raw)
    except (TypeError, ValueError):
        log.warning("an automation's actions column is not JSON; treating it as none granted")
        return []
    if not isinstance(loaded, list):
        return []
    return sorted({str(name) for name in loaded if isinstance(name, str) and name.strip()})


def encode_actions(names: Any) -> str | None:
    if not names:
        return None
    return json.dumps(sorted({str(n).strip() for n in names if str(n).strip()}))


@dataclass
class Automation:
    id: int
    name: str
    prompt: str
    every_minutes: int
    enabled: bool
    provider: str | None
    model: str | None
    next_run_at: str
    last_run_at: str | None
    last_status: str | None
    last_summary: str | None
    last_conversation_id: str | None
    capability_profile: str | None
    consecutive_failures: int
    # Extended fields
    description: str | None = None
    schedule_type: str = "interval"
    daily_at_time: str | None = None
    weekly_day: int | None = None
    timezone: str | None = None
    notification: str = "app"
    template_id: str | None = None
    #: Tool names this automation may use unattended. See `UnattendedGate`.
    actions: list[str] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Automation:
        return cls(
            id=row["id"],
            name=row["name"],
            prompt=row["prompt"],
            every_minutes=row["every_minutes"],
            enabled=bool(row["enabled"]),
            provider=row["provider"],
            model=row["model"],
            next_run_at=row["next_run_at"],
            last_run_at=row["last_run_at"],
            last_status=row["last_status"],
            last_summary=row["last_summary"],
            last_conversation_id=row["last_conversation_id"],
            capability_profile=row["capability_profile"],
            consecutive_failures=row["consecutive_failures"],
            description=row["description"] if "description" in row.keys() else None,
            schedule_type=row["schedule_type"] if "schedule_type" in row.keys() else "interval",
            daily_at_time=row["daily_at_time"] if "daily_at_time" in row.keys() else None,
            weekly_day=row["weekly_day"] if "weekly_day" in row.keys() else None,
            timezone=row["timezone"] if "timezone" in row.keys() else None,
            notification=row["notification"] if "notification" in row.keys() else "app",
            template_id=row["template_id"] if "template_id" in row.keys() else None,
            actions=decode_actions(row["actions"] if "actions" in row.keys() else None),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "prompt": self.prompt,
            "every_minutes": self.every_minutes,
            "enabled": self.enabled,
            "provider": self.provider,
            "model": self.model,
            "schedule_type": self.schedule_type,
            "daily_at_time": self.daily_at_time,
            "weekly_day": self.weekly_day,
            "timezone": self.timezone,
            "notification": self.notification,
            "template_id": self.template_id,
            "actions": self.actions,
            "next_run_at": self.next_run_at,
            "last_run_at": self.last_run_at,
            "last_status": self.last_status,
            "last_summary": self.last_summary,
            "last_conversation_id": self.last_conversation_id,
            "capability_profile": self.capability_profile,
            "consecutive_failures": self.consecutive_failures,
        }


class AutomationError(ValueError):
    pass


#: Where a finished run is delivered. `app` is an OS notification (backend/
#: notify.py, the same one reminders use); `email` is a real message through the
#: connected mail account, and a run whose email could not be sent is `partial`
#: rather than `success`.
NOTIFICATIONS = ("email+app", "email", "app", "off")

SCHEDULE_TYPES = ("interval", "daily_at", "weekly_at")


def _validate_schedule(
    schedule_type: str,
    *,
    every_minutes: int,
    daily_at_time: str | None,
    weekly_day: int | None,
    timezone: str | None,
) -> None:
    """Refuse a schedule that cannot mean what it says.

    Silent coercion was the old behaviour and it is the worse one: an unparsable
    time became 07:00, so an automation the user set for 19:30 ran at breakfast
    and the interface showed the time they typed.
    """
    if schedule_type not in SCHEDULE_TYPES:
        raise AutomationError(f"unknown schedule type: {schedule_type}")
    if schedule_type in ("daily_at", "weekly_at"):
        if not valid_time_of_day(daily_at_time):
            raise AutomationError(
                f"'{daily_at_time}' is not a time of day; it needs to look like 07:30"
            )
        if schedule_type == "weekly_at" and not (
            weekly_day is not None and 0 <= int(weekly_day) <= 6
        ):
            raise AutomationError("a weekly automation needs a day, Monday (0) to Sunday (6)")
    elif not MIN_MINUTES <= every_minutes <= MAX_MINUTES:
        raise AutomationError(
            f"the interval must be between {MIN_MINUTES} minute"
            f"{'' if MIN_MINUTES == 1 else 's'} and 30 days"
        )
    if timezone and not _known_zone(timezone):
        raise AutomationError(
            f"'{timezone}' is not a timezone this machine knows; it needs an IANA"
            " name like America/New_York"
        )


@dataclass
class AutomationRun:
    """A single execution attempt of an automation."""
    id: int
    automation_id: int
    trigger: str
    started_at: str | None
    completed_at: str | None
    duration_ms: int | None
    status: str
    error: str | None
    result_summary: str | None
    conversation_id: str | None
    created_at: str
    #: The schedule slot, or None for a manual run. The idempotency key.
    scheduled_for: str | None = None
    #: What ran and what it did: tool calls, and how delivery went.
    steps: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> AutomationRun:
        return cls(
            id=row["id"],
            automation_id=row["automation_id"],
            trigger=row["trigger"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            duration_ms=row["duration_ms"],
            status=row["status"],
            error=row["error"],
            result_summary=row["result_summary"],
            conversation_id=row["conversation_id"],
            created_at=row["created_at"],
            scheduled_for=row["scheduled_for"] if "scheduled_for" in row.keys() else None,
            steps=_decode_steps(row["steps"] if "steps" in row.keys() else None),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "automation_id": self.automation_id,
            "trigger": self.trigger,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "error": self.error,
            "result_summary": self.result_summary,
            "conversation_id": self.conversation_id,
            "created_at": self.created_at,
            "scheduled_for": self.scheduled_for,
            "steps": self.steps,
        }


def _decode_steps(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        loaded = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return loaded if isinstance(loaded, list) else []


class AutomationRunRepository:
    """Execution history for automations. Each run is an auditable record."""

    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()

    def _read(self, run_id: int) -> AutomationRun:
        row = self.conn.execute(
            "SELECT * FROM automation_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return AutomationRun.from_row(row)

    def claim(
        self,
        automation_id: int,
        *,
        scheduled_for: str | None = None,
        trigger: str = "scheduled",
    ) -> AutomationRun | None:
        """Take the slot, or find out somebody else already has it.

        `None` means this scheduled execution has already been claimed -- by the
        in-process runner, by a second tick from GitHub Actions, by the same
        workflow retrying. The caller skips rather than running it again.

        The guarantee is the partial unique index on
        `(automation_id, scheduled_for)`, not a read-then-write: two callers
        that both looked first would both find nothing and both proceed, which
        is exactly what the function this replaces did. Here they both INSERT,
        SQLite lets one through, and the loser is told by IntegrityError.

        A manual run passes no slot, so the index does not apply to it and
        pressing "Run now" twice is two runs -- which is what it looks like it
        should be. Double-clicking is deduplicated a layer up, by the job that
        is already in flight.
        """
        try:
            cursor = self.conn.execute(
                "INSERT INTO automation_runs (automation_id, trigger, scheduled_for, status)"
                " VALUES (?, ?, ?, 'claimed')",
                (automation_id, trigger, scheduled_for),
            )
        except sqlite3.IntegrityError:
            self.conn.rollback()
            return None
        self.conn.commit()
        return self._read(cursor.lastrowid)  # type: ignore[arg-type]

    def create(self, automation_id: int, trigger: str = "scheduled") -> AutomationRun:
        """A claimed run with no slot. What a direct caller (a test) wants."""
        run = self.claim(automation_id, scheduled_for=None, trigger=trigger)
        assert run is not None  # no slot, so nothing to collide with
        return run

    def begin(self, run_id: int) -> None:
        """The turn is starting. `started_at` is set here rather than at claim
        time so `duration_ms` measures the run and not the wait in front of it."""
        self.conn.execute(
            "UPDATE automation_runs SET status = 'running', started_at = ? WHERE id = ?",
            (_iso(_now()), run_id),
        )
        self.conn.commit()

    def add_step(self, run_id: int, step: dict[str, Any]) -> None:
        """Append one thing that happened. Read back by the run detail."""
        run = self._read(run_id)
        steps = [*run.steps, step]
        self.conn.execute(
            "UPDATE automation_runs SET steps = ? WHERE id = ?",
            (json.dumps(steps)[:20_000], run_id),
        )
        self.conn.commit()

    def complete(
        self,
        run_id: int,
        *,
        status: str,
        result_summary: str | None = None,
        error: str | None = None,
        conversation_id: str | None = None,
    ) -> None:
        """Mark a run as finished with its outcome."""
        now = _now()
        run = self.conn.execute(
            "SELECT started_at FROM automation_runs WHERE id = ?", (run_id,)
        ).fetchone()
        duration_ms = None
        if run and run["started_at"]:
            started = parse_iso(run["started_at"])
            duration_ms = int((now - started).total_seconds() * 1000)
        self.conn.execute(
            "UPDATE automation_runs SET completed_at = ?, duration_ms = ?,"
            " status = ?, result_summary = ?, error = ?,"
            " conversation_id = COALESCE(?, conversation_id) WHERE id = ?",
            (_iso(now), duration_ms, status, result_summary, error, conversation_id, run_id),
        )
        self.conn.commit()

    def runs_of(
        self, automation_id: int, *, limit: int = 50
    ) -> list[AutomationRun]:
        """Newest-first list of runs for one automation."""
        return [
            AutomationRun.from_row(r)
            for r in self.conn.execute(
                "SELECT * FROM automation_runs WHERE automation_id = ?"
                " ORDER BY created_at DESC LIMIT ?",
                (automation_id, limit),
            )
        ]

    def recent_runs(self, *, limit: int = 100) -> list[AutomationRun]:
        """Newest-first list across all automations."""
        return [
            AutomationRun.from_row(r)
            for r in self.conn.execute(
                "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
        ]

    def stats(self, automation_id: int, days: int = 30) -> dict[str, Any]:
        """Aggregate stats for run history chart."""
        rows = self.conn.execute(
            "SELECT status, COUNT(*) as count, DATE(created_at) as day"
            " FROM automation_runs"
            " WHERE automation_id = ? AND created_at >= datetime('now', ?)"
            " GROUP BY DATE(created_at), status"
            " ORDER BY day",
            (automation_id, f"-{days} days"),
        ).fetchall()
        return {"by_day": _by_day(rows), "days": days, "totals": _totals(rows)}

    def overall_stats(self, days: int = 30) -> dict[str, Any]:
        """The same shape, across every automation.

        The chart used to be fed one automation's stats -- `rows[0]`'s -- under
        a heading that read as a total. This is the total.
        """
        rows = self.conn.execute(
            "SELECT status, COUNT(*) as count, DATE(created_at) as day"
            " FROM automation_runs"
            " WHERE created_at >= datetime('now', ?)"
            " GROUP BY DATE(created_at), status"
            " ORDER BY day",
            (f"-{days} days",),
        ).fetchall()
        return {"by_day": _by_day(rows), "days": days, "totals": _totals(rows)}


#: Every status a finished run can carry. `claimed` and `running` are in
#: flight; the rest are terminal. Kept in one place because the chart, the API
#: and the interface all count them and had all invented their own list.
#: `automations.last_status` -> `automation_runs.status`. Two vocabularies
#: because the first is "what happened last" on the automation and the second is
#: one row in an audit trail, and they were being mapped ad hoc in two places.
RUN_STATUS_OF = {
    "ok": "success",
    "error": "failed",
    "blocked": "blocked",
    "partial": "partial",
    "skipped": "skipped",
    "running": "running",
}

RUN_STATUSES = (
    "claimed",
    "running",
    "success",
    "partial",
    "failed",
    "blocked",
    "skipped",
)


def _by_day(rows: list[sqlite3.Row]) -> dict[str, dict[str, int]]:
    by_day: dict[str, dict[str, int]] = {}
    for row in rows:
        day = by_day.setdefault(row["day"], {"total": 0})
        day[row["status"]] = day.get(row["status"], 0) + row["count"]
        day["total"] += row["count"]
    return by_day


def _totals(rows: list[sqlite3.Row]) -> dict[str, int]:
    totals: dict[str, int] = {"total": 0}
    for row in rows:
        totals[row["status"]] = totals.get(row["status"], 0) + row["count"]
        totals["total"] += row["count"]
    return totals


class AutomationRepository:
    def __init__(self, conn: sqlite3.Connection | None = None):
        self.conn = conn or get_connection()

    def create(
        self,
        name: str,
        prompt: str,
        every_minutes: int,
        *,
        provider: str | None = None,
        model: str | None = None,
        enabled: bool = True,
        first_run: datetime | None = None,
        capability_profile: str | None = None,
        description: str | None = None,
        schedule_type: str = "interval",
        daily_at_time: str | None = None,
        weekly_day: int | None = None,
        timezone: str | None = None,
        notification: str = "app",
        template_id: str | None = None,
        actions: list[str] | None = None,
    ) -> Automation:
        clean_name = " ".join(name.split())
        clean_prompt = prompt.strip()
        if not clean_name:
            raise AutomationError("an automation needs a name")
        if not clean_prompt:
            raise AutomationError("an automation with no prompt has nothing to run")
        _validate_schedule(
            schedule_type,
            every_minutes=every_minutes,
            daily_at_time=daily_at_time,
            weekly_day=weekly_day,
            timezone=timezone,
        )
        if notification not in NOTIFICATIONS:
            raise AutomationError(f"unknown notification setting: {notification}")
        due = first_run or next_run_for(
            schedule_type=schedule_type,
            every_minutes=every_minutes,
            daily_at_time=daily_at_time,
            weekly_day=weekly_day,
            timezone=timezone,
        )
        cursor = self.conn.execute(
            "INSERT INTO automations (name, prompt, every_minutes, enabled, provider, model,"
            " next_run_at, capability_profile, description, schedule_type,"
            " daily_at_time, weekly_day, timezone, notification, template_id, actions)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                clean_name,
                clean_prompt,
                every_minutes,
                int(enabled),
                provider,
                model,
                _iso(due),
                capability_profile,
                description,
                schedule_type,
                daily_at_time,
                weekly_day,
                timezone,
                notification,
                template_id,
                encode_actions(actions),
            ),
        )
        self.conn.commit()
        return self.get(cursor.lastrowid)  # type: ignore[return-value]

    def get(self, automation_id: int) -> Automation | None:
        row = self.conn.execute(
            "SELECT * FROM automations WHERE id = ?", (automation_id,)
        ).fetchone()
        return Automation.from_row(row) if row else None

    def list(self) -> list[Automation]:
        return [
            Automation.from_row(r)
            for r in self.conn.execute("SELECT * FROM automations ORDER BY next_run_at")
        ]

    def due(self, moment: datetime | None = None) -> list[Automation]:
        return [
            Automation.from_row(r)
            for r in self.conn.execute(
                "SELECT * FROM automations WHERE enabled = 1 AND next_run_at <= ?"
                " ORDER BY next_run_at",
                (_iso(moment or _now()),),
            )
        ]

    def update(self, automation_id: int, **fields: Any) -> Automation | None:
        allowed = {
            "name",
            "prompt",
            "every_minutes",
            "enabled",
            "provider",
            "model",
            "capability_profile",
            "description",
            "schedule_type",
            "daily_at_time",
            "weekly_day",
            "timezone",
            "notification",
            "actions",
        }
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        current = self.get(automation_id)
        if current is None:
            return None
        if updates:
            _validate_schedule(
                updates.get("schedule_type", current.schedule_type),
                every_minutes=updates.get("every_minutes", current.every_minutes),
                daily_at_time=updates.get("daily_at_time", current.daily_at_time),
                weekly_day=updates.get("weekly_day", current.weekly_day),
                timezone=updates.get("timezone", current.timezone),
            )
        if "notification" in updates and updates["notification"] not in NOTIFICATIONS:
            raise AutomationError(f"unknown notification setting: {updates['notification']}")
        if "enabled" in updates:
            updates["enabled"] = int(updates["enabled"])
        if "weekly_day" in updates:
            updates["weekly_day"] = int(updates["weekly_day"])
        if "actions" in updates:
            updates["actions"] = encode_actions(updates["actions"])
        if not updates:
            return self.get(automation_id)
        assignments = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE automations SET {assignments} WHERE id = ?",
            (*updates.values(), automation_id),
        )
        # Anything that changes *when* it runs moves the next run, through the
        # same function `create` and `record` use.
        schedule_fields = {
            "every_minutes", "schedule_type", "daily_at_time", "weekly_day", "timezone",
        }
        if schedule_fields & set(updates) and (auto := self.get(automation_id)):
            self.conn.execute(
                "UPDATE automations SET next_run_at = ? WHERE id = ?",
                (
                    _iso(
                        next_run_for(
                            schedule_type=auto.schedule_type,
                            every_minutes=auto.every_minutes,
                            daily_at_time=auto.daily_at_time,
                            weekly_day=auto.weekly_day,
                            timezone=auto.timezone,
                        )
                    ),
                    automation_id,
                ),
            )
        self.conn.commit()
        return self.get(automation_id)

    def delete(self, automation_id: int) -> bool:
        cursor = self.conn.execute("DELETE FROM automations WHERE id = ?", (automation_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def mark_running(self, automation_id: int) -> None:
        self.conn.execute(
            "UPDATE automations SET last_status = 'running', last_run_at = ? WHERE id = ?",
            (_iso(_now()), automation_id),
        )
        self.conn.commit()

    def record(
        self,
        automation_id: int,
        *,
        status: str,
        summary: str,
        conversation_id: str | None,
        every_minutes: int,
        run_id: int | None = None,
    ) -> None:
        """Write the outcome and schedule the next run.

        Rescheduled from now rather than from the last due time on purpose: a
        server that was off for a day should not come back and fire twenty-four
        catch-up runs of an hourly automation.

        `status == "error"` backs the next run off geometrically, capped at
        `MAX_MINUTES` -- a permanently broken automation must not keep coming
        due every interval forever, spending a turn (and, on an unreliable
        provider, an announcement of failure) each time nobody reads the
        record. `"ok"` resets the count. `"blocked"` touches neither: an
        unattended turn correctly refusing to do something it was never
        approved for is not a failure to retry past, and backing it off would
        read as AMETHYST giving up on approval rather than waiting for it.
        """
        previous = self.conn.execute(
            "SELECT consecutive_failures FROM automations WHERE id = ?", (automation_id,)
        ).fetchone()
        failures = previous["consecutive_failures"] if previous else 0

        if status == "error":
            failures += 1
            delay = min(every_minutes * (2 ** min(failures, 6)), MAX_MINUTES)
            hours = delay / 60
            summary = (
                f"{summary[:360]} (failed {failures} time{'s' if failures != 1 else ''} in a"
                f" row, retrying in {hours:.1f}h)"
            )
        elif status == "ok":
            failures = 0
            delay = every_minutes
        else:
            # `blocked` and `partial`. Neither backs off and neither resets the
            # count. A refused permission is not a fault to retreat from, and a
            # run that produced its work but could not deliver it will deliver
            # it next time if the user reconnects the account -- pushing the
            # next run hours out would make that fix look like it had not
            # worked.
            delay = every_minutes

        # A wall-clock schedule goes to its next occurrence; an interval goes
        # `delay` from now, which is how the failure backoff gets applied. Both
        # through the one function that knows about timezones.
        auto = self.get(automation_id)
        next_run = next_run_for(
            schedule_type=auto.schedule_type if auto else "interval",
            every_minutes=delay,
            daily_at_time=auto.daily_at_time if auto else None,
            weekly_day=auto.weekly_day if auto else None,
            timezone=auto.timezone if auto else None,
        )

        self.conn.execute(
            "UPDATE automations SET last_status = ?, last_summary = ?,"
            " last_conversation_id = ?, last_run_at = ?, next_run_at = ?,"
            " consecutive_failures = ? WHERE id = ?",
            (
                status,
                summary[:400],
                conversation_id,
                _iso(_now()),
                _iso(next_run),
                failures,
                automation_id,
            ),
        )
        self.conn.commit()
        # The run row carries the same outcome in its own vocabulary. `blocked`
        # maps to `blocked` rather than to `skipped`: a turn that ran and was
        # refused permission is not a turn that never happened, and the two used
        # to be indistinguishable in the history.
        if run_id is not None:
            AutomationRunRepository(self.conn).complete(
                run_id,
                status=RUN_STATUS_OF.get(status, "failed"),
                result_summary=summary[:400],
                error=summary[:2000] if status in ("error", "partial") else None,
                conversation_id=conversation_id,
            )
        # Runs accumulated for as long as the automation was enabled, because
        # nothing ever removed one.
        from backend.db.repositories import ConversationRepository

        ConversationRepository(self.conn).prune_runs(str(automation_id), KEEP_RUNS)


#: What an automation may be *offered* the right to do, as
#: (tool name, label, group, integration). Deliberately a curated list rather
#: than "every registered tool":
#:
#: * `run_shell_command` and `delete_file` are not here. A checkbox that hands
#:   an unattended model a shell on this machine at 3am is not a permission
#:   control, it is a hole with a label on it. They remain reachable the hard
#:   way -- a standing "don't ask again" the user grants in a conversation,
#:   having seen the actual command -- which is a decision made with the
#:   evidence in front of them.
#: * Read-only tools (`search_web`, `list_calendar`, `list_upcoming`) are not
#:   here either, because they need no grant: the gate auto-allows LOW risk, so
#:   listing them would be a switch that changes nothing.
GRANTABLE_ACTIONS: tuple[tuple[str, str, str, str | None], ...] = (
    ("search_email", "Search mail", "Mail", "mail"),
    ("read_email", "Read a message", "Mail", "mail"),
    ("draft_email", "Save a draft", "Mail", "mail"),
    ("send_email", "Send mail", "Mail", "mail"),
    ("reply_email", "Reply in a thread", "Mail", "mail"),
    ("create_task", "Create a task", "Tasks", None),
    ("create_tasks", "Create several tasks", "Tasks", None),
    ("update_task", "Update a task", "Tasks", None),
    ("create_calendar_event", "Create a calendar event", "Calendar", None),
    ("create_document", "Write a document", "Documents", None),
    ("edit_document", "Edit a document", "Documents", None),
    ("write_file", "Write a file", "Files", None),
    ("log_library_item", "Add to the library", "Library", None),
)


def grantable_actions() -> list[dict[str, Any]]:
    """The grants an automation can be given, and whether each one can work.

    "Available" is asked of the integration, not assumed from the tool being
    registered. That is the difference the brief asks for: a Send mail switch
    on a machine where nobody has signed in has to say so in the editor,
    rather than turning into a `blocked` run at half past seven.
    """
    from backend.tools.builtin.mail import available as mail_available

    checks: dict[str, tuple[bool, str]] = {}
    out: list[dict[str, Any]] = []
    for name, label, group, integration in GRANTABLE_ACTIONS:
        available, detail = True, ""
        if integration == "mail":
            if integration not in checks:
                checks[integration] = mail_available()
            available, detail = checks[integration]
        out.append(
            {
                "name": name,
                "label": label,
                "group": group,
                "integration": integration,
                "available": available,
                # The sentence to show when it is not available. When it is,
                # this is the account -- worth showing, because "which mailbox"
                # is the next question anyone asks.
                "detail": detail,
            }
        )
    return out


def unavailable_actions(automation: Automation) -> list[dict[str, Any]]:
    """Grants this automation holds that cannot currently be used.

    What the row's warning is made of: the automation is configured to send
    mail and mail is not connected, so the next run will record the refusal.
    Better said now, on the page, than at 07:30.
    """
    granted = set(automation.actions)
    return [a for a in grantable_actions() if a["name"] in granted and not a["available"]]


class UnattendedGate:
    """The permission gate, with nobody at the keyboard.

    Standing approvals are checked before this is ever reached, so an automation
    can do anything the user has deliberately said may run without asking, and
    nothing else.

    It **denies** rather than raising. Raising looked right -- it carried the
    operation key straight out -- but the loop turns any exception into a failed
    turn, so a scheduled run that wanted one thing it could not have reported
    nothing but a stack-trace-shaped string and did none of the rest of its work.
    A denial is a thing the loop already knows how to handle: the model is told
    the call was refused and carries on, and what was refused is collected here
    so the automation can name it afterwards.
    """

    def __init__(self, allowed: Any = ()) -> None:
        #: Tool names this automation was granted, from `automations.actions`.
        #: A grant made in the dialog that created the automation, for that
        #: automation only -- unlike "don't ask again", which is machine-wide.
        #: That distinction is the reason this exists: sending mail on a
        #: schedule should not require handing every conversation on the
        #: machine a standing permission to send mail.
        self.allowed = {str(name) for name in (allowed or ())}
        self.refused: list[str] = []
        self.used: list[str] = []

    async def __call__(self, request) -> bool:
        key = request.operation_key
        if request.tool_name in self.allowed or key in self.allowed:
            if key not in self.used:
                self.used.append(key)
            return True
        if key not in self.refused:
            self.refused.append(key)
        return False


async def deliver(automation: Automation, answer: str) -> list[dict[str, Any]]:
    """Put the result where the automation says it goes, and report honestly.

    This is the half that did not exist. `notification` was stored, returned by
    the API and editable on screen, and read by nothing at all -- so an
    automation set to "Email + App" produced its briefing, recorded `ok`, and
    nobody was told anything. A run that says it emailed you now has a Gmail
    message id in its steps, or a reason it has not.

    Each delivery is one step with an `ok` flag. The caller turns a failed one
    into `partial`: the work happened, the handoff did not, and the run has to
    say which.
    """
    wanted = automation.notification or "app"
    if wanted == "off" or not answer.strip():
        return []

    steps: list[dict[str, Any]] = []

    if "app" in wanted:
        from backend.notify import notify

        shown = await notify(automation.name, " ".join(answer.split())[:240])
        steps.append(
            {
                "kind": "notify",
                "ok": bool(shown),
                "detail": "shown on this machine"
                if shown
                else "no notification daemon answered; nothing was shown",
            }
        )

    if "email" in wanted:
        from backend.mail import agentmail, gmail

        subject = f"{automation.name} — {datetime.now(_zone(automation.timezone)):%a %d %b}"
        try:
            if agentmail.configured():
                sent = await agentmail.send(answer, subject=subject)
                provider = "AgentMail"
                msg_id = sent.get("message_id")
            else:
                sent = await gmail.send(answer, subject=subject)
                provider = "Gmail"
                msg_id = sent.get("id")
        except Exception as exc:
            # Includes MailUnavailable, which carries the sentence naming what
            # is missing. Recorded as the step's detail so the run history says
            # "connect Gmail" rather than "failed".
            steps.append(
                {
                    "kind": "email",
                    "ok": False,
                    "detail": str(exc) or f"{type(exc).__name__}",
                }
            )
            log.warning("automation %s could not deliver by email: %s", automation.id, exc)
        else:
            steps.append(
                {
                    "kind": "email",
                    "ok": True,
                    "detail": f"sent to {sent['to']} via {provider}",
                    "message_id": msg_id,
                    "subject": sent["subject"],
                }
            )
    return steps


def tool_steps(conversation_id: str | None) -> list[dict[str, Any]]:
    """Which tools the turn actually called, from the audit rows it wrote.

    `execution_logs` already holds every dispatch -- name, arguments, outcome,
    the permission decision -- with secrets redacted on the way in. Reading it
    back is the whole run detail, so nothing here has to be recorded twice and
    the history cannot claim a call the dispatcher never made.
    """
    if not conversation_id:
        return []
    from backend.db.repositories import ExecutionLogRepository

    rows = ExecutionLogRepository().conn.execute(
        "SELECT tool_name, tool_source, error, risk_level, confirmation_decision,"
        " duration_ms, result_summary FROM execution_logs"
        " WHERE conversation_id = ? ORDER BY id",
        (conversation_id,),
    ).fetchall()
    return [
        {
            "kind": "tool",
            "name": row["tool_name"],
            "source": row["tool_source"],
            "ok": not row["error"],
            "detail": (row["error"] or row["result_summary"] or "")[:300],
            "risk": row["risk_level"],
            "decision": row["confirmation_decision"],
            "duration_ms": row["duration_ms"],
        }
        for row in rows
    ]


async def run_once(
    automation: Automation,
    *,
    director_for,
    repo: AutomationRepository | None = None,
    job: Any = None,
    store: Any = None,
    trigger: str = "scheduled",
    scheduled_for: str | None = None,
) -> dict[str, Any]:
    """Run one automation and record what happened.

    `director_for` is passed in rather than imported so this stays testable
    without a server: it takes the deny-everything confirmation callback and
    returns something with `.run(conversation_id, prompt)`.

    `job` and `store`, when given, are the durable job this run belongs to. They
    are optional because this function is also the one a test calls directly,
    and because the work does not depend on them -- they are what make the run
    survivable, not what makes it happen.

    `trigger` records whether this was 'scheduled' or 'manual' for audit trail.

    `scheduled_for` is the slot this run is for, and it is what makes running
    twice impossible: the row is claimed under a unique index before anything
    else happens, and a second caller for the same slot is told to go away.
    Manual runs pass none, because "run it now, again" is a thing a person is
    allowed to mean.
    """
    from backend.config import configured_providers
    from backend.db.repositories import ConversationRepository

    repo = repo or AutomationRepository()
    run_repo = AutomationRunRepository()

    # Claim first. Everything below costs a model call, so the decision about
    # whether this execution is ours is made before any of it -- and made by
    # the database, which is the only participant that sees both schedulers.
    run_record = run_repo.claim(
        automation.id, scheduled_for=scheduled_for, trigger=trigger
    )
    if run_record is None:
        log.info(
            "automation %s was already claimed for %s; skipping",
            automation.id,
            scheduled_for,
        )
        return {
            "status": "skipped",
            "summary": "another scheduler had already claimed this run",
            "claimed": False,
        }
    run_repo.begin(run_record.id)
    repo.mark_running(automation.id)

    # Only providers with a key. An automation runs with nobody watching, so
    # picking one that cannot answer costs a failed run every interval until
    # someone reads the record.
    providers = configured_providers()
    provider = automation.provider
    model = automation.model
    if not provider:
        if not providers:
            repo.record(
                automation.id,
                status="error",
                summary="no provider is configured in providers.yaml",
                conversation_id=None,
                every_minutes=automation.every_minutes,
                run_id=run_record.id,
            )
            return {
                "status": "error",
                "summary": "no provider is configured",
                "run_id": run_record.id,
            }
        # The user's own `default:` tier, when they have named one -- an
        # automation created with no provider should land on the same
        # provider a plain chat turn would, not on whichever one happens to
        # sort first (or, as this used to hardcode, whichever one happens to
        # be named "nvidia") while a configured default sits unused.
        from backend.config import load_tiers

        default_tier = load_tiers().get("default")
        if default_tier and default_tier.provider in providers:
            provider = default_tier.provider
        else:
            provider = sorted(providers)[0]

    # Outside the branch above on purpose: an automation created with a provider
    # but no model wrote the literal string "default" onto its conversation, and
    # the provider's own declared model is right there in providers.yaml.
    if not model and (chosen := providers.get(provider)) is not None:
        model = chosen.default_model

    # A step, so a second attempt writes into the transcript the first one
    # started rather than leaving a half-finished conversation behind and
    # opening another. The runs list is what a person reads to find out what an
    # automation did, and one attempt producing three entries made it useless.
    async def _open_conversation() -> str:
        return ConversationRepository().create(
            provider,
            model or "default",
            f"{automation.name} · automation",
            automation_id=automation.id,
        )

    if job is not None and store is not None:
        conversation_id = await store.step(job, "conversation", _open_conversation)
        # Written down before the turn starts, because it is what says where to
        # look for what the turn did. A job that dies mid-turn is only safe to
        # repeat if that transcript's tool calls were read-only, and this is how
        # `replayable_after_crash` finds them.
        store.checkpoint(job, conversation_id=conversation_id)
    else:
        conversation_id = await _open_conversation()

    # Scope this run's tools to the saved profile, if one is set, before the
    # director ever builds a schema list -- the same mechanism a human uses to
    # narrow a conversation's connectors (backend/capabilities.py), applied
    # directly rather than through the REST handler, which also disconnects
    # servers live on the shared MCP manager. An automation's own tool scope
    # must never do that to a connector another run or conversation is using.
    if automation.capability_profile:
        from backend.capabilities import CapabilityService

        try:
            CapabilityService().apply_profile(automation.capability_profile, conversation_id)
        except ValueError:
            summary = (
                f"its tool profile '{automation.capability_profile}' no longer exists --"
                " edit this automation and pick another, or clear its scope"
            )
            repo.record(
                automation.id,
                status="error",
                summary=summary,
                conversation_id=conversation_id,
                every_minutes=automation.every_minutes,
                run_id=run_record.id,
            )
            return {"status": "error", "summary": summary, "run_id": run_record.id}

    answer = ""
    status = "ok"
    summary = ""
    gate = UnattendedGate(automation.actions)
    try:
        director = director_for(gate)
        async with asyncio.timeout(RUN_TIMEOUT_SECONDS):
            async for event in director.run(conversation_id, automation.prompt):
                if event.type in ("assistant_delta", "assistant_text"):
                    answer += event.data.get("text", "")
                elif event.type == "error":
                    status, summary = "error", event.data.get("message", "failed")
                elif event.type == "guard":
                    status, summary = "error", event.data.get("reason", "stopped")
                elif event.type == "done":
                    answer = event.data.get("text", answer)
    except TimeoutError:
        status = "error"
        # Seconds, not minutes: the timeout is not a whole number of them, and
        # rounding it in the one sentence a person reads about a stopped run is
        # how "it ran for three minutes" gets argued with.
        summary = f"took longer than {RUN_TIMEOUT_SECONDS} seconds and was stopped"
    except Exception as exc:  # a broken automation must not stop the runner
        status = "error"
        summary = f"{type(exc).__name__}: {exc}"
        log.exception("automation %s failed", automation.id)

    # Anything refused outranks a clean finish: the turn completed, but not the
    # part that needed permission, and saying "ok" would be a lie by omission.
    # Naming the exact operations is the whole value -- the fix is to approve
    # those, once, rather than to give scheduled work a blanket exemption.
    if gate.refused and status != "error":
        status = "blocked"
        summary = (
            f"needs permission for {', '.join(gate.refused)}. Add"
            f" {'it' if len(gate.refused) == 1 else 'them'} under Actions on this"
            " automation, or approve it once in a conversation with"
            " \u201cdon\u2019t ask again\u201d."
        )
    elif status == "ok" and not summary:
        summary = " ".join(answer.split())[:400] or "ran, and said nothing"

    # What the turn did, before delivery adds to it. Read from the dispatcher's
    # own audit rows rather than tracked here, so the history cannot disagree
    # with what ran.
    steps = tool_steps(conversation_id)
    for refused in gate.refused:
        steps.append(
            {
                "kind": "refused",
                "name": refused,
                "ok": False,
                "detail": "not granted to this automation",
            }
        )

    # Deliver only what succeeded. A failed turn has nothing to send, and
    # emailing a stack trace at half past seven is not a notification.
    if status == "ok":
        try:
            delivery = await deliver(automation, answer)
        except Exception as exc:  # delivery must not lose the run
            log.exception("automation %s delivery failed", automation.id)
            delivery = [{"kind": "delivery", "ok": False, "detail": f"{type(exc).__name__}: {exc}"}]
        steps.extend(delivery)
        # The one place a run stops being able to claim success it did not
        # have: it produced the work and could not hand it over.
        undelivered = [d for d in delivery if not d.get("ok")]
        if undelivered and any(d.get("kind") == "email" for d in undelivered):
            status = "partial"
            summary = f"ran, but the email did not go out: {undelivered[0].get('detail')}"

    run_repo.conn.execute(
        "UPDATE automation_runs SET steps = ? WHERE id = ?",
        (json.dumps(steps)[:20_000], run_record.id),
    )
    run_repo.conn.commit()

    repo.record(
        automation.id,
        status=status,
        summary=summary,
        conversation_id=conversation_id,
        every_minutes=automation.every_minutes,
        run_id=run_record.id,
    )
    return {
        "status": status,
        "summary": summary,
        "conversation_id": conversation_id,
        "run_id": run_record.id,
        "steps": steps,
    }


#: The prefix every job about one automation shares. `live_for` uses it to find
#: a run already in flight, which is what "reconnect rather than start a second"
#: is made of.
JOB_KIND = "automation"


def job_prefix(automation_id: int) -> str:
    return f"{JOB_KIND}:{automation_id}:"


def enqueue_run(automation: Automation, *, manual: bool = False) -> Any:
    """Put one run on the board, or hand back the one already there.

    The key is the automation and the slot it is running for, so the scheduler
    coming round twice while a run is still going -- a tick that overlapped a
    long turn, a restart that re-read the same due row -- produces one job rather
    than two. `manual` stamps the moment instead, so pressing Run now after a
    finished run really does run it again while a double-click does not.
    """
    from backend.jobs import JobStore, enqueue

    store = JobStore()
    live = store.live_for(job_prefix(automation.id))
    if live is not None:
        # Already queued, running, waiting or paused. Whatever the caller wanted
        # is what this job is doing.
        return live
    slot = _iso(_now()) if manual else automation.next_run_at
    return enqueue(
        JOB_KIND,
        f"{job_prefix(automation.id)}{'manual:' if manual else ''}{slot}",
        payload={
            "automation_id": automation.id,
            "manual": manual,
            # The slot travels with the job so the run claims the same one the
            # scheduler decided was due, not whatever `next_run_at` says by the
            # time the lane gets round to it -- which, for a job that waited
            # behind another run, has already moved.
            "scheduled_for": None if manual else slot,
        },
        store=store,
    )


async def run_job(job, store, *, director_for) -> dict[str, Any]:
    """Run the automation this job names.

    The job is the durable half and `run_once` is the work, unchanged: the
    scheduler's path and the "run now" path were already the same one, and this
    keeps them the same one.

    A run that a previous attempt had already got partway through does not
    resume mid-turn -- a turn is not resumable, and the loop that owns it says
    so. What the job adds is that the attempt is *recorded* before it starts, so
    a crash leaves a row that can be looked at rather than a row still claiming
    to be running, and that the decision about whether to repeat it is made
    against the audit trail rather than taken silently.
    """
    from backend.jobs import Unretryable

    automation = AutomationRepository().get(job.payload.get("automation_id"))
    if automation is None:
        raise Unretryable("this automation no longer exists")
    if not automation.enabled and not job.payload.get("manual"):
        raise Unretryable("this automation was switched off before its run started")

    manual = bool(job.payload.get("manual"))
    outcome = await run_once(
        automation,
        director_for=director_for,
        job=job,
        store=store,
        trigger="manual" if manual else "scheduled",
        scheduled_for=job.payload.get("scheduled_for"),
    )
    if outcome.get("status") == "skipped" and outcome.get("claimed") is False:
        # Somebody else has this slot. Not an error: the work is happening, it
        # is simply not happening here.
        return outcome
    if outcome.get("status") == "error":
        # A failed run is a failed job, so the lane's bounded backoff applies to
        # a provider having a bad minute. The automation's own geometric backoff
        # is a different clock for a different thing -- how often to try the
        # *schedule* again -- and `record` has already set it.
        raise RuntimeError(outcome.get("summary") or "the run failed")
    return outcome


def enqueue_due(*, moment: datetime | None = None) -> list[dict[str, Any]]:
    """Put every due automation on the board. The scheduler's entire job.

    One function, two callers: the in-process tick, and the tick GitHub Actions
    asks for over HTTP. They had to be the same code -- the external scheduler
    that existed before this ran its own loop, against its own copy of the
    automations in a JSON file, with its own idea of what "due" meant, and the
    two answers disagreed about timezones and about how often.
    """
    at = moment or _now()
    repo = AutomationRepository()
    started: list[dict[str, Any]] = []
    for automation in repo.due(at):
        # Re-read: it may have been switched off, or already put on the board
        # by "run now", since `due` was evaluated.
        fresh = repo.get(automation.id)
        if fresh is None or not fresh.enabled:
            continue
        if parse_iso(fresh.next_run_at) > at:
            continue
        job = enqueue_run(fresh)
        log.info("automation %s (%s) is due; job %s", fresh.id, fresh.name, job.id)
        started.append(
            {
                "automation_id": fresh.id,
                "name": fresh.name,
                "scheduled_for": fresh.next_run_at,
                "job_id": job.id,
                "state": job.state,
            }
        )
    return started


class AutomationRunner:
    """Wakes every ten seconds and puts whatever is due on the board.

    It stopped being the thing that runs them. Deciding what is due is a
    schedule question and stays here; running it is a durable job, because a run
    is minutes long with nobody watching and a crash used to take it with no
    record that it had ever started. See `backend/jobs/`.

    One at a time is still true and is now the lane's doing rather than a lock's:
    three automations due in the same minute are three jobs in one lane, and a
    lane runs one job at a time.
    """

    def __init__(self, director_for):
        self.director_for = director_for
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        #: Nudged when something is enqueued, so a run starts in the same second
        #: it came due rather than on the lane's next tick.
        self.lane = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    def run_now(self, automation: Automation) -> Any:
        """Run it this second, whatever its schedule says.

        `next_run_at` is deliberately not consulted: the interval floor governs
        how often AMETHYST starts a run by itself, and a person pressing the
        button has already decided.

        It returns the job rather than the run. The endpoint used to block for
        as long as the turn took -- up to three minutes -- so the browser held an
        open request through the whole thing and a proxy timing out looked like a
        failure while the run carried on. Now the button gets an id back and the
        page follows it, which is also what makes a reload reconnect to the run
        instead of starting a second one.
        """
        job = enqueue_run(automation, manual=True)
        if self.lane is not None:
            self.lane.nudge()
        return job

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(TICK_SECONDS)
                if enqueue_due() and self.lane is not None:
                    self.lane.nudge()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("automation tick failed")
