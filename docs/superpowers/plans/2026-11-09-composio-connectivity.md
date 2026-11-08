# Composio Connectivity & Real Google Drive Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Composio connectivity end-to-end across Amethyst: redirect directly to the API key page, validate and store keys properly without wiping toolkits, replace onboarding Google Drive mockup with real Composio OAuth and storage configuration, and harden dashboard widgets with resilient dual-path (MCP fast-lane + direct SDK) execution and modern payload projection.

**Architecture:** Dual-path execution pattern where widgets and background readers seamlessly execute through direct Composio SDK (`client.tools.execute`) if the MCP transport stream is cold, uninitialized, or returns a sandbox file preview. Onboarding is fully wired to live endpoints (`/api/connectors/googledrive/authorize`, `/api/connectors/connected`, `/api/storage/config`) with zero mock fallbacks.

**Tech Stack:** Python 3.12 (FastAPI, SQLite, Composio SDK v0.25, httpx, asyncio), React 18 (Vite, Framer Motion), Pytest.

**Spec:** [docs/superpowers/specs/2026-11-09-composio-connectivity-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-09-composio-connectivity-design.md)

## Global Constraints

- Never use mock data for widget data or cloud storage connection.
- Drafts only: writes go through the permission gate in `backend/security/confirmation.py`.
- No outer container borders, backgrounds, or double boundaries on widgets (`.home-widget.widget-adoption`).
- Do not clobber `composio_state` enabled toolkits on key save.
- All tests must pass before marking tasks complete.

## Review Focus

1. **Cold boot dashboard load:** Widget reads occurring before `_registry_for(None)` finishes connecting must fall back to direct SDK execution rather than raising `RuntimeError("Connector transport unavailable")`.
2. **Modern Composio calendar payload:** `GOOGLECALENDAR_FIND_EVENT` responses returned as `{"event_data": {"event_data": [...]}}` or `{"event_data": [...]}` must be parsed into event rows without raising `ValueError("Invalid calendar response")`.
3. **Multi-execute sandbox truncation:** Large Gmail/Calendar queries returning `data_preview` inside `COMPOSIO_MULTI_EXECUTE_TOOL` must extract messages cleanly rather than failing on missing `data`.
4. **Onboarding key validation race:** Rapid typing in the Composio API key field must not spam the backend with 400 errors or overwrite state with invalid partial keys.
5. **Real Google Drive OAuth completion:** Google Drive connection in onboarding must only flip to `Connected` after the backend confirms `status == 'ACTIVE'` for the account.

---

### Task 1: Backend Composio Service Direct Execution & Toolkit Persistence

**Files:**
- Modify: `backend/mcp/composio_service.py`
- Test: `tests/test_composio_service_direct_exec.py`

**Interfaces:**
- Produces: `composio_service.execute_tool(slug: str, arguments: dict[str, Any]) -> dict[str, Any]`
- Modifies: `composio_service.set_api_key(key: str, mode: str | None = None) -> bool` to preserve or seed default toolkits.

- [ ] **Step 1: Write failing tests for direct tool execution and toolkit preservation**

Write `tests/test_composio_service_direct_exec.py`:
```python
import pytest
from unittest.mock import MagicMock, patch
from backend.mcp.composio_service import ComposioService, DEFAULT_TOOLKITS

def test_default_toolkits_include_calendar_and_drive():
    assert "googlecalendar" in DEFAULT_TOOLKITS
    assert "googledrive" in DEFAULT_TOOLKITS
    assert "gmail" in DEFAULT_TOOLKITS

def test_set_api_key_preserves_or_seeds_toolkits(db):
    service = ComposioService()
    with patch("backend.secrets.set_secret"):
        service.set_api_key("uak_test_key_12345678901234567890", mode="user")
    enabled = service.get_enabled_toolkits()
    assert len(enabled) > 0
    assert "googlecalendar" in enabled
    assert "googledrive" in enabled

@pytest.mark.asyncio
async def test_execute_tool_unwraps_data():
    service = ComposioService()
    mock_client = MagicMock()
    mock_client.tools.execute.return_value = {
        "successful": True,
        "error": None,
        "data": {"messages": [{"id": "m1", "subject": "Test"}]},
    }
    with patch.object(service, "is_configured", return_value=True), \
         patch.object(service, "_get_client", return_value=mock_client), \
         patch.object(service, "_get_stable_user_id", return_value="user_1"):
        res = await service.execute_tool("GMAIL_FETCH_EMAILS", {"max_results": 5})
        assert "messages" in res
        assert res["messages"][0]["id"] == "m1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_service_direct_exec.py -v`  
