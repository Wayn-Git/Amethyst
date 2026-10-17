import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx
from backend.relay_deploy import verify_cloudflare_token, check_or_create_d1


@pytest.mark.asyncio
async def test_verify_cloudflare_token_success():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "success": True,
        "result": {"id": "tok_123", "status": "active"},
        "messages": [{"message": "This API Token is valid and active"}],
    }

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        valid, msg = await verify_cloudflare_token("valid_token_123")
        assert valid is True
        assert "active" in msg.lower() or "valid" in msg.lower()


@pytest.mark.asyncio
async def test_verify_cloudflare_token_failure():
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {
        "success": False,
        "errors": [{"code": 1000, "message": "Invalid API Token"}],
    }

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        valid, msg = await verify_cloudflare_token("bad_token")
        assert valid is False
        assert "Invalid API Token" in msg


@pytest.mark.asyncio
async def test_check_or_create_d1_finds_existing():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "success": True,
        "result": [
            {"uuid": "db-uuid-111", "name": "other-db"},
            {"uuid": "db-uuid-222", "name": "amethyst-relay"},
        ],
    }

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        res = await check_or_create_d1("tok_123", "acc_456", "amethyst-relay")
        assert res["database_id"] == "db-uuid-222"
        assert res["created"] is False


@pytest.mark.asyncio
async def test_check_or_create_d1_creates_new_if_missing():
    mock_get_resp = MagicMock()
    mock_get_resp.status_code = 200
    mock_get_resp.json.return_value = {
        "success": True,
        "result": [{"uuid": "db-uuid-111", "name": "other-db"}],
    }

    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {
        "success": True,
        "result": {"uuid": "db-uuid-333", "name": "amethyst-relay"},
    }

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get, \
         patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_get.return_value = mock_get_resp
        mock_post.return_value = mock_post_resp

        res = await check_or_create_d1("tok_123", "acc_456", "amethyst-relay")
        assert res["database_id"] == "db-uuid-333"
        assert res["created"] is True


def test_api_relay_verify_and_deploy_endpoints(monkeypatch):
    from starlette.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)

    # 1. Mock verify failure
    with patch("backend.relay_deploy.verify_cloudflare_token", new_callable=AsyncMock) as mock_ver:
        mock_ver.return_value = (False, "Bad token")
        resp = client.post("/api/relay/verify", json={"token": "invalid_tok"})
        assert resp.status_code == 200
        assert resp.json()["valid"] is False
        assert resp.json()["message"] == "Bad token"

    # 2. Mock verify success with D1 lookup
    with patch("backend.relay_deploy.verify_cloudflare_token", new_callable=AsyncMock) as mock_ver, \
         patch("backend.relay_deploy.check_or_create_d1", new_callable=AsyncMock) as mock_d1:
        mock_ver.return_value = (True, "Token is active")
        mock_d1.return_value = {"database_id": "cf-db-456", "name": "amethyst-relay", "created": False}

        resp = client.post("/api/relay/verify", json={"token": "valid_tok", "account_id": "acc_789"})
        assert resp.status_code == 200
        assert resp.json()["valid"] is True
        assert resp.json()["d1"]["database_id"] == "cf-db-456"

    # 3. Test deploy endpoint
    saved_secrets = {}
    saved_ig = {}
    monkeypatch.setattr("backend.secrets.set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr("backend.config.save_instagram", lambda patch: saved_ig.update(patch))

    deploy_resp = client.post(
        "/api/relay/deploy",
        json={
            "token": "valid_tok",
            "account_id": "acc_789",
            "database_id": "cf-db-456",
            "relay_url": "https://amethyst-relay.workers.dev",
        },
    )
    assert deploy_resp.status_code == 200
    assert deploy_resp.json()["ok"] is True
    assert saved_secrets["amethyst/cloudflare-token"] == "valid_tok"
    assert saved_secrets["amethyst/cloudflare-account-id"] == "acc_789"
    assert saved_secrets["amethyst/cloudflare-database-id"] == "cf-db-456"
    assert saved_ig["relay_url"] == "https://amethyst-relay.workers.dev"
    assert saved_ig["relay_enabled"] is True

