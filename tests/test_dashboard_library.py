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
