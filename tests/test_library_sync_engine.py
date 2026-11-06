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

@pytest.mark.asyncio
async def test_gdrive_bridge_pagination():
    from backend.library.storage.gdrive_bridge import GoogleDriveBridge
    bridge = GoogleDriveBridge()
    with patch.object(bridge, "_execute", new_callable=AsyncMock) as mock_exec:
        # First page has 2 files and nextPageToken, second page has 1 file and no token
        mock_exec.side_effect = [
            {"files": [{"id": "1", "name": "f1"}, {"id": "2", "name": "f2"}], "nextPageToken": "token123"},
            {"files": [{"id": "3", "name": "f3"}]},
        ]
        files = await bridge.list_files_in_folder("dummy_folder")
        assert len(files) == 3
        assert [f["id"] for f in files] == ["1", "2", "3"]
        assert mock_exec.call_count == 2

@pytest.mark.asyncio
async def test_inbound_preserves_item_id_and_merges_thumb(tmp_path):
    conn = get_connection()
    store = LibraryStore(conn)
    engine = LibrarySyncEngine()

    md_file = {
        "id": "drive_md_999",
        "name": "000999-my-awesome-post.md",
        "mimeType": "text/markdown",
        "size": 250,
        "md5Checksum": "md5_hash_999",
        "parent_folder": "articles",
    }
    thumb_file = {
        "id": "drive_th_999",
        "name": "000999-thumb.jpg",
        "mimeType": "image/jpeg",
        "size": 1500,
        "md5Checksum": "md5_th_999",
        "parent_folder": "media",
    }

    with patch.object(engine.bridge, "download_file", new_callable=AsyncMock) as mock_down:
        mock_down.return_value = b"# My Awesome Post\n\nSome summary here.\n\n## Mentioned\n- tool - Figma: UI design (https://figma.com)\n"
        res_md = await engine.ingest_inbound_item(md_file)
        assert res_md["status"] == "imported"
        assert res_md["item_id"] == 999

        # Ingest thumbnail for item 999
        mock_down.return_value = b"FAKE_JPG_BYTES_12345"
        res_th = await engine.ingest_inbound_item(thumb_file)
        assert res_th["status"] == "merged_thumbnail"
        assert res_th["item_id"] == 999

        item = store.get(999)
        assert item is not None
        assert item["id"] == 999
        assert item["title"] == "My Awesome Post"
        assert item["url"] == "https://figma.com"
        assert "Figma" in item["resources"]
        assert item["thumbnail_path"] is not None
