# Spec: Connectors & Composio Real-Time Reliability, System Tools & UI Overhaul

## 1. Problem Statement & Motivation
Users rely on Amethyst's Connectors menu to provide their autonomous agents with access to real-world cloud APIs (via Composio) and local computer capabilities (CUA, Terminal, Filesystem, Browser, MCP).
However:
1. **Unreliable / Stale Connectivity State**:
   - `composio_service.get_connected_services_state()` silently suppressed HTTP failures (like 401 Unauthorized or API connection loss) and reported `credentialStore: "ok"`, leaving the UI in a fake "Connected" state or missing error context.
   - The frontend cached status for 30,000ms (`CONNECTOR_STATUS_CACHE_MS`), preventing users from seeing real-time disconnections, expired OAuth tokens, or newly authenticated accounts.
2. **Missing Granular Tool Capabilities ("We Need More Stuff")**:
   - Connector detail views only displayed a generic string ("Interactive, Write, Read") rather than the actual MCP tools and actions granted to the agent (e.g., `GITHUB_CREATE_ISSUE`, `GMAIL_SEND_EMAIL`, `LINEAR_UPDATE_ISSUE`).
   - `list_connector_tools()` returned generic `{SLUG}_ACTION` stubs rather than real schemas from `STATIC_PINNED_SCHEMAS` and fast-lane registries.
   - Users lacked a live probe button to test whether an individual connected account's token is alive.
3. **Neglected Local & System Connectors**:
   - Built-in system connectors (Desktop CUA Driver, System Terminal, Workspace Filesystem, Web Browser, and uv runtime) were not presented with first-class UI cards, and custom MCP servers were relegated to a raw JSON editor at the very bottom.

---

## 2. Technical Architecture & Design

### A. Backend: True Real-Time Connectivity Engine (`backend/mcp/composio_service.py`)
1. **Strict Live Verification (`get_connected_services_state`)**:
   - Track health metadata: `status: "ACTIVE" | "EXPIRED" | "FAILED" | "UNAUTHORIZED" | "UNCONFIGURED"`.
   - If HTTP response is 401/403 or network error: record `credentialStore: "error"` and descriptive `error_detail: "Invalid or expired Composio API key"`.
   - Inspect individual account statuses from Composio: if an account status is `EXPIRED` or `FAILED`, pass this state explicitly to the frontend so the user gets a 1-click "Reconnect" CTA.
2. **Real Granular Tool Schemas (`list_connector_tools`)**:
   - Return actual tool schemas from `STATIC_PINNED_SCHEMAS` and fast-lane definitions:
     - Tool name, parameter summary, and human-readable description.
3. **Live Connectivity Test Endpoint (`/api/connectors/{slug}/test`)**:
   - Test connectivity for a specific connected service account to verify token validity in real-time.

### B. Frontend: Connectors Orchestrator & Live Sync (`ConnectorsTab.jsx`)
1. **Real-Time Gateway Sync & Auto-Revalidation**:
   - Reduce background stale threshold; re-validate on window focus (`window.addEventListener('focus')`).
   - Add a prominent top-level **Gateway Status Badge** with latency and a manual `[↻ Sync]` button:
     - `● Composio: Connected (92ms)` or `▲ Composio: Token Expired - Re-authenticate`.
2. **Top Filter Navigation**:
   - `All` · `Cloud Apps (Composio)` · `System & Local` · `Installed (N)`.
   - Live search across both cloud apps and system tools.

### C. System & Local Connectors Component (`SystemConnectorsPanel.jsx`)
First-class visual cards for Amethyst's core local capabilities:
1. **Desktop & CUA Driver (`cua-driver`)**:
   - Screen inspection, mouse/keyboard automation, native window management.
   - Shows permissions status (Accessibility / Screen Recording).
2. **System Terminal & CLI (`bash`)**:
   - Persistent terminal shells, background command runner, execution sandbox.
3. **Workspace Filesystem**:
   - Project directory access, AST search, atomic write guarantees.
4. **Web Browser & Scraper (`fetch` / `browser`)**:
   - Chromium automation and clean markdown crawler.
5. **Custom MCP Servers (`McpServersPanel`)**:
   - Clean card-based preset launcher for `filesystem`, `fetch`, `playwright`, `postgres`, `brave-search`.

### D. Richer Composio Detail View (`PluginDetailView.jsx`)
1. **Granular Action & Tool Catalog**:
   - Interactive accordion of all tools granted by this app with action descriptions and parameter hints.
2. **Account Management & Health**:
   - Account alias, connected timestamp, live `[Test Connection]` button, and `[Reconnect]` if expired.
3. **Prebuilt Squircle App Icons**:
   - Continues using `ServiceIcon` with authentic high-res brand logos and CDN fallbacks.

---

## 3. Verification Plan
1. **Automated Unit Tests**:
   - Backend: Pytest suite for `composio_service` status checking and error handling.
   - Frontend: `npm run test:widgets` and `npm run test:renderers`.
2. **Production Build**:
   - `npm run build` with zero errors.
3. **Manual Flow Verification**:
   - Test live status sync button in Connectors tab.
   - Test local & system connectors filter and cards.
   - Verify tool inspection in PluginDetailView.
