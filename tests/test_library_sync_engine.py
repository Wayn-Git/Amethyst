import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from backend.library.storage.sync_engine import LibrarySyncEngine
from backend.library.store import LibraryStore
from backend.db.connection import get_connection

@pytest.mark.asyncio
async def test_inbound_ingestion_and_deduplication(tmp_path):
    conn = get_connection()
    store = LibraryStore(conn)
    engine = LibrarySyncEngine()

    mock_drive_file = {
        "id": "drive_file_abc_1",
        "name": "Design Principles.md",
        "mimeType": "text/markdown",
        "size": 250,
        "md5Checksum": "md5_hash_123",
        "parent_folder": "articles",
    }

    with patch.object(engine.bridge, "download_file", new_callable=AsyncMock) as mock_down:
        mock_down.return_value = b"# Design Principles\n\nContent here."
        res = await engine.ingest_inbound_item(mock_drive_file)
        assert res["status"] == "imported"
        assert res["item_id"] is not None

        # Verify second ingestion of identical file deduplicates and skips
        res_dup = await engine.ingest_inbound_item(mock_drive_file)
        assert res_dup["status"] == "skipped"

@pytest.mark.asyncio
async def test_scan_drive_items_traverses_subfolders():
    engine = LibrarySyncEngine()
    with patch.object(engine.bridge, "list_files_in_folder", new_callable=AsyncMock) as mock_list, \
         patch.object(engine.bridge, "_find_folder", new_callable=AsyncMock) as mock_find:
        
        # Mock subfolders
        mock_find.side_effect = lambda name, parent: f"folder_{name}_id"
        mock_list.side_effect = lambda fid: [
            {"id": f"file_{fid}_1", "name": f"doc_{fid}.md", "mimeType": "text/markdown"}
        ]

        items = await engine.scan_drive_items("root_123")
        assert len(items) >= 1
        assert any("doc_" in it["name"] for it in items)

@pytest.mark.asyncio
async def test_run_two_way_sync():
    engine = LibrarySyncEngine()
    with patch.object(engine, "scan_drive_items", new_callable=AsyncMock) as mock_scan, \
         patch.object(engine, "ingest_inbound_item", new_callable=AsyncMock) as mock_ingest, \
         patch("backend.library.storage.migration.MigrationEngine.step", new_callable=AsyncMock) as mock_step:
        
        mock_scan.return_value = [{"id": "f1", "name": "Test.md", "mimeType": "text/markdown"}]
        mock_ingest.return_value = {"status": "imported", "item_id": 100}
        mock_step.side_effect = [{"completed": 1, "failed": 0}, {"completed": 0, "failed": 0}]

        status = await engine.run_two_way_sync("root_123")
        assert status["is_running"] is False
        assert status["stage"] == "complete"
        assert status["inbound_imported"] == 1
        assert status["uploaded_outbound"] == 1
