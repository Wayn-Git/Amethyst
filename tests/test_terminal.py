"""Tests for the interactive PTY terminal endpoints and manager."""

from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.terminal import TerminalManager, get_available_shells

pytestmark = pytest.mark.usefixtures("amethyst_home")


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_list_shells(client: TestClient):
    res = client.get("/api/terminal/shells")
    assert res.status_code == 200
    data = res.json()
    assert "shells" in data
    assert len(data["shells"]) > 0
    assert "default_cwd" in data


def test_create_and_delete_session(client: TestClient):
    # List shells to pick one
    shells = get_available_shells()
    shell_id = shells[0]["id"]

    # Create session
    create_res = client.post("/api/terminal/sessions", json={"shell": shell_id})
    assert create_res.status_code == 200
    session_data = create_res.json()
    session_id = session_data["id"]
    assert session_data["shell"] == shell_id
    assert session_data["alive"] is True

    # List sessions
    list_res = client.get("/api/terminal/sessions")
    assert list_res.status_code == 200
    all_sessions = list_res.json()
    assert any(s["id"] == session_id for s in all_sessions)

    # Delete session
    del_res = client.delete(f"/api/terminal/sessions/{session_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "closed"

    # Confirm session removed
    list_after = client.get("/api/terminal/sessions").json()
    assert not any(s["id"] == session_id for s in list_after)


def test_terminal_websocket(client: TestClient):
    with client.websocket_connect("/api/terminal/ws") as ws:
        init_raw = ws.receive_text()
        init_data = json.loads(init_raw)
        assert init_data["type"] == "session_init"
        assert "id" in init_data
        session_id = init_data["id"]

        # Resize message
        ws.send_text(json.dumps({"type": "resize", "cols": 100, "rows": 30}))

        # Clean up
        manager = TerminalManager.get()
        assert manager.get_session(session_id) is not None
