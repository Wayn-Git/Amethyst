import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.base import StorageUnavailableError, StorageNotFoundError
from backend.library.storage.gdrive_bridge import GoogleDriveBridge

@pytest.mark.asyncio
async def test_gdrive_bridge_connection_check():
    bridge = GoogleDriveBridge()
    with patch("backend.library.storage.gdrive_bridge.composio_service") as mock_cs:
        mock_cs.is_configured.return_value = True
        mock_cs.get_connections.return_value = {
            "googledrive": {"status": "ACTIVE", "id": "acc_123", "email": "test@gmail.com"}
        }
        mock_cs.is_reauth_required.return_value = False

        status = bridge.get_connection_status()
        assert status["connected"] is True
        assert status["account_email"] == "test@gmail.com"
        assert bridge.is_connected() is True


@pytest.mark.asyncio
async def test_gdrive_bridge_root_folder_creation():
    mock_executor = AsyncMock()
    # 1. Search Amethyst folder -> not found
    # 2. Create Amethyst folder -> returns folder_1
    # 3. Create Library folder inside folder_1 -> returns folder_2
    mock_executor.side_effect = [
        {"files": []},  # Search Amethyst
        {"id": "folder_amethyst", "name": "Amethyst"},  # Create Amethyst
        {"files": []},  # Search Library in Amethyst
        {"id": "folder_library", "name": "Library"},  # Create Library
    ]

    bridge = GoogleDriveBridge(action_executor=mock_executor)
    root_id = await bridge.ensure_root_folder("Amethyst/Library")
    assert root_id == "folder_library"
    assert mock_executor.call_count == 4


@pytest.mark.asyncio
async def test_gdrive_bridge_upload_and_download():
    mock_executor = AsyncMock()
    mock_executor.side_effect = [
        {"id": "file_123", "name": "note.md", "size": 12, "md5Checksum": "abc123md5"},
        b"# Note text",
    ]

    bridge = GoogleDriveBridge(action_executor=mock_executor)
    uploaded = await bridge.upload_file(
        name="note.md",
        content=b"# Note text",
        mime_type="text/markdown",
        parent_id="folder_library",
    )
    assert uploaded["id"] == "file_123"
    assert uploaded["size"] == 12

    content = await bridge.download_file("file_123")
    assert content == b"# Note text"
