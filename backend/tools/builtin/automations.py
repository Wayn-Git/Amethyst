"""Automation management from chat: the bot maintains its own schedules.

Before this existed, every change went through the Automations page: the
person asked in chat, got "done", and nothing changed. One tool call now
answers "what do I have scheduled", and the create/pause/resume/delete
operations apply through the same repository the page uses -- there is no
second code path to drift.

Writes confirm (MEDIUM risk), keyed per operation, so a "don't ask again" on
create never covers delete.
"""

from __future__ import annotations

import json
from typing import Any

from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

OPERATIONS = (
    "list",
    "runs",
    "create",
    "update",
    "pause",
    "resume",
    "delete",
    "run_now",
)


def _schedule_summary(automation) -> str:
    if automation.schedule_type == "daily_at":
        base = f"daily at {automation.daily_at_time}"
    elif automation.schedule_type == "weekly_at":
        days = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        day = days[automation.weekly_day] if automation.weekly_day is not None else "?"
        base = f"{day} at {automation.daily_at_time}"
    else:
        base = f"every {automation.every_minutes} min"
    if automation.timezone:
        base += f" ({automation.timezone})"
    return base


def _one_line(automation) -> str:
    parts = [
        f"#{automation.id}",
        f'"{automation.name}"',
        _schedule_summary(automation),
        "next" + " " + (automation.next_run_at or "?"),
        f"{'active' if automation.enabled else 'paused'}",
        f"last {automation.last_status or 'never run'}",
    ]
    if automation.description:
        parts.append(automation.description)
    return " — ".join(parts)


def _apply_schedule(args: dict[str, Any]) -> dict[str, Any]:
    """Map the tool's `schedule` object onto repository field names."""
    schedule = args.get("schedule") or {}
    if not isinstance(schedule, dict):
        raise ValueError("schedule must be an object")
    out: dict[str, Any] = {}
    kind = schedule.get("type")
    if kind:
        if kind == "daily":
            out["schedule_type"] = "daily_at"
            out["daily_at_time"] = schedule.get("time")
            out["every_minutes"] = 1440
        elif kind == "weekly":
            out["schedule_type"] = "weekly_at"
            out["daily_at_time"] = schedule.get("time")
            out["weekly_day"] = schedule.get("weekday")
            out["every_minutes"] = 1440 * 7
        elif kind == "interval":
            out["schedule_type"] = "interval"
            out["every_minutes"] = schedule.get("every_minutes")
        else:
            raise ValueError(
                f"unknown schedule type '{kind}': use interval, daily or weekly"
            )
    for key in ("every_minutes", "timezone", "daily_at_time", "weekly_day"):
        if key in schedule and schedule[key] is not None:
            out[key] = schedule[key]
    return out


