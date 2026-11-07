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
    clear_phone_composio_config,
    clear_phone_llm_config,
    get_phone_composio_config,
    get_use_separate_keys,
    set_phone_composio_config,
    set_phone_llm_config,
    set_use_separate_keys,
)
from backend.pairing.service import pairing_service
from backend.secrets import delete_secret, get_secret, set_secret


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
    set_use_separate_keys(False)
    yield
    pairing_service.cancel_pairing()
    clear_phone_llm_config()
    clear_phone_composio_config()
    set_use_separate_keys(False)


def test_missing_phone_key_blocks_pairing():
    clear_phone_llm_config()
    clear_phone_composio_config()

    # 0. When separate keys toggle is OFF (default), missing phone keys DO NOT block pairing
    set_use_separate_keys(False)
    with TestClient(app) as client:
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        pairing_service.cancel_pairing()

    # When separate keys toggle is ON, missing phone keys block pairing
    set_use_separate_keys(True)
    with TestClient(app) as client:
        # 1. Missing phone LLM key
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 400
        assert "Phone-only LLM API key is required" in resp.json()["detail"]

        # 2. Configured LLM, but missing both phone Composio credentials
        set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-test-key")
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 400
        assert "Phone-only Composio API key and User ID are required" in resp.json()["detail"]

        # 3. Missing only phone Composio API key
        set_phone_composio_config(user_id="phone_user_1")
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 400
        assert "Phone-only Composio API key is required" in resp.json()["detail"]

        # 4. Missing only phone Composio User ID
        clear_phone_composio_config()
        set_phone_composio_config(api_key="comp_test_key_1")
        resp = client.post("/api/pairing/v2/start")
        assert resp.status_code == 400
        assert "Phone-only Composio User ID is required" in resp.json()["detail"]


def test_qr_payload_contract_v2():
    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-test-key")
    set_phone_composio_config(api_key="comp_test_key", user_id="phone_user_default")
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
    set_phone_composio_config(api_key="comp_phone_test_key", user_id="phone_user_default")
    start_res = pairing_service.start_pairing()
    port = start_res["port"]

    status, body = _post_pair(port, {"token": "wrong_token_123", "device_label": "Test Phone"})
    assert status == 401
    assert body.get("error") == "invalid_token"


