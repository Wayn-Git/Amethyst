import pytest
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.db.connection import reset_connection
from backend.library.storage.config import StorageConfigStore

def test_storage_config_defaults_and_updates():
    reset_connection()
    store = StorageConfigStore()
    cfg = store.get_config()
    assert cfg["active_provider"] == "local"
    assert cfg["gdrive_root_name"] == "Amethyst/Library"
    assert cfg["auto_upload_new"] == 0

    updated = store.update_config(
        active_provider="google_drive",
        gdrive_root_id="folder_abc123",
        gdrive_root_name="My GDrive Knowledge",
        auto_upload_new=1,
    )
    assert updated["active_provider"] == "google_drive"
    assert updated["gdrive_root_id"] == "folder_abc123"
    assert updated["gdrive_root_name"] == "My GDrive Knowledge"
    assert updated["auto_upload_new"] == 1

    re_read = store.get_config()
    assert re_read["active_provider"] == "google_drive"
    assert re_read["gdrive_root_id"] == "folder_abc123"


def test_storage_config_endpoints():
    reset_connection()
    client = TestClient(app)
    res = client.get("/api/storage/config")
    assert res.status_code == 200
    data = res.json()
    assert data["active_provider"] == "local"

    patch_res = client.patch(
        "/api/storage/config",
        json={"active_provider": "google_drive", "gdrive_root_id": "root_999"},
    )
    assert patch_res.status_code == 200
    patched = patch_res.json()
    assert patched["active_provider"] == "google_drive"
    assert patched["gdrive_root_id"] == "root_999"
