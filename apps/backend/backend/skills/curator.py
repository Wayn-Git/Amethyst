"""Keeping the skill catalog small, deterministically.

A skill library only stays useful while every entry is one the model might
actually use. Left alone it grows: the agent writes a procedure, the situation
never comes up again, and the description sits in every system prompt for a year
costing attention it never earns back.

This module makes the three-state judgement -- active, stale, archived -- from
recorded facts only: how long since the skill was last used or edited, whether
the agent created it, whether a person pinned or locked it, and whether an
automation names it. There is no model in the loop. A curator that asks an LLM
which skills to delete will eventually delete one that mattered, cannot be
tested, and cannot explain its reasoning; a rule that says "unused for 30 days"
can do all three.

The rules, in order. A skill is skipped entirely when:

- a person pinned it (the whole point of pinning),
- a person locked it (locked means "do not edit", and archival is an edit),
- it carries `.seeded`, so it is a shipped builtin and not the agent's to retire,
- `created_by` is not ``agent`` in the usage sidecar -- a user-installed skill
  with no recorded history is not evidence of disuse,
- it is younger than `GRACE_DAYS`, because a new skill has not had a chance,
- an enabled automation's prompt names it, because deleting it breaks that run.

Otherwise: unused for `STALE_AFTER_DAYS` moves it to ``stale``, and unused for
`ARCHIVE_AFTER_DAYS` moves it to ``archived`` and moves the directory into
`skills/.archive/`. Archiving is reversible and the report says where the copy
went, so the recovery path is a link in a Markdown file rather than a guess.

"Unused" is measured from `last_activity_at`, which both `use_count` and
`patch_count` bump. A skill the agent keeps improving is live even if no turn
has invoked it, which is the right reading: the edits are the evidence somebody
still cares.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from backend.config import paths
from backend.skills import manage
from backend.skills import usage as skill_usage
from backend.skills.loader import SEED_MARKER, scan

log = logging.getLogger(__name__)

#: Unused for this long: mark `stale`. Visible in the catalog and in Settings,
#: but still loaded, because two weeks is a guess about relevance and a wrong
#: guess should cost nothing.
STALE_AFTER_DAYS = 14

#: Unused for this long: archive. Still reversible, which is what makes the
#: threshold allowed to be this aggressive.
ARCHIVE_AFTER_DAYS = 30

#: Never judge a skill younger than this. A procedure written yesterday has no
#: usage history to judge it by, and "never used" means "has not come up yet".
GRACE_DAYS = 7

#: The job kind and its lane.
JOB_KIND = "skills_curator"

#: Run at most once a day. The job is cheap, but a pass that moves files is not
#: something to repeat on every tick of a lane.
INTERVAL_HOURS = 24


def _now() -> datetime:
    return datetime.now(UTC)


def _parse(stamp: str | None) -> datetime | None:
    if not stamp:
        return None
    try:
        parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _state_path() -> Path:
    return paths().logs_dir / "curator" / "state.json"


def _last_run() -> datetime | None:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return _parse(data.get("last_run_at")) if isinstance(data, dict) else None


def _record_run(moment: datetime, report_path: Path) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"last_run_at": moment.isoformat(timespec="seconds"), "report": str(report_path)}
    from backend.config import write_atomic

    write_atomic(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def should_run(now: datetime | None = None) -> bool:
    """Whether a pass is due. Daily, from the last pass's own record."""
    moment = now or _now()
    last = _last_run()
    if last is None:
        return True
    return moment - last >= timedelta(hours=INTERVAL_HOURS)


def _automation_text() -> str:
    """Every enabled automation's prompt, lowercased, as one haystack.

    Read through the repository rather than by opening the database here, so
    this module keeps the rule that only repositories issue SQL. A missing
    database is not an error: there are simply no automations to protect.
    """
    try:
        from backend.automation import AutomationRepository

        parts = [a.prompt or "" for a in AutomationRepository().list() if getattr(a, "enabled", 1)]
    except Exception as exc:
        log.debug("curator could not read automations: %s", exc)
        return ""
    return "\n".join(parts).lower()


