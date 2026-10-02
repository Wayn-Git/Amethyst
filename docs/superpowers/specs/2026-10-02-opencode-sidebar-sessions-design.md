# Design Spec: Work & Code Sidebar Mode and OpenCode Session Architecture

## 1. Overview & Context

Amethyst provides a personal operating system interface featuring conversational AI, system tools, automations, and a dedicated **Code** mode backed by the local OpenCode engine (`opencode serve`).

Currently, the Code view is represented as a single nav item that loads an OpenCode iframe without deep session integration, while the sidebar remains fixed in general chat mode. Users need a seamless, professional experience inspired by modern AI coding environments (e.g., Mistral Vibe) that cleanly separates **Work** and **Code** workflows, displays real OpenCode projects and sessions in the sidebar, and functions reliably across all operating systems without hardcoded single-machine assumptions.

---

## 2. Core Directives & Constraints

1. **Zero Fake or Mock Features**: Every item shown in Code mode (sessions, projects, skills count, MCP connectors) binds directly to live OpenCode endpoints (`/api/opencode/*`). No placeholder lists or simulated states.
2. **Distinct Amethyst Identity**: Retain Amethyst's signature dark canvas (`#09090c`), violet/purple luminous accents (`#8b5cf6`), and clean typography. Do not copy external UIs 1:1.
3. **Cross-Platform Portability**: OpenCode discovery and execution must work out-of-the-box on Linux, macOS, and Windows. If OpenCode is not installed, provide clear platform-specific setup commands rather than silent failures.
4. **Design Engineering Standards**: Adhere to Emil Kowalski's interaction physics:
   - Specific CSS transitions (`transform`, `opacity`) under 200ms.
   - Haptic button press states (`transform: scale(0.97)` on `:active`).
   - Custom easing curves (`cubic-bezier(0.23, 1, 0.32, 1)`).
   - Never animate from `scale(0)` (use `scale(0.95)` with opacity).

---

## 3. System Architecture

```
+-----------------------------------------------------------------------------------+
| Amethyst App Shell                                                                |
|                                                                                   |
|  +---------------------------+  +-----------------------------------------------+ |
|  | Sidebar                   |  | Main View Container                           | |
|  |                           |  |                                               | |
|  | [Brand / UserMenu]        |  | When view === 'chat' / 'today' / 'tasks' ...  | |
|  |                           |  |  -> Native Amethyst Work View                 | |
|  | [ Work ] | [ Code ]  <----+--+-----------------------------------------------+ |
|  |   Mode Switcher           |  | When view === 'code'                          | |
|  |                           |  |                                               | |
|  | (If Work):                |  |  +------------------------------------------+ | |
|  |  - New Chat               |  |  | Breadcrumb: Project / Session Title      | | |
|  |  - Nav Places             |  |  | Health Indicator · Engine Controls       | | |
|  |  - Starred & Recents      |  |  +------------------------------------------+ | |
|  |                           |  |  | OpenCode Themed Web Interface            | | |
|  | (If Code):                |  |  | (Synced to /:dir/session/:id)            | | |
|  |  - + New Session          |  |  +------------------------------------------+ | |
|  |  - Context (Skills, MCP)  |  +-----------------------------------------------+ |
|  |  - Projects & Sessions    |                                                    |
|  +---------------------------+                                                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
                         Amethyst Backend Proxy (/api/opencode/*)
                                         |
                                         v
                            OpenCode Engine (`opencode serve`)
```

---

## 4. Detailed Component Specifications

### 4.1 State Management (`frontend/src/store.jsx`)
- `sidebarMode`: `'work' | 'code'` (default `'work'`, stored in `safeStorage.getItem('amethyst_sidebar_mode')`).
- `setSidebarMode(mode)`: updates mode state.
  - When switching to `'code'`, if current `view !== 'code'`, automatically transitions `view` to `'code'`.
  - When switching to `'work'`, transitions `view` to `'chat'` (or last active work view).
- `codeActiveSessionId`: `string | null` tracks the currently open OpenCode session ID.
- `codeActiveProjectId`: `string | null` tracks the selected project ID.
- `openCodeSession(sessionId, directory)`: updates active session ID and triggers URL sync in the Code view.

### 4.2 Sidebar Segmented Mode Switcher (`frontend/src/components/Sidebar.jsx`)
- Rendered directly below the brand header in expanded view and mini rail.
- Segmented control with two options:
  - **Work**: labeled with `Icon name="chat"` or `wrench` for everyday assistant tasks.
  - **Code**: labeled with `Icon name="code"` for OpenCode environment.
- Motion indicator using Framer Motion `layoutId="sb-mode-pill"` with `duration: 0.18, ease: [0.23, 1, 0.32, 1]`.
- In mini rail: switches between mini work icons and mini code actions (`+ New Session`, code sessions list popup).

### 4.3 Code Sidebar View (`Sidebar.jsx`)
When `sidebarMode === 'code'`:
1. **New Session Pill Button**:
   - Primary violet pill button: `+ New Session`.
   - On click: calls `opencode.createSession({ directory })`, prepends new session to list, and activates it.
2. **Context Sub-section (Collapsible)**:
   - **Skills**: queries `opencode.listSkills()` (`GET /api/opencode/skill`). Displays badge showing active skills count. Clicking toggles a popover listing installed skills.
   - **Connectors**: queries `opencode.getConfig()` (`GET /api/opencode/config`). Displays configured providers and plugins.
