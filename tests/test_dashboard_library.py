from backend.dashboard.library import provide
from backend.library.service import LibraryService


async def test_inbox_uses_library(db, monkeypatch):
    monkeypatch.setattr(LibraryService, "recent", lambda self, **kwargs: [])
    assert await provide("lib.inbox") == {"items": []}
    monkeypatch.setattr(LibraryService, "recent", lambda self, **kwargs: [{"id": 1, "title": "Saved", "kind": "note", "notes": "private"}])
    items = (await provide("lib.inbox"))["items"]
    assert items[0]["title"] == "Saved"
    assert "notes" not in items[0]
