"""Tests for Microsoft credential handoff on pairing and PC relinquishment."""

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from backend.api.main import app
from backend.auth import microsoft
from backend.pairing.service import pairing_service
from backend.secrets import delete_secret, get_secret, set_secret


@pytest.fixture(autouse=True)
def clean_state():
    delete_secret(microsoft.VAULT_KEY)
    pairing_service.cancel_pairing()
    yield
    delete_secret(microsoft.VAULT_KEY)
    pairing_service.cancel_pairing()


def test_pairing_handoff_with_microsoft_connected():
    """When PC is connected to Microsoft, approve_pairing sends token bundle, but only relinquishes on ACK."""
    # 1. Store Microsoft credentials on PC
    initial_tokens = {
        "access_token": "pc-live-access-token",
        "refresh_token": "pc-live-refresh-token",
        "expires_at": time.time() + 3600,
        "scope": microsoft.DEFAULT_SCOPES,
        "account_id": "acc-user-99",
        "email": "user@example.com",
    }
    set_secret(microsoft.VAULT_KEY, json.dumps(initial_tokens))
    assert microsoft.get_connection_status()["connected"] is True

    # 2. Start pairing and approve
    pairing_service.start_pairing()
    pairing_service._server.pending_device_label = "Test Companion Phone"

    approve_res = pairing_service.approve_pairing()
    assert approve_res["ok"] is True

    # 3. Verify bundle delivered to phone contains Microsoft credentials
    last_bundle = pairing_service._last_bundle
    assert last_bundle is not None
    assert "microsoft" in last_bundle
    ms_bundle = last_bundle["microsoft"]
    assert ms_bundle["refresh_token"] == "pc-live-refresh-token"
    assert ms_bundle["access_token"] == "pc-live-access-token"
    assert ms_bundle["account_id"] == "acc-user-99"
    assert ms_bundle["email"] == "user@example.com"
    assert ms_bundle["scopes"] == microsoft.DEFAULT_SCOPES

    # 4. Before ACK: PC token must NOT be wiped
    stored_pc_before = json.loads(get_secret(microsoft.VAULT_KEY))
    assert stored_pc_before.get("refresh_token") == "pc-live-refresh-token"
    assert microsoft.get_connection_status()["connected"] is True

    # 5. Phone sends explicit ACK: PC copy is relinquished
    ack_res = pairing_service.confirm_pairing(device_id=approve_res["device_id"], token=pairing_service._last_token)
    assert ack_res["ok"] is True

    stored_pc = json.loads(get_secret(microsoft.VAULT_KEY))
    assert stored_pc.get("refresh_token") is None
    assert stored_pc.get("handed_off") is True

    pc_status = microsoft.get_connection_status()
    assert pc_status["connected"] is False
    assert pc_status.get("handed_off") is True


def test_dropped_connection_before_ack_keeps_pc_tokens():
    """Risk a: If phone connection drops before ACK, PC tokens must remain completely intact."""
    initial_tokens = {
        "access_token": "pc-safe-access",
        "refresh_token": "pc-safe-refresh",
        "expires_at": time.time() + 3600,
    }
    set_secret(microsoft.VAULT_KEY, json.dumps(initial_tokens))
    assert microsoft.get_connection_status()["connected"] is True

    pairing_service.start_pairing()
    pairing_service._server.pending_device_label = "Dropped Phone"

    # Pairing is approved on PC, but phone connection aborts / drops before writing or ACKing
    approve_res = pairing_service.approve_pairing()
    assert approve_res["ok"] is True

    # Simulated phone network drop: no ACK ever arrives, pairing server is cancelled or expires
    pairing_service.cancel_pairing()

    # Assert PC still has valid tokens and is connected
    assert microsoft.get_connection_status()["connected"] is True
    pc_data = json.loads(get_secret(microsoft.VAULT_KEY))
    assert pc_data.get("refresh_token") == "pc-safe-refresh"


