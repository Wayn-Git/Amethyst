"""Tests for HTTP Shortcuts sharing."""

from fastapi.testclient import TestClient

from backend.api.main import app


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
