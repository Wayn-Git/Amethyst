from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard.items import local_now, provide
from backend.dashboard.router import router
from backend.db.connection import reset_connection
from backend.db.repositories import TaskRepository


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def propose(client, action, body, widget="task.today"):
    response = client.post(f"/api/widgets/{widget}/actions/{action}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["draft_id"]


def decide(client, draft_id, approved=True, widget="task.today"):
    return client.post(f"/api/widgets/{widget}/drafts/{draft_id}", json={"approved": approved})


@pytest.mark.parametrize("widget", ["task.today", "task.backlog"])
def test_task_crud_requires_approval_and_persists(client, widget):
    draft = propose(client, "add", {"title": "Test task"}, widget)
    assert provide(widget)["items"] == []
    assert decide(client, draft, False, widget).json()["state"] == "denied"
    assert provide(widget)["items"] == []
    draft = propose(client, "add", {"title": "Test task"}, widget)
    assert decide(client, draft, widget=widget).json()["state"] == "applied"
    assert decide(client, draft, widget=widget).status_code == 409
    reset_connection()
    item = provide(widget)["items"][0]
    draft = propose(client, "edit", {"id": item["id"], "title": "Edited task"}, widget)
    assert provide(widget)["items"][0]["title"] == "Test task"
    assert decide(client, draft, widget=widget).status_code == 200
    assert provide(widget)["items"][0]["title"] == "Edited task"
    draft = propose(client, "complete", {"id": item["id"]}, widget)
    assert decide(client, draft, widget=widget).status_code == 200
    assert provide(widget)["items"] == []
    draft = propose(client, "delete", {"id": item["id"]}, widget)
    assert decide(client, draft, widget=widget).status_code == 200
    assert TaskRepository().get(item["id"]) is None


def test_validation_and_changed_draft(client):
    for body in (
        {"title": " "},
        {"title": "x", "due_at": "2026-10-24T09:00"},
        {"title": "x", "approved": True},
    ):
        assert client.post("/api/widgets/task.today/actions/add", json=body).status_code == 422
    assert (
        client.post("/api/widgets/task.today/actions/edit", json={"title": "x"}).status_code == 422
    )
    task_id = TaskRepository().create("Before", my_day_date=local_now().date().isoformat())
    draft = propose(client, "delete", {"id": task_id})
    TaskRepository().update(task_id, title="Changed")
    assert decide(client, draft).status_code == 409
    assert TaskRepository().get(task_id)["title"] == "Changed"


def test_today_selection(client):
    now = local_now()
    repo = TaskRepository()
    repo.create("Yesterday", my_day_date=(now - timedelta(days=1)).date().isoformat())
    repo.create("Scheduled", scheduled_at=now.isoformat())
    repo.create("Due", due_at=now.isoformat())
    repo.create("Completed", my_day_date=now.date().isoformat(), status="done")
    assert {i["title"] for i in provide("task.today")["items"]} == {"Scheduled", "Due"}


def test_gate_denial_prevents_write(client, monkeypatch):
    from backend.security.confirmation import ConfirmationOutcome, ConfirmationService
    from backend.tools.base import RiskLevel

    async def deny(*args, **kwargs):
        return ConfirmationOutcome(False, "denied", RiskLevel.HIGH)

    monkeypatch.setattr(ConfirmationService, "check", deny)
    draft = propose(client, "add", {"title": "Denied"})
    assert decide(client, draft).json()["state"] == "denied"
    assert provide("task.today")["items"] == []


def test_backlog_idle_sort_and_today_exclusion(client):
    from backend.db.connection import transaction

    repo = TaskRepository()
    newer = repo.create("Newer")
    older = repo.create("Older")
    repo.create("Today", my_day_date=local_now().date().isoformat())
    repo.create("Done", status="done")
    with transaction() as conn:
        conn.execute(
            "UPDATE tasks SET updated_at=? WHERE id=?",
            ((local_now() - timedelta(days=5)).isoformat(), older),
        )
    items = provide("task.backlog")["items"]
    assert [item["id"] for item in items] == [older, newer]
    assert items[0]["idle_days"] == 5


@pytest.mark.parametrize("widget", ["task.deadlines", "task.reminders"])
def test_dated_item_crud_and_countdown_order(client, widget):
    assert (
        client.post(f"/api/widgets/{widget}/actions/add", json={"title": "No date"}).status_code
        == 422
    )
    now = local_now()
    for title, due in [("Later", now + timedelta(days=2)), ("Overdue", now - timedelta(hours=1))]:
        draft = propose(client, "add", {"title": title, "due_at": due.isoformat()}, widget)
        assert provide(widget)["items"] == [] if title == "Later" else True
        assert decide(client, draft, widget=widget).json()["state"] == "applied"
    reset_connection()
    items = provide(widget)["items"]
    assert [item["title"] for item in items] == ["Overdue", "Later"]
    assert items[0]["seconds_until_due"] < 0 < items[1]["seconds_until_due"]
    item_id = items[0]["id"]
    draft = propose(
        client,
        "edit",
        {"id": item_id, "title": "Edited", "due_at": (now + timedelta(days=3)).isoformat()},
        widget,
    )
    assert decide(client, draft, widget=widget).status_code == 200
    assert provide(widget)["items"][-1]["title"] == "Edited"
    draft = propose(client, "complete", {"id": item_id}, widget)
    assert decide(client, draft, widget=widget).status_code == 200
    assert len(provide(widget)["items"]) == 1
    draft = propose(client, "delete", {"id": items[1]["id"]}, widget)
    assert decide(client, draft, widget=widget).status_code == 200
    assert provide(widget)["items"] == []


def test_reminders_do_not_schedule_notifications(client):
    repo = TaskRepository()
    before = repo.due_reminders(local_now().isoformat())
    draft = propose(
        client,
        "add",
        {"title": "Due reminder", "due_at": (local_now() - timedelta(hours=1)).isoformat()},
        "task.reminders",
    )
    assert decide(client, draft, widget="task.reminders").json()["state"] == "applied"
    assert repo.due_reminders(local_now().isoformat()) == before
    assert provide("task.reminders")["items"][0]["due_state"] == "overdue"


def test_overdue_aggregates_three_sources_and_excludes_closed(client):
    now = local_now()
    repo = TaskRepository()
    repo.create("Overdue task", due_at=(now - timedelta(hours=3)).isoformat())
    repo.create("Future task", due_at=(now + timedelta(hours=3)).isoformat())
    repo.create("Done task", due_at=(now - timedelta(hours=3)).isoformat(), status="done")
    repo.create("Cancelled task", due_at=(now - timedelta(hours=3)).isoformat(), status="cancelled")
    for widget in ("task.deadlines", "task.reminders"):
        draft = propose(
            client,
            "add",
            {"title": widget, "due_at": (now - timedelta(hours=1)).isoformat()},
            widget,
        )
        decide(client, draft, widget=widget)
    items = provide("need.overdue")["items"]
    assert [item["source"] for item in items] == ["tasks", "deadlines", "reminders"]
    assert all(item["due_state"] == "overdue" for item in items)
    client.get("/api/widgets/need.overdue/data")
    assert client.get("/api/widgets/need.overdue/data").json()["state"] == "ok"
    item = items[-1]
    draft = propose(client, "complete", {"id": item["id"]}, "task.reminders")
    decide(client, draft, widget="task.reminders")
    assert client.get("/api/widgets/need.overdue/data").json()["stale"]
    assert len(provide("need.overdue")["items"]) == 2
    assert (
        client.post("/api/widgets/need.overdue/actions/delete", json={"id": 1}).status_code == 404
    )


def test_snoozed_local_day_boundaries_and_persistence(client, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from backend.dashboard import items
    from backend.dashboard.store import settings_write
    from backend.db.connection import transaction

    now = datetime(2026, 10, 24, 12, tzinfo=ZoneInfo("Asia/Kolkata"))
    monkeypatch.setattr(items, "local_now", lambda: now)
    settings_write("dash.quiet", {"snoozed_until": "2026-10-24T18:00:00+05:30"})
    assert provide("need.snoozed")["items"] == []
    with transaction() as conn:
        for title, until, status in [
            ("Midnight", "2026-10-23T18:30:00Z", "todo"),
            ("Later today", "2026-10-24T18:29:59Z", "todo"),
            ("Tomorrow", "2026-10-24T18:30:00Z", "todo"),
            ("Yesterday", "2026-10-23T18:29:59Z", "todo"),
            ("Done", "2026-10-24T05:00:00Z", "done"),
        ]:
            item_id = conn.execute(
                "INSERT INTO tasks(title,status) VALUES(?,?)", (title, status)
            ).lastrowid
            conn.execute("INSERT INTO snoozes VALUES(?,?,?)", (str(item_id), "task.today", until))
        conn.execute("INSERT INTO snoozes VALUES('missing','task.today','2026-10-24T05:00:00Z')")
    reset_connection()
    rows = provide("need.snoozed")["items"]
    assert [row["title"] for row in rows] == ["Midnight", "Later today"]
    assert [row["return_state"] for row in rows] == ["ready", "scheduled"]
    assert (
        client.post("/api/widgets/need.snoozed/actions/delete", json={"id": 1}).status_code == 404
    )


def test_task_naive_dates_keep_host_timezone_and_idle_uses_utc(client, monkeypatch):
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo

    from backend.dashboard import items
    from backend.db.connection import transaction

    now = datetime(2026, 10, 24, 12, tzinfo=UTC)
    monkeypatch.setattr(items, "local_now", lambda: now.astimezone(ZoneInfo("Pacific/Auckland")))
    due = now - timedelta(hours=1)
    task_id = TaskRepository().create(
        "Existing local task", due_at=due.astimezone().replace(tzinfo=None).isoformat()
    )
    with transaction() as conn:
        conn.execute(
            "UPDATE tasks SET updated_at=? WHERE id=?",
            ((now - timedelta(days=2)).replace(tzinfo=None).isoformat(), task_id),
        )
    row = provide("need.overdue")["items"][0]
    assert items.parsed(row["due_at"]) == due
    assert row["idle_days"] == 2


def test_expired_and_wrong_widget_drafts_cannot_write(client):
    from backend.db.connection import transaction

    draft = propose(client, "add", {"title": "Expired"})
    assert decide(client, draft, widget="task.backlog").status_code == 404
    with transaction() as conn:
        conn.execute(
            "UPDATE widget_action_drafts SET created_at=? WHERE id=?",
            ((local_now() - timedelta(hours=2)).isoformat(), draft),
        )
    assert decide(client, draft).status_code == 409
    assert provide("task.today")["items"] == []
