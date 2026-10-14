from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import goals, items
from backend.dashboard.router import router
from backend.db.connection import reset_connection
from backend.db.repositories import TaskRepository


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(
        items, "local_now", lambda: datetime(2026, 10, 25, 0, 1, tzinfo=ZoneInfo("Asia/Kolkata"))
    )
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def act(client, action, body, approved=True):
    response = client.post(f"/api/widgets/task.goals/actions/{action}", json=body)
    assert response.status_code == 200, response.text
    return client.post(
        "/api/widgets/task.goals/drafts/" + response.json()["draft_id"], json={"approved": approved}
    )


def test_manual_goal_gate_persistence_and_day(client):
    body = {"title": "Learn", "target_date": "2026-10-24"}
    assert goals.provide()["items"] == []
    assert act(client, "add", body, False).json()["state"] == "denied"
    assert goals.provide()["items"] == []
    act(client, "add", body)
    reset_connection()
    goal = goals.provide()["items"][0]
    assert goal["overdue"]
    act(client, "progress", {"id": goal["id"], "progress": 70})
    assert goals.provide()["items"][0]["progress"] == 70
    act(client, "progress", {"id": goal["id"], "progress": 100})
    assert not goals.provide()["items"][0]["overdue"]


def test_linked_progress_tracks_existing_tasks(client):
    repo = TaskRepository()
    first = repo.create("First")
    second = repo.create("Second")
    act(
        client,
        "add",
        {
            "title": "Ship",
            "target_date": "2026-10-25",
            "mode": "tasks",
            "task_ids": [first, second],
        },
    )
    assert goals.provide()["items"][0]["progress"] == 0
    repo.update(first, status="done")
    assert goals.provide()["items"][0]["progress"] == 50
    repo.update(second, status="done")
    assert goals.provide()["items"][0]["progress"] == 100
    goal_id = goals.provide()["items"][0]["id"]
    assert (
        client.post(
            "/api/widgets/task.goals/actions/progress", json={"id": goal_id, "progress": 20}
        ).status_code
        == 409
    )
    from backend.db.connection import get_connection

    assert get_connection().execute("SELECT count(*) FROM tasks").fetchone()[0] == 2


def test_invalid_and_changed_goals(client):
    for body in (
        {"title": "x"},
        {"title": "x", "target_date": "invalid"},
        {"title": "x", "target_date": "2026-10-25", "mode": "tasks", "task_ids": [999]},
        {"title": "x", "target_date": "2026-10-25", "progress": 101},
    ):
        assert client.post("/api/widgets/task.goals/actions/add", json=body).status_code == 422
    act(client, "add", {"title": "Study", "target_date": "2026-10-25"})
    goal_id = goals.provide()["items"][0]["id"]
    response = client.post(
        "/api/widgets/task.goals/actions/progress", json={"id": goal_id, "progress": 10}
    )
    act(client, "progress", {"id": goal_id, "progress": 20})
    assert (
        client.post(
            "/api/widgets/task.goals/drafts/" + response.json()["draft_id"], json={"approved": True}
        ).status_code
        == 409
    )
