"""Local goals with manual or live task-linked progress."""

from datetime import date
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from backend.dashboard import items
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection


class GoalInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    title: str = Field(default="", max_length=500)
    target_date: date | None = None
    mode: Literal["manual", "tasks"] = "manual"
    progress: int = Field(default=0, ge=0, le=100)
    task_ids: list[int] = Field(default_factory=list, max_length=500)


def tasks():
    return [
        dict(row)
        for row in get_connection().execute("SELECT id,title,status FROM tasks ORDER BY id")
    ]


def provide():
    available = tasks()
    by_id = {row["id"]: row for row in available}
    goals = []
    today = items.local_now().date()
    for row in get_connection().execute("SELECT * FROM dashboard_goals ORDER BY target_date,id"):
        value = dict(row)
        linked = [
            r[0]
            for r in get_connection().execute(
                "SELECT task_id FROM dashboard_goal_tasks WHERE goal_id=? ORDER BY task_id",
                (row["id"],),
            )
        ]
        if row["mode"] == "tasks":
            value["progress"] = (
                round(100 * sum(by_id[t]["status"] == "done" for t in linked) / len(linked))
                if linked
                else 0
            )
        value.update(
            task_ids=linked,
            overdue=row["target_date"] < today.isoformat() and value["progress"] < 100,
        )
        goals.append(value)
    return {"today": today.isoformat(), "tasks": available, "items": goals}


def draft(action, body):
    if action not in ("add", "progress"):
        raise HTTPException(404, "Unknown goal action")
    payload = body.model_dump(mode="json")
    if action == "add":
        if body.id is not None or not body.title.strip() or body.target_date is None:
            raise HTTPException(422, "A goal requires a title, target date and no id")
        payload["title"] = body.title.strip()
        if body.mode == "manual" and body.task_ids:
            raise HTTPException(422, "Manual goals cannot link tasks")
        if body.mode == "tasks":
            if not body.task_ids or len(set(body.task_ids)) != len(body.task_ids):
                raise HTTPException(422, "Select distinct tasks for linked progress")
            if not set(body.task_ids) <= {row["id"] for row in tasks()}:
                raise HTTPException(422, "Linked task not found")
            payload["progress"] = 0
    else:
        row = (
            get_connection()
            .execute("SELECT * FROM dashboard_goals WHERE id=?", (body.id,))
            .fetchone()
        )
        if not row:
            raise HTTPException(404, "Goal not found")
        if row["mode"] != "manual":
            raise HTTPException(409, "Linked progress is computed from tasks")
        payload["expected"] = dict(row)
    return items.save_draft("task.goals", action, body, payload)


def apply(conn, action, body):
    if action == "add":
        if not set(body["task_ids"]) <= {row["id"] for row in tasks()}:
            raise HTTPException(409, "Linked tasks changed. Review a new goal.")
        goal_id = conn.execute(
            "INSERT INTO dashboard_goals(title,target_date,mode,progress) VALUES(?,?,?,?)",
            (body["title"], body["target_date"], body["mode"], body["progress"]),
        ).lastrowid
        conn.executemany(
            "INSERT INTO dashboard_goal_tasks(goal_id,task_id) VALUES(?,?)",
            [(goal_id, task_id) for task_id in body["task_ids"]],
        )
    else:
        row = conn.execute("SELECT * FROM dashboard_goals WHERE id=?", (body["id"],)).fetchone()
        if not row or dict(row) != body["expected"]:
            raise HTTPException(409, "Goal changed. Review a new draft.")
        conn.execute(
            "UPDATE dashboard_goals SET progress=? WHERE id=?", (body["progress"], body["id"])
        )