def _referenced(name: str, haystack: str) -> bool:
    """Is this skill named in an automation prompt?

    Matched as a whole token so `weekly-review` does not match `weekly-review-old`
    and a common word does not keep an unrelated skill alive by accident. Hyphens
    and spaces are equivalent: a prompt says "weekly review" and the skill is
    `weekly-review`.
    """
    if not haystack or not name:
        return False
    pattern = re.escape(name).replace(r"\-", "[- ]")
    return re.search(rf"(?<![\w-]){pattern}(?![\w-])", haystack, re.IGNORECASE) is not None


def _plan_for(
    name: str,
    directory: Path,
    entry: dict[str, Any],
    now: datetime,
    automations: str,
) -> tuple[str, str] | None:
    """The decision for one skill, or None to leave it alone.

    Returns ``(action, reason)`` where action is ``stale``, ``archive`` or
    ``reactivate``. ``reactivate`` exists because a stale skill that is used
    again should stop being stale; the usage sidecar is otherwise only ever
    moved forward, and a stale badge that survives a fresh read is a wrong badge.
    """
    created_by = str(entry.get("created_by") or "")
    if bool(entry.get("pinned")):
        return None
    if bool(entry.get("locked")):
        return None
    if (directory / SEED_MARKER).exists():
        return None
    if created_by != "agent":
        return None
    if _referenced(name, automations):
        return None

    created_at = _parse(entry.get("created_at"))
    activity_at = _parse(entry.get("last_activity_at")) or created_at
    if activity_at is None:
        return None
    age = now - created_at if created_at else now - activity_at
    if age < timedelta(days=GRACE_DAYS):
        return None

    idle = now - activity_at
    state = str(entry.get("state") or skill_usage.ACTIVE)

    if idle >= timedelta(days=ARCHIVE_AFTER_DAYS):
        if state == skill_usage.ARCHIVED:
            return None
        # Files not on disk are not ours to move again; the sidecar may be
        # ahead of reality after a manual removal.
        if not (directory / "SKILL.md").is_file():
            return None
        return "archive", f"unused for {idle.days} days"
    if idle >= timedelta(days=STALE_AFTER_DAYS):
        if state != skill_usage.ACTIVE:
            return None
        return "stale", f"unused for {idle.days} days"
    if state == skill_usage.STALE:
        return "reactivate", "used within the stale window"
    return None


def _render_report(report: dict[str, Any]) -> str:
    lines = [
        "# Skill curation report",
        "",
        f"- Run: {report['started_at']}",
        f"- Scanned: {report['scanned']} skill(s)",
        f"- Stale: {len(report['stale'])}",
        f"- Archived: {len(report['archived'])}",
        f"- Reactivated: {len(report['reactivated'])}",
        f"- Skipped: {len(report['skipped'])}",
        "",
    ]
    if report["stale"]:
        lines += ["## Marked stale", ""]
        lines += [f"- `{item['name']}` — {item['reason']}" for item in report["stale"]]
        lines.append("")
    if report["archived"]:
        lines += ["## Archived", ""]
        lines += [
            f"- `{item['name']}` — {item['reason']}; copy at `{item['path']}`"
            for item in report["archived"]
        ]
        lines += [
            "",
            "Restore any of these from Capabilities → Skills, or run",
            "`skill_manage` with `action: restore` and the skill's name.",
            "",
        ]
    if report["reactivated"]:
        lines += ["## Reactivated", ""]
        lines += [f"- `{item['name']}` — {item['reason']}" for item in report["reactivated"]]
        lines.append("")
    if report["skipped"]:
        lines += ["## Left alone", ""]
        lines += [f"- `{item['name']}` — {item['reason']}" for item in report["skipped"]]
        lines.append("")
    if report["errors"]:
        lines += ["## Errors", ""]
        lines += [f"- `{item['name']}` — {item['error']}" for item in report["errors"]]
        lines.append("")
    return "\n".join(lines)


