import base64
import json
import ssl
import threading
import time
import urllib.error
import urllib.request
import pytest
from starlette.testclient import TestClient

from backend.api.main import app
from backend.db.connection import get_connection
from backend.pairing.cert import get_or_create_tls_cert
from backend.pairing.config import (
    clear_phone_llm_config,
    set_phone_llm_config,
)
from backend.pairing.service import pairing_service


def _make_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _post_pair(port: int, body: dict) -> tuple[int, dict]:
    url = f"https://127.0.0.1:{port}/pair"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ctx = _make_ssl_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as err:
        content = err.read().decode("utf-8")
        return err.code, json.loads(content) if content else {}


@pytest.fixture(autouse=True)
def cleanup_pairing():
    pairing_service.cancel_pairing()
    yield
    pairing_service.cancel_pairing()
    clear_phone_llm_config()


def test_missing_phone_key_blocks_pairing():
    clear_phone_llm_config()
    with TestClient(app) as client:
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 400
        assert "Phone-only LLM API key is required" in resp.json()["detail"]


def test_qr_payload_contract_v2():
    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-test-key")
    with TestClient(app) as client:
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "qr" in data
        assert "qr_svg" in data
        assert data["qr_svg"].startswith("<svg")

        # Decode base64url payload
        qr_b64 = data["qr"]
        decoded_bytes = base64.urlsafe_b64decode(qr_b64 + "===")
        payload = json.loads(decoded_bytes.decode("utf-8"))

        assert payload["v"] == 2
        assert isinstance(payload["hosts"], list)
        assert len(payload["hosts"]) >= 1
        assert isinstance(payload["port"], int)
        assert isinstance(payload["token"], str)
        assert len(payload["token"]) == 32  # 128-bit hex
        assert isinstance(payload["fp"], str)
        assert len(payload["fp"]) == 64  # SHA-256 hex
        assert payload["exp"] > time.time()

        # Contract v2 requirement: QR contains NO keys
        assert "api_key" not in payload
        assert "key" not in payload
        assert "secret" not in payload


def test_wrong_token():
    set_phone_llm_config(provider="openai", model="gpt-4o-mini", api_key="sk-test-wrong-token")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]

    status, body = _post_pair(port, {"token": "wrong_token_123", "device_label": "Test Phone"})
    assert status == 401
    assert body.get("error") == "invalid_token"


def test_five_attempt_lockout():
    set_phone_llm_config(provider="openai", model="gpt-4o-mini", api_key="sk-test-lockout")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]

    # Attempts 1 to 4 should return 401
    for _ in range(4):
        status, body = _post_pair(port, {"token": "bad_token"})
        assert status == 401
        assert body.get("error") == "invalid_token"

    # Attempt 5 should return 429 and trigger immediate server shutdown
    status, body = _post_pair(port, {"token": "bad_token"})
    assert status == 429
    assert body.get("error") == "max_attempts_exceeded"

    # Subsequent request should fail (server closed)
    time.sleep(0.15)
    with pytest.raises(Exception):
        _post_pair(port, {"token": "bad_token"})


def test_single_use_burn_token():
    set_phone_llm_config(provider="anthropic", model="haiku", api_key="sk-ant-test-single")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]
    valid_token = start_res["payload"]["token"]

    first_resp: list[tuple[int, dict]] = []

    def _client_request():
        status, body = _post_pair(port, {"token": valid_token, "device_label": "Phone 1"})
        first_resp.append((status, body))

    t = threading.Thread(target=_client_request, daemon=True)
    t.start()

    # Wait until pairing service registers token as pending
    for _ in range(20):
        status = pairing_service.get_status()
        if status.get("status") == "pending_approval":
            break
        time.sleep(0.05)

    assert pairing_service.get_status()["status"] == "pending_approval"

    # Second request with the same valid token must be rejected because token is burned
    status_2, body_2 = _post_pair(port, {"token": valid_token, "device_label": "Duplicate Attempt"})
    assert status_2 == 403
    assert body_2.get("error") == "token_already_used"

    # Now approve first
    pairing_service.approve_pairing()
    t.join(timeout=2)
    assert len(first_resp) == 1
    assert first_resp[0][0] == 200