Expected: FAIL (`execute_tool` does not exist, `googlecalendar` not in `DEFAULT_TOOLKITS`).

- [ ] **Step 3: Implement `DEFAULT_TOOLKITS`, `set_api_key`, and `execute_tool` in `backend/mcp/composio_service.py`**

1. Update `DEFAULT_TOOLKITS` around line 32:
   ```python
   DEFAULT_TOOLKITS = [
       "slack", "github", "linear", "notion", "gmail",
       "googlecalendar", "googledrive", "google_maps", "spotify", "discord"
   ]
   ```
2. Update `set_api_key` around lines 1580-1593:
   Preserve existing non-empty `enabled_toolkits` from database; if empty, initialize with `json.dumps(DEFAULT_TOOLKITS)`.
3. Add `execute_tool(self, slug: str, arguments: dict[str, Any]) -> dict[str, Any]`:
   Call `client.tools.execute(slug=slug, arguments=arguments, user_id=uid, dangerously_skip_version_check=True)` in thread pool with `asyncio.to_thread`.
   Unwrap `res.get("data", res)` and raise `RuntimeError(res["error"])` if `res.get("error")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_service_direct_exec.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mcp/composio_service.py tests/test_composio_service_direct_exec.py
git commit -m "feat(composio): add execute_tool fallback and preserve default toolkits"
```

---

### Task 2: Backend API Key Endpoint & Connector Apply Fix

**Files:**
- Modify: `backend/api/main.py:5997-6025, 6420-6455`
- Test: `tests/test_composio_api_key_endpoint.py`

**Interfaces:**
- Consumes: `composio_service.validate_api_key`, `composio_service.set_api_key`, `CapabilityService`
- Produces: Robust `POST /api/composio/key` response and `_apply_connector("composio", ...)` handler without `mcp.yaml` errors.

- [ ] **Step 1: Write failing test for `POST /api/composio/key`**

Write `tests/test_composio_api_key_endpoint.py`:
```python
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

@pytest.mark.asyncio
async def test_save_composio_key_does_not_fail_on_mcp_yaml(db):
    from backend.api.main import app
    client = TestClient(app)
    
    with patch("backend.mcp.composio_service.composio_service.validate_api_key", return_value=(True, None)), \
         patch("backend.mcp.composio_service.composio_service.set_api_key", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.get_status", return_value={"configured": True, "active": True}), \
         patch("backend.api.main._apply_connector", return_value={"connected": True, "tools": 5, "error": None}):
        
        response = client.post("/api/composio/key", json={"api_key": "uak_valid_key_1234567890123456"})
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["status"]["active"] is True
        assert data["status"].get("error") is None
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `pytest tests/test_composio_api_key_endpoint.py -v`

- [ ] **Step 3: Modify `backend/api/main.py`**

1. In `_apply_connector(name: str, enabled: bool)` around line 6420:
   If `name == "composio"`:
   Handle dynamically without requiring entry in `mcp.yaml`. Check `composio_service.is_configured()`, load configuration via `load_servers().get("composio")`, and connect if manager is present.
2. In `save_composio_key(payload: dict[str, Any])` around line 5997:
   Call `_apply_connector("composio", True)`. Do not overwrite `status["error"]` or force `status["active"] = False` if `composio` connects or direct service is active.

- [ ] **Step 4: Run tests to verify**

Run: `pytest tests/test_composio_api_key_endpoint.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py tests/test_composio_api_key_endpoint.py
git commit -m "fix(api): handle composio connector in save_composio_key and apply_connector"
```

---

### Task 3: Dashboard Connectors Dual-Path & Payload Projection Hardening

**Files:**
- Modify: `backend/dashboard/connectors.py`
- Modify: `backend/dashboard/remote.py`
- Modify: `backend/dashboard/agenda.py`
- Modify: `backend/mcp/manager.py`
- Test: `tests/test_dashboard_connectors_real.py`

**Interfaces:**
- Consumes: `composio_service.execute_tool`, `composio_service.get_connections`
- Produces: `connectors.read(widget_id, toolkit, slug, arguments)` with direct SDK fallback when MCP connection is None; `project(slug, value, arguments)` supporting `event_data` and `data_preview`.

- [ ] **Step 1: Write failing tests for calendar `event_data` and cold-boot fallback**

Write `tests/test_dashboard_connectors_real.py`:
```python
import pytest
from unittest.mock import patch, MagicMock
from backend.dashboard.remote import project
from backend.dashboard import connectors

