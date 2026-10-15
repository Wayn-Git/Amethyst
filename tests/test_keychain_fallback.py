import pytest
from starlette.testclient import TestClient
from backend.api.main import app
from backend.setup_status import check_keychain


def test_check_keychain_detects_fail_backend(monkeypatch):
    class MockFailKeyring:
        priority = 0

    import keyring
    monkeypatch.setattr(keyring, "get_keyring", lambda: MockFailKeyring())
    monkeypatch.delenv("AMETHYST_SECRETS_FILE", raising=False)

    status = check_keychain()
    assert status["writable"] is False
    assert status["fallback_available"] is True


def test_keychain_fallback_activation(tmp_path, monkeypatch):
    test_secrets = tmp_path / "secrets.json"
    monkeypatch.setenv("AMETHYST_SECRETS_FILE", str(test_secrets))

    with TestClient(app) as client:
        resp = client.post("/api/setup/keychain/fallback", json={"consent": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["storage_type"] == "file"
        assert test_secrets.exists()


def test_keychain_fallback_refuses_without_consent():
    with TestClient(app) as client:
        resp = client.post("/api/setup/keychain/fallback", json={"consent": False})
        assert resp.status_code == 400
