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
