# Composio Plugins Experience & Zero-Key Browser OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate Composio plugins to the top of the Connectors tab as the default hero, organize apps by category with an expandable "View more" toggle, move local MCP servers to a distinct bottom section, and provide zero-key browser OAuth so users log in with Google and connect apps effortlessly without manual API key entry.

**Architecture:** A native browser OAuth device session bridge (`/api/v3/cli/create-session` and `get-session`) in the backend, coupled with a reorganized Connectors tab in the frontend that groups cloud toolkits by category with progressive disclosure ("View more") and places local tools at the bottom.

**Tech Stack:** Python 3.12 (FastAPI, httpx, Pytest), React 19, Framer Motion, Vanilla CSS (design system tokens per AGENTS.md).

**Spec:** [docs/superpowers/specs/2026-10-11-composio-plugins-experience-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-11-composio-plugins-experience-design.md)

## Global Constraints

- Design System fidelity per AGENTS.md: Use `--canvas`, `--surface`, `--surface-2`, `--accent`, `--live`, `--text`, `--text-dim`, `--hairline`. No hardcoded hex values.
- Animation constraints: Duration under 140ms for press/hover, 200–280ms for arrival/expansion, spring transitions, respect `prefers-reduced-motion`.
- Deduplication and ownership invariant: Keep `provider_ownership.py` semantics intact (active local provider cleanly overrides Composio equivalents).
- All tests must pass: `pytest tests/test_composio_service.py -v`, `cd frontend && npm run build`.

## Review Focus

1. **Browser popup blocker handling:** Ensure `start_browser_login` returns the URL to the frontend so the link can be opened via user action or re-clicked if a popup was blocked.
2. **Expired or canceled login sessions:** Polling must gracefully time out after 5 minutes without hanging indefinitely, and handle 400/404 responses cleanly.
3. **Empty category or single-item categories:** Ensure categories with <= 4 items do not show unnecessary "View more" buttons.
4. **Active search query:** When a user types a query in the search bar, all matching categories must auto-expand so results are never hidden behind a collapsed state.
5. **Key persistence across restarts:** When browser OAuth links, the token must be saved to the OS keychain and `composio_state` database so subsequent boots remain connected.

---

### Task 1: Backend Composio Browser OAuth Session Integration

**Files:**
- Modify: `backend/mcp/composio_service.py:730-798`
- Modify: `backend/api/main.py:4670-4735`
- Test: `tests/test_composio_service.py`

**Interfaces:**
- Produces:
  - `ComposioService.start_browser_login() -> dict[str, Any]` (returns `session_id`, `code`, `login_url`)
  - `ComposioService.poll_browser_login(session_id: str) -> dict[str, Any]` (returns `status`: "pending" | "linked" | "expired")
  - `POST /api/composio/login/start`
  - `GET /api/composio/login/poll/{session_id}`

- [ ] **Step 1: Write failing tests in `tests/test_composio_service.py`**

```python
def test_composio_browser_login_start_and_poll(monkeypatch):
    from backend.mcp.composio_service import ComposioService

    service = ComposioService()

    # Mock create-session
    class MockCreateResp:
        status_code = 201
        def json(self):
            return {
                "id": "session_test_123",
                "code": "AB12CD",
                "expiresAt": "2026-10-11T12:00:00Z",
                "status": "pending",
            }

    # Mock get-session pending and linked
    class MockPollPendingResp:
        status_code = 200
        def json(self):
            return {"id": "session_test_123", "status": "pending", "api_key": None}

    class MockPollLinkedResp:
        status_code = 200
        def json(self):
            return {"id": "session_test_123", "status": "linked", "api_key": "uak_test_secret"}

    import httpx
    monkeypatch.setattr(httpx, "post", lambda url, **kwargs: MockCreateResp())
    login_info = service.start_browser_login()
    assert login_info["session_id"] == "session_test_123"
    assert login_info["code"] == "AB12CD"
    assert "cliKey=session_test_123" in login_info["login_url"]

    # Poll pending
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: MockPollPendingResp())
    poll_res = service.poll_browser_login("session_test_123")
    assert poll_res["status"] == "pending"

    # Poll linked
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: MockPollLinkedResp())
    poll_res = service.poll_browser_login("session_test_123")
    assert poll_res["status"] == "linked"
    assert poll_res["configured"] is True
    assert service.get_api_key() == "uak_test_secret"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_composio_service.py::test_composio_browser_login_start_and_poll -v`  
