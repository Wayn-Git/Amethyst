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


