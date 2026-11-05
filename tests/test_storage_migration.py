import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from backend.db.connection import get_connection, reset_connection
from backend.library.store import LibraryStore
from backend.library.storage.base import StorageObject
from backend.library.storage.migration import MigrationEngine

@pytest.mark.asyncio
async def test_migration_engine_manifest_and_step(tmp_path: Path):
    reset_connection()
    store = LibraryStore()

    # Create local items
    f1 = tmp_path / "art1.md"
    f1.write_text("# Article 1", encoding="utf-8")
    item1 = store.create(kind="article", title="Article 1")
    store.update(item1, text_path=str(f1))

    f2 = tmp_path / "art2.md"
    f2.write_text("# Article 2", encoding="utf-8")
    item2 = store.create(kind="article", title="Article 2")
    store.update(item2, text_path=str(f2))

    mock_provider = AsyncMock()
    mock_provider.provider_id = "google_drive"
    mock_provider.write.return_value = StorageObject(
        external_id="gdrive_file_abc",
        name="art.md",
        size_bytes=11,
        mime_type="text/markdown",
        checksum="hash123",
        modified_at="2026-11-04T12:00:00Z",
    )

    engine = MigrationEngine(gdrive_provider=mock_provider)
    queued = await engine.build_manifest()
    assert queued == 2

    status = engine.get_status()
    assert status["total"] == 2
    assert status["pending"] == 2
    assert status["completed"] == 0

    # Step migration
    processed = await engine.step(batch_size=2)
    assert processed["completed"] == 2
    assert processed["failed"] == 0

    status_after = engine.get_status()
    assert status_after["completed"] == 2
    assert status_after["pending"] == 0

    # Verify library item row updated
    row1 = store.get(item1)
    assert row1["storage_provider"] == "google_drive"
    assert row1["external_id"] == "gdrive_file_abc"
