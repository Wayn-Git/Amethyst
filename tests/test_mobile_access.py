"""Companion credentials must never become unrestricted desktop credentials."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.api.main import app, BIND_HOST_ENV
from backend.db.connection import get_connection
from backend.remote import actions
from backend.sync import devices


@pytest.fixture
def phone(monkeypatch):
    monkeypatch.setenv(BIND_HOST_ENV, "0.0.0.0")
    devices._failures.clear()
    device, token = devices.register(get_connection(), name="Phone", role="control",
                                     permissions={"power": True, "terminal": True})
    with TestClient(app, client=("192.0.2.3", 1234)) as client:
        client.headers["Authorization"] = f"Bearer {token}"
        yield client, device, token


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/devices/pending"), ("GET", "/api/settings"),
    ("POST", "/api/relay/deploy"), ("POST", "/api/unknown-future-route"),
    ("POST", "/api/confirmation-preferences/clear"),
])
def test_device_cannot_administer_desktop(phone, method, path):
    client, _, _ = phone
    assert client.request(method, path, json={}).status_code == 403


def test_loopback_proxy_requires_a_credential():
    with TestClient(app, client=("127.0.0.1", 1234)) as client:
        assert client.get("/api/conversations", headers={"X-Forwarded-For": "192.0.2.3"}).status_code == 403


def test_supplied_token_does_not_inherit_loopback_trust(phone):
    _, _, token = phone
    client = TestClient(app, client=("127.0.0.1", 1234))
    assert client.get("/api/devices/pending", headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_missing_grants_are_denied(phone):
    client, device, _ = phone
    conn = get_connection()
    conn.execute("UPDATE devices SET permissions='{}' WHERE id=?", (device.id,))
    conn.commit()
    assert client.post("/api/remote/command", json={"command": "true"}).status_code == 403


def test_power_is_a_single_use_reviewed_draft(phone, monkeypatch):
    client, device, _ = phone
    calls = []
    monkeypatch.setattr(actions, "execute", lambda *args: calls.append(args) or {"ok": True})
    draft = client.post("/api/remote/power/reboot").json()
    assert draft["state"] == "awaiting-approval"
    assert calls == []
    path = f"/api/remote/actions/{draft['draft_id']}/decision"
    assert client.post(path, json={"approved": True}).status_code == 200
    assert len(calls) == 1
    assert client.post(path, json={"approved": True}).status_code == 409
    assert get_connection().execute("SELECT count(*) FROM execution_logs WHERE tool_name='remote_pc_action'").fetchone()[0] == 1


def test_denial_expiry_and_permission_changes_do_not_execute(phone, monkeypatch):
    client, device, _ = phone
    monkeypatch.setattr(actions, "execute", lambda *_: pytest.fail("Must not execute"))
    draft = client.post("/api/remote/power/shutdown").json()
    assert client.post(f"/api/remote/actions/{draft['draft_id']}/decision", json={"approved": False}).json()["state"] == "denied"
    draft = client.post("/api/remote/power/reboot").json()
    conn = get_connection()
    conn.execute("UPDATE remote_action_drafts SET expires_at=0 WHERE id=?", (draft["draft_id"],))
    conn.commit()
    assert client.post(f"/api/remote/actions/{draft['draft_id']}/decision", json={"approved": True}).status_code == 409
    draft = client.post("/api/remote/power/reboot").json()
    devices.update_permissions(conn, device.id, {"power": False})
    assert client.post(f"/api/remote/actions/{draft['draft_id']}/decision", json={"approved": True}).status_code == 403


def test_multiplexed_input_cannot_bypass_grant(phone, monkeypatch):
    client, _, token = phone
    # Import the module rather than the APIRouter exported by the package.
    import importlib
    module = importlib.import_module("backend.remote.router")
    monkeypatch.setattr(module, "keyboard_type", lambda *_: pytest.fail("Must not type"))
    with client.websocket_connect(f"/api/remote/ws?token={token}") as ws:
        ws.send_json({"type": "keyboard_type", "text": "unsafe"})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 1008


def test_open_socket_rechecks_revocation(phone):
    client, device, token = phone
    with client.websocket_connect(f"/api/remote/ws?token={token}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        devices.revoke(get_connection(), device.id)
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


@pytest.mark.parametrize("guard", ["full-access", "guard-auto-edit"])
def test_remote_turn_cannot_weaken_permission_gate(phone, guard):
    client, _, _ = phone
    response = client.post('/api/conversations/unknown/turn', json={"message": "hello", "guard": guard})
    assert response.status_code == 403


@pytest.mark.parametrize("device_id", [None, "unknown"])
def test_unrecognised_intent_owner_cannot_run(device_id):
    from backend.sync.intents import _is_live
    assert not _is_live(get_connection(), device_id)


def test_intent_rechecks_agent_grant(phone):
    from backend.sync.intents import _is_live
    _, device, _ = phone
    assert _is_live(get_connection(), device.id)
    devices.update_permissions(get_connection(), device.id, {"agent": False})
    assert not _is_live(get_connection(), device.id)
