# Design Spec: Composio Plugins First-Class Experience & 1-Click Browser OAuth

**Date:** 2026-10-11  
**Topic:** Connectors Tab Reorganization, Category Grouping with "View More", and Zero-Key Composio Browser OAuth  

---

## 1. Problem Statement & Motivation

Currently, the Capabilities & Connectors tab (`ConnectorsTab.jsx`) exhibits three key usability and architectural friction points:

1. **Inverted Hierarchy**: Agent Core Tools and local MCP servers are rendered above Composio. For users seeking instant cloud SaaS plugins (Slack, Gmail, GitHub, Linear, Notion, etc.), Composio is pushed down the page rather than being the prominent default.
2. **Unstructured Flat Grid**: All Composio toolkits are rendered in a single, unstructured flat grid without grouping by category/label. Users cannot quickly locate apps by domain (e.g., Communication vs. Productivity), and the list quickly becomes visually cluttered.
3. **High Setup Friction (Manual API Keys)**: When users click "Connect Composio" or attempt to connect a tool, they are presented with a modal demanding a Composio API Key (`ck_...`, `uak_...`). This forces everyday users to leave the app, register on a developer dashboard, locate an obscure settings tab, create an API key, copy it, and paste it back into Amethyst.

---

## 2. Goals & Non-Goals

### Goals
- **Composio as the Default Hero**: Position Composio Cloud Plugins at the top of the Connectors tab, with honest connection state and 1-click setup.
- **Dedicated Local Section**: Relocate local MCP servers (Playwright, Chrome DevTools, Memory, custom `mcp.yaml` servers) to a distinct, clearly marked section at the bottom.
- **Categorized App Sections with "View More"**: Divide Composio apps by their category/label (e.g. Communication, Productivity, Developer Tools, Knowledge & Data, Utilities). Show the top 4–6 apps initially per category, with an interactive "View more" toggle to expand all items in that category.
- **Zero-Manual-Key Browser OAuth**: Implement 1-click login using Composio's native browser session protocol (`/api/v3/cli/create-session` and `get-session`). The user clicks "Connect", their browser opens to Composio Google Login (`https://dashboard.composio.dev/?cliKey={id}`), and Amethyst automatically captures the resulting token and activates the tools without the user ever touching an API key.
- **Preserve Fallbacks**: Retain an optional "Enter existing API key manually" accordion for developers who prefer using custom keys or self-hosted proxies.

### Non-Goals
- Changing the local MCP process lifecycle or stdio transport.
- Altering the underlying deduplication logic in `provider_ownership.py` (active local servers still cleanly override Composio equivalents).
- Introducing third-party authentication services outside of Composio's own hosted OAuth flow.

---

## 3. Architecture & Data Flow

### 3.1 Zero-Key Browser OAuth Flow

```
[User clicks "Connect"]
       │
       ▼
[Frontend: ComposioConnectModal] ───> POST /api/composio/login/start
                                              │
                                              ▼
                                 [Backend: composio_service]
                                 POST https://backend.composio.dev/api/v3/cli/create-session
                                 { "scope": "user", "source": "amethyst" }
                                              │
                                              ▼
                                 Returns: { session_id, code, login_url }
                                 login_url = "https://dashboard.composio.dev/?cliKey={session_id}"
       │                                      │
       ▼                                      ▼
[Opens browser tab] <─────────────────────────┘
(User logs in via Google on Composio)
       │
       ▼
[Frontend/Backend Polls] ───────────> GET /api/composio/login/poll/{session_id}
                                              │
                                              ▼
                                 GET https://backend.composio.dev/api/v3/cli/get-session?id={id}
                                 Status: "pending" ──> Status: "linked", api_key: "uak_..."
                                              │
                                              ▼
                                 [Backend: composio_service.set_api_key(api_key)]
                                 Saves key in OS keychain & composio_state DB table
                                 Auto-initializes Composio MCP session
                                              │
                                              ▼
[Modal Closes & UI Updates] <─────────────────┘
Shows "Connected" with live toolkits!
```

### 3.2 Layout Hierarchy & Sectioning

```
Capabilities View
└── Connectors Tab
    ├── Header & Search / Filter Chips
    │
    ├── 1. COMPOSIO CLOUD PLUGINS (Primary / Top)
    │   ├── Composio Banner & Status (Connected badge OR "Connect with Google" button)
    │   ├── Category: Communication (Slack, Gmail, Discord, Twitter...) [View 4 more]
    │   ├── Category: Productivity (Linear, Notion, Google Calendar, Asana...) [View 6 more]
    │   ├── Category: Developer Tools (GitHub, Jira, SQL...) [View 3 more]
    │   └── Category: Knowledge & Utilities (Web Scraper, Calculator, Weather...)
    │
    └── 2. LOCAL & SYSTEM CONNECTORS (Distinct Bottom Section)
        ├── Section Header: "Local & System Connectors" + subtle badge / explanation
        ├── Agent Core Tools (Playwright, Fetch, etc.)
        └── User Local MCP Servers (DevTools, Memory, custom mcp.yaml entries)
```

---

## 4. Component Details & Technical Specifications

### 4.1 Backend: `backend/mcp/composio_service.py`