def test_five_attempt_lockout():
    set_phone_llm_config(provider="openai", model="gpt-4o-mini", api_key="sk-test-lockout")
    set_phone_composio_config(api_key="comp_phone_test_key", user_id="phone_user_default")
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
    set_phone_composio_config(api_key="comp_phone_test_key", user_id="phone_user_default")
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
    set_phone_composio_config(api_key="comp_phone_test_key", user_id="phone_user_default")
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
    set_use_separate_keys(True)
    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-live-phone-key")
    set_phone_composio_config(api_key="comp_phone_test_key_live", user_id="phone_user_live")
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
    assert bundle["composio"]["api_key"] == "comp_phone_test_key_live"
    assert bundle["composio"]["user_id"] == "phone_user_live"
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
    set_use_separate_keys(True)
    set_phone_llm_config(provider="openai", model="gpt-4o-mini", api_key="sk-test-revoke")
    set_phone_composio_config(api_key="comp_revoke_key", user_id="phone_revoke_user")
    conn = get_connection()
    test_dev_id = "phone_revoketest123"
    permissions = json.dumps({"shared_providers": ["openai", "composio"]})
    conn.execute(
        "INSERT OR REPLACE INTO devices (id, name, role, token_hash, permissions) VALUES (?, 'Test Device', 'control', 'hash123', ?)",
        (test_dev_id, permissions),
    )
    conn.commit()

    with TestClient(app) as client:
        resp = client.delete(f"/api/pairing/v2/devices/{test_dev_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["device_id"] == test_dev_id
        assert "reminder" in data
        assert "does NOT rotate or delete any API keys" in data["reminder"]
        assert "openai" in data["reminder"]
        assert "composio" in data["reminder"]
        assert data["shared_providers"] == ["openai", "composio"]
        assert len(data["checklist"]) == 2

    # Check device is forgotten locally
    row = conn.execute("SELECT id FROM devices WHERE id = ?", (test_dev_id,)).fetchone()
    assert row is None


def test_bundle_never_contains_main_composio_key():
    set_use_separate_keys(True)
    MAIN_KEY = "main-composio-secret-super-key-99999"
    set_secret("amethyst/composio", MAIN_KEY)

    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key="sk-ant-live-phone-key")
    set_phone_composio_config(api_key="comp_isolated_phone_key_777", user_id="phone_isolated_user_777")

    start_res = pairing_service.start_pairing()
    port = start_res["port"]
    valid_token = start_res["payload"]["token"]

    phone_resp: list[tuple[int, dict]] = []

    def _client_request():
        status, body = _post_pair(port, {"token": valid_token, "device_label": "Phone Companion"})
        phone_resp.append((status, body))

    t = threading.Thread(target=_client_request, daemon=True)
    t.start()

    for _ in range(20):
        if pairing_service.get_status().get("status") == "pending_approval":
            break
        time.sleep(0.05)

    res = pairing_service.approve_pairing(device_label="Phone Companion")
    assert res["ok"] is True

    t.join(timeout=2)
    assert len(phone_resp) == 1
    status_code, bundle = phone_resp[0]
    assert status_code == 200

    # Ensure phone-only composio credentials are used
    assert bundle["composio"]["api_key"] == "comp_isolated_phone_key_777"
    assert bundle["composio"]["user_id"] == "phone_isolated_user_777"

    # Ensure main key is NEVER present in the bundle
    assert bundle["composio"]["api_key"] != MAIN_KEY
    bundle_str = json.dumps(bundle)
    assert MAIN_KEY not in bundle_str

    delete_secret("amethyst/composio")

    # Ensure main key is NEVER present in the bundle
    assert bundle["composio"]["api_key"] != MAIN_KEY
    bundle_str = json.dumps(bundle)
    assert MAIN_KEY not in bundle_str

    delete_secret("amethyst/composio")


def test_phone_composio_settings_api():
    clear_phone_composio_config()
    with TestClient(app) as client:
        # Initially empty
        get_res = client.get("/api/settings/phone-composio")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["has_key"] is False
        assert data["has_user_id"] is False
        assert data["user_id"] == ""

        # Save credentials
        post_res = client.post(
            "/api/settings/phone-composio",
            json={"api_key": "  comp_api_key_456  ", "user_id": "phone_user_custom"},
        )
        assert post_res.status_code == 200
        saved = post_res.json()
        assert saved["ok"] is True
        assert saved["has_key"] is True
        assert saved["has_user_id"] is True
        assert saved["user_id"] == "phone_user_custom"

        # Verify raw secret in keychain
        assert get_secret("amethyst/phone_composio_api_key") == "comp_api_key_456"
        assert get_secret("amethyst/phone_composio_user_id") == "phone_user_custom"

        # Get settings masks api_key
        get_res = client.get("/api/settings/phone-composio")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["has_key"] is True
        assert data["has_user_id"] is True
        assert data["user_id"] == "phone_user_custom"
        assert "api_key" not in data

        # Delete settings
        del_res = client.delete("/api/settings/phone-composio")
        assert del_res.status_code == 200
        assert del_res.json()["ok"] is True

        # Verify cleared from keychain
        assert get_secret("amethyst/phone_composio_api_key") is None
        assert get_secret("amethyst/phone_composio_user_id") is None


