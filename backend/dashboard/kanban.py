"""Boards project existing local task lists and canonical task statuses."""

import json
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, field_validator

from backend.dashboard import items
from backend.dashboard.models import StrictModel
from backend.db.connection import get_connection

DEFAULT_COLUMNS = [
    {"id": "todo", "title": "To do", "status": "todo"},
    {"id": "in_progress", "title": "Doing", "status": "in_progress"},
    {"id": "done", "title": "Done", "status": "done"},
]


class Column(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=100)
    status: Literal["todo", "in_progress", "done"]

    @field_validator("id", "title")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Column id and title cannot be blank")
        return value.strip()


class BoardInput(StrictModel):
    project_id: int | None = Field(default=None, gt=0)
    id: int | None = Field(default=None, gt=0)
    title: str = Field(default="", max_length=500)
    column_id: str | None = Field(default=None, min_length=1, max_length=100)
    columns: list[Column] = Field(default_factory=list, max_length=12)


def columns(project_id):
    row = (
        get_connection()
        .execute("SELECT columns_json FROM dashboard_kanban_boards WHERE list_id=?", (project_id,))
        .fetchone()
    )
    return json.loads(row[0]) if row else DEFAULT_COLUMNS


def project(project_id):
    row = (
        get_connection()
        .execute(
            "SELECT * FROM task_lists WHERE id=? AND external_source IS NULL "
            "AND retired_at IS NULL",
            (project_id,),
        )
        .fetchone()
    )
    if not row:
        raise HTTPException(404, "Local project not found")
    return dict(row)


def task(task_id):
    row = get_connection().execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Task not found")
    if row["external_source"]:
        raise HTTPException(409, "Connected tasks must be edited in their source")
    if row["status"] == "cancelled":
        raise HTTPException(409, "Cancelled tasks cannot be moved")
    return dict(row)


def provide():
    conn = get_connection()
    boards = []
    for row in conn.execute(
        "SELECT id,name FROM task_lists WHERE external_source IS NULL "
        "AND retired_at IS NULL ORDER BY id"
    ):
        cols = columns(row["id"])
        cards = []
        for card in conn.execute(
            "SELECT t.*,p.column_id FROM tasks t LEFT JOIN dashboard_kanban_cards p "
            "ON p.task_id=t.id "
            "WHERE t.list_id=? AND t.status!='cancelled' ORDER BY t.id",
            (row["id"],),
        ):
            column = next(
                (c for c in cols if c["id"] == card["column_id"] and c["status"] == card["status"]),
                None,
            )
            column = column or next(c for c in cols if c["status"] == card["status"])
            cards.append(
                {
                    "id": card["id"],
                    "title": card["title"],
                    "status": card["status"],
                    "column_id": column["id"],
                    "editable": not card["external_source"],
                }
            )
        boards.append({"id": row["id"], "title": row["name"], "columns": cols, "cards": cards})
    return {
        "items": boards,
        "tasks": [
            dict(row)
            for row in conn.execute(
                "SELECT id,title,list_id FROM tasks WHERE external_source IS NULL "
                "AND status!='cancelled' "
                "ORDER BY id"
            )
        ],
    }


def draft(action, body):
    if action not in ("project", "configure", "move"):
        raise HTTPException(404, "Unknown board action")
    payload = body.model_dump()
    if action == "project":
        if not body.title.strip():
            raise HTTPException(422, "Project title is required")
        payload["title"] = body.title.strip()
    else:
        payload["expected_project"] = project(body.project_id)
        payload["expected_columns"] = columns(body.project_id)
        if action == "configure":
            cols = [col.model_dump() for col in body.columns]
            if {c["status"] for c in cols} != {"todo", "in_progress", "done"} or len(
                {c["id"] for c in cols}
            ) != len(cols):
                raise HTTPException(
                    422, "Keep distinct columns covering To do, Doing and Done statuses"
                )
        else:
            payload["expected_task"] = task(body.id)
            if body.column_id not in {col["id"] for col in payload["expected_columns"]}:
                raise HTTPException(422, "Column not found")
    return items.save_draft("task.kanban", action, body, payload)


def apply(conn, action, body):
    if action == "project":
        if conn.execute(
            "SELECT 1 FROM task_lists WHERE name=? AND external_id IS NULL", (body["title"],)
        ).fetchone():
            raise HTTPException(409, "A local project with this name already exists")
        conn.execute("INSERT INTO task_lists(name) VALUES(?)", (body["title"],))
        return
    if (
        project(body["project_id"]) != body["expected_project"]
        or columns(body["project_id"]) != body["expected_columns"]
    ):
        raise HTTPException(409, "Project changed. Review a new draft.")
    if action == "configure":
        conn.execute(
            "INSERT INTO dashboard_kanban_boards VALUES(?,?) ON CONFLICT(list_id) "
            "DO UPDATE SET columns_json=excluded.columns_json",
            (body["project_id"], json.dumps(body["columns"])),
        )
        return
    current = task(body["id"])
    if current != body["expected_task"]:
        raise HTTPException(409, "Task changed. Review a new draft.")
    column = next(c for c in body["expected_columns"] if c["id"] == body["column_id"])
    now = items.local_now().isoformat()
    conn.execute(
        "UPDATE tasks SET list_id=?,status=?,completed_at=?,updated_at=? WHERE id=?",
        (
            body["project_id"],
            column["status"],
            (current["completed_at"] or now) if column["status"] == "done" else None,
            now,
            body["id"],
        ),
    )
    conn.execute(
        "INSERT INTO dashboard_kanban_cards VALUES(?,?) ON CONFLICT(task_id) "
        "DO UPDATE SET column_id=excluded.column_id",
        (body["id"], body["column_id"]),
    )