async def _handle(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    from backend.automation import (
        AutomationError,
        AutomationRepository,
        AutomationRunRepository,
    )
    from backend.runtime.registry import is_known_provider

    operation = args.get("operation", "")
    repo = AutomationRepository()

    if operation == "list":
        rows = repo.list()
        if not rows:
            return ToolResult.ok("No automations are scheduled.")
        return ToolResult.ok("\n".join(_one_line(a) for a in rows))

    if operation == "runs":
        automation_id = args.get("automation_id")
        if automation_id is not None and repo.get(automation_id) is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        runs = (
            AutomationRunRepository().runs_of(automation_id, limit=int(args.get("limit", 10)))
            if automation_id is not None
            else AutomationRunRepository().recent_runs(limit=int(args.get("limit", 10)))
        )
        if not runs:
            return ToolResult.ok("No runs recorded yet.")
        lines = []
        for run in runs:
            outcome = run.result_summary or run.error or "(no details)"
            lines.append(
                f"#{run.id} {run.created_at} {run.trigger} {run.status}: {outcome[:120]}"
            )
        return ToolResult.ok("\n".join(lines))

    if operation == "create":
        name = str(args.get("name", "")).strip()
        prompt = str(args.get("instructions", "")).strip()
        if not name or not prompt:
            return ToolResult.error("create needs both name and instructions")
        fields = _apply_schedule(args)
        every = fields.get("every_minutes", 60)
        try:
            automation = repo.create(
                name,
                prompt,
                every,
                provider=args.get("provider"),
                model=args.get("model"),
                enabled=bool(args.get("enabled", True)),
                description=args.get("description"),
                schedule_type=fields.get("schedule_type", "interval"),
                daily_at_time=fields.get("daily_at_time"),
                weekly_day=fields.get("weekly_day"),
                timezone=fields.get("timezone"),
                remember_before=bool(args.get("remember_before", False)),
                results_to=args.get("results_to") or "new",
                actions=args.get("actions"),
            )
        except AutomationError as exc:
            return ToolResult.error(str(exc))
        destination = (
            "a dedicated thread"
            if automation.results_to == "dedicated"
            else "a new thread each run"
        )
        return ToolResult.ok(
            f"Created #{automation.id} \"{automation.name}\" — "
            f"{_schedule_summary(automation)}, next run {automation.next_run_at}, "
            f"reports into {destination}."
        )

    if operation == "update":
        automation_id = args.get("automation_id")
        if args.get("provider") is not None and not is_known_provider(args["provider"]):
            return ToolResult.error(f"provider '{args['provider']}' is not configured")
        if repo.get(automation_id) is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        fields: dict[str, Any] = {}
        for src, key in (
            ("name", "name"),
            ("instructions", "prompt"),
            ("provider", "provider"),
            ("model", "model"),
            ("description", "description"),
        ):
            if args.get(src) is not None:
                fields[key] = args[src]
        fields.update(_apply_schedule(args))
        if args.get("enabled") is not None:
            fields["enabled"] = bool(args["enabled"])
        if args.get("remember_before") is not None:
            fields["remember_before"] = bool(args["remember_before"])
        if args.get("results_to") is not None:
            fields["results_to"] = args["results_to"]
        if not fields:
            return ToolResult.error("update needs something to change")
        try:
            updated = repo.update(automation_id, **fields)
        except AutomationError as exc:
            return ToolResult.error(str(exc))
        if updated is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        return ToolResult.ok(
            f"Updated #{updated.id} \"{updated.name}\" — {_schedule_summary(updated)},"
            f" {'active' if updated.enabled else 'paused'}."
        )

    if operation in ("pause", "resume"):
        automation_id = args.get("automation_id")
        if repo.get(automation_id) is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        updated = repo.update(automation_id, enabled=(operation == "resume"))
        if updated is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        return ToolResult.ok(
            f"#{updated.id} \"{updated.name}\" is now"
            + (
                f" active, next run {updated.next_run_at or '?'}."
                if updated.enabled
                else " paused."
            )
        )

    if operation == "delete":
        automation_id = args.get("automation_id")
        automation = repo.get(automation_id)
        if automation is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        repo.delete(automation_id)
        return ToolResult.ok(
            f"Deleted #{automation.id} \"{automation.name}\". Its past reports are kept in"
            " their conversations."
        )

    if operation == "run_now":
        automation_id = args.get("automation_id")
        automation = repo.get(automation_id)
        if automation is None:
            return ToolResult.error(f"no such automation: #{automation_id}")
        from backend.automation import enqueue_run

        job = enqueue_run(repo.get(automation_id), manual=True)
        destination = (
            "the dedicated thread"
            if automation.results_to == "dedicated"
            else "a new thread"
        )
        return ToolResult.ok(
            f"Running #{automation.id} \"{automation.name}\" now — job {job.id}"
            f" is {job.state}. Its report lands in {destination}."
        )

    return ToolResult.error(
        f"unknown operation '{operation}': use one of {', '.join(OPERATIONS)}"
    )


def tools() -> list[Tool]:
    schedule_desc = json.dumps(
        {
            "type": "interval | daily | weekly",
            "every_minutes": 60,
            "time": "07:30",
            "weekday": 0,
            "timezone": "Europe/Berlin",
        }
    )
    return [
        Tool(
            name="automations",
            description=(
                "Create, inspect and manage scheduled automations from chat. One tool"
                " for the whole lifecycle: `list` what is scheduled, `runs` of one"
                " (or all) automations, `create` a new one, `update` it, `pause`,"
                " `resume`, `delete`, `run_now`.\n\n"
                "Schedules are one of: interval (minutes), daily at a time"
                " ('07:30'), weekly on a weekday (0=Monday..6=Sunday) at a time."
                f" Pass them as a schedule object like {schedule_desc}. A timezone"
                " name (IANA, e.g. America/New_York) is optional; omit it for the"
                " machine's own.\n\n"
                "Every operation is verified against the same store the Automations"
                " page reads: report what changed using the result, and never claim"
                " a change landed before the result says it did. Create and update"
                " confirm with the person first."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": list(OPERATIONS),
                        "description": "What to do",
                    },
                    "automation_id": {
                        "type": "integer",
                        "description": (
                            "Which automation (required for every operation but"
                            " list/create/runs)"
                        ),
                    },
                    "name": {"type": "string", "description": "Short name (create/update)"},
                    "instructions": {
                        "type": "string",
                        "description": (
                            "The prompt a run executes unattended (create/update)."
                            " Must be self-contained: it cannot ask questions or"
                            " request approval."
                        ),
                    },
                    "schedule": {
                        "type": "object",
                        "description": "When it runs",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["interval", "daily", "weekly"],
                            },
                            "every_minutes": {"type": "integer"},
                            "time": {"type": "string"},
                            "weekday": {"type": "integer", "minimum": 0, "maximum": 6},
                            "timezone": {"type": "string"},
                        },
                    },
                    "remember_before": {
                        "type": "boolean",
                        "description": (
                            "Carry the previous run's answer into the next run"
                            " as read-only context"
                        ),
                    },
                    "results_to": {
                        "type": "string",
                        "enum": ["new", "dedicated"],
                        "description": (
                            "'new' = a fresh thread each run; 'dedicated' = one"
                            " thread that runs append to"
                        ),
                    },
                    "actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Tool names this automation may use unattended;"
                            " everything else is refused while nobody is watching"
                        ),
                    },
                    "description": {"type": "string"},
                    "provider": {"type": "string"},
                    "model": {"type": "string"},
                    "enabled": {"type": "boolean", "description": "create/update: active state"},
                    "limit": {
                        "type": "integer",
                        "description": "runs: how many (default 10)",
                    },
                },
                "required": ["operation"],
            },
            handler=_handle,
            risk=RiskLevel.MEDIUM,
            subtype=lambda args: args.get("operation"),
        )
    ]