Expected: FAIL with AttributeError (`start_browser_login` does not exist)

- [ ] **Step 3: Implement `start_browser_login` and `poll_browser_login` in `backend/mcp/composio_service.py`**

Implement HTTP client calls to `https://backend.composio.dev/api/v3/cli/create-session` and `https://backend.composio.dev/api/v3/cli/get-session?id={session_id}`. On `"linked"`, invoke `self.set_api_key(api_key, mode="user")`.

- [ ] **Step 4: Expose endpoints in `backend/api/main.py`**

Add `POST /api/composio/login/start` and `GET /api/composio/login/poll/{session_id}` with integration to `_apply_connector("composio", True)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_composio_service.py -v`  
Expected: PASS

- [ ] **Step 6: Commit backend browser OAuth endpoints**

```bash
git add backend/mcp/composio_service.py backend/api/main.py tests/test_composio_service.py
git commit -m "feat(composio): add zero-key browser oauth session endpoints"
```

---

### Task 2: Frontend API Client & ComposioConnectModal with 1-Click Google OAuth

**Files:**
- Modify: `frontend/src/api.js:376-395`
- Modify: `frontend/src/views/capabilities/ComposioConnectModal.jsx`
- Test: `cd frontend && npm run build`

**Interfaces:**
- Consumes:
  - `POST /api/composio/login/start`
  - `GET /api/composio/login/poll/{session_id}`
- Produces:
  - `api.startComposioLogin(): Promise<{ session_id, code, login_url }>`
  - `api.pollComposioLogin(sessionId): Promise<{ status, configured }>`
  - Updated `ComposioConnectModal` with Google 1-click connect, waiting state, and manual key accordion.

- [ ] **Step 1: Add API client methods in `frontend/src/api.js`**

Add:
```javascript
startComposioLogin: () => j('/composio/login/start', json('POST')),
pollComposioLogin: (sessionId) => j(`/composio/login/poll/${encodeURIComponent(sessionId)}`),
```

- [ ] **Step 2: Update `ComposioConnectModal.jsx` to lead with Browser OAuth**

1. Add state: `loginSession`, `isPolling`, `pollError`, `manualOpen`.
2. Implement `handleBrowserLogin`:
   - Calls `api.startComposioLogin()`.
   - Opens `res.login_url` in a new browser tab (`window.open(res.login_url, '_blank')`).
   - Starts a 2-second interval polling `api.pollComposioLogin(res.session_id)`.
   - When `status === 'linked'`, clears interval, calls `onConnected()`, displays toast, and closes modal.
3. Render prominent "Sign in with Google / Composio" hero button.
4. If `isPolling`, render linking state with the 6-character code (`loginSession.code`), animated spinner, and a "Re-open browser login" button.
5. Place manual API key input inside a collapsible accordion *"Or enter an API key manually"*.

- [ ] **Step 3: Run frontend build to verify syntax and types**

Run: `cd frontend && npm run build`  
Expected: Build passes cleanly with no syntax or bundling errors.

- [ ] **Step 4: Commit frontend modal updates**

```bash
git add frontend/src/api.js frontend/src/views/capabilities/ComposioConnectModal.jsx
git commit -m "feat(ui): add 1-click browser oauth to Composio connect modal"
```

---

### Task 3: Connectors Tab Reorganization & Category Grouping with "View More"

