from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard import goals, items, kanban
from backend.dashboard.router import router
from backend.db.connection import get_connection, reset_connection, transaction
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


def draft(client, action, body):
    response = client.post(f"/api/widgets/task.kanban/actions/{action}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["draft_id"]


def decide(client, draft_id, approved=True):
    return client.post("/api/widgets/task.kanban/drafts/" + draft_id, json={"approved": approved})


def test_project_cards_are_existing_tasks_and_status_is_shared(client):
    assert kanban.provide()["items"] == []
    assert (
        decide(client, draft(client, "project", {"title": "Denied"}), False).json()["state"]
        == "denied"
    )
    assert kanban.provide()["items"] == []
    decide(client, draft(client, "project", {"title": "Ship"}))
    board = kanban.provide()["items"][0]
    assert [c["title"] for c in board["columns"]] == ["To do", "Doing", "Done"]
    task_id = TaskRepository().create("Real task", my_day_date="2026-10-25")
    move = {"project_id": board["id"], "id": task_id, "column_id": "in_progress"}
    move_draft = draft(client, "move", move)
    assert TaskRepository().get(task_id)["status"] == "todo"
    assert decide(client, move_draft).status_code == 200
    assert decide(client, move_draft).status_code == 409
    reset_connection()
    assert TaskRepository().get(task_id)["list_id"] == board["id"]
    assert TaskRepository().get(task_id)["status"] == "in_progress"
    assert items.provide("task.today")["items"][0]["id"] == task_id
    move["column_id"] = "done"
    decide(client, draft(client, "move", move))
    assert items.provide("task.today")["items"] == []
    assert TaskRepository().get(task_id)["completed_at"] == "2026-10-25T00:01:00+05:30"
    assert get_connection().execute("SELECT count(*) FROM tasks").fetchone()[0] == 1
    move["column_id"] = "todo"
    decide(client, draft(client, "move", move))
    assert TaskRepository().get(task_id)["completed_at"] is None
    assert items.provide("task.today")["items"][0]["id"] == task_id


def test_edit_columns_and_external_status_changes(client):
    decide(client, draft(client, "project", {"title": "Ship"}))
    board = kanban.provide()["items"][0]
    cols = [*board["columns"], {"id": "review", "title": "Review", "status": "in_progress"}]
    cols[0]["title"] = "Ready"
    decide(client, draft(client, "configure", {"project_id": board["id"], "columns": cols}))
    task_id = TaskRepository().create("Real task")
    decide(
        client,
        draft(client, "move", {"project_id": board["id"], "id": task_id, "column_id": "review"}),
    )
    reset_connection()
    assert kanban.provide()["items"][0]["cards"][0]["column_id"] == "review"
    TaskRepository().update(task_id, status="done")
    assert kanban.provide()["items"][0]["cards"][0]["column_id"] == "done"
    decide(client, draft(client, "configure", {"project_id": board["id"], "columns": cols[:3]}))
    assert kanban.provide()["items"][0]["columns"][0]["title"] == "Ready"
    for columns in ([], cols[:1], [cols[0], cols[0], *cols[1:3]]):
        assert (
            client.post(
                "/api/widgets/task.kanban/actions/configure",
                json={"project_id": board["id"], "columns": columns},
            ).status_code
            == 422
        )


def test_changed_rows_source_managed_and_cache_invalidation(client):
    decide(client, draft(client, "project", {"title": "Ship"}))
    project_id = kanban.provide()["items"][0]["id"]
    task_id = TaskRepository().create("Local")
    move = {"project_id": project_id, "id": task_id, "column_id": "done"}
    pending = draft(client, "move", move)
    TaskRepository().update(task_id, title="Changed")
    assert decide(client, pending).status_code == 409
    external_id = TaskRepository().create(
        "Remote", external_source="microsoft_todo", external_id="fixture"
    )
    assert (
        client.post(
            "/api/widgets/task.kanban/actions/move", json={**move, "id": external_id}
        ).status_code
        == 409
    )
    with transaction() as conn:
        external_project = conn.execute(
            "INSERT INTO task_lists(name,external_source) VALUES('Remote','microsoft_todo')"
        ).lastrowid
    assert (
        client.post(
            "/api/widgets/task.kanban/actions/move", json={**move, "project_id": external_project}
        ).status_code
        == 404
    )
    goal_draft = client.post(
        "/api/widgets/task.goals/actions/add",
        json={"title": "Ship", "target_date": "2026-10-25", "mode": "tasks", "task_ids": [task_id]},
    ).json()["draft_id"]
    client.post("/api/widgets/task.goals/drafts/" + goal_draft, json={"approved": True})
    client.get("/api/widgets/task.goals/data")
    decide(client, draft(client, "move", move))
    assert client.get("/api/widgets/task.goals/data").json()["stale"]
    assert goals.provide()["items"][0]["progress"] == 100
