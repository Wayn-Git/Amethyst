import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.db.connection import reset_connection

def test_migration_endpoints_lifecycle():
    reset_connection()
    client = TestClient(app)

    # 1. Check initial status
    res = client.get("/api/storage/migration/status")
    assert res.status_code == 200
    status = res.json()
    assert "total" in status
    assert "pending" in status
    assert "completed" in status

    # 2. When disconnected, start & retry fail with 400
    with patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.is_connected", return_value=False):
        res_disconn = client.post("/api/storage/migration/start")
        assert res_disconn.status_code == 400
        assert "not connected" in res_disconn.json()["detail"].lower()

        res_retry_disconn = client.post("/api/storage/migration/retry")
        assert res_retry_disconn.status_code == 400
        assert "not connected" in res_retry_disconn.json()["detail"].lower()

    # 3. When connected, trigger build / start migration
    with patch("backend.library.storage.gdrive_bridge.GoogleDriveBridge.is_connected", return_value=True):
        res_start = client.post("/api/storage/migration/start")
        assert res_start.status_code == 200
        data = res_start.json()
        assert "queued" in data or "status" in data

        # 4. Retry failed
        res_retry = client.post("/api/storage/migration/retry")
        assert res_retry.status_code == 200
        assert "retried" in res_retry.json()
