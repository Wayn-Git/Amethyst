"""Tests for Cloudflare token verification, relay provisioning, and HTTP Shortcuts sharing."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.relay_deploy import (
    check_or_create_d1,
    get_cloudflare_accounts,
    provision_relay,
    verify_cloudflare_token,
)
from backend.secrets import delete_secret, get_secret


@pytest.fixture(autouse=True)
def clean_vault():
    delete_secret("amethyst/cloudflare-api-token")
    yield
    delete_secret("amethyst/cloudflare-api-token")


@pytest.mark.asyncio
async def test_verify_cloudflare_token_active():
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = MagicMock(return_value={
        "success": True,
        "result": {"status": "active"},
    })

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        valid, msg = await verify_cloudflare_token("cf-test-token-valid")
        assert valid is True
        assert "valid and active" in msg


@pytest.mark.asyncio
async def test_verify_cloudflare_token_invalid():
    mock_resp = AsyncMock()
    mock_resp.status_code = 400
    mock_resp.json = MagicMock(return_value={
        "success": False,
        "errors": [{"message": "Invalid token"}],
    })

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        valid, msg = await verify_cloudflare_token("cf-test-token-invalid")
        assert valid is False
        assert "Invalid token" in msg


@pytest.mark.asyncio
async def test_provision_relay_stubbed():
    with patch("backend.relay_deploy.verify_cloudflare_token", return_value=(True, "Active")), \
         patch("backend.relay_deploy.get_cloudflare_accounts", return_value=[{"id": "acc-1", "name": "Main"}]), \
         patch("backend.relay_deploy.check_or_create_d1", return_value={"database_id": "db-123", "created": False}):
        
        result = await provision_relay("test-token", account_id=None)
        assert result["ok"] is True
        assert result["token_verified"] is True
        assert result["account_id"] == "acc-1"
        assert result["d1_database"]["database_id"] == "db-123"
        assert result["worker_deployment"] == "stubbed"  # Clearly labeled stub
        assert result["round_trip_test"] is True


def test_cloudflare_verify_endpoint():
    client = TestClient(app)
    with patch("backend.relay_deploy.provision_relay", return_value={
        "ok": True,
        "token_verified": True,
        "account_id": "test-acc",
        "worker_deployment": "stubbed",
        "round_trip_test": True,
        "message": "Token verified and D1 provisioned; worker deployment stubbed.",
    }):
        resp = client.post("/api/setup/cloudflare/verify", json={"api_token": "valid-cf-token"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["valid"] is True
        assert get_secret("amethyst/cloudflare-api-token") == "valid-cf-token"


def test_http_shortcuts_endpoint():
    client = TestClient(app)
    resp = client.get("/api/share/http-shortcuts.json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 3
    assert len(data["shortcuts"]) > 0

    shortcut = data["shortcuts"][0]
    assert shortcut["id"] == "amethyst-share-capture"
    assert "/api/share/capture" in shortcut["url"]
    assert "Authorization" in shortcut["headers"]
    assert "Bearer " in shortcut["headers"]["Authorization"]
