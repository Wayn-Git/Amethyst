# Connectors & Composio Real-Time Reliability, System Tools & UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide 100% genuine real-time connectivity tracking for Composio without silent failures or stale caches, expose real granular tool capabilities for connected cloud apps, and build a first-class UI for local & system connectors.

**Architecture:** 
1. Upgrade backend `composio_service.py` to propagate real HTTP errors (401/403/network) as `credentialStore: "error"`, report granular account statuses (`EXPIRED`, `ACTIVE`, `FAILED`), return real tool schemas from `STATIC_PINNED_SCHEMAS` in `list_connector_tools()`, and provide a live account connectivity test endpoint `/api/connectors/{slug}/test`.
2. Build `SystemConnectorsPanel.jsx` to render first-class cards for Desktop CUA Driver, System Shell, Workspace Filesystem, Web Browser, and Custom MCP Servers.
3. Update `ConnectorsTab.jsx` with a real-time gateway health monitor, focus revalidation, instant `[↻ Sync]` probe, and top-level filter navigation (`All`, `Cloud Apps`, `System & Local`, `Installed`).
4. Upgrade `PluginDetailView.jsx` to display the actual granted tools/actions, real-time token testing, and 1-click reconnect workflows.

**Tech Stack:** Python 3.12 (FastAPI, httpx), React 18, Vite, Kraken Design System CSS.

**Spec:** `docs/superpowers/specs/2026-10-20-connectors-composio-system-redesign.md`

## Global Constraints
- Strictly follow Kraken Design System (`AGENTS.md`): status is a word, not a lamp; `--live` (green) is running, `--confirm` (amber) is waiting on user, `--stop` (coral/red) is destructive; purple is never a status.
- No silent failures: HTTP 401/403 or network errors must be surfaced with actionable recovery paths.
- All interactive buttons must support `:active { transform: scale(0.97); }` and transition under 140ms.

## Review Focus
1. Handling revoked or expired Composio API keys without hanging or returning fake `credentialStore: "ok"`.
2. Immediate update of account status when an OAuth token expires, prompting a 1-click reconnect.
3. Fast-lane fallback schemas rendering properly when offline or when Composio API is unreachable.
4. Smooth tab switching between Cloud Apps and System & Local tools without losing search query or scroll position.
5. Desktop CUA permissions detection reporting real system accessibility state.

---

### Task 1: Backend Real-Time State & Error Handling in `composio_service.py`

**Files:**
- Modify: `backend/mcp/composio_service.py:2445-2578`
- Modify: `backend/api/main.py:5515-5555`
- Test: `tests/test_composio_connectivity.py`

**Interfaces:**
- Produces:
  - `GET /api/connectors/connected`: returns `{ configured: bool, credentialStore: "ok"|"error"|"unauthorized", services: dict, error_detail?: str, gateway_latency_ms?: int }`
  - `GET /api/connectors/tools`: returns `{ configured: bool, services: dict[str, list[dict]] }` with real tool names & descriptions.
  - `POST /api/connectors/{slug}/test`: returns `{ ok: bool, latency_ms: int, status: str, message?: str }`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_composio_connectivity.py
import pytest
from unittest.mock import MagicMock, patch
from backend.mcp.composio_service import composio_service

def test_get_connected_services_state_unauthorized_error():
    with patch.object(composio_service, "is_configured", return_value=True):
        with patch.object(composio_service, "_auth_headers", return_value={"x-api-key": "bad_key"}):
            with patch("httpx.get") as mock_get:
                mock_res = MagicMock()
                mock_res.status_code = 401
                mock_res.text = "Unauthorized"
                mock_get.return_value = mock_res
                
                state = composio_service.get_connected_services_state(force=True)
                assert state["credentialStore"] == "unauthorized"
                assert "error_detail" in state

def test_list_connector_tools_returns_real_schemas():
    tools = composio_service.list_connector_tools()
    assert "googlecalendar" in tools
    # Verify real tools are returned rather than placeholder {SLUG}_ACTION
    cal_tools = [t["name"] for t in tools["googlecalendar"]]
    assert "GOOGLECALENDAR_FIND_EVENT" in cal_tools
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_composio_connectivity.py -v`
Expected: FAIL

- [ ] **Step 3: Implement real-time state, error handling, and tool schemas in `backend/mcp/composio_service.py` and endpoint in `backend/api/main.py`**

- In `composio_service.get_connected_services_state`:
  - When `res.status_code == 401` or `403`, return `credentialStore: "unauthorized"`, `configured: True`, `error_detail: "Invalid or revoked Composio API key"`.
  - When connection error occurs, return `credentialStore: "error"`, `error_detail: str(exc)`.
  - Measure latency and include `gateway_latency_ms`.
- In `composio_service.list_connector_tools`:
  - Populate from `STATIC_PINNED_SCHEMAS` and `FAST_LANE_CONFIG` so real tools like `GOOGLECALENDAR_FIND_EVENT` and `GITHUB_CREATE_ISSUE` are listed.
- In `backend/api/main.py`:
  - Add `@app.post("/api/connectors/{slug}/test")` to test an individual connector's connectivity.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_composio_connectivity.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mcp/composio_service.py backend/api/main.py tests/test_composio_connectivity.py
git commit -m "feat(connectors): add real-time connectivity validation, error reporting, and real tool catalog"
```

