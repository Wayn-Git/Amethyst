# Design Spec: Local vs. Composio Connector Split & Honest State

**Date:** 2026-10-05  
**Topic:** Connectors Architecture, Deduplication, Honest UI States, and Onboarding

---

## 1. Problem Statement

The Connectors tab rendered providers under **Cloud Connectors "Powered by Composio"** (Slack, GitHub, Linear, Notion, Gmail, Google Calendar) as "Active" with green dots even when Composio was unconfigured and no accounts were connected. Concurrently, Settings → Cloud Integrations reported Composio as "Not configured". 

Furthermore, the agent saw duplicate paths to the same underlying services (e.g. local `workspace-mcp` and Composio `gmail`), leading to confusion, schema bloat (~29K tokens), and ambiguous error handling where failures from unauthenticated connectors were misclassified as outages.

---

## 2. Architectural Principles & Ownership

### 2.1 Backend Ownership Matrix

| Provider Type | Owner | Backend / Transport | Rationale |
|---|---|---|---|
| `no_auth`, `api_key`, or local-first | **Local** | Stdio / HTTP MCP (`backend/mcp/catalogue.py`) | Zero manual OAuth; fully private, local execution. |
| Hosted OAuth (multi-tenant / complex apps) | **Composio** | Streamable HTTP (`composio_service.py`) | Zero manual OAuth app setup for non-technical users. |
| Providers with an active local OAuth app | **Local** (Advanced) | Local Stdio / Copilot MCP | When user configures local credentials, Local takes precedence and Composio equivalent is hidden. |

### 2.2 Provider ID Mapping & Deduplication Rule

Provider identifiers are mapped between Composio toolkits and Local catalogue entries:
```python
PROVIDER_MAPPING: dict[str, set[str]] = {
    "gmail": {"google-workspace", "google-gmail"},
    "googlecalendar": {"google-workspace", "google-calendar"},
    "github": {"github"},
    "spotify": {"spotify"},
}
```