def test_project_calendar_event_data_structure():
    raw_composio_calendar = {
        "event_data": {
            "event_data": [
                {
                    "id": "evt_1",
                    "summary": "Team Standup",
                    "status": "confirmed",
                    "start": {"dateTime": "2026-11-09T10:00:00Z"},
                    "end": {"dateTime": "2026-11-09T10:30:00Z"},
                }
            ],
            "nextPageToken": "tok_1",
        }
    }
    result = project("GOOGLECALENDAR_FIND_EVENT", raw_composio_calendar)
    assert len(result["items"]) == 1
    assert result["items"][0]["summary"] == "Team Standup"
    assert result["items"][0]["start"]["dateTime"] == "2026-11-09T10:00:00Z"

@pytest.mark.asyncio
async def test_connectors_read_falls_back_to_sdk_when_mcp_none(db):
    with patch("backend.dashboard.connectors.access_enabled", return_value=True), \
         patch("backend.dashboard.connectors.composio_service.is_configured", return_value=True), \
         patch("backend.dashboard.connectors.composio_service.get_enabled_toolkits", return_value=["googlecalendar"]), \
         patch("backend.dashboard.connectors.accounts", return_value={"googlecalendar": {"id": "acc_1"}}), \
         patch("backend.dashboard.connectors.reconcile", return_value={"needs_reconnect": 0, "retry_at": 0, "failures": 0}), \
         patch("backend.dashboard.connectors.connection", return_value=None), \
         patch("backend.mcp.composio_service.composio_service.execute_tool", return_value={"event_data": {"event_data": []}}):
        
        val = await connectors.read("task.agenda", "googlecalendar", "GOOGLECALENDAR_FIND_EVENT", {"calendar_id": "primary"})
        assert "items" in val
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_dashboard_connectors_real.py -v`  
Expected: FAIL (`Connector transport unavailable` and `Invalid calendar response`).

- [ ] **Step 3: Implement payload unpacking & execution fallback**

1. In `backend/dashboard/remote.py` line 29:
   Update `GOOGLECALENDAR_FIND_EVENT` parser to support:
   ```python
   if isinstance(value, dict) and "event_data" in value:
       ev = value["event_data"]
       if isinstance(ev, dict) and "event_data" in ev and isinstance(ev["event_data"], list):
           rows = ev["event_data"]
       elif isinstance(ev, list):
           rows = ev
       else:
           rows = value.get("items", value.get("events", []))
   elif isinstance(value, dict):
       rows = value.get("items", value.get("events", value.get("event_data", [])))
   elif isinstance(value, list):
       rows = value
   else:
       rows = []
   ```
2. In `backend/dashboard/agenda.py` lines 30-40:
   Apply the same `event_data` unpacking check so `agenda.provide` never raises `ValueError("Invalid calendar response")` on valid Composio events.
3. In `backend/dashboard/connectors.py`:
   - In `_read`: If `connection("composio") is None` or `tool is None`, check `composio_service.is_configured()`. If configured, call `await composio_service.execute_tool(slug, arguments)` directly and proceed with response caching and projection.
   - In Gmail response processing: unwrap `value["data"]["messages"]`, `value.get("messages")`, or `value.get("data_preview", {}).get("messages")`.
4. In `backend/mcp/manager.py` `_make_composio_fast_lane_handler`:
   Unpack `resp_obj.get("data") or resp_obj.get("data_preview")`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dashboard_connectors_real.py -v`  
Expected: PASS

- [ ] **Step 5: Run existing dashboard connector tests**

Run: `pytest tests/test_dashboard_connectors.py tests/test_dashboard_agenda.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/dashboard/connectors.py backend/dashboard/remote.py backend/dashboard/agenda.py backend/mcp/manager.py tests/test_dashboard_connectors_real.py
git commit -m "fix(dashboard): support modern composio event_data and add direct SDK read fallback"
```

---

### Task 4: Frontend Onboarding Key Management & Real Google Drive Integration

**Files:**
- Modify: `frontend/src/components/onboarding/StepStorage.jsx`
- Modify: `frontend/src/api.js`

