"""Global search is read-only; capture reuses the existing draft gate."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dashboard.router import router
from backend.dashboard.search import search
from backend.dashboard.store import cache_write


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


async def test_search_all_sources_and_actions(db, monkeypatch):
    from backend.dashboard.search import LibraryService

    async def library(self, query, limit):
        assert query == "today"
        self.last_search_degraded = False
        return [{"id": 4, "title": "Today note"}]

    monkeypatch.setattr(LibraryService, "search", library)
    db.execute("INSERT INTO tasks(title,status) VALUES('Today task','todo')")
    db.commit()
    cache_write("task.today", {"items": [{"id": 1, "title": "Today cached task"}]}, "ok")
    result = await search("today")
    assert {item["group"] for item in result["items"]} == {
        "Tasks",
        "Widgets",
        "Actions",
        "Library",
        "Widget items",
    }
    assert all(item["href"].startswith("/today?") for item in result["items"])
    assert not result["degraded"]
    assert db.execute("SELECT count(*) FROM tasks").fetchone()[0] == 1


async def test_empty_literal_search_and_library_failure(db, monkeypatch):
    from backend.dashboard.search import LibraryService

    async def unavailable(*args, **kwargs):
        raise RuntimeError("Offline")

    monkeypatch.setattr(LibraryService, "search", unavailable)
    assert (await search("  "))["items"] == []
    db.execute("INSERT INTO tasks(title,status) VALUES('100% task','todo')")
    db.execute("INSERT INTO tasks(title,status) VALUES('Other task','todo')")
    db.commit()
    result = await search("%")
    assert [item["title"] for item in result["items"] if item["group"] == "Tasks"] == ["100% task"]
    assert result["degraded"]


def test_search_source_and_capture_gate(client, db):
    item_id = db.execute("INSERT INTO tasks(title,status) VALUES('Real task','todo')").lastrowid
    db.commit()
    assert client.get(f"/api/dashboard/search/tasks/{item_id}").json()["title"] == "Real task"
    assert client.get("/api/dashboard/search/unknown/1").status_code == 404
    assert client.get("/api/dashboard/search/library/999").status_code == 404
    assert client.get("/api/dashboard/search?q=" + "x" * 501).status_code == 422
    draft = client.post(
        "/api/widgets/lib.capture/actions/add",
        json={"title": "Captured fixture", "text": "Body fixture"},
    )
    assert draft.status_code == 200
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
    result = client.post(
        "/api/widgets/lib.capture/drafts/" + draft.json()["draft_id"], json={"approved": False}
    )
    assert result.status_code == 200
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
