import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from backend.db.connection import reset_connection
from backend.library.service import LibraryService, as_dict
from backend.library.store import LibraryStore
from backend.library.storage.base import StorageObject
from backend.library.storage.migration import MigrationEngine
from backend.library.storage.accessor import FileContentAccessor

@pytest.mark.asyncio
async def test_end_to_end_library_gdrive_migration_and_access(tmp_path: Path):
    reset_connection()
    store = LibraryStore()

    # 1. User creates a local library item
    local_text = tmp_path / "000001-deep-dive.md"
    local_text.write_text("# Deep Dive into Distributed Systems\n\nFull article body here.", encoding="utf-8")
    item_id = store.create(kind="article", title="Deep Dive into Distributed Systems", category="technology")
    store.update(item_id, text_path=str(local_text))

    # Verify item initially local
    initial_row = store.get(item_id)
    assert initial_row["storage_provider"] == "local"
    assert initial_row["external_id"] is None

    # 2. Mock Google Drive Provider
    mock_gdrive = AsyncMock()
    mock_gdrive.provider_id = "google_drive"
    mock_gdrive.write.return_value = StorageObject(
        external_id="gdrive_file_xyz789",
        name="000001-deep-dive.md",
        size_bytes=len(local_text.read_bytes()),
        mime_type="text/markdown",
        checksum="dummy_checksum_123",
        modified_at="2026-11-04T12:00:00Z",
    )
    mock_gdrive.read.return_value = b"# Deep Dive into Distributed Systems\n\nFull article body here."

    # 3. Run migration engine
    engine = MigrationEngine(gdrive_provider=mock_gdrive)
    queued = await engine.build_manifest()
    assert queued == 1

    mig_result = await engine.step(batch_size=5)
    assert mig_result["completed"] == 1
    assert mig_result["failed"] == 0

    # 4. Verify item updated to Google Drive provider
    migrated_row = store.get(item_id)
    assert migrated_row["storage_provider"] == "google_drive"
    assert migrated_row["external_id"] == "gdrive_file_xyz789"
    assert migrated_row["sync_state"] == "synced"

    # 5. Access content via FileContentAccessor (even if local original is moved/deleted)
    moved_path = tmp_path / "moved_original.md"
    local_text.rename(moved_path)

    cache_dir = tmp_path / "cache"
    accessor = FileContentAccessor(cache_dir=cache_dir, gdrive_provider=mock_gdrive)
    retrieved_text = await accessor.get_text(item_id)
    assert "Deep Dive into Distributed Systems" in retrieved_text
    assert "Full article body here" in retrieved_text

    # 6. Verify as_dict returns correct metadata and content
    dict_item = as_dict(store.get(item_id), include_content=True)
    assert dict_item["storage_provider"] == "google_drive"
    assert dict_item["external_id"] == "gdrive_file_xyz789"
    assert "Deep Dive into Distributed Systems" in dict_item["title"]
