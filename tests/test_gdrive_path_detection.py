import pytest
from unittest.mock import AsyncMock, patch
from backend.library.storage.gdrive_bridge import GoogleDriveBridge, MARKER_FILE_NAME

@pytest.mark.asyncio
async def test_detect_library_root_rejects_unverified_personal_folder():
    bridge = GoogleDriveBridge()
    # Mock finding an existing "amethyst" folder with random personal files (no marker, no library subfolders)
    with patch.object(bridge, "_execute", new_callable=AsyncMock) as mock_exec:
        def side_effect(action, params):
            if action == "GOOGLEDRIVE_FIND_FILE":
                # Searching for .amethyst-library.json returns empty
                if MARKER_FILE_NAME in params.get("q", ""):
                    return {"files": []}
                # Searching for files inside root returns empty
                return {"files": []}
            if action == "GOOGLEDRIVE_FIND_FOLDER":
                if params.get("name_exact") in ("Amethyst", "amethyst"):
                    # Simulating pre-existing personal folder
                    return {"files": [{"id": "personal_folder_999", "name": "amethyst"}]}
                if params.get("parent_folder_id") == "personal_folder_999":
                    # No "Library" subfolder inside
                    return {"files": []}
            return {"files": []}
        mock_exec.side_effect = side_effect

        result = await bridge.detect_library_root(mode="auto")
        # Must NOT auto-use the personal folder without verification marker
        assert result["folder_id"] != "personal_folder_999"
        assert result.get("warning") is not None
        assert "unverified" in result["warning"].lower()

@pytest.mark.asyncio
async def test_detect_library_root_finds_marker_file():
    bridge = GoogleDriveBridge()
    with patch.object(bridge, "_execute", new_callable=AsyncMock) as mock_exec:
        def side_effect(action, params):
            if action == "GOOGLEDRIVE_FIND_FILE":
                if MARKER_FILE_NAME in params.get("q", ""):
                    return {
                        "files": [{
                            "id": "marker_123",
                            "name": MARKER_FILE_NAME,
                            "parents": ["verified_folder_456"],
                        }]
                    }
                return {"files": []}
            return {"files": []}
        mock_exec.side_effect = side_effect

        result = await bridge.detect_library_root(mode="auto")
        assert result["verified"] is True
        assert result["folder_id"] == "verified_folder_456"
        assert result["marker_present"] is True

@pytest.mark.asyncio
async def test_ensure_verified_root_writes_marker():
    bridge = GoogleDriveBridge()
    with patch.object(bridge, "_execute", new_callable=AsyncMock) as mock_exec, \
         patch.object(bridge, "upload_file", new_callable=AsyncMock) as mock_upload:
        
        # Mock creating folder
        mock_exec.return_value = {"id": "new_lib_folder_789"}
        mock_upload.return_value = {"id": "marker_file_id"}

        folder_id = await bridge.ensure_verified_root("Amethyst/Library", write_marker=True)
        assert folder_id is not None
        assert mock_upload.called
        call_args = mock_upload.call_args[1]
        assert call_args["name"] == MARKER_FILE_NAME
        assert b"library_root" in call_args["content"]
