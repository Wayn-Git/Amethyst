import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from backend.api.main import app


def test_library_sync_status():
    client = TestClient(app)
    res = client.get("/api/library/sync/status")
    assert res.status_code == 200
    data = res.json()
    assert "stage" in data
    assert "is_running" in data
    assert "found_drive_items" in data
    assert "inbound_imported" in data


def test_library_sync_cancel():
    client = TestClient(app)
    res = client.post("/api/library/sync/cancel")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "cancelling"


def test_library_sync_detect_path_mocked():
    client = TestClient(app)
    with patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.is_connected", return_value=True), \
         patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.detect_library_root", new_callable=AsyncMock) as mock_detect:
        mock_detect.return_value = {
            "verified": True,
            "folder_id": "folder_123",
            "folder_path": "Amethyst/library",
            "marker_present": True,
            "file_count": 5,
            "warning": None,
        }
        res = client.post("/api/library/sync/detect-path", json={"mode": "auto"})
        assert res.status_code == 200
        assert res.json()["folder_id"] == "folder_123"
        assert res.json()["file_count"] == 5


def test_library_sync_start_mocked():
    client = TestClient(app)
    with patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.is_connected", return_value=True), \
         patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.ensure_verified_root", new_callable=AsyncMock) as mock_root, \
         patch("backend.library.storage.sync_engine.LibrarySyncEngine.run_two_way_sync", new_callable=AsyncMock) as mock_run:
        mock_root.return_value = "folder_root_abc"
        mock_run.return_value = {"is_running": False, "stage": "complete"}
        res = client.post("/api/library/sync/start", json={"root_path": "Amethyst/library"})
        assert res.status_code == 200
        assert res.json()["status"] == "started"