**Interfaces:**
- Consumes: `api.composioStatus`, `api.saveComposioKey`, `api.connectorsAuthorize`, `api.connectorsConnected`, `api.updateStorageConfig`, `api.librarySyncDetect`
- Produces: Polished, real-time verified onboarding screen with direct link to Composio API keys and real Google Drive OAuth.

- [ ] **Step 1: Check existing `api.js` endpoints and add any missing connector/storage bindings**

Verify in `frontend/src/api.js`:
- `composioStatus: () => j('/composio/status')`
- `saveComposioKey: (apiKey) => j('/composio/key', json('POST', { api_key: apiKey }))`
- `connectorsAuthorize: (slug) => j(`/connectors/${encodeURIComponent(slug)}/authorize`, json('POST'))`
- `connectorsConnected: () => j('/connectors/connected')`
- `storageConfig: () => j('/storage/config')`
- `updateStorageConfig: (patch) => j('/storage/config', json('PATCH', patch))`
- `librarySyncDetect: (body) => j('/library/sync/detect-path', json('POST', body))`

- [ ] **Step 2: Update `StepStorage.jsx`**

1. Change "Get a free key ↗" link:
   Target: `https://app.composio.dev/settings/api-keys`
   Text: "Copy API key from Composio ↗"
2. Fix Composio status detection in `checkStorageStatus`:
   ```javascript
   const res = await api.composioStatus?.()
   if (res?.configured && res?.active) {
       setComposioConnected(true)
   }
   ```
3. Add key validation state & explicit Save button / debounced handler:
   - State: `validatingKey` (boolean), `keyError` (string).
   - Validation button / Enter trigger that invokes `api.saveComposioKey(composioKey.trim())`.
   - On success: clear error, set `composioConnected(true)`.
   - On error: display error message from `err.message || 'Invalid API key'`.
4. Replace fake Google Drive handler `handleConnectDrive`:
   - Set `connectingDrive(true)`.
   - Call `const res = await api.connectorsAuthorize('googledrive')`.
   - If `res?.url`: `window.open(res.url, '_blank')`.
   - Start 2s polling on `api.connectorsConnected()`:
     - Check `gd = conns?.services?.googledrive || conns?.connections?.googledrive`.
     - When `gd && (gd.connected || gd.status === 'ACTIVE')`:
       - Stop polling.
       - Set `driveConnected(true)`.
       - Set `driveEmail(gd.accounts?.[0]?.email || gd.email || 'Connected')`.
       - Call `api.updateStorageConfig({ active_provider: 'google_drive', gdrive_root_name: 'Amethyst/Library' })`.
       - Call `api.librarySyncDetect({ mode: 'auto' }).catch(() => {})`.
       - Set `connectingDrive(false)`.
   - In catch or timeout (>60s): show error toast, reset `connectingDrive(false)`, leave `driveConnected(false)` (no mock fallback!).

- [ ] **Step 3: Build & Lint check frontend**

Run: `npm run build` or `npm run check` in `frontend/`
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/onboarding/StepStorage.jsx frontend/src/api.js
git commit -m "feat(onboarding): direct composio key link, validation feedback, and real google drive oauth"
```

---

### Task 5: End-to-End System Verification & Documentation Update

**Files:**
- Modify: `docs/agent-context/INDEX.md`
- Modify: `docs/agent-context/MCP-INTEGRATIONS.md`
- Test: Full integration test suite

- [ ] **Step 1: Run complete backend pytest suite for connectors and dashboard**

Run: `pytest tests/test_dashboard_connectors*.py tests/test_composio*.py tests/test_auth_failures.py -v`  
Expected: All tests pass.

- [ ] **Step 2: Live end-to-end Python test of agenda and mail retrieval**

Execute test script verifying:
1. `agenda.provide("task.agenda")` returns live events from Composio.
2. `mail.provide("need.inbox")` returns live messages from Composio.
3. `GoogleDriveBridge().get_connection_status()` returns active connection.

- [ ] **Step 3: Update documentation in `docs/agent-context/`**

Update `docs/agent-context/MCP-INTEGRATIONS.md` with:
- Documented `execute_tool` direct SDK fallback in `ComposioService`.
- Modern payload unpacking specifications for `event_data` and `data_preview`.
- Updated verification date and commit hash.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-context/MCP-INTEGRATIONS.md docs/agent-context/INDEX.md
git commit -m "docs: document dual-path composio execution and event_data payload contracts"
```
