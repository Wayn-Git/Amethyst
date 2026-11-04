import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from starlette.testclient import TestClient

from backend.api.main import app
from backend.db.connection import reset_connection
from backend.library.store import LibraryStore
from backend.library.storage.base import StorageObject
from backend.library.storage.migration import MigrationEngine


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_library_media_serves_cloud_stored_media_without_ytdlp(tmp_path: Path, client: TestClient, monkeypatch):
    reset_connection()
    store = LibraryStore()

    # Create video item with NO local media_path (cloud-only)
    item_id = store.create(
        kind="video",
        title="Sample Stored Video",
        url="https://youtube.com/watch?v=mock_video_id",
    )

    media_bytes = b"MP4_DATA_" + b"0" * 2000

    # Mock provider reading cloud media
    mock_provider = AsyncMock()
    mock_provider.provider_id = "google_drive"
    mock_provider.read.return_value = media_bytes

    # Populate manifest with completed media entry
    from backend.db.connection import get_connection
    conn = get_connection()
    conn.execute(
        """
        INSERT INTO storage_migration_manifest (
            item_id, file_type, local_path, file_size, checksum, target_folder, status, external_id
        ) VALUES (?, 'media', '/mock/path/000001.mp4', ?, 'sha123', 'media', 'completed', 'gdrive_media_file_999')
        """,
        (item_id, len(media_bytes)),
    )
    conn.commit()

    store.update(item_id, storage_provider="google_drive", external_id="gdrive_media_file_999", cached_locally=0)

    # Patch FileContentAccessor provider lookup to return our mock provider
    with patch("backend.library.storage.accessor.FileContentAccessor._get_provider_for_name", return_value=mock_provider):
        with patch("yt_dlp.YoutubeDL") as mock_ytdlp:
            # Request media endpoint
            resp = client.get(f"/api/library/{item_id}/media")
            assert resp.status_code == 200
            assert resp.content == media_bytes
            assert resp.headers["content-type"].startswith("video/")

            # Verify yt_dlp was never called
            mock_ytdlp.assert_not_called()

            # Second call should serve from cache directly without provider read
            mock_provider.read.reset_mock()
            resp2 = client.get(f"/api/library/{item_id}/media")
            assert resp2.status_code == 200
            assert resp2.content == media_bytes
            mock_provider.read.assert_not_called()
            mock_ytdlp.assert_not_called()
