"""Tests for To-do items and credentials/auth synchronization across devices.

Verifies:
1. Secure credential storage and migration:
   - Vault persistence in OS keychain / secrets store.
   - Sync with ~/.config/microsoft-todo-mcp/token-cache.json (0600 permissions).
   - Automatic migration of existing filesystem token cache into vault.
2. Device-to-device carry over:
   - Sign in on Device A.
   - Add to-dos and task lists on Device A.
   - Pair Device B and sync.
   - Confirm Device B receives all task lists, all to-dos (including checklists and dates),
     and valid Microsoft To Do credentials/auth.
3. Refresh and disconnect propagation:
   - Token refresh on one device propagates to the other.
   - Disconnecting / logging out removes credentials from both devices without leaving orphan secrets.
4. Security invariants:
   - No plaintext secrets in SQLite database tables or logs.
"""

from __future__ import annotations

import json
import os
import stat
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import secrets
from backend.auth import microsoft
from backend.db.connection import _configure, migrate
from backend.db.repositories import TaskListRepository, TaskRepository
from backend.sync import crypto, devices, ops, project, registry, service
from backend.sync.hlc import Clock


SCHEMA = Path(__file__).resolve().parents[1] / "backend" / "db" / "schema.sql"


class MockMailbox:
    """Simulated relay mailbox between paired devices."""

    def __init__(self, *device_ids: str):
        self.devices = list(device_ids)
        self.rows: dict[str, dict] = {}
        self.acks: set[tuple[str, str]] = set()

    def post(self, uploaded, from_device):
        stored = 0
        for op in uploaded:
            if op["op_id"] in self.rows:
                continue
            self.rows[op["op_id"]] = {**op, "from_device": from_device}
            stored += 1
        return stored

    def take(self, device_id):
        return [
            row
            for op_id, row in self.rows.items()
            if row["from_device"] != device_id and (op_id, device_id) not in self.acks
        ]

    def ack(self, device_id, op_ids):
        for op_id in op_ids:
            self.acks.add((op_id, device_id))
        for op_id in list(self.rows):
            owed = [d for d in self.devices if d != self.rows[op_id]["from_device"]]
            if all((op_id, d) in self.acks for d in owed):
                del self.rows[op_id]


class SyncDevice:
    """A simulated Amethyst machine with SQLite DB and vault store."""

    def __init__(self, name: str, vault_store: dict[str, str], cache_dir: Path):
        self.name = name
        self.vault = vault_store
        self.cache_dir = cache_dir
        self.cache_path = cache_dir / "token-cache.json"

        # Dedicated SQLite connection
        import sqlite3

        self.conn = sqlite3.connect(":memory:")
        _configure(self.conn)
        migrate(self.conn)
        self.id = devices.local_id(self.conn, name=name)
        self.clock = Clock(self.id)
        self.conn.commit()

        self.tasks = TaskRepository(self.conn)
        self.lists = TaskListRepository(self.conn)
        self.pending_ack: list[str] = []

    def sync(self, mailbox: MockMailbox) -> int:
        outgoing = service.outgoing(self.conn)
        ack, self.pending_ack = self.pending_ack, []

        stored = mailbox.post(outgoing, self.id)
        mailbox.ack(self.id, ack)

        if outgoing and stored is not None:
            ops.forget(self.conn, [op["op_id"] for op in outgoing])

        applied, acks = service.incoming({"ops": mailbox.take(self.id)}, self.conn)
        self.pending_ack.extend(acks)
        self.conn.commit()
        return applied


