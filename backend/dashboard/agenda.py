"""Current-week projection of structured Google Calendar events."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from backend.dashboard.connectors import read
from backend.dashboard.store import settings_read


async def provide(widget_id, *, now=None, range_end=None, future=False):
    timezone = str(now.tzinfo) if now else settings_read("dash.quiet").get("timezone", "UTC")
    zone = ZoneInfo(timezone)
    now = now or datetime.now(zone)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = range_end or start + timedelta(days=7)
    if future:
        start, end = now, None
    value = await read(
        widget_id,
        "googlecalendar",
        "GOOGLECALENDAR_FIND_EVENT",
        {
            "calendar_id": "primary",
            "time_min": start.isoformat(),
            **({"time_max": end.isoformat()} if end else {"order_by": "startTime"}),
            "single_events": True,
            "max_results": 100,
        },
    )
    # The registered fast-lane handler already unwraps Composio's execution envelope.
    if isinstance(value, dict):
        ev_data = value.get("event_data")
        if isinstance(ev_data, dict):
            value = ev_data.get("event_data", ev_data)
        elif isinstance(ev_data, list):
            value = ev_data
        else:
            value = value.get("data", value)
    limited = isinstance(value, dict) and bool(value.get("nextPageToken"))
    rows = (
        value if isinstance(value, list)
        else (
            value.get("items")
            or value.get("events")
            or value.get("event_data")
            if isinstance(value, dict) else []
        )
    )
    if rows is None:
        rows = []
    elif not isinstance(rows, list):
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
        if (end and begins >= end) or finishes <= start:
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
                "location": row.get("location") if isinstance(row.get("location"), str) else None,
                "transparent": row.get("transparency") == "transparent",
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
    all_items = payload.get("items", [])
    upcoming = []
    all_day = []
    for item in all_items:
        try:
            start_str = item.get("start")
            end_str = item.get("end") or start_str
            if not start_str:
                continue
            start_dt = datetime.fromisoformat(start_str)
            end_dt = datetime.fromisoformat(end_str)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=ZoneInfo(payload["timezone"]))
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=ZoneInfo(payload["timezone"]))
            if item.get("all_day"):
                if start_dt.date() <= now.date() <= end_dt.date():
                    all_day.append(item)
            elif end_dt >= now:
                upcoming.append(item)
        except Exception:
            continue
    first_item = [item for item in upcoming if not item.get("all_day")][:1] or upcoming[:1]
    return {
        "items": first_item,
        "events": upcoming,
        "all_day_events": all_day,
        "timezone": payload["timezone"],
        "week_start": payload.get("week_start"),
        "today": payload.get("today"),
        "limited": payload.get("limited", False),
    }