def test_auto_capture_bundle_contains_all_providers_and_default():
    set_use_separate_keys(False)
    MAIN_KEY = "main-composio-secret-super-key-auto"
    set_secret("amethyst/composio", MAIN_KEY)

    start_res = pairing_service.start_pairing()
    port = start_res["port"]
    valid_token = start_res["payload"]["token"]

    phone_resp: list[tuple[int, dict]] = []

    def _client_request():
        status, body = _post_pair(port, {"token": valid_token, "device_label": "Pixel Phone"})
        phone_resp.append((status, body))

    t = threading.Thread(target=_client_request, daemon=True)
    t.start()

    for _ in range(20):
        if pairing_service.get_status().get("status") == "pending_approval":
            break
        time.sleep(0.05)

    res = pairing_service.approve_pairing(device_label="Pixel Phone")
    assert res["ok"] is True

    t.join(timeout=2)
    assert len(phone_resp) == 1
    status_code, bundle = phone_resp[0]
    assert status_code == 200

    # Auto-capture contains all providers in llm.providers
    llm = bundle["llm"]
    assert "providers" in llm
    assert isinstance(llm["providers"], list)
    assert len(llm["providers"]) > 0

    # Verify default alias equals providers[default]
    default_idx = llm.get("default", 0)
    assert 0 <= default_idx < len(llm["providers"])
    default_provider = llm["providers"][default_idx]
    assert llm["provider"] == default_provider["provider"]
    assert llm["model"] == default_provider["model"]
    assert llm["api_key"] == default_provider["api_key"]

    # Verify main Composio key is included in auto-capture mode
    assert bundle["composio"]["api_key"] == MAIN_KEY

    delete_secret("amethyst/composio")


def test_no_key_values_in_logs_or_approve_prompt(caplog):
    import logging
    caplog.set_level(logging.DEBUG)

    SECRET_KEY_PROV = "sk-live-super-secret-prov-key-999"
    SECRET_KEY_COMP = "comp-live-super-secret-comp-key-888"

    set_use_separate_keys(True)
    set_phone_llm_config(provider="anthropic", model="claude-3-5-haiku-20241022", api_key=SECRET_KEY_PROV)
    set_phone_composio_config(api_key=SECRET_KEY_COMP, user_id="phone_user_safe")

    with TestClient(app) as client:
        start_res = client.post("/api/pairing/v2/start").json()
        port = start_res["port"]
        valid_token = start_res["payload"]["token"]

        phone_resp = []

        def _client_request():
            status, body = _post_pair(port, {"token": valid_token, "device_label": "Audit Device"})
            phone_resp.append((status, body))

        t = threading.Thread(target=_client_request, daemon=True)
        t.start()

        for _ in range(20):
            st = client.get("/api/pairing/v2/status").json()
            if st.get("status") == "pending_approval":
                break
            time.sleep(0.05)

        # Inspect status / approve prompt response
        status_resp = client.get("/api/pairing/v2/status")
        assert status_resp.status_code == 200
        st_data = status_resp.json()
        assert st_data["status"] == "pending_approval"
        assert "shared_providers" in st_data
        assert "composio_user_id" in st_data
        assert "warning" in st_data
        assert "This phone will be able to use these keys. If it is lost, rotate them." in st_data["warning"]

        # Ensure NO key values appear in Approve prompt endpoint payload
        status_text = status_resp.text
        assert SECRET_KEY_PROV not in status_text
        assert SECRET_KEY_COMP not in status_text
        assert "api_key" not in st_data

        # Approve
        appr_resp = client.post("/api/pairing/v2/approve", json={"device_label": "Audit Device"})
        assert appr_resp.status_code == 200

        t.join(timeout=2)
        assert len(phone_resp) == 1
        assert phone_resp[0][0] == 200

        # Verify no key values leaked into logs
        assert SECRET_KEY_PROV not in caplog.text
        assert SECRET_KEY_COMP not in caplog.text


def test_phone_pairing_settings_api():
    with TestClient(app) as client:
        # Default is False
        res = client.get("/api/settings/phone-pairing")
        assert res.status_code == 200
        assert res.json()["use_separate_keys"] is False

        # Set to True
        post_res = client.post("/api/settings/phone-pairing", json={"use_separate_keys": True})
        assert post_res.status_code == 200
        assert post_res.json()["ok"] is True
        assert post_res.json()["use_separate_keys"] is True

        assert get_use_separate_keys() is True

        # Check GET reflects True
        res = client.get("/api/settings/phone-pairing")
        assert res.status_code == 200
        assert res.json()["use_separate_keys"] is True

        # Set back to False
        post_res = client.post("/api/settings/phone-pairing", json={"use_separate_keys": False})
        assert post_res.status_code == 200
        assert post_res.json()["use_separate_keys"] is False
        assert get_use_separate_keys() is False