@pytest.fixture
def test_env(tmp_path, monkeypatch):
    """Set up isolated vault, token cache directory, and crypto group key."""
    secrets_a: dict[str, str] = {}
    secrets_b: dict[str, str] = {}
    active_device = ["A"]

    def fake_get_secret(ref: str) -> str | None:
        target = secrets_a if active_device[0] == "A" else secrets_b
        return target.get(ref)

    def fake_set_secret(ref: str, val: str) -> None:
        target = secrets_a if active_device[0] == "A" else secrets_b
        target[ref] = val

    def fake_delete_secret(ref: str) -> None:
        target = secrets_a if active_device[0] == "A" else secrets_b
        target.pop(ref, None)

    monkeypatch.setattr(secrets, "get_secret", fake_get_secret)
    monkeypatch.setattr(secrets, "set_secret", fake_set_secret)
    monkeypatch.setattr(secrets, "delete_secret", fake_delete_secret)
    monkeypatch.setattr("backend.secrets.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.secrets.set_secret", fake_set_secret)
    monkeypatch.setattr("backend.secrets.delete_secret", fake_delete_secret)
    monkeypatch.setattr("backend.sync.project.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.sync.ops.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.sync.ops.set_secret", fake_set_secret)
    monkeypatch.setattr("backend.sync.ops.delete_secret", fake_delete_secret)
    monkeypatch.setattr("backend.sync.devices.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.auth.microsoft.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.auth.microsoft.set_secret", fake_set_secret)
    monkeypatch.setattr("backend.auth.microsoft.delete_secret", fake_delete_secret)
    monkeypatch.setattr("backend.sync.crypto.get_secret", fake_get_secret)
    monkeypatch.setattr("backend.sync.crypto.set_secret", fake_set_secret)

    cache_a = tmp_path / "device_a_config" / "microsoft-todo-mcp"
    cache_b = tmp_path / "device_b_config" / "microsoft-todo-mcp"
    cache_a.mkdir(parents=True, exist_ok=True)
    cache_b.mkdir(parents=True, exist_ok=True)

    def fake_get_cache_path():
        return (cache_a if active_device[0] == "A" else cache_b) / "token-cache.json"

    monkeypatch.setattr(microsoft, "get_token_cache_path", fake_get_cache_path)

    # Pre-generate group key for both
    group_key = crypto.AESGCM.generate_key(bit_length=256)
    secrets_a["amethyst/sync-group-key"] = crypto.b64(group_key)
    secrets_b["amethyst/sync-group-key"] = crypto.b64(group_key)

    service.reset_clock()

    yield {
        "secrets_a": secrets_a,
        "secrets_b": secrets_b,
        "cache_a": cache_a,
        "cache_b": cache_b,
        "active_device": active_device,
    }
    service.reset_clock()


def test_token_persistence_and_cache_sync(test_env):
    """Signing in saves tokens to vault, writes 0600 token-cache.json, and records change."""
    token_record = {
        "access_token": "live-access-token-123",
        "refresh_token": "live-refresh-token-456",
        "expires_at": time.time() + 3600,
        "scope": microsoft.DEFAULT_SCOPES,
        "client_id": "test-client",
        "updated_at": time.time(),
    }

    # Store via microsoft helper
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(token_record))
    microsoft.sync_token_cache_from_vault(token_record)

    # 1. Vault check
    stored_vault = secrets.get_secret(microsoft.VAULT_KEY)
    assert stored_vault is not None
    assert json.loads(stored_vault)["access_token"] == "live-access-token-123"

    # 2. File cache check
    cache_file = microsoft.get_token_cache_path()
    assert cache_file.is_file()
    mode = stat.S_IMODE(os.stat(cache_file).st_mode)
    assert mode == 0o600, f"Token cache file must have 0600 permissions, got {oct(mode)}"

    content = json.loads(cache_file.read_text(encoding="utf-8"))
    assert content["accessToken"] == "live-access-token-123"
    assert content["refreshToken"] == "live-refresh-token-456"

    # 3. Connection status check
    status = microsoft.get_connection_status()
    assert status["connected"] is True


def test_legacy_token_cache_migration(test_env):
    """A pre-existing token-cache.json is migrated into the vault with 0600 permissions."""
    cache_file = microsoft.get_token_cache_path()
    cache_file.write_text(json.dumps({
        "accessToken": "legacy-token-abc",
        "refreshToken": "legacy-refresh-xyz",
        "expires_at": time.time() + 7200,
    }), encoding="utf-8")
    os.chmod(cache_file, 0o644)  # Previously loose permissions

    assert secrets.get_secret(microsoft.VAULT_KEY) is None

    # Trigger migration
    migrated = microsoft.migrate_token_cache_to_vault()
    assert migrated is True

    # Vault now has the tokens
    stored = secrets.get_secret(microsoft.VAULT_KEY)
    assert stored is not None
    record = json.loads(stored)
    assert record["access_token"] == "legacy-token-abc"
    assert record["refresh_token"] == "legacy-refresh-xyz"

    # Permissions tightened to 0600
    mode = stat.S_IMODE(os.stat(cache_file).st_mode)
    assert mode == 0o600


