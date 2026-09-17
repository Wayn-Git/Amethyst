"""Local, manually configured birthday and correspondence reminders."""

import json
from datetime import datetime, timedelta

from fastapi import HTTPException
from pydantic import Field, field_validator

from backend.dashboard.items import local_now, save_draft
from backend.dashboard.models import StrictModel
from backend.dashboard.store import cache_read, settings_read


class Birthday(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    birthday: str = Field(pattern=r"^\d{2}-\d{2}$")

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()

    @field_validator("birthday")
    @classmethod
    def valid_day(cls, value):
        datetime.strptime("2000-" + value, "%Y-%m-%d")
        return value


class ReachoutInput(StrictModel):
    days: int = Field(default=30, ge=1, le=3650)
    birthdays: list[Birthday] = Field(default_factory=list, max_length=100)


def draft(action, body):
    if action != "configure":
        raise HTTPException(404, "Unknown reminder action")
    return save_draft(
        "comm.reachout",
        action,
        body,
        {**body.model_dump(), "expected": settings_read("comm.reachout")},
    )


def apply(conn, action, body):
    if action != "configure":
        raise HTTPException(404, "Unknown reminder action")
    if settings_read("comm.reachout") != body["expected"]:
        raise HTTPException(409, "Reminders changed. Review a new request.")
    value = ReachoutInput.model_validate({k: body[k] for k in ("days", "birthdays")}).model_dump()
    conn.execute(
        "INSERT INTO widget_settings VALUES(?,?) ON CONFLICT(widget_id) "
        "DO UPDATE SET settings_json=excluded.settings_json",
        ("comm.reachout", json.dumps(value)),
    )
    conn.execute("UPDATE widget_cache SET state='stale' WHERE widget_id='comm.reachout'")


async def provide():
    from backend.dashboard import service
    from backend.dashboard.mail import mail_date

    settings = ReachoutInput.model_validate(settings_read("comm.reachout")).model_dump()
    await service.refresh("comm.contacts")
    cached = cache_read("comm.contacts")
    contacts = (cached["payload"] or {}).get("items", [])
    now = local_now()
    cutoff = now - timedelta(days=settings["days"])
    items = [
        {
            "id": "birthday:" + str(index),
            "title": row["name"],
            "reason": "Birthday today",
            "source": "Manual",
        }
        for index, row in enumerate(settings["birthdays"])
        if row["birthday"] == now.strftime("%m-%d")
    ]
    for row in contacts:
        when = mail_date(row["at"])
        if when.year > 1 and when <= cutoff:
            items.append({**row, "reason": f"No contact in {settings['days']} days"})
    return {
        **settings,
        "items": items,
        "limited": True,
        "unavailable": (cached["payload"] or {}).get("unavailable", [])
        if cached["state"] in ("ok", "empty")
        else ["Contact refresh"],
    }
