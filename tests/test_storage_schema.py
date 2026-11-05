import sqlite3
from backend.db.connection import get_connection, reset_connection

def test_storage_schema_columns_and_tables():
    reset_connection()
    conn = get_connection()
    # Check library_items columns
    cur = conn.execute("PRAGMA table_info(library_items)")
    cols = {row[1] for row in cur.fetchall()}
    assert "storage_provider" in cols
    assert "external_id" in cols
    assert "cached_locally" in cols
    assert "sync_state" in cols
    assert "checksum" in cols
    assert "last_synced_at" in cols

    # Check new tables exist
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_configurations'")
    assert cur.fetchone() is not None
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_migration_manifest'")
    assert cur.fetchone() is not None
