"""Current-week projection of structured Google Calendar events."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from backend.dashboard.connectors import read
from backend.dashboard.store import settings_read


async def provide(widget_id, *, now=None):
    timezone = str(now.tzinfo) if now else settings_read("dash.quiet").get("timezone", "UTC")
    zone = ZoneInfo(timezone)
    now = now or datetime.now(zone)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    value = await read(
        widget_id,
        "googlecalendar",
        "GOOGLECALENDAR_FIND_EVENT",
        {
            "calendar_id": "primary",
            "time_min": start.isoformat(),
            "time_max": end.isoformat(),
            "single_events": True,
            "max_results": 100,
        },
    )
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


async def next_event():
    from backend.dashboard.connectors import SourceUnavailable, access_enabled
    from backend.dashboard.service import read_data
    from backend.dashboard.store import cache_write, stamp

    if not access_enabled("task.agenda"):
        raise SourceUnavailable
    cached = read_data("task.agenda")
    if cached["payload"] is None or cached["stale"]:
        payload = await provide("task.agenda")
        cache_write(
            "task.agenda", payload, "ok" if payload["items"] else "empty", synced_at=stamp()
        )
    else:
        payload = cached["payload"]
    now = datetime.now(ZoneInfo(payload["timezone"]))
    upcoming = [item for item in payload["items"] if datetime.fromisoformat(item["start"]) >= now]
    return {
        "items": upcoming[:1],
        "timezone": payload["timezone"],
        "limited": payload.get("limited", False),
    }
