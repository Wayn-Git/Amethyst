from __future__ import annotations

import hashlib
import pytest
from fastapi.testclient import TestClient

from backend.api.main import BIND_HOST_ENV, app
from backend.db.connection import get_connection

pytestmark = pytest.mark.usefixtures("amethyst_home")


@pytest.fixture
def bound_wide(monkeypatch):
    monkeypatch.setenv(BIND_HOST_ENV, "0.0.0.0")


def test_credentials_bundle_requires_authentication(bound_wide):
    with TestClient(app, client=("192.168.1.50", 51234)) as client:
        res = client.get("/api/remote/credentials/bundle")
        assert res.status_code == 403


def test_credentials_bundle_returns_valid_bundle_for_paired_device(bound_wide, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key-1234")
    token = "test_device_secret_token_abc"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    conn = get_connection()
    conn.execute(
        "INSERT INTO devices (id, name, role, token_hash, permissions, created_at) "
        "VALUES (?, ?, 'control', ?, '{\"library\":true,\"paired\":true}', datetime('now'))",
        ("test_phone_id", "Test Phone", token_hash),
    )
    conn.commit()

    with TestClient(app, client=("192.168.1.50", 51234)) as client:
        headers = {"Authorization": f"Bearer {token}"}
        res = client.get("/api/remote/credentials/bundle", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "llm" in data
        assert "drive" in data
        assert "composio" in data
        assert "device_id" in data
        assert data["device_id"] == "test_phone_id"


def test_remote_revoke_self_invalidates_device(bound_wide):
    token = "test_revoke_token_xyz"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    conn = get_connection()
    conn.execute(
        "INSERT INTO devices (id, name, role, token_hash, permissions, created_at) "
        "VALUES (?, ?, 'control', ?, '{\"library\":true,\"paired\":true}', datetime('now'))",
        ("test_phone_revoke", "Revoke Phone", token_hash),
    )
    conn.commit()

    with TestClient(app, client=("192.168.1.50", 51234)) as client:
        headers = {"Authorization": f"Bearer {token}"}
        res = client.post("/api/remote/revoke", headers=headers)
        assert res.status_code == 200
        assert res.json() == {"revoked": "test_phone_revoke"}

        # Subsequent call using the revoked token is rejected (403)
        res2 = client.post("/api/remote/revoke", headers=headers)
        assert res2.status_code == 403