def _skip_reason(name: str, directory: Path, entry: dict[str, Any]) -> str:
    if not entry:
        return "no usage record"
    if entry.get("pinned"):
        return "pinned"
    if entry.get("locked"):
        return "locked"
    if (directory / SEED_MARKER).exists():
        return "shipped builtin"
    if str(entry.get("created_by") or "") != "agent":
        return "not created by the agent"
    return "within the grace period"


def run(
    *,
    now: datetime | None = None,
    force: bool = False,
    skills_dir: Path | None = None,
) -> dict[str, Any]:
    """One curation pass. Writes a JSON and a Markdown report, returns the JSON.

    ``force`` skips the daily gate, for the button in Settings and for tests.
    ``skills_dir`` exists for the same reason every other skill function takes
    it: a test gets its own directory and never touches the user's library.
    """
    moment = now or _now()
    root = (skills_dir or paths().skills_dir)
    if not force and not should_run(moment):
        return {"skipped": "not due", "started_at": moment.isoformat(timespec="seconds")}

    skills, load_errors = scan(root if skills_dir is not None else None)
    entries = skill_usage.load(root)
    automations = _automation_text()

    report: dict[str, Any] = {
        "started_at": moment.isoformat(timespec="seconds"),
        "scanned": len(skills),
        "stale": [],
        "archived": [],
        "reactivated": [],
        "skipped": [],
        "errors": [
            {"name": error.path.name, "error": error.error} for error in load_errors
        ],
    }

    for skill in skills:
        name = skill.name
        directory = skill.path.parent
        # `entry()` rather than `get()`: a skill with no record must stay
        # unknown, because `get()` invents a fresh `created_at` of today and
        # would hide a long-unused skill behind a permanent grace period.
        entry = skill_usage.entry(name, root)
        decision = _plan_for(name, directory, entry, moment, automations)
        if decision is None:
            report["skipped"].append({"name": name, "reason": _skip_reason(name, directory, entry)})
            continue
        action, reason = decision
        try:
            if action == "stale":
                skill_usage.mark(name, state=skill_usage.STALE, skills_dir=root)
                report["stale"].append({"name": name, "reason": reason})
            elif action == "archive":
                destination = manage.archive(name, reason=f"curator: {reason}", skills_dir=root)
                skill_usage.mark(name, state=skill_usage.ARCHIVED, skills_dir=root)
                report["archived"].append(
                    {"name": name, "reason": reason, "path": str(destination)}
                )
            elif action == "reactivate":
                skill_usage.mark(name, state=skill_usage.ACTIVE, skills_dir=root)
                report["reactivated"].append({"name": name, "reason": reason})
        except Exception as exc:  # one bad skill must not end the pass
            log.warning("curator could not %s skill %s: %s", action, name, exc)
            report["errors"].append({"name": name, "error": str(exc)})

    stamp = moment.strftime("%Y%m%dT%H%M%SZ")
    out_dir = paths().logs_dir / "curator" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "run.json"
    from backend.config import write_atomic

    write_atomic(json_path, json.dumps(report, indent=2, sort_keys=True) + "\n")
    write_atomic(out_dir / "REPORT.md", _render_report(report))

    _record_run(moment, json_path)
    log.info(
        "skill curation: %s scanned, %s stale, %s archived",
        report["scanned"], len(report["stale"]), len(report["archived"]),
    )
    report["report_path"] = str(out_dir / "REPORT.md")
    return report


def latest_report() -> dict[str, Any] | None:
    """The newest pass on disk, for the Settings panel. None before the first."""
    root = paths().logs_dir / "curator"
    if not root.is_dir():
        return None
    for child in sorted(root.iterdir(), reverse=True):
        if not child.is_dir():
            continue
        candidate = child / "run.json"
        if not candidate.is_file():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            data["report_path"] = str(child / "REPORT.md")
            return data
    return None
