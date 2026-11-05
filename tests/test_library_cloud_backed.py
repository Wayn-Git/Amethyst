import pytest
from pathlib import Path
from backend.db.connection import reset_connection
from backend.library.service import LibraryService, as_dict
from backend.library.store import LibraryStore
from backend.config import paths

def test_as_dict_reads_from_cache_when_local_file_moved(tmp_path: Path):
    reset_connection()
    store = LibraryStore()
    item_id = store.create(kind="article", title="Cloud Item")

    # Simulate cached file for cloud item with title and body
    cache_dir = paths().home / "cache" / "library"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{item_id:06d}-text.md"
    cache_file.write_text("# Cached Cloud Title\n\nCached Cloud Body Content", encoding="utf-8")

    store.update(
        item_id,
        storage_provider="google_drive",
        external_id="gdrive_999",
        text_path="/nonexistent/local/path.md",
        cached_locally=1,
    )

    row = store.get(item_id)
    d = as_dict(row, include_content=True)
    assert d["content"] == "# Cached Cloud Title\n\nCached Cloud Body Content"
    assert "Cached Cloud Body Content" in d.get("excerpt", "")