**Deduplication Invariant:**
- A provider is registered **under at most one backend** in tool schemas for any agent turn.
- If a local connector is configured and signed in (`mcp.is_signed_in(config) is True`), local takes precedence: Composio's equivalent toolkit is withheld from schemas and hidden in the Connectors UI.
- If local is not configured/signed-in, and Composio has an active connection (`item.status == "ACTIVE"` in Composio's connected accounts), Composio owns the service (`composio:<toolkit>`).
- If neither is connected, schemas are withheld from the model.

---

## 3. Detailed Component Design

### 3.1 Backend: `backend/mcp/composio_service.py`

1. **`get_connections()`**:
   - Calls `composio.client.connected_accounts.list(user_ids=[user_id], statuses=["ACTIVE"])` (with fallback to project-wide list).
   - Caches active connections for 5.0 seconds (matching `guidance.py` cache cycle).
   - Returns a dictionary mapping `toolkit_slug -> {"id": ..., "status": "ACTIVE", "created_at": ...}`.
2. **`initiate_connection(toolkit: str) -> str`**:
   - Calls `client.toolkits.authorize(user_id=user_id, toolkit=toolkit.lower())`.
   - Returns `connection_request.redirect_url`.
3. **`get_status()`**:
   - Enhanced to report active connected account counts and verify real readiness.

### 3.2 Backend: `backend/api/main.py`

- `GET /api/composio/connections`: returns active connected accounts from `composio_service.get_connections()`.
- `POST /api/composio/toolkits/{toolkit}/connect`: triggers `initiate_connection(toolkit)` and returns `{ "redirect_url": url }`.
- `GET /api/composio/toolkits`: annotates each item with:
  - `connected`: bool (true only if account is in `get_connections()`)
  - `overridden_by_local`: bool (true if local equivalent server is active/signed-in)

### 3.3 Backend: Tool Registry, Schemas & Guidance

#### `backend/tools/registry.py` & `backend/agent/director.py`
- In `registry.schemas(hidden_servers=..., priority_servers=...)`:
  - When iterating tools, if a tool is from `composio` (or has `__mcp__composio`):
    - Extract `toolkit` slug.
    - If `toolkit` is overridden by an active local server: withhold tool schema.
    - If `toolkit` has no active connected account in `composio_service.get_connections()`: withhold tool schema.
- In `registry.dispatch()`:
  - Intercept calls to `composio` tools before network dispatch.
  - If Composio is not configured: refuse with instructions to configure API key.
  - If the tool's toolkit has no connected account: refuse with instructional error from `guidance.composio_sign_in_instruction(toolkit)`.

#### `backend/mcp/guidance.py`
- Add `composio_sign_in_instruction(toolkit: str) -> str`:
  > `'composio:{toolkit}' is available but no account is connected to it, so none of its tools can work yet. This is not an outage and not a bug: it is a setup step only the user can complete. Tell them to open Skills & connectors (Cmd/Ctrl+4), Connectors tab, find '{toolkit.capitalize()}' under Cloud Connectors and press Connect. Do not retry this tool. Finish everything else the request needs and say plainly which part is waiting on that connection.`
- Update `ready_connectors_block()`:
  - For Composio, list each active connected toolkit individually (`composio:slack`, `composio:linear`, etc.) rather than a generic `composio` blob.

### 3.4 Frontend: Connectors Tab (`ConnectorsTab.jsx`)

1. **Unconfigured Composio State**:
   - When `!composioStatus?.configured`, hide the per-provider rows completely.
   - Display a single honest banner card:
     * Title: **Composio — Not configured**
     * Description: "Paste an API key to enable one-click Gmail, Slack, GitHub, Linear, and Notion connections (free tier, limits apply). No developer console setup needed."
     * Actions: Direct link to `https://dashboard.composio.dev/settings` and a button to open Settings → Cloud Integrations.
2. **Configured State**:
   - Render provider rows with honest statuses:
     * `Active` (green status badge & dot): displayed **only** if `item.connected === true`.
     * `Not connected`: displays an actionable **"Connect"** button.
   - Clicking "Connect":
     * Calls `api.connectComposioToolkit(item.slug)`
     * Opens authorization URL in a new tab via `window.open(redirect_url, '_blank')`
     * Periodically checks status until connected.
   - If `item.overridden_by_local` is true, omit the row or show as managed by local MCP to prevent duplicate UI rows.

### 3.5 Frontend: Onboarding & Settings

1. **Onboarding Wizard (`SplashScreenWizard.jsx` → `StepConnectors`)**:
   - Recommend Composio by default for OAuth providers: highlight instant setup without manual Google Cloud / GitHub OAuth apps.
   - Clearly explain free tier limits.
   - Keep self-hosted OAuth app setup accessible via an "Advanced (Self-hosted / Local-first)" accordion/card.
2. **Settings → Cloud Integrations (`Settings.jsx`)**:
   - Surface free tier details, hosted OAuth benefits, and list of supported apps.
   - Display active connected accounts when configured.

---

## 4. Verification & Testing Plan

1. **Unit & Integration Tests**:
   - `tests/test_composio_service.py`: test `get_connections()`, `initiate_connection()`, and caching behavior with mocked Composio client.
   - `tests/test_connector_ownership.py`: verify that local active servers suppress Composio toolkits, and unconnected Composio toolkits have their tools withheld from `registry.schemas()`.
   - `tests/test_composio_dispatch_guard.py`: verify that calling an unconnected Composio tool returns the exact `composio_sign_in_instruction` with "Do not retry".
2. **Frontend UI Verification**:
   - Verify unconfigured state renders exactly one honest card without provider rows.
   - Verify configured state displays "Active" only when connected, and "Connect" button opens the hosted OAuth link.
3. **Documentation**:
   - Update `docs/architecture/connectors.md` to document the ownership split and deduplication rules.