Add session lifecycle methods to `ComposioService`:

1. **`start_browser_login() -> dict[str, Any]`**:
   - Sends HTTP POST to `https://backend.composio.dev/api/v3/cli/create-session` with body `{"scope": "user", "source": "amethyst"}`.
   - Extracts `session_id = data["id"]`, `code = data["code"]`, and builds:
     ```python
     login_url = f"https://dashboard.composio.dev/?cliKey={session_id}"
     ```
   - Returns `{"session_id": session_id, "code": code, "login_url": login_url, "expires_at": data.get("expiresAt")}`.

2. **`poll_browser_login(session_id: str) -> dict[str, Any]`**:
   - Queries `GET https://backend.composio.dev/api/v3/cli/get-session?id={session_id}`.
   - If `status == "linked"` and `api_key` is present:
     - Automatically calls `self.set_api_key(api_key, mode="user")`.
     - Returns `{"status": "linked", "configured": True, "api_key": "***"}`.
   - If still `"pending"`, returns `{"status": "pending"}`.
   - Handles errors/timeouts gracefully.

### 4.2 Backend: `backend/api/main.py`

Expose two new REST endpoints:

- `POST /api/composio/login/start`:
  - Calls `composio_service.start_browser_login()`.
  - Returns JSON with session ID, code, and direct Google/dashboard login URL.

- `GET /api/composio/login/poll/{session_id}`:
  - Calls `composio_service.poll_browser_login(session_id)`.
  - On link success, triggers `_apply_connector("composio", True)` so MCP tools initialize immediately.
  - Returns current status (`pending`, `linked`, or `expired`).

### 4.3 Frontend: API Client (`frontend/src/api.js`)

Add API methods:
```javascript
startComposioLogin: () => j('/composio/login/start', json('POST')),
pollComposioLogin: (sessionId) => j(`/composio/login/poll/${encodeURIComponent(sessionId)}`),
```

### 4.4 Frontend: Modernized Connect Modal (`ComposioConnectModal.jsx`)

Redesign the modal to put Browser OAuth first:
- **Hero Action**: Prominent *"Connect with Google / Composio"* button with Google/Composio branding.
- **Connecting State**: When clicked:
  - Automatically opens the login URL in a new browser window/tab.
  - Displays a clean waiting screen:
    - Pulsing indicator: *"Waiting for authorization in browser..."*
    - The 6-character code (`code`) in a monospace badge: *"Your verification code: ABC123"*
    - Button to re-open the browser tab if closed.
  - Polls `/api/composio/login/poll/{session_id}` every 2 seconds.
  - Upon completion: triggers success toast, updates app state, and closes modal automatically.
- **Secondary Accordion**: Small collapsible link at the bottom *"Or enter an API key manually"* allowing users to paste a custom key if desired.

### 4.5 Frontend: Connectors Tab Reorganization (`ConnectorsTab.jsx`)

1. **Reorder Layout**:
   - Top: **Plugins by Composio** section.
   - Bottom: **Local & System Connectors** section.
2. **Category Grouping**:
   - Group `filteredComposioToolkits` by `item.category` (with fallbacks for unassigned categories).
   - Maintain a local state `expandedCategories: Record<string, boolean>`.
   - Per category:
     - Show category title and app count (e.g., *"Communication (6)"*).
     - Display top 4–6 items when collapsed.
     - Show a clean pill button: *"View 2 more"* / *"Show fewer"*.
     - If the global search query is active, auto-expand all matching categories.
3. **One-Click App Connection**:
   - When a user clicks "Connect" on any unconfigured Composio app, instead of failing or opening a raw key input, it launches the browser OAuth flow directly.

---

## 5. Design System & Tokens (`AGENTS.md`)

- **Palette**: Use `--accent`, `--surface`, `--surface-2`, `--live`, `--text`, `--text-dim`, `--hairline`. No hardcoded hex values.
- **Typography**: Display/UI fonts scale via `--text-scale` and use `--font-body`, with code badges styled via `--font-mono`.
- **Motion**:
  - Modal transitions using spring physics (`stiffness: 450, damping: 30`).
  - Category accordion expansion using Framer Motion `AnimatePresence` and `layout="position"` with durations <240ms.
  - Respect `prefers-reduced-motion`.
- **Geometry**: Border radii follow token scale (`--radius-cards`, `--radius-buttons`).

---

## 6. Testing & Verification Plan

1. **Unit & API Testing (`tests/test_composio_service.py`)**:
   - Mock responses for `create-session` and `get-session`.
   - Verify `start_browser_login` returns the expected URL and session ID.
   - Verify `poll_browser_login` transitions from `pending` to `linked` and invokes `set_api_key`.
2. **Integration Route Testing (`backend/api/main.py`)**:
   - Test `POST /api/composio/login/start` returns 200 with valid session structure.
   - Test `GET /api/composio/login/poll/{id}` handles pending and linked scenarios.
3. **Frontend Component & Lint Verification**:
   - Verify React build passes without errors (`npm run build` in `frontend`).
   - Verify responsive behavior of category grid and accordion buttons.
   - Verify search filtering auto-expands categories.
   - Verify modal initiates browser OAuth, opens popup/tab, polls, and updates live state without page refresh.