def test_expiry():
    from backend.pairing.server import PairingServer
    cert_path, key_path, _ = get_or_create_tls_cert()

    # Create server that expires in 0.3 seconds
    server = PairingServer(
        token="expiring_token",
        cert_path=cert_path,
        key_path=key_path,
        exp=int(time.time()) + 1,  # 1 second
        bind_host="127.0.0.1",
    )
    server.start()
    try:
        assert server.is_closed is False
        # Wait for expiry timer to fire
        time.sleep(1.2)
        assert server.is_closed is True
        # Connection must fail because server closed on expiry
        with pytest.raises(Exception):
            _post_pair(server.port, {"token": "expiring_token"})
    finally:
        server.close()



def test_deny():
    set_phone_llm_config(provider="anthropic", model="haiku", api_key="sk-test-deny")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]
    valid_token = start_res["payload"]["token"]

    phone_resp: list[tuple[int, dict]] = []

    def _client_request():
        status, body = _post_pair(port, {"token": valid_token, "device_label": "Denied Phone"})
        phone_resp.append((status, body))

    t = threading.Thread(target=_client_request, daemon=True)
    t.start()

    for _ in range(20):
        if pairing_service.get_status().get("status") == "pending_approval":
            break
        time.sleep(0.05)

    # Deny
    with TestClient(app) as client:
        resp = client.post("/api/pairing/v2/deny")
        assert resp.status_code == 200
        assert resp.json()["status"] == "denied"

    t.join(timeout=2)
    assert len(phone_resp) == 1
    assert phone_resp[0][0] == 403
    assert phone_resp[0][1].get("error") == "pairing_denied"

    # Server closed after deny
    time.sleep(0.1)
    with pytest.raises(Exception):
        _post_pair(port, {"token": valid_token})


def test_server_closes_after_success_and_bundle_delivered():
    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-live-phone-key")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]
    valid_token = start_res["payload"]["token"]

    phone_resp: list[tuple[int, dict]] = []

    def _client_request():
        status, body = _post_pair(port, {"token": valid_token, "device_label": "Pixel 9 Pro"})
        phone_resp.append((status, body))

    t = threading.Thread(target=_client_request, daemon=True)
    t.start()

    for _ in range(20):
        if pairing_service.get_status().get("status") == "pending_approval":
            break
        time.sleep(0.05)

    assert pairing_service.get_status()["device_label"] == "Pixel 9 Pro"

    # Approve
    with TestClient(app) as client:
        resp = client.post("/api/pairing/v2/approve", json={"device_label": "Pixel 9 Pro"})
        assert resp.status_code == 200
        device_id = resp.json()["device_id"]
        assert device_id.startswith("phone_")

    t.join(timeout=2)
    assert len(phone_resp) == 1
    status_code, bundle = phone_resp[0]
    assert status_code == 200

    # Verify bundle structure per CONTRACT v2
    assert bundle["device_id"] == device_id
    assert bundle["llm"]["provider"] == "anthropic"
    assert bundle["llm"]["model"] == "claude-3-5-haiku-20241022"
    assert bundle["llm"]["api_key"] == "sk-ant-live-phone-key"
    assert "composio" in bundle
    assert "api_key" in bundle["composio"]
    assert "user_id" in bundle["composio"]
    assert "drive" in bundle
    assert "root_folder_id" in bundle["drive"]
    assert "inbox_folder_id" in bundle["drive"]
    assert "prompts" in bundle
    assert "summary" in bundle["prompts"]

    # Verify device exists in devices table
    conn = get_connection()
    row = conn.execute("SELECT id, name, role FROM devices WHERE id = ?", (device_id,)).fetchone()
    assert row is not None
    assert row["name"] == "Pixel 9 Pro"
    assert row["role"] == "control"

    # Verify pairing server closed after success
    time.sleep(0.15)
    with pytest.raises(Exception):
        _post_pair(port, {"token": valid_token})


def test_revoke_device():
    set_phone_llm_config(provider="openai", model="gpt-4o-mini", api_key="sk-test-revoke")
    conn = get_connection()
    test_dev_id = "phone_revoketest123"
    conn.execute(
        "INSERT OR REPLACE INTO devices (id, name, role, token_hash) VALUES (?, 'Test Device', 'control', 'hash123')",
        (test_dev_id,),
    )
    conn.commit()

    with TestClient(app) as client:
        resp = client.delete(f"/api/pairing/v2/devices/{test_dev_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["device_id"] == test_dev_id
        assert "reminder" in data
        assert "does NOT rotate or delete keys" in data["reminder"]

    # Check device is forgotten locally
    row = conn.execute("SELECT id FROM devices WHERE id = ?", (test_dev_id,)).fetchone()
    assert row is None
