import pytest
from unittest.mock import AsyncMock
from backend.library.storage.base import StorageObject
from backend.library.storage.gdrive import GoogleDriveProvider

@pytest.mark.asyncio
async def test_gdrive_provider_operations():
    mock_bridge = AsyncMock()
    mock_bridge.upload_file.return_value = {
        "id": "gdrive_file_1",
        "name": "doc.md",
        "size": 16,
        "mimeType": "text/markdown",
        "md5Checksum": "abc123md5",
        "modifiedTime": "2026-11-04T12:00:00Z",
    }
    mock_bridge.download_file.return_value = b"# Sample Content"
    mock_bridge.delete_file.return_value = True
    mock_bridge.list_files_in_folder.return_value = [
        {
            "id": "gdrive_file_1",
            "name": "doc.md",
            "size": 16,
            "mimeType": "text/markdown",
            "modifiedTime": "2026-11-04T12:00:00Z",
        }
    ]
    mock_bridge.get_or_create_subfolder.return_value = "sub_articles"

    provider = GoogleDriveProvider(bridge=mock_bridge, root_folder_id="root_folder_123")
    assert provider.provider_id == "google_drive"

    # Write file
    obj = await provider.write(
        name="doc.md",
        data=b"# Sample Content",
        mime_type="text/markdown",
        parent_folder_id="articles",
    )
    assert isinstance(obj, StorageObject)
    assert obj.external_id == "gdrive_file_1"
    assert obj.size_bytes == 16

    # Read file
    content = await provider.read("gdrive_file_1")
    assert content == b"# Sample Content"

    # List folder
    files = await provider.list_folder("articles")
    assert len(files) == 1
    assert files[0].external_id == "gdrive_file_1"

    # Delete file
    deleted = await provider.delete("gdrive_file_1")
    assert deleted is True
