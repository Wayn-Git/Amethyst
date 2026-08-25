from backend.dashboard.library import provide
from backend.library.service import LibraryService


async def test_inbox_uses_library(db, monkeypatch):
    monkeypatch.setattr(LibraryService, "recent", lambda self, **kwargs: [])
    assert await provide("lib.inbox") == {"items": []}
    monkeypatch.setattr(
        LibraryService,
        "recent",
        lambda self, **kwargs: [{"id": 1, "title": "Saved", "kind": "note", "notes": "private"}],
    )
    items = (await provide("lib.inbox"))["items"]
    assert items[0]["title"] == "Saved"
    assert "notes" not in items[0]


async def test_resurface_searches_context_and_explains_old_notes(db, monkeypatch):
    monkeypatch.setattr(LibraryService, "recent", lambda self, **kwargs: [{"title": "Gardening"}])

    async def search(self, query, **kwargs):
        assert query == "Gardening"
        return [
            {"id": 1, "title": "Seeds", "kind": "note", "created_at": "2020-01-01"},
            {"id": 2, "title": "Article", "kind": "article", "created_at": "2020-01-01"},
            {"id": 3, "title": "Undated", "kind": "note"},
        ]

    monkeypatch.setattr(LibraryService, "search", search)
    items = (await provide("lib.resurface"))["items"]
    assert [item["id"] for item in items] == [1]
    assert items[0]["reason"] == "Recent capture: Gardening"


async def test_capture_requires_review_and_persists_markdown(db, monkeypatch):
    from pathlib import Path

    import pytest
    from fastapi import HTTPException

    from backend.dashboard.items import ItemInput, decide, draft
    from backend.retrieval.indexer import Indexer

    async def index(self, *args, **kwargs):
        return 0

    monkeypatch.setattr(Indexer, "index_file", index)
    body = ItemInput(title="Vault fixture", text="Body fixture")
    rejected = draft("lib.capture", "add", body)
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
    assert await decide("lib.capture", rejected["draft_id"], False) == {"state": "denied"}
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
    accepted = draft("lib.capture", "add", body)
    assert await decide("lib.capture", accepted["draft_id"], True) == {"state": "applied"}
    row = db.execute("SELECT * FROM library_items").fetchone()
    assert row["kind"] == "note"
    assert Path(row["text_path"]).read_text() == "# Vault fixture\n\nBody fixture\n"
    with pytest.raises(HTTPException) as error:
        await decide("lib.capture", accepted["draft_id"], True)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        draft("lib.capture", "add", ItemInput(title="Blank", text="  "))


async def test_capture_gate_can_refuse_approval(db, monkeypatch):
    from types import SimpleNamespace

    from backend.dashboard.items import ItemInput, decide, draft
    from backend.security.confirmation import ConfirmationService

    async def deny(*args, **kwargs):
        return SimpleNamespace(allowed=False, decision="denied")

    monkeypatch.setattr(ConfirmationService, "check", deny)
    pending = draft("lib.capture", "add", ItemInput(title="Denied", text="Never saved"))
    assert await decide("lib.capture", pending["draft_id"], True) == {"state": "denied"}
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0


async def test_search_uses_existing_hybrid_search(db, monkeypatch):
    from backend.dashboard.store import settings_write

    assert (await provide("lib.search"))["items"] == []
    settings_write("lib.search", {"query": "Seeds"})

    async def search(self, query, **kwargs):
        assert query == "Seeds"
        self.last_search_degraded = "offline"
        return [{"id": 1, "title": "Garden", "excerpt": "Seeds passage"}]

    monkeypatch.setattr(LibraryService, "search", search)
    result = await provide("lib.search")
    assert result["items"][0]["excerpt"] == "Seeds passage"
    assert result["degraded"] == "offline"


