"""Read-only calendar capacity and deterministic task proposals."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import Field, model_validator

from backend.dashboard import agenda
from backend.dashboard.connectors import SourceUnavailable, access_enabled
from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read
from backend.db.connection import get_connection


class PlanningSettings(StrictModel):
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    days: list[int] = Field(min_length=1, max_length=7)
    timezone: str

    @model_validator(mode="after")
    def valid(self):
        ZoneInfo(self.timezone)
        if self.start >= self.end or any(day not in range(7) for day in self.days):
            raise ValueError("Choose working days (Monday=0) and an end after start")
        return self


def clock(zone):
    return datetime.now(zone)


def date_time(value, zone):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed.astimezone(zone)


async def context(widget_id):
    if not access_enabled("task.agenda"):
        raise SourceUnavailable
    settings = settings_read("task.free")
    if not settings:
        return None
    settings = PlanningSettings.model_validate(settings)
    zone = ZoneInfo(settings.timezone)
    now = clock(zone)
    calendar = await agenda.provide(widget_id, now=now)
    # Incomplete calendars must never be presented as free capacity.
    if calendar["limited"]:
        raise ValueError("Calendar is incomplete")
    events = [
        {**event, "begin": date_time(event["start"], zone), "finish": date_time(event["end"], zone)}
        for event in calendar["items"]
        if not event.get("transparent")
    ]
    slots = []
    end = date_time(calendar["week_start"], zone) + timedelta(days=7)
    day = now.date()
    while day < end.date():
        if day.weekday() in settings.days:
            start = max(datetime.combine(day, time.fromisoformat(settings.start), zone), now)
            finish = datetime.combine(day, time.fromisoformat(settings.end), zone)
            for event in sorted(events, key=lambda e: e["begin"]):
                if event["finish"] <= start or event["begin"] >= finish:
                    continue
                if event["begin"] > start:
                    slots.append((start, event["begin"]))
                start = max(start, event["finish"])
            if start < finish:
                slots.append((start, finish))
        day += timedelta(days=1)
    return now, events, slots


def tasks(zone):
    rows = [
        dict(row)
        for row in get_connection().execute(
            "SELECT id,title,due_at,scheduled_at,my_day_date,duration_estimate_minutes "
            "FROM tasks WHERE status IN ('todo','in_progress') ORDER BY due_at,id"
        )
    ]
    for row in rows:
        row["due"] = date_time(row["due_at"], zone) if row["due_at"] else None
    return rows


async def provide(widget_id):
    value = await context(widget_id)
    if value is None:
        return {
            "items": [],
            "message": "Set working hours and timezone in settings.",
            "set_hours": True,
        }
    now, events, slots = value
    items = []
    pending = tasks(now.tzinfo)
    if widget_id == "task.plan":
        today = [
            row
            for row in pending
            if row["my_day_date"] == now.date().isoformat()
            or any(
                row.get(key) and date_time(row[key], now.tzinfo).date() == now.date()
                for key in ("due_at", "scheduled_at")
            )
        ]
        available = [(a, b) for a, b in slots if a.date() == now.date()]
        for row in today:
            minutes = row["duration_estimate_minutes"]
            if not minutes or minutes <= 0:
                items.append(
                    {
                        "id": str(row["id"]),
                        "title": row["title"],
                        "detail": "Set a duration estimate",
                    }
                )
                continue
            duration = timedelta(minutes=minutes)
            for index, (start, end) in enumerate(available):
                if end - start >= duration and (not row["due"] or start + duration <= row["due"]):
                    items.append(
                        {
                            "id": str(row["id"]),
                            "title": row["title"],
                            "start": start.isoformat(),
                            "end": (start + duration).isoformat(),
                            "detail": "Proposed only",
                        }
                    )
                    available[index] = (start + duration, end)
                    break
            else:
                items.append(
                    {"id": str(row["id"]), "title": row["title"], "detail": "No slot today"}
                )
    return {
        "items": items,
        "timezone": str(now.tzinfo),
        "message": "Current week only. Calendar read-only.",
    }
