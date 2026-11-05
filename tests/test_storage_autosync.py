import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.db.connection import reset_connection, get_connection
from backend.library.store import LibraryStore
from backend.library.storage.base import StorageObject
from backend.library.storage.config import StorageConfigStore
from backend.library.storage.migration import MigrationEngine
from backend.library.storage.sync import is_auto_sync_enabled, auto_sync_item, trigger_auto_sync


@pytest.mark.asyncio
async def test_build_manifest_for_item_and_sync_item(tmp_path: Path):
    reset_connection()
    store = LibraryStore()

    # Create an item with text and media
    t_file = tmp_path / "note.md"
    t_file.write_text("# Auto-sync test content", encoding="utf-8")

    m_file = tmp_path / "sample.mp4"
    m_file.write_bytes(b"MP4_DATA_" + b"1" * 1500)

    item_id = store.create(kind="video", title="Auto Sync Item")
    store.update(item_id, text_path=str(t_file), media_path=str(m_file))

    mock_provider = AsyncMock()
    mock_provider.provider_id = "google_drive"
    mock_provider.write.return_value = StorageObject(
        external_id="gdrive_auto_synced_id",
        name="sample.mp4",
        size_bytes=len(m_file.read_bytes()),
        mime_type="video/mp4",
        checksum="hash123",
        modified_at="2026-11-04T12:00:00Z",
    )

    engine = MigrationEngine(gdrive_provider=mock_provider)

    # Test build_manifest_for_item
    queued = await engine.build_manifest_for_item(item_id)
    assert queued == 2

    # Verify manifest rows exist in pending state
    conn = get_connection()
    rows = conn.execute(
        "SELECT file_type, status FROM storage_migration_manifest WHERE item_id = ? ORDER BY file_type ASC",
        (item_id,),
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["file_type"] == "media" and rows[0]["status"] == "pending"
    assert rows[1]["file_type"] == "text" and rows[1]["status"] == "pending"

    # Test sync_item
    res = await engine.sync_item(item_id)
    assert res["synced"] is True
    assert res["uploaded"] == 2

    # Verify rows completed
    rows_after = conn.execute(
        "SELECT file_type, status, external_id FROM storage_migration_manifest WHERE item_id = ? ORDER BY file_type ASC",
        (item_id,),
    ).fetchall()
    assert rows_after[0]["status"] == "completed"
    assert rows_after[1]["status"] == "completed"

    item_row = store.get(item_id)
    assert item_row["storage_provider"] == "google_drive"
    assert item_row["sync_state"] == "synced"


@pytest.mark.asyncio
async def test_auto_sync_trigger_gating(tmp_path: Path):
    reset_connection()
    cfg_store = StorageConfigStore()

    # Case 1: Disabled
    cfg_store.update_config(active_provider="local", auto_upload_new=0)
    assert is_auto_sync_enabled() is False

    # Case 2: Enabled via auto_upload_new = 1
    cfg_store.update_config(auto_upload_new=1)
    assert is_auto_sync_enabled() is True

    # Case 3: Enabled via active_provider = google_drive
    cfg_store.update_config(auto_upload_new=0, active_provider="google_drive")
    assert is_auto_sync_enabled() is True
