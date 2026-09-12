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
import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

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
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "every_minutes": self.every_minutes,
            "enabled": self.enabled,
            "provider": self.provider,
            "model": self.model,
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
    ) -> Automation:
        clean_name = " ".join(name.split())
        clean_prompt = prompt.strip()
        if not clean_name:
            raise AutomationError("an automation needs a name")
        if not clean_prompt:
            raise AutomationError("an automation with no prompt has nothing to run")
        if not MIN_MINUTES <= every_minutes <= MAX_MINUTES:
            raise AutomationError(
                f"the interval must be between {MIN_MINUTES} minute"
                f"{'' if MIN_MINUTES == 1 else 's'} and 30 days"
            )
        # Scheduled forward by default: creating one must not fire it that
        # second, which is how a mistyped prompt runs before it is re-read.
        due = first_run or (_now() + timedelta(minutes=every_minutes))
        cursor = self.conn.execute(
            "INSERT INTO automations (name, prompt, every_minutes, enabled, provider, model,"
            " next_run_at, capability_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                clean_name,
                clean_prompt,
                every_minutes,
                int(enabled),
                provider,
                model,
                _iso(due),
                capability_profile,
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
        }
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if "every_minutes" in updates and not (
            MIN_MINUTES <= updates["every_minutes"] <= MAX_MINUTES
        ):
            raise AutomationError(
                f"the interval must be between {MIN_MINUTES} minute"
                f"{'' if MIN_MINUTES == 1 else 's'} and 30 days"
            )
        if "enabled" in updates:
            updates["enabled"] = int(updates["enabled"])
        if not updates:
            return self.get(automation_id)
        assignments = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE automations SET {assignments} WHERE id = ?",
            (*updates.values(), automation_id),
        )
        # A changed interval moves the next run, or an automation switched from
        # daily to hourly waits out the rest of the day it was already given.
        if "every_minutes" in updates:
            self.conn.execute(
                "UPDATE automations SET next_run_at = ? WHERE id = ?",
                (_iso(_now() + timedelta(minutes=updates["every_minutes"])), automation_id),
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
        else:  # blocked
            delay = every_minutes

        self.conn.execute(
            "UPDATE automations SET last_status = ?, last_summary = ?,"
            " last_conversation_id = ?, last_run_at = ?, next_run_at = ?,"
            " consecutive_failures = ? WHERE id = ?",
            (
                status,
                summary[:400],
                conversation_id,
                _iso(_now()),
                _iso(_now() + timedelta(minutes=delay)),
                failures,
                automation_id,
            ),
        )
        self.conn.commit()
        # Runs accumulated for as long as the automation was enabled, because
        # nothing ever removed one.
        from backend.db.repositories import ConversationRepository

        ConversationRepository(self.conn).prune_runs(str(automation_id), KEEP_RUNS)


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

    def __init__(self) -> None:
        self.refused: list[str] = []

    async def __call__(self, request) -> bool:
        if request.operation_key not in self.refused:
            self.refused.append(request.operation_key)
        return False


async def run_once(
    automation: Automation,
    *,
    director_for,
    repo: AutomationRepository | None = None,
    job: Any = None,
    store: Any = None,
) -> dict[str, Any]:
    """Run one automation and record what happened.

    `director_for` is passed in rather than imported so this stays testable
    without a server: it takes the deny-everything confirmation callback and
    returns something with `.run(conversation_id, prompt)`.

    `job` and `store`, when given, are the durable job this run belongs to. They
    are optional because this function is also the one a test calls directly,
    and because the work does not depend on them -- they are what makes the run
    survivable, not what makes it happen.
    """
    from backend.config import configured_providers
    from backend.db.repositories import ConversationRepository

    repo = repo or AutomationRepository()
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
            )
            return {"status": "error", "summary": "no provider is configured"}
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
            )
            return {"status": "error", "summary": summary}

    answer = ""
    status = "ok"
    summary = ""
    gate = UnattendedGate()
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
            f"needs permission for {', '.join(gate.refused)}. Approve each once from a"
            " conversation with \u201cdon\u2019t ask again\u201d and this will run unattended."
        )
    elif status == "ok" and not summary:
        summary = " ".join(answer.split())[:400] or "ran, and said nothing"

    repo.record(
        automation.id,
        status=status,
        summary=summary,
        conversation_id=conversation_id,
        every_minutes=automation.every_minutes,
    )
    return {"status": status, "summary": summary, "conversation_id": conversation_id}


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
        payload={"automation_id": automation.id, "manual": manual},
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

    outcome = await run_once(automation, director_for=director_for, job=job, store=store)
    if outcome.get("status") == "error":
        # A failed run is a failed job, so the lane's bounded backoff applies to
        # a provider having a bad minute. The automation's own geometric backoff
        # is a different clock for a different thing -- how often to try the
        # *schedule* again -- and `record` has already set it.
        raise RuntimeError(outcome.get("summary") or "the run failed")
    return outcome


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
                for automation in AutomationRepository().due():
                    # Re-read: it may have been switched off, or already put on
                    # the board by "run now", since `due` was evaluated.
                    fresh = AutomationRepository().get(automation.id)
                    if fresh is None or not fresh.enabled:
                        continue
                    if parse_iso(fresh.next_run_at) > _now():
                        continue
                    job = enqueue_run(fresh)
                    log.info(
                        "automation %s (%s) is due; job %s", fresh.id, fresh.name, job.id
                    )
                    if self.lane is not None:
                        self.lane.nudge()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad tick must not end the runner
                log.exception("automation tick failed")
