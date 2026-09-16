import json
import pytest
import sqlite3
from backend.library.store import LibraryStore
from backend.library.service import as_dict

def test_store_entity_column_and_as_dict(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE library_items (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            kind         TEXT NOT NULL,
            title        TEXT NOT NULL,
            url          TEXT,
            author       TEXT,
            site         TEXT,
            published_on TEXT,
            consumed_on  TEXT NOT NULL,
            notes        TEXT,
            rating       INTEGER,
            source_ref   TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    store = LibraryStore(conn)
    cols = [col[1] for col in conn.execute("PRAGMA table_info(library_items)").fetchall()]
    assert "entity" in cols

    item_id = store.create(kind="video", title="Remain Calm", consumed_on="2026-10-18")
    entity_data = {
        "title": "Remain Calm",
        "subtitle": "Jake Lewis · Horror Comedy",
        "rating": "10.0/10 TMDB",
        "attributes": {"Genre": "Horror", "Runtime": "13 min"}
    }
    store.update(item_id, entity=json.dumps(entity_data))
    row = store.get(item_id)
    d = as_dict(row)
    assert d["entity"] == entity_data