@pytest.mark.asyncio
async def test_device_a_to_device_b_full_sync(test_env):
    """End-to-end multi-device workflow:
    1. Sign in on Device A to Microsoft To Do.
    2. Add to-dos and task lists on Device A.
    3. Pair Device B with Device A.
    4. Run sync.
    5. Confirm Device B has all to-dos, checklists, lists, and Microsoft credentials!
    """
    env = test_env
    active = env["active_device"]

    # --- DEVICE A SETUP ---
    active[0] = "A"
    dev_a = SyncDevice("device-a", env["secrets_a"], env["cache_a"])

    # 1. Sign in on Device A
    tokens = {
        "access_token": "token-for-device-a",
        "refresh_token": "refresh-for-device-a",
        "expires_at": time.time() + 3600,
        "scope": microsoft.DEFAULT_SCOPES,
        "client_id": "test-client",
        "updated_at": time.time(),
    }
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(tokens))
    microsoft.sync_token_cache_from_vault(tokens)
    microsoft.record_credential_change(tokens, dev_a.conn)

    # 2. Add task lists and to-do items on Device A
    work_list_id = dev_a.lists.create("Work", is_default=False)
    home_list_id = dev_a.lists.create("Home", is_default=True)

    task_1 = dev_a.tasks.create(
        "Complete quarterly report",
        notes="Include metrics from analytics dashboard",
        due_at="2026-11-15 17:00:00",
        scheduled_at="2026-11-14 09:00:00",
        duration_estimate_minutes=120,
        priority="high",
        important=True,
        list_id=work_list_id,
        my_day_date="2026-11-14",
        checklist_items=json.dumps([
            {"id": "c1", "displayName": "Export stats", "isChecked": True},
            {"id": "c2", "displayName": "Draft slides", "isChecked": False},
        ]),
    )

    task_2 = dev_a.tasks.create(
        "Buy milk and eggs",
        list_id=home_list_id,
        priority="low",
    )

    # --- DEVICE B SETUP & PAIRING ---
    active[0] = "B"
    dev_b = SyncDevice("device-b", env["secrets_b"], env["cache_b"])

    # Register peers on both devices
    devices.register(dev_a.conn, name="device-b", role="control")
    devices.register(dev_b.conn, name="device-a", role="host")
    dev_a.conn.commit()
    dev_b.conn.commit()

    mailbox = MockMailbox(dev_a.id, dev_b.id)

    # --- RUN SYNC ---
    # Device A publishes to mailbox
    active[0] = "A"
    dev_a.sync(mailbox)
    print("MAILBOX ROWS AFTER A SYNC:", [r.get("op_id") for r in mailbox.rows.values()])

    # Device B receives from mailbox
    active[0] = "B"
    applied_count = dev_b.sync(mailbox)
    assert applied_count > 0, "Device B should have applied incoming ops"

    # --- VERIFY DEVICE B STATE ---
    # 1. Lists transferred
    lists_b = dev_b.lists.all()
    list_names = [l["name"] for l in lists_b]
    assert "Work" in list_names
    assert "Home" in list_names

    # 2. Tasks transferred with all details
    all_tasks_b = dev_b.conn.execute("SELECT * FROM tasks").fetchall()
    assert len(all_tasks_b) == 2

    report_task = next(t for t in all_tasks_b if t["title"] == "Complete quarterly report")
    assert report_task["notes"] == "Include metrics from analytics dashboard"
    assert report_task["due_at"] == "2026-11-15 17:00:00"
    assert report_task["scheduled_at"] == "2026-11-14 09:00:00"
    assert report_task["duration_estimate_minutes"] == 120
    assert report_task["priority"] == "high"
    assert report_task["important"] == 1
    assert report_task["my_day_date"] == "2026-11-14"

    checklists = json.loads(report_task["checklist_items"])
    assert len(checklists) == 2
    assert checklists[0]["displayName"] == "Export stats"
    assert checklists[0]["isChecked"] is True

    # 3. Credentials transferred to Device B!
    b_vault_raw = secrets.get_secret(microsoft.VAULT_KEY)
    assert b_vault_raw is not None, "Microsoft To Do tokens must be present in Device B vault"
    b_tokens = json.loads(b_vault_raw)
    assert b_tokens["access_token"] == "token-for-device-a"

    # 4. Device B connection status is connected
    b_status = microsoft.get_connection_status()
    assert b_status["connected"] is True

    # 5. Device B valid access token check
    token = await microsoft.get_valid_access_token()
    assert token == "token-for-device-a"

    # 6. Device B connector cache file check
    b_cache = microsoft.get_token_cache_path()
    assert b_cache.is_file()
    b_cache_mode = stat.S_IMODE(os.stat(b_cache).st_mode)
    assert b_cache_mode == 0o600


