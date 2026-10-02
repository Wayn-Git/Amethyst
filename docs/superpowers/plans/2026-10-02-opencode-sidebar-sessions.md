# Work & Code Sidebar Mode & OpenCode Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst's sidebar and Code view into a high-end dual-mode workspace (Work mode for assistant/tools, Code mode for OpenCode) backed 100% by live OpenCode APIs, with real sessions, projects, skills count, cross-platform binary discovery, and Emil Kowalski design engineering.

**Architecture:** A top-level segmented switcher in `Sidebar.jsx` toggles between `work` and `code` modes. In `code` mode, the sidebar queries live `/api/opencode/project`, `/api/opencode/session`, and `/api/opencode/skill` to manage real sessions and projects. `Code.jsx` synchronizes its embedded OpenCode viewport to `/:encodedDir/session/:sessionId` with base64url directory encoding, while `backend/opencode/manager.py` provides cross-platform binary discovery and LAN proxy routing.

**Tech Stack:** React 19, FastAPI, OpenCode REST API, Framer Motion, Vanilla CSS (Amethyst Design System).

**Spec:** [`docs/superpowers/specs/2026-10-02-opencode-sidebar-sessions-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-02-opencode-sidebar-sessions-design.md)

## Global Constraints
- Zero mock or placeholder data: all sessions, projects, skills, and connector counts must come from live OpenCode endpoints.
- Distinct Amethyst aesthetic: deep canvas `#09090c`, violet accents `#8b5cf6`, `#a855f7`, hairline borders `rgba(255, 255, 255, 0.08)`.
- Emil Kowalski motion principles: `:active` button scale `0.97`, easing `cubic-bezier(0.23, 1, 0.32, 1)`, durations under 200ms, no `transition: all`.
- Multi-PC reliability: search PATH, homebrew, npm, Windows standard paths, and `OPENCODE_BIN` env var; handle LAN host binding without crashing.

## Review Focus
1. Binary not found in default `~/.opencode/bin/opencode`: should fallback gracefully to `shutil.which` or standard paths, and present clean install instructions in the UI.
2. Direct session deep linking: navigating between sessions in sidebar must update the iframe URL to `/:encodedDir/session/:id` without crashing or losing Amethyst theme injection.
3. Subagent child sessions (`parentID != null`): root session list should exclude child subagents (e.g. `@explore` threads) so the list is clean and intelligible.
4. Session CRUD: creating a session (`POST /api/opencode/session`), renaming (`PATCH /api/opencode/session/:id`), and deleting (`DELETE /api/opencode/session/:id`) must immediately update the sidebar.
5. Mode switcher state persistence: switching to `code` mode and refreshing the browser must keep `code` mode and active session intact.

---

### Task 1: Backend Portability & SPA Proxy Theme Injection

**Files:**
- Modify: `backend/opencode/manager.py:26-55`
- Modify: `backend/opencode/manager.py:220-295`
- Test: `tests/test_opencode_manager.py`

**Interfaces:**
- Produces: `_find_binary() -> str | None` searching multi-OS locations (`OPENCODE_BIN`, `which`, Linux/macOS/Windows standard dirs).
- Produces: `_handle_proxy_client` with robust index/HTML route detection for deep sessions (`/:dir/session/:id`).

- [ ] **Step 1: Write unit tests for binary detection and proxy route detection**

```python
# tests/test_opencode_manager.py
import pytest
from backend.opencode.manager import _find_binary

def test_find_binary_does_not_crash():
    res = _find_binary()
    assert res is None or isinstance(res, str)
```

- [ ] **Step 2: Run test to verify it executes**

Run: `pytest tests/test_opencode_manager.py -v`
Expected: PASS or skips gracefully.

- [ ] **Step 3: Update `_find_binary()` in `backend/opencode/manager.py`**

Add multi-OS paths (`os.environ.get("OPENCODE_BIN")`, `~/.local/bin/opencode`, `/usr/local/bin/opencode`, `/opt/homebrew/bin/opencode`, `~/.npm-global/bin/opencode`, Windows `%APPDATA%/npm/opencode.cmd`).

- [ ] **Step 4: Update `_handle_proxy_client` in `backend/opencode/manager.py`**

Allow any GET request with `Accept: text/html` or root/session path to receive `AMETHYST_THEME_INJECTION` so theme styles apply to deep-linked sessions.

- [ ] **Step 5: Run tests and verify**

Run: `pytest tests/test_opencode_manager.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/opencode/manager.py tests/test_opencode_manager.py
git commit -m "fix(opencode): expand cross-platform binary discovery and proxy theme injection"
```

---

### Task 2: Frontend OpenCode Client & Store State

**Files:**
- Modify: `frontend/src/lib/opencode.js`
- Modify: `frontend/src/store.jsx`

**Interfaces:**
- Produces: `opencode.listProjects() -> Promise<Array>`
- Produces: `opencode.getCurrentProject() -> Promise<Object>`
- Produces: `opencode.listSkills() -> Promise<Array>`
- Produces: `opencode.encodeDir(path: string) -> string`
- Produces: `useApp().sidebarMode: 'work' | 'code'`
- Produces: `useApp().setSidebarMode(mode: 'work' | 'code')`
- Produces: `useApp().codeActiveSessionId: string | null`
- Produces: `useApp().setCodeActiveSessionId(id: string | null)`

- [ ] **Step 1: Add OpenCode API methods and directory encoder in `frontend/src/lib/opencode.js`**

Implement:
- `encodeDir(dir)` base64url encoder.
- `listProjects()`, `getCurrentProject()`, `listSkills()`.

- [ ] **Step 2: Add sidebar mode and session tracking in `frontend/src/store.jsx`**

Add `sidebarMode` state (initialized from `safeStorage.getItem('amethyst_sidebar_mode') || 'work'`).
Add `setSidebarMode` with view synchronization: switching to `'code'` activates `view === 'code'`; switching to `'work'` returns to `'chat'`.
Add `codeActiveSessionId` and `setCodeActiveSessionId`.

- [ ] **Step 3: Verify build compiles cleanly**

Run: `(cd frontend && npm run build)`
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/opencode.js frontend/src/store.jsx
git commit -m "feat(store): add sidebarMode, activeSessionId, and extended OpenCode API client"
```

---

### Task 3: Sidebar Segmented Mode Switcher & OpenCode Workspace View

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx`
- Modify: `frontend/src/views/code.css`

**Interfaces:**
- Consumes: `useApp().sidebarMode`, `setSidebarMode`, `codeActiveSessionId`, `setCodeActiveSessionId`
- Produces: Segmented control `[ Work ] [ Code ]` in header.
- Produces: Code mode sidebar with `+ New Session`, `Context` (Skills, MCP Connectors), `Projects & Sessions` real list with Rename and Delete actions.

- [ ] **Step 1: Implement Segmented Switcher component in `frontend/src/components/Sidebar.jsx`**

Place mode toggle right below the brand header in both expanded container and mini rail.
Add Framer Motion active pill layout transition.

- [ ] **Step 2: Implement Code mode sidebar content in `frontend/src/components/Sidebar.jsx`**

When `sidebarMode === 'code'`:
1. Render `+ New Session` button calling `opencode.createSession()` and updating active session.
2. Render collapsible `Context` section:
   - Skills item: live count pill from `opencode.listSkills()`. Popover on click showing skills list.
   - Connectors item: live count of active MCP/plugins from `opencode.getConfig()`.
3. Render `Projects & Sessions` list:
   - Group sessions by project/directory from `opencode.listProjects()` and `opencode.listSessions()`.
   - Filter out subagent child sessions (`parentID != null`).
   - Session row with active indicator, title, agent badge, and action menu (Rename, Delete).

- [ ] **Step 3: Add CSS for Segmented Switcher and Code Sidebar in `frontend/src/views/code.css`**

Implement double-bezel styling, `#09090c` dark canvas, violet glows, Emil Kowalski `:active` scale (`0.97`), and custom cubic-bezier transitions.

- [ ] **Step 4: Verify build compiles cleanly**

Run: `(cd frontend && npm run build)`
Expected: Build succeeds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.jsx frontend/src/views/code.css
git commit -m "feat(sidebar): add Work/Code mode switcher and live OpenCode session management"
```

---

### Task 4: Code View Deep Session Synchronization & Offline Guide

**Files:**
- Modify: `frontend/src/views/Code.jsx`
- Modify: `frontend/src/views/code.css`

**Interfaces:**
- Consumes: `useApp().codeActiveSessionId`, `useApp().opencode`
- Produces: Code view header bar with project / session breadcrumb, health status dot, external window opener, and session-synced iframe.
- Produces: Rich cross-platform offline install guide with copyable commands.

- [ ] **Step 1: Update `frontend/src/views/Code.jsx` with session URL synchronization**

Calculate iframe URL:
- If `activeSession`: `http://${host}:${status.port}/${opencode.encodeDir(activeSession.directory)}/session/${activeSession.id}`.
- If no session or new session: `http://${host}:${status.port}/${opencode.encodeDir(projectDir)}/`.

- [ ] **Step 2: Add header context bar in `frontend/src/views/Code.jsx`**

Breadcrumb: `[Project Worktree] / [Session Title]` with session picker dropdown.
Engine status pill (`running`, `offline`, port indicator).
Open in new tab button (`Icon name="external-link"`).

- [ ] **Step 3: Enhance offline state in `frontend/src/views/Code.jsx`**

Include platform tabs:
- **macOS / Linux**: `curl -fsSL https://opencode.ai/install.sh | bash`
- **npm**: `npm install -g opencode-ai`
- One-click copy buttons for installation commands.

- [ ] **Step 4: Update styles in `frontend/src/views/code.css`**

Add styles for header context bar, offline install tabs, copy buttons, and session switch dropdown.

- [ ] **Step 5: Verify build compiles cleanly**

Run: `(cd frontend && npm run build)`
Expected: Build succeeds with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Code.jsx frontend/src/views/code.css
git commit -m "feat(code-view): implement session deep-linking, top context bar, and install guide"
```

---

### Task 5: End-to-End Verification & Integration Test

**Files:**
- Test: All touched files (`manager.py`, `opencode.js`, `store.jsx`, `Sidebar.jsx`, `Code.jsx`, `code.css`)

- [ ] **Step 1: Run Python tests**

Run: `pytest tests/test_opencode_manager.py -v`
Expected: PASS

- [ ] **Step 2: Run frontend production build**

Run: `(cd frontend && npm run build)`
Expected: PASS with 0 warnings or errors.

- [ ] **Step 3: Verify live endpoints and session switching via browser / curl**

Test `GET /api/opencode/status`, `GET /api/opencode/session`, `GET /api/opencode/project`, `GET /api/opencode/skill`.
Confirm session click navigates iframe, rename updates session title, and mode switcher transitions smoothly.

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: complete Work & Code sidebar and OpenCode session integration"
```
