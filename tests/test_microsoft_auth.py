"""Tests for Microsoft Graph OAuth 2.0 PKCE flow and token vault storage."""

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.auth.microsoft import (
    VAULT_KEY,
    create_auth_url,
    disconnect,
    exchange_code_for_tokens,
    get_connection_status,
    get_valid_access_token,
    refresh_tokens,
)
from backend.secrets import delete_secret, get_secret, set_secret


@pytest.fixture(autouse=True)
def clean_vault():
    delete_secret(VAULT_KEY)
    yield
    delete_secret(VAULT_KEY)


def test_create_auth_url():
    res = create_auth_url("http://localhost:8000/api/auth/microsoft/callback", client_id="test-client-id")
    assert "auth_url" in res
    assert "state" in res
    assert "login.microsoftonline.com/common/oauth2/v2.0/authorize" in res["auth_url"]
    assert "client_id=test-client-id" in res["auth_url"]
    assert "code_challenge_method=S256" in res["auth_url"]
    assert "Tasks.ReadWrite" in res["auth_url"]
    assert "offline_access" in res["auth_url"]


@pytest.mark.asyncio
async def test_exchange_code_for_tokens():
    res = create_auth_url("http://localhost:8000/api/auth/microsoft/callback", client_id="test-client-id")
    state = res["state"]

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = MagicMock(return_value={
        "access_token": "fake-access-token-123",
        "refresh_token": "fake-refresh-token-456",
        "expires_in": 3600,
        "token_type": "Bearer",
        "scope": "Tasks.ReadWrite offline_access User.Read",
    })

    with patch("httpx.AsyncClient.post", return_value=mock_resp) as mock_post:
        tokens = await exchange_code_for_tokens("auth-code-xyz", state)
        assert tokens["access_token"] == "fake-access-token-123"
        assert tokens["refresh_token"] == "fake-refresh-token-456"

        stored_raw = get_secret(VAULT_KEY)
        assert stored_raw is not None
        stored = json.loads(stored_raw)
        assert stored["access_token"] == "fake-access-token-123"

        post_data = mock_post.call_args[1]["data"]
        assert post_data["grant_type"] == "authorization_code"
        assert post_data["code"] == "auth-code-xyz"
        assert "code_verifier" in post_data
        assert "client_secret" not in post_data  # Public client only


@pytest.mark.asyncio
async def test_token_refresh():
    initial_tokens = {
        "access_token": "expired-token",
        "refresh_token": "valid-refresh-token",
        "expires_at": time.time() - 100,  # Expired
        "client_id": "test-client-id",
    }
    set_secret(VAULT_KEY, json.dumps(initial_tokens))

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = MagicMock(return_value={
        "access_token": "new-access-token-789",
        "refresh_token": "new-refresh-token-012",
        "expires_in": 7200,
    })

    with patch("httpx.AsyncClient.post", return_value=mock_resp):
        valid_token = await get_valid_access_token()
        assert valid_token == "new-access-token-789"

        status = get_connection_status()
        assert status["connected"] is True


def test_disconnect():
    set_secret(VAULT_KEY, json.dumps({"access_token": "dummy"}))
    assert get_connection_status()["connected"] is True
    ok = disconnect()
    assert ok is True
    assert get_connection_status()["connected"] is False


def test_api_routes():
    client = TestClient(app)

    start_res = client.post("/api/auth/microsoft/start", json={"client_id": "route-test-client"})
    assert start_res.status_code == 200
    data = start_res.json()
    assert "auth_url" in data
    assert "state" in data

    state = data["state"]
    poll_res = client.get(f"/api/auth/microsoft/poll/{state}")
    assert poll_res.status_code == 200
    assert poll_res.json()["status"] == "pending"

    status_res = client.get("/api/auth/microsoft/status")
    assert status_res.status_code == 200
    assert "connected" in status_res.json()


@pytest.mark.asyncio
async def test_device_flow():
    from backend.auth.microsoft import poll_device_flow, start_device_flow

    mock_device_resp = AsyncMock()
    mock_device_resp.status_code = 200
    mock_device_resp.json = MagicMock(return_value={
        "device_code": "mock-device-code-abc",
        "user_code": "ABCD-EFGH",
        "verification_uri": "https://login.microsoft.com/device",
        "expires_in": 900,
        "interval": 5,
        "message": "To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code ABCD-EFGH to authenticate.",
    })

    with patch("httpx.AsyncClient.post", return_value=mock_device_resp):
        info = await start_device_flow()
        assert info["user_code"] == "ABCD-EFGH"
        assert info["device_code"] == "mock-device-code-abc"
        assert info["verification_uri"] == "https://login.microsoft.com/device"

    # Pending poll
    mock_poll_pending = AsyncMock()
    mock_poll_pending.status_code = 400
    mock_poll_pending.json = MagicMock(return_value={
        "error": "authorization_pending",
        "error_description": "Authorization pending",
    })

    with patch("httpx.AsyncClient.post", return_value=mock_poll_pending):
        poll_res = await poll_device_flow("mock-device-code-abc")
        assert poll_res["connected"] is False
        assert poll_res["status"] == "pending"

    # Success poll
    mock_poll_success = AsyncMock()
    mock_poll_success.status_code = 200
    mock_poll_success.json = MagicMock(return_value={
        "access_token": "token-12345",
        "refresh_token": "refresh-67890",
        "expires_in": 3600,
    })

    with patch("httpx.AsyncClient.post", return_value=mock_poll_success):
        poll_res = await poll_device_flow("mock-device-code-abc")
        assert poll_res["connected"] is True
        assert poll_res["status"] == "completed"
        assert get_connection_status()["connected"] is True


def test_device_flow_api_routes():
    client = TestClient(app)

    mock_device_resp = AsyncMock()
    mock_device_resp.status_code = 200
    mock_device_resp.json = MagicMock(return_value={
        "device_code": "test-device-code-xyz",
        "user_code": "WXYZ-1234",
        "verification_uri": "https://login.microsoft.com/device",
        "expires_in": 900,
        "interval": 5,
    })

    with patch("httpx.AsyncClient.post", return_value=mock_device_resp):
        start_res = client.post("/api/auth/microsoft/device/start")
        assert start_res.status_code == 200
        data = start_res.json()
        assert data["user_code"] == "WXYZ-1234"
        assert data["device_code"] == "test-device-code-xyz"

    mock_poll_pending = AsyncMock()
    mock_poll_pending.status_code = 400
    mock_poll_pending.json = MagicMock(return_value={"error": "authorization_pending"})

    with patch("httpx.AsyncClient.post", return_value=mock_poll_pending):
        poll_res = client.get("/api/auth/microsoft/device/poll/test-device-code-xyz")
        assert poll_res.status_code == 200
        assert poll_res.json()["connected"] is False
        assert poll_res.json()["status"] == "pending"
