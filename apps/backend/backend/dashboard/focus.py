"""Persistent focus sessions; completion uses the local notification center."""

import asyncio
import json
import logging
from datetime import timedelta
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard import items
from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read
from backend.db.connection import get_connection, transaction
from backend.notify import notify

log = logging.getLogger(__name__)


class FocusInput(StrictModel):
    mode: Literal["focus", "break"] = "focus"
    focus_minutes: int = Field(default=25, ge=1, le=240)
    break_minutes: int = Field(default=5, ge=1, le=240)


def snapshot():
    return {
        "settings": settings_read("task.focus"),
        "sessions": [
            dict(r)
            for r in get_connection().execute("SELECT * FROM dashboard_focus ORDER BY id DESC")
        ],
    }


def draft(action, body):
    if action not in ("configure", "start", "stop"):
        raise HTTPException(404, "Unknown focus action")
    return items.save_draft(
        "task.focus", action, body, {**body.model_dump(), "expected": snapshot()}
    )


def apply(conn, action, body):
    if snapshot() != body["expected"]:
        raise HTTPException(409, "Timer changed. Review a new draft.")
    now = items.local_now()
    active = conn.execute("SELECT * FROM dashboard_focus WHERE ended_at IS NULL").fetchone()
    if action == "configure":
        conn.execute(
            "INSERT INTO widget_settings VALUES(?,?) ON CONFLICT(widget_id) "
            "DO UPDATE SET settings_json=excluded.settings_json",
            ("task.focus", json.dumps({k: body[k] for k in ("focus_minutes", "break_minutes")})),
        )
    elif action == "start":
        if active:
            raise HTTPException(409, "A timer is already running")
        minutes = settings_read("task.focus").get(
            body["mode"] + "_minutes", 25 if body["mode"] == "focus" else 5
        )
        conn.execute(
            "INSERT INTO dashboard_focus(mode,started_at,duration_s) VALUES(?,?,?)",
            (body["mode"], now.isoformat(), minutes * 60),
        )
    elif action == "stop":
        if not active:
            raise HTTPException(409, "No timer is running")
        conn.execute(
            "UPDATE dashboard_focus SET ended_at=? WHERE id=?", (now.isoformat(), active["id"])
        )


async def complete_due():
    now = items.local_now()
    rows = (
        get_connection().execute("SELECT * FROM dashboard_focus WHERE ended_at IS NULL").fetchall()
    )
    for row in rows:
        end = items.parsed(row["started_at"]) + timedelta(seconds=row["duration_s"])
        if end > now:
            continue
        # Save the deduplicated notification first so interruption cannot lose it.
        await notify(
            f"{row['mode'].title()} complete",
            "Your timer has finished.",
            source_key=f"focus:{row['id']}",
        )
        with transaction() as conn:
            conn.execute(
                "UPDATE dashboard_focus SET ended_at=?,completed=1 WHERE id=? AND ended_at IS NULL",
                (end.isoformat(), row["id"]),
            )
            conn.execute("UPDATE widget_cache SET state='stale' WHERE widget_id='task.focus'")


def provide():
    value = snapshot()
    return {
        **value["settings"],
        "items": value["sessions"][:50],
        "now": items.local_now().isoformat(),
    }


async def run():
    while True:
        try:
            await complete_due()
        except Exception:
            log.exception("widget=task.focus tick failed")
        await asyncio.sleep(1)
