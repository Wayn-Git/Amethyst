"""Local item providers and explicit, single-use drafts through the Director gate."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import Field, field_validator

from backend.agent.trace import finish_turn_trace, record_tool_dispatch, start_turn_trace
from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read, stamp
from backend.db.connection import get_connection, transaction
from backend.security.confirmation import ConfirmationService
from backend.tools.base import RiskLevel, Tool, ToolContext

TABLES = {
    "task.today": "tasks",
    "task.backlog": "tasks",
    "task.deadlines": "deadlines",
    "task.reminders": "reminders",
}


class ItemInput(StrictModel):
    id: int | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    due_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Title cannot be blank")
        return value.strip() if value else value

    @field_validator("due_at")
    @classmethod
    def aware(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Due date requires a timezone")
        return value


def local_now():
    zone = settings_read("dash.quiet").get("timezone")
    return datetime.now(ZoneInfo(zone)) if zone else datetime.now().astimezone()


def parsed(value):
    if not value:
        return None
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return date if date.tzinfo else date.replace(tzinfo=local_now().tzinfo)


def task_rows():
    return [
        dict(r)
        for r in get_connection().execute(
            "SELECT id,title,due_at,scheduled_at,my_day_date,status,updated_at,external_source "
            "FROM tasks "
            "WHERE status IN ('todo','in_progress')"
        )
    ]


def today_item(row, now):
    return row.get("my_day_date") == now.date().isoformat() or any(
        parsed(row.get(key)) is not None
        and parsed(row[key]).astimezone(now.tzinfo).date() == now.date()
        for key in ("scheduled_at", "due_at")
    )


def display(row, now, source):
    due = parsed(row.get("due_at"))
    return {
        "id": row["id"],
        "title": row["title"],
        "due_at": due.isoformat() if due else None,
        "source": source,
        "due_state": "overdue" if due and due < now else "upcoming" if due else "unscheduled",
        "seconds_until_due": int((due - now).total_seconds()) if due else None,
        "updated_at": row.get("updated_at"),
        "idle_days": max(0, (now - parsed(row["updated_at"])).days),
        "editable": not row.get("external_source"),
    }


def provide(widget_id):
    now = local_now()
    if widget_id in ("task.deadlines", "task.reminders"):
        table = TABLES[widget_id]
        rows = [
            dict(row)
            for row in get_connection().execute(f"SELECT * FROM {table} WHERE status='todo'")
        ]
        rows.sort(key=lambda row: (parsed(row["due_at"]), row["id"]))
        return {"items": [display(row, now, table) for row in rows]}
    rows = [r for r in task_rows() if today_item(r, now) == (widget_id == "task.today")]
    if widget_id == "task.backlog":
        rows.sort(key=lambda r: (parsed(r["updated_at"]), r["id"]))
    return {"items": [display(r, now, "tasks") for r in rows]}


def draft(widget_id, action, body):
    if widget_id not in TABLES or action not in ("add", "edit", "complete", "delete"):
        raise HTTPException(404, "Unknown item action")
    if action in ("add", "edit") and not body.title:
        raise HTTPException(422, "Title is required")
    if TABLES[widget_id] != "tasks" and action in ("add", "edit") and body.due_at is None:
        raise HTTPException(422, "Due date is required")
    if action != "add" and body.id is None:
        raise HTTPException(422, "Item id is required")
    if action == "add" and body.id is not None:
        raise HTTPException(422, "New items cannot specify an id")
    if body.id is not None:
        row = (
            get_connection()
            .execute(f"SELECT * FROM {TABLES[widget_id]} WHERE id=?", (body.id,))
            .fetchone()
        )
        if row is None:
            raise HTTPException(404, "Item no longer exists")
        if TABLES[widget_id] == "tasks" and row["external_source"]:
            raise HTTPException(409, "Connected tasks must be edited in their source")
    payload = body.model_dump(mode="json")
    if body.id is not None:
        payload["expected"] = dict(row)
    draft_id = str(uuid.uuid4())
    with transaction() as conn:
        conn.execute(
            "INSERT INTO widget_action_drafts(id,widget_id,action,body_json,created_at) "
            "VALUES(?,?,?,?,?)",
            (draft_id, widget_id, action, json.dumps(payload), stamp()),
        )
    return {
        "draft_id": draft_id,
        "action": action,
        "item": body.model_dump(mode="json"),
        "state": "awaiting-approval",
    }


async def decide(widget_id, draft_id, approved):
    row = (
        get_connection()
        .execute(
            "SELECT * FROM widget_action_drafts WHERE id=? AND widget_id=?", (draft_id, widget_id)
        )
        .fetchone()
    )
    if row is None:
        raise HTTPException(404, "Draft not found")
    if row["decision"] or parsed(row["created_at"]) < datetime.now(UTC) - timedelta(hours=1):
        raise HTTPException(409, "Draft already decided or expired")
    body = json.loads(row["body_json"])
    action = row["action"]

    async def answer(_request):
        return approved

    async def unused(_args, _context):
        raise RuntimeError("Execute only after the gate")

    tool = Tool(
        name="dashboard_item",
        description="Apply a reviewed local item draft",
        parameters={},
        handler=unused,
        risk=RiskLevel.HIGH,
    )
    trace, watchdog, token = start_turn_trace(
        "dashboard", f"{widget_id}: {action}", turn_id=draft_id
    )
    started = time.monotonic()
    try:
        outcome = await ConfirmationService(callback=answer).check(
            tool,
            {"widget_id": widget_id, "action": action, "item": body},
            ToolContext(turn_id=draft_id),
        )
        allowed = approved and outcome.allowed
        with transaction() as conn:
            claimed = conn.execute(
                "UPDATE widget_action_drafts SET decision=?,decided_at=? "
                "WHERE id=? AND decision IS NULL",
                (outcome.decision if allowed else "denied", stamp(), draft_id),
            )
            if not claimed.rowcount:
                raise HTTPException(409, "Draft already decided")
            if allowed:
                apply(conn, widget_id, action, body)
                conn.execute(
                    "UPDATE widget_cache SET state='stale' WHERE widget_id LIKE 'task.%' "
                    "OR widget_id LIKE 'need.%'"
                )
        return {"state": "applied" if allowed else "denied"}
    finally:
        record_tool_dispatch(
            "dashboard_item",
            (time.monotonic() - started) * 1000,
            arguments={"widget_id": widget_id, "action": action},
        )
        finish_turn_trace(trace, watchdog, token)


def apply(conn, widget_id, action, body):
    table = TABLES[widget_id]
    if body["id"] is not None:
        current = conn.execute(f"SELECT * FROM {table} WHERE id=?", (body["id"],)).fetchone()
        if current is None or dict(current) != body["expected"]:
            raise HTTPException(409, "Item changed. Review a new draft.")
    due = parsed(body["due_at"])
    # Existing tasks use local naive timestamps; other widget tables use offsets.
    due_text = (
        due.astimezone(local_now().tzinfo).replace(tzinfo=None).isoformat(sep=" ") if due else None
    )
    if table != "tasks":
        due_text = due.astimezone(UTC).isoformat() if due else None
    if action == "add" and table != "tasks":
        conn.execute(f"INSERT INTO {table}(title,due_at) VALUES(?,?)", (body["title"], due_text))
    elif action == "add":
        conn.execute(
            "INSERT INTO tasks(title,due_at,my_day_date) VALUES(?,?,?)",
            (
                body["title"],
                due_text,
                local_now().date().isoformat() if widget_id == "task.today" else None,
            ),
        )
    elif action == "edit":
        conn.execute(
            f"UPDATE {table} SET title=?,due_at=?,updated_at=? WHERE id=?",
            (body["title"], due_text, stamp(), body["id"]),
        )
    elif action == "complete":
        conn.execute(
            f"UPDATE {table} SET status='done',completed_at=?,updated_at=? WHERE id=?",
            (stamp(), stamp(), body["id"]),
        )
    else:
        conn.execute(f"DELETE FROM {table} WHERE id=?", (body["id"],))