def test_search_settings_validation(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.dashboard.router import router

    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.put("/api/widgets/lib.search/settings", json={"query": ""}).status_code == 200
        assert (
            client.put("/api/widgets/lib.search/settings", json={"query": "a" * 501}).status_code
            == 422
        )
        assert client.put("/api/widgets/lib.search/settings", json={"extra": 1}).status_code == 422


async def test_recent_orders_notes_by_edit_not_capture_date(db):
    from backend.library.store import LibraryStore

    assert await provide("lib.recent") == {"items": []}
    store = LibraryStore(db)
    first = store.create(kind="note", title="Edited earlier")
    second = store.create(kind="note", title="Edited later")
    store.create(kind="article", title="Not a note")
    db.execute("UPDATE library_items SET updated_at='2020-01-01' WHERE id=?", (first,))
    db.execute("UPDATE library_items SET updated_at='2021-01-01' WHERE id=?", (second,))
    db.commit()
    assert [r["id"] for r in (await provide("lib.recent"))["items"]] == [second, first]


async def test_duplicates_reuse_library_identity_lookups(db):
    from backend.library.store import LibraryStore

    store = LibraryStore(db)
    assert await provide("lib.dupes") == {"items": []}
    old = store.create(kind="article", title="Old", url="https://example.com/item")
    latest = store.create(kind="article", title="Latest", url="https://example.com/item")
    ref_old = store.create(kind="note", title="Old ref", source_ref="capture:1")
    ref_latest = store.create(kind="note", title="Latest ref", source_ref="capture:1")
    store.create(kind="note", title="Old")
    items = (await provide("lib.dupes"))["items"]
    assert {item["id"]: item["duplicate_of"] for item in items} == {
        old: latest,
        ref_old: ref_latest,
    }
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 5


async def test_ask_is_grounded_in_retrieved_notes(db, monkeypatch):
    from backend.dashboard.store import settings_write

    settings_write("lib.ask", {"query": "seeds"})

    async def search(self, *args, **kwargs):
        return [
            {"id": 1, "kind": "note", "title": "Garden", "excerpt": "Sow in spring."},
            {"id": 2, "kind": "article", "excerpt": "Excluded"},
        ]

    monkeypatch.setattr(LibraryService, "search", search)

    async def ask(*args, **kwargs):
        assert kwargs["paid_ok"] is False
        return {"text": '{"quotes": [{"id": 1, "text": "Sow in spring."}]}'}

    monkeypatch.setattr("backend.workers.llm.ask", ask)
    result = await provide("lib.ask")
    assert result["answer"] == "Sow in spring."
    assert [x["id"] for x in result["items"]] == [1]
    settings_write("lib.ask", {"query": ""})
    assert (await provide("lib.ask"))["answer"] == "not in your notes"


async def test_ask_rejects_unsourced_model_text(db, monkeypatch):
    import pytest

    from backend.dashboard.store import settings_write

    settings_write("lib.ask", {"query": "seeds"})

    async def search(*args, **kwargs):
        return [{"id": 1, "kind": "note", "excerpt": "Sow in spring."}]

    async def ask(*args, **kwargs):
        return {"text": '{"quotes": [{"id": 1, "text": "Invented"}]}'}

    monkeypatch.setattr(LibraryService, "search", search)
    monkeypatch.setattr("backend.workers.llm.ask", ask)
    with pytest.raises(ValueError, match="unsourced"):
        await provide("lib.ask")


async def test_readlater_reviews_url_and_rejects_replay(db, monkeypatch):
    import pytest
    from fastapi import HTTPException

    from backend.dashboard.items import decide
    from backend.dashboard.library import LibraryInput, draft
    from backend.retrieval.indexer import Indexer

    async def index(*args, **kwargs):
        return 0

    monkeypatch.setattr(Indexer, "index_file", index)
    body = LibraryInput(title="Article fixture", url="https://example.com/story")
    pending = draft("lib.readlater", "add", body)
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
    await decide("lib.readlater", pending["draft_id"], False)
    assert db.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
    pending = draft("lib.readlater", "add", body)
    await decide("lib.readlater", pending["draft_id"], True)
    assert db.execute("SELECT url FROM library_items").fetchone()[0] == body.url
    with pytest.raises(HTTPException):
        await decide("lib.readlater", pending["draft_id"], True)
    with pytest.raises(HTTPException):
        draft("lib.readlater", "add", LibraryInput(title="bad", url="file:///etc/passwd"))


async def test_readlater_audits_redirects_and_reuses_cached_summary(db, monkeypatch):
    import httpx

    from backend.dashboard.store import cache_write
    from backend.library.store import LibraryStore
    from backend.web import reader

    store = LibraryStore(db)
    item_id = store.create(kind="article", title="Fixture", url="https://example.com/start")

    async def safe(*args):
        pass

    monkeypatch.setattr(reader, "check_url_async", safe)

    def handle(request):
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/finish"})
        return httpx.Response(200, text="A saved article about growing spring seeds.")

    client = httpx.AsyncClient
    monkeypatch.setattr(
        reader.httpx,
        "AsyncClient",
        lambda **kw: client(transport=httpx.MockTransport(handle), **kw),
    )

    async def ask(*args, **kwargs):
        return {
            "text": __import__("json").dumps(
                {"summaries": [{"id": item_id, "summary": "Grow spring seeds."}]}
            )
        }

    monkeypatch.setattr("backend.workers.llm.ask", ask)
    payload = await provide("lib.readlater")
    assert payload["items"][0]["summary"] == "Grow spring seeds."
    assert (
        db.execute(
            "SELECT count(*) FROM execution_logs WHERE tool_name='dashboard_page_fetch'"
        ).fetchone()[0]
        == 2
    )
    cache_write("lib.readlater", payload, "ok")
    assert await provide("lib.readlater") == payload
    assert (
        db.execute(
            "SELECT count(*) FROM execution_logs WHERE tool_name='dashboard_page_fetch'"
        ).fetchone()[0]
        == 2
    )
