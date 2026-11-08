# Mobile Remote Access Permissions & Credential Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 403 Forbidden on mobile library re-enrichment, enable independent mobile operation with local keys, and automatically sync LLM and Google Drive keys when desktop PC is online.

**Architecture:** Update `backend/security/remote_access.py` capabilities to permit library writes and AI transforms for paired companions; introduce `GET /api/remote/credentials/bundle` and WebSocket broadcasts in `backend/remote/router.py`; wire `Companion.jsx` to auto-refresh mobile vault keys upon connection, app resume, and push notifications with offline fallback.

**Tech Stack:** Python, FastAPI, SQLite, React, WebSocket, Android Keystore / iOS Keychain (nativeVault), Capacitor, Pytest, Node Test Runner.

**Spec:** [`docs/superpowers/specs/2026-11-09-mobile-permissions-and-credential-sync-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-09-mobile-permissions-and-credential-sync-design.md)

## Global Constraints

- Never expose unencrypted API keys or credentials in synced SQLite tables (`ops.py`) or Cloudflare relay logs.
- Paired mobile devices must fail closed on revoked tokens (HTTP 401).
- Offline mobile operations must succeed using locally cached bundle keys without requiring active PC connection.
- Preserves CONTRACT v2 separate phone-only keys when `use_separate_keys` setting is enabled.

## Review Focus

- Calling `POST /api/library/{id}/enrich` from an unauthenticated caller or an unpaired device must return 403.
- Calling `POST /api/library/{id}/enrich` from a paired device holding `library: true` must succeed.
- Calling `GET /api/remote/credentials/bundle` without a device token must return 403/401.
- If the desktop PC goes to sleep or disconnects, mobile app must not throw unhandled exceptions or crash.
- If desktop updates LLM providers, mobile vault must update without dropping existing Microsoft Todo tokens or offline queue.

---

### Task 1: Remote Access Capability Map Update & Tests

**Files:**
- Modify: `backend/security/remote_access.py:13-52`
- Test: `tests/test_remote_access_library.py`

**Interfaces:**
- Consumes:
  - `capability(path: str, method: str) -> str | None`
  - `allowed(device, permission: str | None) -> bool`
- Produces:
  - Grants capability `"library"` for `POST /api/library/{id}/enrich`, `POST /api/library/{id}/reindex`, `PUT/PATCH/DELETE /api/library/{id}`, `POST /api/library`, `POST /api/library/sync/(start|detect)`, `GET /api/library/sync/status`.
  - Grants capability `"paired"` for `POST /api/ai/transform` and `GET /api/remote/credentials/bundle`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_remote_access_library.py`:
```python
import pytest
from backend.security.remote_access import capability, allowed
from backend.sync.devices import Device

def test_capability_mapping_for_library_routes():
    assert capability("/api/library/1/enrich", "POST") == "library"
    assert capability("/api/library/1/reindex", "POST") == "library"
    assert capability("/api/library/1", "PUT") == "library"
    assert capability("/api/library/1", "DELETE") == "library"
    assert capability("/api/library", "POST") == "library"
    assert capability("/api/library/sync/start", "POST") == "library"
    assert capability("/api/library/sync/status", "GET") == "library"
    assert capability("/api/ai/transform", "POST") == "paired"
    assert capability("/api/remote/credentials/bundle", "GET") == "paired"

def test_allowed_checks_device_permissions():
    dev = Device(id="phone_1", name="Phone", role="control", token_hash="h", permissions={"library": True}, created_at="", last_seen_at="")
    assert allowed(dev, "library") is True
    assert allowed(dev, "paired") is True
    assert allowed(dev, "system") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_remote_access_library.py -v`  
Expected: FAIL on `capability("/api/library/1/enrich", "POST") == "library"` (returns `None`).

- [ ] **Step 3: Update `backend/security/remote_access.py`**

In `backend/security/remote_access.py`:
Replace the `rules` tuple entries for library:
```python
        ("GET|POST|PUT|PATCH|DELETE", r"/api/library(?:/[^/]+(?:/(?:thumbnail|media|slides/\d+|enrich|reindex))?)?", "library"),
        ("POST", r"/api/library/sync/(?:start|detect)", "library"),
        ("GET", r"/api/library/sync/status", "library"),
        ("POST", r"/api/ai/transform", "paired"),
        ("GET", r"/api/remote/credentials/bundle", "paired"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_remote_access_library.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/security/remote_access.py tests/test_remote_access_library.py
git commit -m "feat: map library actions and credentials bundle to remote access capabilities"
```

---

### Task 2: Backend Credentials Bundle Endpoint & WebSocket Notification

**Files:**
- Modify: `backend/remote/router.py`
- Test: `tests/test_remote_credentials_bundle.py`

**Interfaces:**
- Consumes:
  - `backend.config.configured_providers()`
  - `backend.config.load_tiers()`
  - `backend.secrets.resolve_api_key()`
  - `backend.config.load_drive_inbox_settings()`
  - `backend.pairing.config.get_use_separate_keys()`
  - `backend.pairing.config.get_phone_llm_config()`
  - `backend.pairing.config.get_phone_composio_config()`
  - `backend.mcp.composio_service.composio_service`
- Produces:
  - Route `GET /api/remote/credentials/bundle` -> returns CONTRACT v2 bundle payload.
  - Function `broadcast_credentials_updated()` -> sends `{ "type": "credentials_updated" }` to active remote WebSockets.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_remote_credentials_bundle.py`:
```python
import pytest
from fastapi.testclient import TestClient
from backend.api.main import app, BIND_HOST_ENV
from backend.db.connection import get_connection
from backend.sync import devices
import hashlib

@pytest.fixture
def bound_wide(monkeypatch):
    monkeypatch.setenv(BIND_HOST_ENV, "0.0.0.0")

def test_credentials_bundle_requires_authentication(bound_wide):
    with TestClient(app, client=("192.168.1.50", 51234)) as client:
        res = client.get("/api/remote/credentials/bundle")
        assert res.status_code == 403

def test_credentials_bundle_returns_valid_bundle_for_paired_device(bound_wide, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key-1234")
    token = "test_device_secret_token_abc"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    conn = get_connection()
    conn.execute(
        "INSERT INTO devices (id, name, role, token_hash, permissions, created_at) VALUES (?, ?, 'control', ?, '{\"library\":true,\"paired\":true}', datetime('now'))",
        ("test_phone_id", "Test Phone", token_hash),
    )
    conn.commit()

    with TestClient(app, client=("192.168.1.50", 51234)) as client:
        headers = {"Authorization": f"Bearer {token}"}
        res = client.get("/api/remote/credentials/bundle", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "llm" in data
        assert "drive" in data
        assert "composio" in data
        assert "device_id" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_remote_credentials_bundle.py -v`  
Expected: FAIL with 404 or 403 on `/api/remote/credentials/bundle`.

- [ ] **Step 3: Implement `GET /api/remote/credentials/bundle` in `backend/remote/router.py`**

In `backend/remote/router.py`:
- Add handler `get_credentials_bundle(request: Request)`:
  - Reads authenticated `request.scope.get("device")`. If missing, raises HTTP 403.
  - Builds `llm_bundle`, `composio_bundle`, and `drive_bundle` using `configured_providers()`, `load_tiers()`, `load_drive_inbox_settings()`, and Composio credentials.
  - Returns bundle JSON matching CONTRACT v2 schema.
- Implement helper `broadcast_credentials_updated()` that iterates over active WebSockets in `backend/remote/router.py` and sends `json.dumps({"type": "credentials_updated"})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_remote_credentials_bundle.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/remote/router.py tests/test_remote_credentials_bundle.py
git commit -m "feat: add remote credentials bundle endpoint and websocket broadcast"
```

---

### Task 3: Mobile Client Auto-Sync Hook and Secure Vault Update

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/mobile/Companion.jsx:110-140, 320-370`
- Modify: `frontend/src/mobile/connectionStatus.js:60-95`
- Test: `frontend/tests/mobile-credential-sync.test.mjs`

**Interfaces:**
- Consumes:
  - `api.getCredentialsBundle() -> Promise<Object>`
  - `getBundle() -> Promise<Object|null>`
  - `saveBundle(bundle: Object) -> Promise<void>`
  - `saveConnections(conns: Object) -> Promise<void>`
  - `loadConnections() -> Promise<Object>`
- Produces:
  - Automatic synchronization of credentials into mobile keystore and service connections.
  - Non-blocking error handling when host is offline.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/mobile-credential-sync.test.mjs`:
```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBundle } from '../src/mobile/bundle.js'

test('validates incoming synced credentials bundle', () => {
  const incoming = {
    device_id: 'phone_01',
    llm: {
      providers: [
        { provider: 'openai', model: 'gpt-4o', api_key: 'sk-12345' }
      ],
      default: 0,
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'sk-12345'
    },
    composio: { api_key: 'comp_123', user_id: 'uid_123' },
    drive: { root_folder_id: 'root_1', inbox_folder_id: 'inbox_1' },
    prompts: { summary: 'Concise summary' }
  }
  const check = validateBundle(incoming)
  assert.equal(check.valid, true)
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test frontend/tests/mobile-credential-sync.test.mjs`  
Expected: PASS.

- [ ] **Step 3: Implement `api.getCredentialsBundle` and sync handler**

1. In `frontend/src/api.js`:
   ```javascript
   getCredentialsBundle() {
     return request('/remote/credentials/bundle')
   },
   ```
2. In `frontend/src/mobile/Companion.jsx`:
   - Add a credential sync function `syncCredentials()`:
     - Check if paired. If not, return.
     - Call `const fresh = await api.getCredentialsBundle().catch(() => null)`.
     - If `fresh && validateBundle(fresh).valid`:
       - Check if `JSON.stringify(fresh.llm) !== JSON.stringify(currentBundle?.llm)` or drive changed.
       - If changed, call `await saveBundle(fresh)` and update connections via `saveConnections(...)`.
   - Call `syncCredentials()`:
     - When WebSocket receives `{ type: "credentials_updated" }`.
     - When transport switches to `direct` or on app resume (`visibilitychange`).
     - On initial load after `refresh()`.

- [ ] **Step 4: Run frontend tests & linter**

Run:
```bash
node --test frontend/tests/mobile-credential-sync.test.mjs
npm --prefix frontend run lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/mobile/Companion.jsx frontend/src/mobile/connectionStatus.js frontend/tests/mobile-credential-sync.test.mjs
git commit -m "feat: auto-sync mobile credentials bundle and update secure vault"
```

---

### Task 4: Integration Verification & Documentation

**Files:**
- Modify: `docs/agent-context/sections/remote-mobile.md`
- Modify: `docs/agent-context/INDEX.md`
- Test: Full test run on modified files

- [ ] **Step 1: Run full test suite for touched code**

Run:
```bash
pytest tests/test_remote_access_library.py tests/test_remote_credentials_bundle.py tests/test_api_remote_access.py -v
node --test frontend/tests/mobile-credential-sync.test.mjs frontend/tests/mobile-pairing-contract-v2.mjs
```
Expected: All tests PASS.

- [ ] **Step 2: Update agent context documentation**

Update `docs/agent-context/sections/remote-mobile.md` with:
- Updated capability rules for library routes (`POST /api/library/{id}/enrich`, `reindex`, `sync`, `ai/transform`).
- New `GET /api/remote/credentials/bundle` endpoint and auto-sync lifecycle.
Update last verified date and commit hash in `docs/agent-context/INDEX.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/agent-context/
git commit -m "docs: update remote-mobile agent context with credential sync and library permissions"
```