**Files:**
- Modify: `frontend/src/views/capabilities/ConnectorsTab.jsx:2170-2560`
- Modify: `frontend/src/index.css` (or `ConnectorsTab.css` if styles reside there)
- Test: `cd frontend && npm run build`

**Interfaces:**
- Produces:
  - Composio Cloud Plugins elevated to top section.
  - Grouping of Composio toolkits by `category` with expandable "View more" controls.
  - Local & System Connectors section positioned at the bottom.
  - Auto-launch of Browser OAuth modal when clicking "Connect" on unconfigured toolkits.

- [ ] **Step 1: Implement category grouping and expansion in `ConnectorsTab.jsx`**

1. Group `filteredComposioToolkits` by `item.category || 'Utilities'`.
2. Add `expandedCategories` state: `const [expandedCats, setExpandedCats] = useState({})`.
3. Auto-expand categories if `q` search query is present:
   ```javascript
   const isExpanded = Boolean(q) || Boolean(expandedCats[catName])
   ```
4. Slice items: `const displayedItems = isExpanded ? items : items.slice(0, 4)`.
5. Render a clean "View N more" / "Show fewer" toggle button when `items.length > 4 && !q`.

- [ ] **Step 2: Reorder section layout in `ConnectorsTab.jsx`**

1. Move **Plugins by Composio** to be Section 1 (at the top, right below the search/filters).
2. Move **Local & System Connectors** (Agent Core Tools + User Connectors) to Section 2 (at the bottom).
3. Add a distinct visual header for the Local section:
   ```jsx
   <div className="plugin-section-head">
     <div className="plugin-section-title-wrap">
       <h2 className="plugin-section-title">Local & System Connectors</h2>
       <span className="plugin-section-badge">{localTotalCount}</span>
     </div>
   </div>
   ```
4. Wire unconfigured app clicks: when `!composioStatus?.configured`, clicking any Composio app's "Connect" opens the new 1-click Google OAuth flow directly.

- [ ] **Step 3: Add CSS styling for category groups and expansion pills**

Ensure styles adhere strictly to `AGENTS.md`:
- Class `.plugin-category-section` with clean hierarchy.
- Class `.plugin-view-more-btn` styled with capsule `--radius-buttons`, `--surface-2`, `--hairline`, hover micro-animation (<140ms).
- Clear divider `.local-connectors-divider` separating cloud plugins from local MCP.

- [ ] **Step 4: Run frontend build to verify compilation**

Run: `cd frontend && npm run build`  
Expected: PASS

- [ ] **Step 5: Commit ConnectorsTab reorganization**

```bash
git add frontend/src/views/capabilities/ConnectorsTab.jsx frontend/src/index.css
git commit -m "feat(ui): elevate composio plugins to top with category view-more and bottom local section"
```

---

### Task 4: End-to-End Verification & Regression Testing

**Files:**
- Test: `tests/test_composio_service.py`
- Test: `tests/test_connector_ownership.py`
- Build: `frontend/`

- [ ] **Step 1: Run full backend test suite for Composio & Connectors**

Run: `uv run pytest tests/test_composio_service.py tests/test_connector_ownership.py -v`  
Expected: All tests PASS with 0 errors.

- [ ] **Step 2: Run frontend production build**

Run: `cd frontend && npm run build`  
Expected: Build succeeds without warnings or errors.

- [ ] **Step 3: Verification with interactive smoke test**

1. Check that opening Connectors tab shows Composio at the top.
2. Check that categories (Communication, Productivity, etc.) display top 4 cards and "View more" button.
3. Check that typing in search automatically expands all matching categories.
4. Check that clicking "Connect Composio" opens the 1-click Browser OAuth modal.
5. Check that local MCP servers and tools appear cleanly formatted in the bottom section.

- [ ] **Step 4: Commit documentation and mark completion**

```bash
git add docs/superpowers/plans/2026-10-11-composio-plugins-experience.md
git commit -m "docs: complete implementation plan for composio plugins experience"
```