@pytest.mark.asyncio
async def test_token_refresh_syncs_to_peer(test_env):
    """When tokens refresh on Device A, Device B receives the refreshed tokens."""
    env = test_env
    active = env["active_device"]

    active[0] = "A"
    dev_a = SyncDevice("device-a", env["secrets_a"], env["cache_a"])
    active[0] = "B"
    dev_b = SyncDevice("device-b", env["secrets_b"], env["cache_b"])

    devices.register(dev_a.conn, name="device-b", role="control")
    devices.register(dev_b.conn, name="device-a", role="host")
    dev_a.conn.commit()
    dev_b.conn.commit()

    mailbox = MockMailbox(dev_a.id, dev_b.id)

    # Initial token on A
    active[0] = "A"
    initial_record = {
        "access_token": "expired-token-a",
        "refresh_token": "refresh-token-a",
        "expires_at": time.time() - 10,
        "scope": microsoft.DEFAULT_SCOPES,
        "client_id": "cid",
        "updated_at": time.time() - 100,
    }
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(initial_record))
    microsoft.sync_token_cache_from_vault(initial_record)
    microsoft.record_credential_change(initial_record, dev_a.conn)

    # Refresh token on A via mock endpoint
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = MagicMock(return_value={
        "access_token": "brand-new-token-111",
        "refresh_token": "brand-new-refresh-222",
        "expires_in": 3600,
    })

    with patch("httpx.AsyncClient.post", return_value=mock_resp):
        new_token = await microsoft.get_valid_access_token()
        assert new_token == "brand-new-token-111"

    # Sync from A to B
    active[0] = "A"
    dev_a.sync(mailbox)

    active[0] = "B"
    dev_b.sync(mailbox)

    # Device B should have the refreshed token
    b_raw = secrets.get_secret(microsoft.VAULT_KEY)
    assert b_raw is not None
    assert json.loads(b_raw)["access_token"] == "brand-new-token-111"
    assert json.loads(b_raw)["refresh_token"] == "brand-new-refresh-222"


def test_disconnect_logout_propagates_and_cleans_up(test_env):
    """Disconnecting on Device A removes credentials on Device A and Device B."""
    env = test_env
    active = env["active_device"]

    active[0] = "A"
    dev_a = SyncDevice("device-a", env["secrets_a"], env["cache_a"])
    active[0] = "B"
    dev_b = SyncDevice("device-b", env["secrets_b"], env["cache_b"])

    devices.register(dev_a.conn, name="device-b", role="control")
    devices.register(dev_b.conn, name="device-a", role="host")
    dev_a.conn.commit()
    dev_b.conn.commit()

    mailbox = MockMailbox(dev_a.id, dev_b.id)

    # Initial state: both have tokens
    active[0] = "A"
    tok = {"access_token": "active-tok", "refresh_token": "rt", "expires_at": time.time() + 3600}
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(tok))
    microsoft.sync_token_cache_from_vault(tok)
    microsoft.record_credential_change(tok, dev_a.conn)

    active[0] = "B"
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(tok))
    microsoft.sync_token_cache_from_vault(tok)

    # Disconnect on Device A
    active[0] = "A"
    ok = microsoft.disconnect()
    assert ok is True
    assert secrets.get_secret(microsoft.VAULT_KEY) is None
    assert not microsoft.get_token_cache_path().exists()

    # Sync to Device B
    dev_a.sync(mailbox)

    active[0] = "B"
    dev_b.sync(mailbox)

    # Device B should also be disconnected
    assert secrets.get_secret(microsoft.VAULT_KEY) is None
    assert not microsoft.get_token_cache_path().exists()
    assert microsoft.get_connection_status()["connected"] is False


def test_no_plaintext_secrets_in_sqlite_tables(test_env):
    """Confirm no token strings appear in SQLite tables."""
    env = test_env
    active = env["active_device"]
    active[0] = "A"

    dev_a = SyncDevice("device-a", env["secrets_a"], env["cache_a"])
    secret_marker = "super-secret-unique-token-value-999888"

    tokens = {
        "access_token": secret_marker,
        "refresh_token": "another-secret-token",
        "expires_at": time.time() + 3600,
    }
    secrets.set_secret(microsoft.VAULT_KEY, json.dumps(tokens))
    microsoft.record_credential_change(tokens, dev_a.conn)

    # Dump all SQLite text
    cursor = dev_a.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]

    for table in tables:
        rows = dev_a.conn.execute(f"SELECT * FROM {table}").fetchall()
        for row in rows:
            row_str = str(row)
            assert secret_marker not in row_str, f"Plaintext secret found in table {table}: {row_str}"
