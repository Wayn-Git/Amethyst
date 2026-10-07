import pytest
from starlette.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock
from backend.api.main import app
from backend.provider_catalogue import preset as find_preset


def test_cloudflare_preset_has_account_id_placeholder():
    cf = find_preset("cloudflare")
    assert cf is not None
    assert "{account_id}" in cf.base_url or "ACCOUNT_ID" in cf.base_url


def test_verify_provider_substitutes_account_id(monkeypatch):
    client = TestClient(app)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "result": [{"id": "@cf/meta/llama-3.1-8b-instruct"}]
    }

    captured_urls = []

    async def mock_get(self, url, *args, **kwargs):
        captured_urls.append(str(url))
        return mock_resp

    monkeypatch.setattr("httpx.AsyncClient.get", mock_get)

    resp = client.post(
        "/api/providers/cloudflare/verify",
        json={
            "api_key": "cf_test_api_token",
            "account_id": "test_account_xyz",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["valid"] is True
    assert len(captured_urls) > 0
    assert "accounts/test_account_xyz/ai/v1" in captured_urls[0]


def test_add_provider_substitutes_account_id(monkeypatch):
    client = TestClient(app)

    saved_providers = []
    saved_secrets = {}

    monkeypatch.setattr("backend.config.add_provider", lambda entry: saved_providers.append(entry))
    monkeypatch.setattr("backend.secrets.set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))

    resp = client.post(
        "/api/providers",
        json={
            "name": "cloudflare",
            "api_key": "cf_token_val",
            "account_id": "cf_acc_999",
        },
    )
    assert resp.status_code == 200
    assert any(
        p.get("name") == "cloudflare"
        and "accounts/cf_acc_999/ai/v1" in p.get("base_url", "")
        for p in saved_providers
    )
