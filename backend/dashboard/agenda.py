"""Read-only current-week agenda through the live, audited Composio registry."""

import json
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.dashboard.store import settings_read
from backend.db.repositories import ExecutionLogRepository
from backend.mcp.client import is_auth_failure_text
from backend.mcp.composio_service import composio_service
from backend.mcp.live import connection, get_manager
from backend.mcp.provider_ownership import is_provider_overridden_by_local
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, ToolContext, ToolSource


class CalendarUnavailable(Exception):
    """Calendar access is disabled, disconnected, or requires sign-in."""


def access_enabled():
    return settings_read("task.agenda").get("enabled", True)


async def provide(_widget_id):
    if not access_enabled() or not composio_service.is_configured():
        raise CalendarUnavailable
    if (
        "googlecalendar" not in composio_service.get_enabled_toolkits()
        or is_provider_overridden_by_local("googlecalendar")
    ):
        raise CalendarUnavailable
    if composio_service.is_reauth_required("googlecalendar"):
        raise CalendarUnavailable
    if connection("composio") is None:
        raise RuntimeError("Calendar transport unavailable")
    if "googlecalendar" not in await composio_service.get_connections_async():
        raise CalendarUnavailable
    manager = get_manager()
    tool = manager.registry.resolve_tool("GOOGLECALENDAR_FIND_EVENT")
    if not tool or tool.server_name != "composio" or tool.source != ToolSource.MCP:
        raise CalendarUnavailable
    if tool.risk != RiskLevel.LOW:
        raise RuntimeError("Calendar reader must be read-only")
    timezone = settings_read("dash.quiet").get("timezone", "UTC")
    zone = ZoneInfo(timezone)
    now = datetime.now(zone)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    arguments = {
        "calendar_id": "primary",
        "time_min": start.isoformat(),
        "time_max": end.isoformat(),
        "single_events": True,
        "max_results": 100,
    }

    async def refuse_prompt(_request):
        return False

    context = ToolContext(read_only=True)
    trace, watchdog, token = start_turn_trace("dashboard", "Read calendar agenda")
    started = time.monotonic()
    succeeded = False
    outcome = None
    try:
        outcome = await ConfirmationService(callback=refuse_prompt).check(tool, arguments, context)
        if not outcome.allowed:
            raise CalendarUnavailable
        # Registry dispatch projects/truncates results for LLM context; this machine reader
        # uses the same registered handler and gate, retaining structured event dates.
        result = await tool.handler(arguments, context)
        succeeded = not result.is_error
    finally:
        elapsed = int((time.monotonic() - started) * 1000)
        ExecutionLogRepository().record(
            tool_name=tool.name,
            tool_source=tool.source.value,
            arguments=arguments,
            result_summary="Calendar agenda read" if succeeded else None,
            error=None if succeeded else "Calendar agenda unavailable",
            duration_ms=elapsed,
            risk_level=tool.risk.value,
            confirmation_decision=outcome.decision if outcome else "gate_error",
        )
        record_tool_dispatch(tool.name, elapsed, arguments=arguments)
        finish_turn_trace(trace, watchdog, token)
    if not access_enabled() or composio_service.is_reauth_required("googlecalendar"):
        raise CalendarUnavailable
    if result.is_error:
        if is_auth_failure_text(result.content):
            raise CalendarUnavailable
        raise RuntimeError("Calendar read failed")
    value = json.loads(result.content)
    # The registered fast-lane handler already unwraps Composio's execution envelope.
    if isinstance(value, dict):
        value = value.get("data", value)
    limited = isinstance(value, dict) and bool(value.get("nextPageToken"))
    rows = value if isinstance(value, list) else value.get("items", value.get("events"))
    if not isinstance(rows, list):
        raise ValueError("Invalid calendar response")
    items = []
    for row in rows:
        if row.get("status") == "cancelled":
            continue
        starts, ends = row.get("start", {}), row.get("end", {})
        if isinstance(starts, str):
            starts = {"date" if len(starts) == 10 else "dateTime": starts}
        if isinstance(ends, str):
            ends = {"date" if len(ends) == 10 else "dateTime": ends}
        all_day = "date" in starts
        begins = datetime.fromisoformat(starts.get("dateTime") or starts["date"])
        finishes = datetime.fromisoformat(ends.get("dateTime") or ends["date"])
        if begins.tzinfo is None:
            begins = begins.replace(tzinfo=ZoneInfo(starts.get("timeZone", timezone)))
        if finishes.tzinfo is None:
            finishes = finishes.replace(tzinfo=ZoneInfo(ends.get("timeZone", timezone)))
        if finishes <= begins:
            raise ValueError("Invalid event interval")
        if begins >= end or finishes <= start:
            continue
        title = row.get("summary") or "Untitled event"
        if not isinstance(row.get("id"), str) or not isinstance(title, str):
            raise ValueError("Invalid calendar event identity")
        items.append(
            {
                "id": row["id"],
                "title": title,
                "start": begins.isoformat(),
                "end": finishes.isoformat(),
                "all_day": all_day,
            }
        )
    items.sort(key=lambda item: (datetime.fromisoformat(item["start"]), item["id"]))
    return {
        "items": items,
        "timezone": timezone,
        "week_start": start.date().isoformat(),
        "today": now.date().isoformat(),
        "limited": limited or len(rows) >= 100,
    }
