import json
import pytest
from starlette.testclient import TestClient

from backend.api.main import app


def test_launcher_stream_endpoint():
    client = TestClient(app)
    response = client.get("/api/launcher/stream?q=chat&session_id=test_s1")
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    # Parse SSE data events
    lines = response.text.strip().split("\n")
    events = []
    for line in lines:
        if line.startswith("data: "):
            payload = json.loads(line[6:])
            events.append(payload)

    assert len(events) >= 1
    # Check that at least one event contains items
    items = [item for ev in events for item in (ev if isinstance(ev, list) else [])]
    assert any("chat" in it.get("title", "").lower() for it in items)


def _sse_events(response):
    events = []
    event_type = "message"
    for line in response.text.strip().split("\n"):
        if line.startswith("event: "):
            event_type = line[7:]
        elif line.startswith("data: "):
            events.append((event_type, json.loads(line[6:])))
            event_type = "message"
    return events


def test_launcher_stream_announces_intent():
    client = TestClient(app)
    response = client.get("/api/launcher/stream?q=chrome&session_id=test_intent")
    assert response.status_code == 200

    events = _sse_events(response)
    intent_events = [payload for kind, payload in events if kind == "intent"]
    assert len(intent_events) == 1
    intent = intent_events[0]
    assert intent["mode"] == "local"
    assert intent["providers"] == ["apps", "commands", "library"]
    assert intent["external"] == []
    assert intent["subject"] == "chrome"


def test_launcher_stream_prefix_routes_one_family():
    client = TestClient(app)
    response = client.get(
        "/api/launcher/stream?q=%3Egoogle%20rust%20lifetimes&session_id=test_prefix"
    )
    intent = [payload for kind, payload in _sse_events(response) if kind == "intent"][0]
    assert intent["mode"] == "web"
    assert intent["subject"] == "rust lifetimes"
    assert intent["providers"] == []
    assert intent["external"] == ["web"]


def test_launcher_stream_explicit_providers_override():
    client = TestClient(app)
    response = client.get(
        "/api/launcher/stream?q=chrome&session_id=test_override&providers=commands"
    )
    intent = [payload for kind, payload in _sse_events(response) if kind == "intent"][0]
    assert intent["providers"] == ["commands"]


def test_launcher_action_endpoint():
    client = TestClient(app)
    res = client.post(
        "/api/launcher/action",
        json={
            "provider_id": "commands",
            "action_id": "run",
            "payload": {"command_id": "nav:chat"},
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data.get("status") == "ok"
    assert data.get("target") == "chat"


def test_launcher_action_unknown_provider():
    client = TestClient(app)
    res = client.post(
        "/api/launcher/action",
        json={
            "provider_id": "nonexistent_provider",
            "action_id": "run",
            "payload": {},
        },
    )
    assert res.status_code == 404


def test_launcher_action_clipboard():
    client = TestClient(app)
    from unittest.mock import patch
    with patch("backend.launcher.providers.clipboard.set_clipboard", return_value={"ok": True}):
        res = client.post(
            "/api/launcher/action",
            json={
                "provider_id": "clipboard",
                "action_id": "copy",
                "payload": {"text": "hello test clipboard"},
            },
        )
        assert res.status_code == 200
        assert res.json().get("copied") is True


def test_settings_hotkey_endpoint():
    client = TestClient(app)
    # GET settings
    res = client.get("/api/settings")
    assert res.status_code == 200
    assert "hotkey" in res.json()

    # PATCH settings
    patch_res = client.patch("/api/settings", json={"hotkey": "<super>+<space>"})
    assert patch_res.status_code == 200
    assert patch_res.json().get("hotkey") == "<super>+<space>"


def test_launcher_icon_endpoint():
    client = TestClient(app)
    # Test valid icon name (e.g. google-chrome or firefox or simple-icons)
    res = client.get("/api/launcher/icon?name=firefox")
    if res.status_code == 200:
        assert "image/" in res.headers.get("content-type", "")
    else:
        assert res.status_code == 404

    # Test invalid / traversal name
    res_invalid = client.get("/api/launcher/icon?name=../secret")
    assert res_invalid.status_code == 400

    # Test missing name
    res_missing = client.get("/api/launcher/icon?name=")
    assert res_missing.status_code == 400


