import pytest
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.web.circuit_breaker import get_circuit_breaker

client = TestClient(app)

def test_get_search_provider_returns_health_and_preference(monkeypatch):
    get_circuit_breaker().reset()
    fake_secrets = {}

    def fake_get_secret(ref):
        return fake_secrets.get(ref)

    monkeypatch.setattr("backend.secrets.get_secret", fake_get_secret)

    resp = client.get("/api/search/provider")
    assert resp.status_code == 200
    data = resp.json()
    assert "active" in data
    assert "preferred" in data
    assert "status" in data
    assert "options" in data
    assert len(data["options"]) >= 4
    names = [opt["name"] for opt in data["options"]]
    assert "langsearch" in names
    assert "exa" in names
    assert "firecrawl" in names
    assert "tavily" in names


def test_put_search_provider_key_resets_circuit_breaker(monkeypatch):
    cb = get_circuit_breaker()
    cb.record_failure("langsearch", status_code=429, error="Rate limited")
    assert not cb.is_available("langsearch")

    saved_secrets = {}
    monkeypatch.setattr("backend.secrets.set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr("backend.secrets.get_secret", lambda ref: saved_secrets.get(ref))

    resp = client.put("/api/search/provider", json={"name": "langsearch", "key": "new-test-key"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "langsearch"
    assert data["configured"] is True
    assert saved_secrets.get("amethyst/langsearch") == "new-test-key"
    # Circuit breaker must be reset
    assert cb.is_available("langsearch")


def test_put_search_provider_preference_override(monkeypatch):
    saved_secrets = {}
    monkeypatch.setattr("backend.secrets.set_secret", lambda ref, val: saved_secrets.__setitem__(ref, val))
    monkeypatch.setattr("backend.secrets.get_secret", lambda ref: saved_secrets.get(ref))

    resp = client.put("/api/search/provider", json={"preferred": "exa"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["preferred"] == "exa"
    assert saved_secrets.get("amethyst/search_preferred") == "exa"

    # GET returns updated preferred
    resp_get = client.get("/api/search/provider")
    assert resp_get.status_code == 200
    assert resp_get.json()["preferred"] == "exa"


def test_put_search_provider_invalid_name():
    resp = client.put("/api/search/provider", json={"name": "unknown_provider", "key": "some-key"})
    assert resp.status_code == 400