def test_no_empty_credential_op_published_over_relay():
    """Risk b: Handed-off or empty credentials must NOT publish empty op over sync relay."""
    import sqlite3
    from backend.db.connection import _configure, migrate
    from backend.sync.hlc import Clock
    from backend.sync import ops, project

    conn = sqlite3.connect(":memory:")
    _configure(conn)
    migrate(conn)
    clock = Clock("test-device")

    # Record synced_credentials row for microsoft-todo
    conn.execute(
        "INSERT INTO synced_credentials (key, updated_at) VALUES ('microsoft-todo', datetime('now'))"
    )
    conn.commit()

    # Case 1: Handed off tokens in vault
    set_secret(microsoft.VAULT_KEY, json.dumps({
        "access_token": None,
        "refresh_token": None,
        "handed_off": True,
    }))

    published = project._publish_credentials(conn, clock, limit=10)
    assert published == 0

    # Verify no credential op was emitted
    op_count = conn.execute(
        "SELECT COUNT(*) FROM sync_ops WHERE entity = 'credentials'"
    ).fetchone()[0]
    assert op_count == 0


@pytest.mark.asyncio
async def test_pc_requires_reauth_when_next_needing_graph():
    """After handoff, PC cannot refresh with handed-off token and returns None for access token."""
    initial_tokens = {
        "access_token": "pc-live-access-token",
        "refresh_token": "pc-live-refresh-token",
        "expires_at": time.time() + 3600,
    }
    set_secret(microsoft.VAULT_KEY, json.dumps(initial_tokens))

    # Hand off
    bundle = microsoft.get_token_bundle_for_handoff()
    assert bundle["refresh_token"] == "pc-live-refresh-token"
    microsoft.relinquish_refresh_token_after_handoff()

    # Next Graph access on PC cannot use the handed-off refresh token
    token = await microsoft.get_valid_access_token()
    assert token is None


def test_pairing_omits_microsoft_when_pc_disconnected():
    """When PC has no Microsoft connection, pairing bundle omits microsoft section."""
    delete_secret(microsoft.VAULT_KEY)
    assert microsoft.get_connection_status()["connected"] is False

    pairing_service.start_pairing()
    pairing_service._server.pending_device_label = "Offline Phone"

    approve_res = pairing_service.approve_pairing()
    assert approve_res["ok"] is True

    last_bundle = pairing_service._last_bundle
    assert "microsoft" not in last_bundle


def test_pc_bundle_endpoint():
    """GET /api/auth/microsoft/bundle returns bundle if PC has fresh auth, or connected=False if handed off."""
    client = TestClient(app)

    # Handed off state -> connected=False
    tokens = {
        "access_token": None,
        "refresh_token": None,
        "handed_off": True,
    }
    set_secret(microsoft.VAULT_KEY, json.dumps(tokens))

    res = client.get("/api/auth/microsoft/bundle")
    assert res.status_code == 200
    assert res.json()["connected"] is False

    # PC re-authenticates itself with a fresh token
    fresh_tokens = {
        "access_token": "pc-new-access",
        "refresh_token": "pc-new-refresh",
        "expires_at": time.time() + 3600,
        "scope": microsoft.DEFAULT_SCOPES,
        "email": "reauth@example.com",
    }
    set_secret(microsoft.VAULT_KEY, json.dumps(fresh_tokens))

    res2 = client.get("/api/auth/microsoft/bundle")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["connected"] is True
    assert data2["bundle"]["refresh_token"] == "pc-new-refresh"
    assert data2["bundle"]["email"] == "reauth@example.com"


def test_disconnect_clears_pc_vault():
    """POST /api/auth/microsoft/disconnect removes credentials from vault."""
    client = TestClient(app)
    set_secret(microsoft.VAULT_KEY, json.dumps({"access_token": "dummy", "refresh_token": "rt"}))
    assert microsoft.get_connection_status()["connected"] is True

    res = client.post("/api/auth/microsoft/disconnect")
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert microsoft.get_connection_status()["connected"] is False
    assert get_secret(microsoft.VAULT_KEY) is None