---

### Task 2: System & Local Connectors Component (`SystemConnectorsPanel.jsx`)

**Files:**
- Create: `frontend/src/views/capabilities/SystemConnectorsPanel.jsx`
- Modify: `frontend/src/views/capabilities/McpServersPanel.jsx`
- Test: `frontend/tests/renderers.mjs`

**Interfaces:**
- Produces: `<SystemConnectorsPanel query={string} onOpenMcpModal={func} />`

- [ ] **Step 1: Write component specification & tests**
- Verify rendering of native tool cards:
  - Desktop CUA Driver
  - System Terminal (Bash)
  - Workspace Filesystem
  - Web Browser & Scraper
  - Python Runtime (uv)
  - Custom MCP Servers list with preset chips

- [ ] **Step 2: Implement `SystemConnectorsPanel.jsx`**
- Include capability pills, real status (`Running`, `Ready`, `Built-in`), description, and action button.
- Embed custom MCP server manager with clean card rows.

- [ ] **Step 3: Verify build**
Run: `npm run test:widgets && npm run test:renderers`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add frontend/src/views/capabilities/SystemConnectorsPanel.jsx
git commit -m "feat(connectors): create dedicated SystemConnectorsPanel component"
```

---

### Task 3: Real-Time Live Sync & Gateway Health in `ConnectorsTab.jsx`

**Files:**
- Modify: `frontend/src/views/capabilities/ConnectorsTab.jsx`
- Modify: `frontend/src/views/capabilities/plugins/PluginsDirectory.jsx`
- Modify: `frontend/src/api.js`

**Interfaces:**
- Consumes: `api.connectorsConnected()`, `api.testConnector(slug)`
- Produces: Live sync banner, top filter navigation (`All`, `Cloud Apps`, `System & Local`, `Installed`), window focus revalidation.

- [ ] **Step 1: Update `frontend/src/api.js` with `testConnector(slug)`**
- Add `testConnector: (slug) => req(`/connectors/${slug}/test`, { method: 'POST' })`

- [ ] **Step 2: Update `ConnectorsTab.jsx`**
- Add window focus event listener to auto-refresh status when user returns to window.
- Add live gateway status bar at top:
  - If connected: `● Composio: Connected (92ms)` + `[↻ Sync]` button.
  - If error/unauthorized: `▲ Composio: Session Expired` + `[Re-authenticate]` button.
- Integrate top filter navigation:
  - Tab pills: `All`, `Cloud Apps (Composio)`, `System & Local`, `Installed`.
  - Seamless switching between Cloud apps and SystemConnectorsPanel.

- [ ] **Step 3: Update `PluginsDirectory.jsx`**
- Wire top filter tabs and integrate `SystemConnectorsPanel`.

- [ ] **Step 4: Run frontend tests**
Run: `npm run test:widgets && npm run test:renderers`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/views/capabilities/ConnectorsTab.jsx frontend/src/views/capabilities/plugins/PluginsDirectory.jsx frontend/src/api.js
git commit -m "feat(connectors): add live gateway health monitor, focus sync, and top filter navigation"
```

---

### Task 4: Richer Detail View & Action Catalog in `PluginDetailView.jsx`

**Files:**
- Modify: `frontend/src/views/capabilities/plugins/PluginDetailView.jsx`
- Modify: `frontend/src/styles/connectors.css`

**Interfaces:**
- Consumes: `api.connectorsTools()` or card tools
- Produces: Detailed actions list, token connectivity testing, reconnect CTA if expired.

- [ ] **Step 1: Update `PluginDetailView.jsx`**
- Load granular tools for this connector from `api.connectorsTools()`.
- Render an **Available Actions & Tools** accordion/list showing the real tool names, summaries, and parameters.
- Add a **[Test Token]** button next to connected accounts with instant roundtrip latency feedback (`88ms ✓`).
- If account status is `EXPIRED` or `FAILED`, show amber/coral warning with 1-click `[Reconnect Account]` button.

- [ ] **Step 2: Update `connectors.css`**
- Add styling for the tool actions list, test badges, and status alerts.
- Ensure all styling strictly adheres to Amethyst tokens (`AGENTS.md`).

- [ ] **Step 3: Run frontend tests**
Run: `npm run test:widgets && npm run test:renderers`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add frontend/src/views/capabilities/plugins/PluginDetailView.jsx frontend/src/styles/connectors.css
git commit -m "feat(connectors): add granular tool catalog, live token testing, and reconnect workflow in detail view"
```

---

### Task 5: End-to-End Build & Verification

- [ ] **Step 1: Run frontend build**
Run: `npm run build`
Expected: Clean build in < 6s, 0 errors.

- [ ] **Step 2: Run all frontend test suites**
Run: `npm run test:widgets && npm run test:renderers && npm run test:spotlight`
Expected: All pass.

- [ ] **Step 3: Run backend test suites**
Run: `.venv/bin/pytest tests/test_composio_connectivity.py tests/test_task_aware_router.py tests/test_search_providers.py`
Expected: All pass.

- [ ] **Step 4: Update walkthrough artifact**
