import pytest
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

    # 2. Trigger build / start migration
    res_start = client.post("/api/storage/migration/start")
    assert res_start.status_code == 200
    data = res_start.json()
    assert "queued" in data or "status" in data

    # 3. Retry failed
    res_retry = client.post("/api/storage/migration/retry")
    assert res_retry.status_code == 200
    assert "retried" in res_retry.json()
