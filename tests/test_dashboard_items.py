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


def test_today_crud_requires_approval_and_persists(client):
    draft = propose(client, "add", {"title": "Test task"})
    assert provide("task.today")["items"] == []
    assert decide(client, draft, False).json()["state"] == "denied"
    assert provide("task.today")["items"] == []
    draft = propose(client, "add", {"title": "Test task"})
    assert decide(client, draft).json()["state"] == "applied"
    assert decide(client, draft).status_code == 409
    reset_connection()
    item = provide("task.today")["items"][0]
    draft = propose(client, "edit", {"id": item["id"], "title": "Edited task"})
    assert provide("task.today")["items"][0]["title"] == "Test task"
    assert decide(client, draft).status_code == 200
    assert provide("task.today")["items"][0]["title"] == "Edited task"
    draft = propose(client, "complete", {"id": item["id"]})
    assert decide(client, draft).status_code == 200
    assert provide("task.today")["items"] == []
    draft = propose(client, "delete", {"id": item["id"]})
    assert decide(client, draft).status_code == 200
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
