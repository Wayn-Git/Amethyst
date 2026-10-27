from __future__ import annotations

import io
import uuid
import pytest
from fastapi.testclient import TestClient

from backend.api.main import BIND_HOST_ENV, app
from backend.db.connection import get_connection
from backend.sync import devices
from backend.sync.devices import DEFAULT_PERMISSIONS


@pytest.fixture(autouse=True)
def clean_devices_state():
    devices.close_pairing()
    devices._failures.clear()
    yield
    devices.close_pairing()
    devices._failures.clear()


@pytest.fixture
def bound_wide(monkeypatch):
    """Run server as bound wide so RemoteCallerGuard active."""
    monkeypatch.setenv(BIND_HOST_ENV, "0.0.0.0")


@pytest.fixture
def remote_client(bound_wide):
    with TestClient(app, client=("192.168.1.88", 51234)) as c:
        yield c


@pytest.fixture
def local_client(bound_wide):
    with TestClient(app, client=("127.0.0.1", 51234)) as c:
        yield c


@pytest.fixture
def paired_phone(bound_wide):
    conn = get_connection()
    device, token = devices.register(
        conn,
        name="Test iPhone",
        role="control",
        permissions=dict(DEFAULT_PERMISSIONS),
    )
    return device, token


def test_unauthenticated_remote_caller_blocked_from_remote_api(remote_client):
    res = remote_client.get("/api/remote/status")
    assert res.status_code == 403
    assert "loopback" in res.json().get("detail", "")


