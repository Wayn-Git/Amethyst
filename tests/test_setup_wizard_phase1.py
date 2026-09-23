import os
import pytest
from starlette.testclient import TestClient
from unittest.mock import patch, MagicMock
import httpx

from backend.api.main import app
from backend.db.connection import get_connection


@pytest.fixture
def client():
    return TestClient(app)


def test_catalogue_exposes_free_core_adapter_and_strengths(client):
    """R2: GET /api/providers exposes free, core, adapter, strengths in catalogue presets."""
    resp = client.get("/api/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert "catalogue" in data
    assert len(data["catalogue"]) > 0

    # Find groq (free tier) and google (core, adapter="google")
    presets = {p["slug"]: p for p in data["catalogue"]}
    assert "groq" in presets
    assert presets["groq"]["free"] is True
    assert "fast" in presets["groq"]["strengths"]

    assert "google" in presets
    assert presets["google"]["core"] is True
    assert presets["google"]["adapter"] == "google"

    assert "opencode-zen" in presets
    assert presets["opencode-zen"]["base_url"] == "https://opencode.ai/zen/v1"
    assert presets["opencode-zen"]["default_model"] == "mimo-v2.6-flash-free"


@pytest.mark.anyio
async def test_provider_verify_valid_key(client):
    """R1: POST /api/providers/{name}/verify returns valid=True and models on 200 OK."""
    fake_models_response = {
        "data": [
            {"id": "llama-3.3-70b-versatile"},
            {"id": "mixtral-8x7b-32768"},
        ]
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = fake_models_response
    mock_resp.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        resp = client.post(
            "/api/providers/groq/verify",
            json={"key": "gsk_valid_mock_key_12345"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["status"] == "ok"
        assert len(data["models"]) == 2
        assert data["models"][0]["id"] == "llama-3.3-70b-versatile"


@pytest.mark.anyio
async def test_provider_verify_invalid_key_401(client):
    """R1: POST /api/providers/{name}/verify returns valid=False on 401 Unauthorized without saving."""
    mock_request = httpx.Request("GET", "https://api.groq.com/openai/v1/models")
    mock_response = httpx.Response(
        401,
        request=mock_request,
        text='{"error":{"message":"Invalid API Key","type":"invalid_request_error"}}',
    )
    http_err = httpx.HTTPStatusError("401 Unauthorized", request=mock_request, response=mock_response)

    with patch("httpx.AsyncClient.get", side_effect=http_err):
        resp = client.post(
            "/api/providers/groq/verify",
            json={"key": "gsk_invalid_mock_key"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False
        assert data["status"] == "invalid_key"
        assert "Authentication failed (401)" in data["message"]
        assert data["models"] == []


@pytest.mark.anyio
async def test_provider_verify_rate_limited_429(client):
    """R1: POST /api/providers/{name}/verify returns valid=True, status='rate_limited' on 429."""
    mock_request = httpx.Request("GET", "https://api.groq.com/openai/v1/models")
    mock_response = httpx.Response(
        429,
        request=mock_request,
        text='{"error":{"message":"Rate limit reached"}}',
    )
    http_err = httpx.HTTPStatusError("429 Too Many Requests", request=mock_request, response=mock_response)

    with patch("httpx.AsyncClient.get", side_effect=http_err):
        resp = client.post(
            "/api/providers/groq/verify",
            json={"key": "gsk_rate_limited_key"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["status"] == "rate_limited"
        assert "rate limit or quota exceeded (429)" in data["message"]


def test_setup_status_endpoint(client):
    """R3: GET /api/setup/status returns full readiness survey."""
    resp = client.get("/api/setup/status")
    assert resp.status_code == 200
    data = resp.json()

    assert "model" in data
    assert "verified" in data["model"]
    assert "keychain" in data
    assert "writable" in data["keychain"]
    assert "ollama" in data
    assert "running" in data["ollama"]
    assert "runtimes" in data
    assert "composio" in data
    assert "connectors" in data
    assert "setup" in data
    assert "completed" in data["setup"]


def test_setup_complete_endpoint(client):
    """R4: POST /api/setup/complete records completion and preferences in app_settings."""
    resp = client.post(
        "/api/setup/complete",
        json={"browser_enabled": False, "tray_enabled": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["completed"] is True
    assert data["completed_at"] is not None

    # Check setup status reflects completed: True
    status_resp = client.get("/api/setup/status")
    status_data = status_resp.json()
    assert status_data["setup"]["completed"] is True
    assert status_data["setup"]["completed_at"] == data["completed_at"]

    # Check database app_settings directly
    conn = get_connection()
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'setup.completed_at'").fetchone()
    assert row is not None
    assert row[0] == data["completed_at"]

    browser_row = conn.execute("SELECT value FROM app_settings WHERE key = 'browser.enabled'").fetchone()
    assert browser_row is not None
    assert browser_row[0] == "0"

    tray_row = conn.execute("SELECT value FROM app_settings WHERE key = 'tray.enabled'").fetchone()
    assert tray_row is not None
    assert tray_row[0] == "1"
