"""Habit streaks derived from local calendar check-ins."""

from collections import Counter
from datetime import date, timedelta
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard import items
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection


class HabitInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    title: str = Field(default="", max_length=500)
    period: Literal["daily", "weekly"] = "daily"
    target: int = Field(default=1, ge=1, le=100)


def history(habit_id):
    return [
        row[0]
        for row in get_connection().execute(
            "SELECT day FROM dashboard_habit_checkins WHERE habit_id=? ORDER BY id", (habit_id,)
        )
    ]


def period_start(day, period):
    return day - timedelta(days=day.weekday()) if period == "weekly" else day


def progress(row, days, today):
    current = period_start(today, row["period"])
    counts = Counter(period_start(date.fromisoformat(day), row["period"]) for day in days)
    step = timedelta(days=7 if row["period"] == "weekly" else 1)
    cursor = current if counts[current] >= row["target"] else current - step
    streak = 0
    while counts[cursor] >= row["target"]:
        streak += 1
        cursor -= step
    return {"count": counts[current], "streak": streak}


def provide():
    today = items.local_now().date()
    return {
        "today": today.isoformat(),
        "items": [
            {**dict(row), **progress(row, history(row["id"]), today)}
            for row in get_connection().execute("SELECT * FROM dashboard_habits ORDER BY id")
        ],
    }


def draft(action, body):
    if action not in ("add", "checkin"):
        raise HTTPException(404, "Unknown habit action")
    payload = body.model_dump()
    if action == "add":
        if body.id is not None or not body.title.strip():
            raise HTTPException(422, "A new habit requires a title and no id")
        payload["title"] = body.title.strip()
    else:
        row = (
            get_connection()
            .execute("SELECT * FROM dashboard_habits WHERE id=?", (body.id,))
            .fetchone()
        )
        if not row:
            raise HTTPException(404, "Habit not found")
        payload.update(
            expected=dict(row), history=history(body.id), day=items.local_now().date().isoformat()
        )
    return items.save_draft("task.habits", action, body, payload)


def apply(conn, action, body):
    if action == "add":
        conn.execute(
            "INSERT INTO dashboard_habits(title,period,target) VALUES(?,?,?)",
            (body["title"], body["period"], body["target"]),
        )
        return
    row = conn.execute("SELECT * FROM dashboard_habits WHERE id=?", (body["id"],)).fetchone()
    if (
        not row
        or dict(row) != body["expected"]
        or history(body["id"]) != body["history"]
        or body["day"] != items.local_now().date().isoformat()
    ):
        raise HTTPException(409, "Habit or day changed. Review a new check-in.")
    conn.execute(
        "INSERT INTO dashboard_habit_checkins(habit_id,day) VALUES(?,?)", (body["id"], body["day"])
    )