3. **Projects & Sessions List**:
   - Fetches projects via `opencode.listProjects()` (`GET /api/opencode/project`).
   - Fetches sessions via `opencode.listSessions()` (`GET /api/opencode/session`).
   - Groups sessions by project / directory.
   - Filters out child subagent sessions (sessions where `parentID` is present, e.g., `@explore` sub-threads) from the root list to keep list clean, while optionally showing sub-run indicators.
   - Session Row:
     - Title (truncated with ellipsis).
     - Agent badge (`build` / `plan`).
     - Relative time stamp (using `bucketOf` or `fmtDate`).
     - Action dots menu on hover:
       - **Rename**: inline editable field triggering `PATCH /api/opencode/session/:id`.
       - **Delete**: confirmation modal triggering `DELETE /api/opencode/session/:id`.
     - Active state: highlighted with Amethyst accent border and violet glow.

### 4.4 Code View & Session Synchronization (`frontend/src/views/Code.jsx`)
- **Directory Encoding**:
  - Implements OpenCode's base64url directory encoder:
    ```js
    function encodeDirectory(dir) {
      if (!dir) return ''
      const bytes = new TextEncoder().encode(dir)
      const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }
    ```
- **Iframe URL Construction**:
  - For active session: `http://${host}:${port}/${encodeDirectory(session.directory)}/session/${session.id}`.
  - For root/new session: `http://${host}:${port}/${encodeDirectory(projectDir)}/`.
- **Top Context Bar**:
  - Breadcrumb: `[Project Worktree] / [Session Title]` with session switch dropdown.
  - Status indicator dot (`running` green pulse, `offline` red).
  - Open in external window button (`Icon name="external-link"`).
  - Restart / Stop engine buttons.
- **Offline / Install Guide State**:
  - When OpenCode engine is offline or binary missing, presents clean installation card with tabs for:
    - **macOS / Linux**: `curl -fsSL https://opencode.ai/install.sh | bash`
    - **Node / npm**: `npm install -g opencode-ai`
    - **Manual**: link to documentation.
    - One-click copy buttons for commands.

### 4.5 Frontend OpenCode Client (`frontend/src/lib/opencode.js`)
Add missing typed methods:
- `listProjects: () => request('GET', '/project')`
- `getCurrentProject: () => request('GET', '/project/current')`
- `listSkills: () => request('GET', '/skill')`
- `encodeDir: (dir) => encodeDirectory(dir)`

### 4.6 Backend Cross-Platform Portability (`backend/opencode/manager.py`)
- **Expanded Binary Search (`_find_binary`)**:
  - Check `os.environ.get("OPENCODE_BIN")`.
  - Check `shutil.which("opencode")`.
  - Check multi-OS paths:
    - `~/.opencode/bin/opencode`
    - `~/.local/bin/opencode`
    - `/usr/local/bin/opencode`
    - `/usr/bin/opencode`
    - `/opt/homebrew/bin/opencode`
    - `~/.npm-global/bin/opencode`
    - Windows paths: `%APPDATA%/npm/opencode.cmd`, `%LOCALAPPDATA%/Programs/opencode/opencode.exe`
- **Host & Network Support**:
  - Support configurable bind host: when Amethyst is run with `--host 0.0.0.0`, ensure OpenCode CORS headers allow the originating client and proxy server listens appropriately.
- **SPA Routing in Proxy Server**:
  - In `_handle_proxy_client`, ensure requests to `/:dir/session/:id` or any HTML route receive the index.html payload with `AMETHYST_THEME_INJECTION` so theme styles apply to deep-linked sessions.

---

## 5. Visual Styling & Polish (`frontend/src/views/code.css`, `frontend/src/components/Sidebar.jsx`)

1. **Segmented Switcher Style**:
   - Container: `height: 34px`, background `var(--surface-sunken, rgba(255, 255, 255, 0.04))`, border `1px solid var(--hairline, rgba(255, 255, 255, 0.08))`, radius `9px`, padding `3px`.
   - Items: `flex: 1`, font size `12px`, weight `500`, smooth active indicator with subtle violet border and glow.
2. **Context Collapsible**:
   - Chevron toggle with smooth height transition via Framer Motion.
   - Skill items rendered with microscopic badge (`rounded-full px-2 py-0.5 text-[10px] bg-purple-500/10 text-purple-400`).
3. **Session Items**:
   - Sleek row with icon, title, relative timestamp, agent badge (`build`, `plan`).
   - Active session: `background: rgba(139, 92, 246, 0.08)`, border `1px solid rgba(139, 92, 246, 0.3)`.
   - Action menu on hover (rename, delete).
4. **Micro-Interactions**:
   - Button press: `transform: scale(0.97)` on `:active`.
   - Easing: `cubic-bezier(0.23, 1, 0.32, 1)`.
   - Staggered entry animation on session list mount.

---

## 6. Verification & Test Plan

1. **Binary Detection Verification**:
   - Verify `_find_binary()` locates binary via which or common paths on Linux/macOS/Windows.
2. **OpenCode Endpoints Verification**:
   - Verify `GET /api/opencode/session`, `GET /api/opencode/project`, `GET /api/opencode/skill` return valid JSON.
3. **Sidebar Mode Switch**:
   - Toggle `Work` <-> `Code` in expanded sidebar and mini rail.
   - Confirm mode state persists across page reload.
4. **Session Operations**:
   - Create new session via `+ New Session` button; confirm it appears in sidebar and loads in iframe.
   - Rename session via menu; confirm update persists.
   - Delete session via menu; confirm deletion in backend.
   - Select different sessions; confirm iframe navigates to corresponding `/:dir/session/:id`.
5. **Portability & Error States**:
   - Test behavior when engine is stopped (shows clean offline state with Start button and install instructions).
   - Test starting engine from offline card.