def test_authenticated_device_can_fetch_system_status(remote_client, paired_phone):
    device, token = paired_phone
    res = remote_client.get(
        "/api/remote/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "cpu" in data
    assert "memory" in data
    assert "disk" in data
    assert "battery" in data
    assert "network" in data


def test_authenticated_device_can_fetch_processes(remote_client, paired_phone):
    _, token = paired_phone
    res = remote_client.get(
        "/api/remote/processes",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    procs = res.json()
    assert "processes" in procs
    assert isinstance(procs["processes"], list)


def test_authenticated_device_can_fetch_media(remote_client, paired_phone):
    _, token = paired_phone
    res = remote_client.get(
        "/api/remote/media",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "volume" in data
    assert "muted" in data
    assert "sinks" in data
    assert "now_playing" in data


def test_power_scope_permission_enforcement(remote_client, paired_phone):
    device, token = paired_phone
    conn = get_connection()

    # Disable power permission
    restricted_perms = dict(DEFAULT_PERMISSIONS)
    restricted_perms["power"] = False
    devices.update_permissions(conn, device.id, restricted_perms)

    res = remote_client.post(
        "/api/remote/power",
        json={"action": "lock"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
    assert "power" in res.json().get("detail", "").lower()

    # Re-enable power permission
    restricted_perms["power"] = True
    devices.update_permissions(conn, device.id, restricted_perms)
    status_res = remote_client.get(
        "/api/remote/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status_res.status_code == 200


def test_webcam_scope_permission_enforcement(remote_client, paired_phone):
    device, token = paired_phone
    conn = get_connection()

    # Disable webcam permission
    restricted_perms = dict(DEFAULT_PERMISSIONS)
    restricted_perms["webcam"] = False
    devices.update_permissions(conn, device.id, restricted_perms)

    res = remote_client.get(
        "/api/remote/camera/list",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
    assert "webcam" in res.json().get("detail", "").lower()

    # Re-enable webcam permission
    restricted_perms["webcam"] = True
    devices.update_permissions(conn, device.id, restricted_perms)

    res2 = remote_client.get(
        "/api/remote/camera/list",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res2.status_code == 200


def test_file_transfer_crud(remote_client, paired_phone):
    _, token = paired_phone
    auth_header = {"Authorization": f"Bearer {token}"}
    fname = f"amethyst_test_{uuid.uuid4().hex[:8]}.txt"

    # 1. List files initially
    res = remote_client.get("/api/remote/files", headers=auth_header)
    assert res.status_code == 200
    assert "files" in res.json()

    # 2. Upload a test file
    test_content = b"Amethyst test transfer payload"
    upload_res = remote_client.post(
        "/api/remote/files/upload",
        files={"file": (fname, io.BytesIO(test_content), "text/plain")},
        headers=auth_header,
    )
    assert upload_res.status_code == 200
    assert upload_res.json().get("name") == fname

    # 3. Verify it is listed
    res_after = remote_client.get("/api/remote/files", headers=auth_header)
    assert res_after.status_code == 200
    listed_names = [f["name"] for f in res_after.json()["files"]]
    assert fname in listed_names

    # 4. Download / retrieve file
    download_res = remote_client.get(f"/api/remote/files/download/{fname}", headers=auth_header)
    assert download_res.status_code == 200
    assert download_res.content == test_content

    # 5. Delete file
    delete_res = remote_client.delete(f"/api/remote/files/{fname}", headers=auth_header)
    assert delete_res.status_code == 200
    assert delete_res.json().get("deleted") == fname

    # 6. Verify it is gone
    res_final = remote_client.get("/api/remote/files", headers=auth_header)
    assert fname not in [f["name"] for f in res_final.json()["files"]]


def test_two_phase_pairing_approval_and_permissions(remote_client):
    secret, _ = devices.open_pairing(name_hint="Android Phone")

    # Step 1: Phone submits pairing claim over LAN
    claim_req = devices.build_request(secret, "Android Phone")
    claim_res = remote_client.post("/api/pair/claim", json=claim_req)
    assert claim_res.status_code == 200
    claim_body = claim_res.json()
    assert claim_body.get("refused") == "pending_approval"
    request_id = claim_body["request_id"]

    # Step 2: Phone checks status while waiting; gets pending_approval
    poll_early = remote_client.get(f"/api/pair/claim?request_id={request_id}")
    assert poll_early.status_code == 200
    assert poll_early.json().get("refused") == "pending_approval"

    # Step 3: PC desktop receives notification and approves with custom permissions (root & power disabled)
    custom_perms = dict(DEFAULT_PERMISSIONS)
    custom_perms["root"] = False
    custom_perms["power"] = False

    conn = get_connection()
    approved = devices.approve_pending(conn, request_id, permissions=custom_perms)
    assert approved is not None

    # Step 4: Phone polls and receives sealed credentials
    poll_approved = remote_client.get(f"/api/pair/claim?request_id={request_id}")
    assert poll_approved.status_code == 200
    approved_body = poll_approved.json()
    assert "ciphertext" in approved_body
    assert "nonce" in approved_body

    # Step 5: Phone unseals credentials and verifies permissions
    unsealed = devices.read_response(secret, approved_body)
    assert unsealed["device_id"]
    assert unsealed["token"]
    assert unsealed["permissions"]["root"] is False
    assert unsealed["permissions"]["power"] is False
    assert unsealed["permissions"]["screen"] is True

    # Step 6: Phone uses token to authenticate against remote endpoints
    phone_token = unsealed["token"]
    status_res = remote_client.get(
        "/api/remote/status",
        headers={"Authorization": f"Bearer {phone_token}"},
    )
    assert status_res.status_code == 200

    # Step 7: Since power was disabled in approval, power control is rejected with 403
    power_res = remote_client.post(
        "/api/remote/power",
        json={"action": "lock"},
        headers={"Authorization": f"Bearer {phone_token}"},
    )
    assert power_res.status_code == 403


def test_two_phase_pairing_rejection(remote_client):
    secret, _ = devices.open_pairing(name_hint="Untrusted Device")

    # Step 1: Phone submits pairing claim
    claim_req = devices.build_request(secret, "Untrusted Device")
    claim_res = remote_client.post("/api/pair/claim", json=claim_req)
    assert claim_res.status_code == 200
    request_id = claim_res.json()["request_id"]

    # Step 2: PC desktop rejects the request
    rejected = devices.reject_pending(request_id)
    assert rejected is not None

    # Step 3: Phone polls and is refused with 403
    poll_rejected = remote_client.get(f"/api/pair/claim?request_id={request_id}")
    assert poll_rejected.status_code == 403


def test_remote_cannot_list_pending_devices(remote_client):
    secret, _ = devices.open_pairing(name_hint="Pixel 9 Pro")
    claim_req = devices.build_request(secret, "Pixel 9 Pro")
    claim_res = remote_client.post("/api/pair/claim", json=claim_req)
    assert claim_res.status_code == 200

    # Remote unauthenticated caller is blocked from listing pending devices
    assert remote_client.get("/api/devices/pending").status_code == 403


def test_local_pending_devices_listing_and_device_id_returned(local_client):
    secret, _ = devices.open_pairing(name_hint="Pixel 9 Pro")

    # Local claims
    claim_req = devices.build_request(secret, "Pixel 9 Pro")
    claim_res = local_client.post("/api/pair/claim", json=claim_req)
    assert claim_res.status_code == 200
    request_id = claim_res.json()["request_id"]

    # PC desktop checks pending list
    pending_res = local_client.get("/api/devices/pending")
    assert pending_res.status_code == 200
    pending_list = pending_res.json().get("pending", [])
    assert any(p["request_id"] == request_id and p["name"] == "Pixel 9 Pro" for p in pending_list)

    # PC desktop approves
    approve_res = local_client.post(f"/api/devices/pending/{request_id}/approve", json={})
    assert approve_res.status_code == 200
    assert approve_res.json()["ok"] is True
    assert approve_res.json()["device_id"] is not None

    # Pending list should now be empty of that request
    pending_after = local_client.get("/api/devices/pending").json().get("pending", [])
    assert not any(p["request_id"] == request_id for p in pending_after)


def test_broadcast_control_thread_safety():
    import threading
    from backend.api.main import broadcast_control

    # Should not raise exception even when called from worker thread
    err = None
    def worker():
        nonlocal err
        try:
            broadcast_control("pairing_request", request_id="test-123", name="Phone")
        except Exception as e:
            err = e

    t = threading.Thread(target=worker)
    t.start()
    t.join()
    assert err is None


def test_broadcast_control_invokes_listeners():
    from backend.api import main as api_main

    received = []
    def on_pairing(data):
        received.append(data)

    api_main.on_control("test_action", on_pairing)
    try:
        api_main.broadcast_control("test_action", test_key="test_val")
        assert len(received) == 1
        assert received[0]["test_key"] == "test_val"
    finally:
        api_main._control_listeners.get("test_action", []).remove(on_pairing)


def test_host_lan_ip_recognized_as_local(bound_wide, monkeypatch):
    from backend.api import main as api_main
    from backend.sync.devices import lan_address

    host_lan = lan_address()
    if not host_lan:
        pytest.skip("No LAN address found on host")

    # Host LAN IP should be considered local
    assert api_main._is_local(host_lan) is True

    # Client accessing via host LAN IP can list pending devices
    with TestClient(api_main.app, client=(host_lan, 54321)) as host_client:
        res = host_client.get("/api/devices/pending")
        assert res.status_code == 200

