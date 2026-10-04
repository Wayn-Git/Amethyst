# Design Spec: Amethyst Composio Hosted MCP Integration & Progressive Disclosure

## 1. Executive Summary & Context

Amethyst is a local-first personal operating system designed to keep user data, execution, and SQLite state on the local machine. While Amethyst features a robust native MCP runtime supporting local stdio and SSE servers, configuring external cloud integrations (e.g., Google Calendar, Slack, Linear, Notion, Jira) currently imposes significant operational friction due to self-hosted OAuth app setup (redirect URIs, GCP/Azure consoles, 7-day testing tokens).

**Composio** provides managed OAuth authentication and pre-built tooling across 250+ cloud applications. Furthermore, Composio v2 provides a dedicated **Hosted MCP Session** architecture (`session.mcp.url`), allowing external platforms to expose tools via standard Model Context Protocol endpoints.

This specification details how Amethyst integrates Composio as an optional, high-convenience cloud connector bridge **without compromising local-first privacy, without bloating LLM context windows, and without creating conflicting tool search mechanisms**.

---

## 2. Core Architectural Tenets

1. **Local-First Dominance**: Core local tools (`view_file`, `edit_file`, `write_file`, `run_shell_command`) remain primary, running locally on the machine with zero cloud roundtrips and zero latency.
2. **Zero Competing Meta-Tools**: Composio's framework-level meta-tools (`COMPOSIO_SEARCH_TOOLS`) are disabled. The agent interacts with only **one search interface: Amethyst's native BM25 `tool_search`**.
3. **Progressive Disclosure & Zero Initial Overhead**: Composio tools are never dumped into the agent prompt upfront. They are registered into Amethyst's deferred tool catalog and discovered on-demand via BM25 matching.
4. **Native MCP Runtime Reuse**: Composio sessions are ingested by Amethyst's existing MCP client (`backend/mcp/client.py`) and manager (`backend/mcp/manager.py`), inheriting existing health checks, logging, and security gates.
5. **Human-in-the-Loop Safety**: Amethyst's operation-level confirmation engine intercepts mutating Composio actions (sending messages, creating pull requests, deleting entities) before execution.

---

## 3. System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│ Amethyst Frontend (React 19)                                           │
│                                                                        │
│   Settings View                     Capabilities > Connectors View     │
│   ┌───────────────────────────┐     ┌────────────────────────────────┐ │
│   │ COMPOSIO_API_KEY Input    │     │ [Slack]   [Notion]   [Linear]  │ │
│   │ Test & Connection Status  │     │ "Powered by Composio" Badges   │ │
│   └─────────────┬─────────────┘     └───────────────┬────────────────┘ │
└─────────────────┼───────────────────────────────────┼──────────────────┘
                  │                                   │
                  ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Amethyst Backend (FastAPI + Python 3.11+)                              │
│                                                                        │
│  API Endpoints:                                                        │
│  • POST /api/composio/key           • GET /api/composio/status         │
│  • GET  /api/composio/toolkits      • POST /api/composio/toolkits/toggle│
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ backend/mcp/composio_service.py                                  │  │
│  │ • Reads API key from system keychain                             │  │
│  │ • Manages persistent session in SQLite:                          │  │
│  │     composio.sessions.create(user_id, toolkits, mcp=True)        │  │
│  │ • Reuses active session via composio.use(session_id, mcp=True)   │  │
│  │ • Dynamically updates toolkits on UI toggle                      │  │
│  │ • Exposes session.mcp.url & headers to MCP Manager               │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Amethyst MCP Manager (backend/mcp/manager.py)                    │  │
│  │ Registers synthetic server: "composio" (streamable-http/sse)     │  │
│  │ Ingests tools as: <action>__mcp__composio                        │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Progressive Tool Disclosure (backend/agent/tool_search_catalog.py│  │
│  │ Indexed in BM25 with source_name: "composio:<toolkit>"           │  │
│  │ Discoverable via single tool: `tool_search`                      │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Composio Cloud Gateway    │
                        │ (Hosted MCP + Auth Hub)   │
                        └───────────────────────────┘
```

---

## 4. Backend Technical Specifications

### 4.1 Dependency Addition
* Add `composio` (version `>= 0.22.0`) to `pyproject.toml` and `requirements.txt`.
* Explicitly exclude `composio-core` (the deprecated v1 SDK).

### 4.2 SQLite Schema Addition (`backend/db/schema.sql` & migrations)
Add table `composio_state` to track the local user session:
```sql
CREATE TABLE IF NOT EXISTS composio_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    enabled_toolkits TEXT NOT NULL DEFAULT '[]', -- JSON array of slugs
    mcp_url TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 Composio Service Manager (`backend/mcp/composio_service.py`)
Encapsulates all interaction with the `composio` Python SDK:
1. **Credentials Management**:
   * Reads and writes `COMPOSIO_API_KEY` to the OS Keychain via Amethyst's existing credential helper (`api_key_ref: "amethyst/composio_api_key"`).
2. **Session Lifecycle**:
   * `get_or_create_session()`:
     * Checks `composio_state` table for an existing `session_id`.
     * If present, verifies and resumes with `composio.use(session_id, mcp=True)`.
     * If expired (HTTP 404) or absent, generates a stable `user_id` (Amethyst local machine UUID) and calls:
       ```python
       session = composio.sessions.create(
           user_id=user_id,
           toolkits={"enable": enabled_toolkits},
           mcp=True
       )
       ```
     * Persists `session_id`, `mcp_url`, and `enabled_toolkits` to SQLite.
3. **Dynamic Toolkit Updates**:
   * When an app is toggled in the UI:
     ```python
     session.update(toolkits={"enable": updated_toolkits})
     ```
   * Triggers `mcp_manager.reconcile_server("composio")` to re-fetch tool schemas without restarting Amethyst.
4. **Auth Link Retrieval**:
   * If a tool invocation returns an authorization challenge, extracts the `redirect_url` and returns it as a structured payload for frontend rendering.

### 4.4 Ingestion into Amethyst MCP Manager (`backend/mcp/manager.py`)
* The `composio` server is injected as a managed dynamic server config:
  * `transport`: `Transport.STREAMABLE_HTTP` (or `Transport.SSE`)
  * `url`: `session.mcp.url`
  * `headers`: `session.mcp.headers` (e.g. `{"x-api-key": "..."}`)
* Tools are normalized with Amethyst's standard naming convention:
  * Pattern: `{composio_action_name}__mcp__composio`
  * Example: `slack_chat_post_message__mcp__composio`

### 4.5 BM25 Catalog & Tool Search Integration
In `backend/agent/tool_search_catalog.py`:
* `_classify_source()` is updated to recognize Composio tools:
  * When `server_name == "composio"`, inspects the tool name prefix or metadata to assign:
    * `source: "mcp"`
    * `source_name: "composio:<toolkit>"` (e.g. `composio:slack`, `composio:notion`)
* Search tokens are generated by splitting the tool name, toolkit slug, description, and properties.

---

## 5. Agent Prompt & Execution Rules

In `backend/agent/prompt.py`, establish explicit hierarchical tool routing instructions:

```markdown
## Tool Routing & Hierarchy
1. Local Workspace & Files: Always use Tier 1 core tools (view_file, edit_file, write_file, run_shell_command). Never attempt to use cloud integrations for local filesystem or local git operations.
2. External Cloud Apps (Slack, Notion, Linear, GitHub, Gmail, Jira):
   - Use `tool_search` to discover the appropriate `composio:<app>` tool.
   - Inspect required parameters using `tool_describe`.
   - Execute via `tool_call`.
3. If a Composio tool returns a Connect Link / Authorization URL, present the link to the user clearly so they can authorize the connection.
```

---

## 6. Frontend & User Experience

### 6.1 Settings View (`frontend/src/views/Settings.jsx`)
* **Integrations Section**:
  * Input for `COMPOSIO_API_KEY` (masked with show/hide toggle).
  * "Test Connection" button that calls `GET /api/composio/status`.
  * Status indicator:
    * Green: Connected & Active.
    * Red/Yellow: Invalid API Key / Unreachable.
  * Direct deep-link to the Composio Dashboard to view active accounts and audit logs.

### 6.2 Capabilities > Connectors Tab (`frontend/src/views/capabilities/ConnectorsTab.jsx`)
* **Unified Connector Tiles**:
  * Composio-backed apps appear in the catalogue grid:
    * Slack, Notion, Linear, GitHub, Google Calendar, Gmail, Jira, Asana, Spotify, etc.
  * Card Elements:
    * Brand Icon + App Title.
    * Pill badge: `Composio` (distinctive purple/orange subtle glow).
    * Status: `Not Connected` vs `Connected`.
    * Toggle switch to Enable / Disable toolkit.
  * Clicking **Connect** when unauthenticated opens the Composio OAuth popup window.

### 6.3 Chat In-Stream Connect Cards
When the agent executes an action for an app that lacks a connected account:
* Amethyst's chat component renders a specialized **Authorization Card**:
  * App icon + title.
  * Message: *"Slack requires authorization to post messages on your behalf."*
  * Button: *"Connect with Slack ↗"* (opens `connect.composio.dev` popup).
  * Automatically detects connection completion and allows the agent to continue.

---

## 7. Safety, Confirmation & Risk Engine

Mutations must never happen silently in the background:
* **Read Actions** (e.g. `slack_conversations_list`, `notion_get_page`, `github_get_issue`):
  * Classified as `risk: read`.
  * Execute without interruption.
* **Mutating Actions** (e.g. `slack_chat_post_message`, `github_create_pull_request`, `gmail_send_mail`):
  * Classified as `risk: write` / `risk: external_mutation`.
  * Triggers Amethyst's native confirmation modal:
    * Highlights target service (e.g. `Slack`).
    * Displays destination (channel, recipient, repo).
    * Shows preview of message content.
    * Requires user approval before dispatching payload to Composio.

---

## 8. Error Handling & Resilience

1. **Network Disruption / Composio Downtime**:
   * If `session.mcp.url` is unreachable or returns 5xx, Amethyst's MCP manager marks `composio` as `UNAVAILABLE`.
   * Agent loop fails open: informs the user that cloud apps are temporarily unavailable, while all local tools continue functioning at 100% capacity.
2. **Session Invalidation**:
   * If a stored `session_id` expires or is deleted in the Composio dashboard, backend catches 404/401 and transparently recreates the session.
3. **Token Limit Guard**:
   * The allowlist `{ enable: [...] }` prevents more than 50–100 tools from being registered at any time, keeping the BM25 index lightning fast and memory usage minimal.

---

## 9. Verification & Acceptance Criteria

1. **Backend Tests**:
   * `tests/test_composio_service.py`: Verify session creation, session resumption (`composio.use`), and toolkit updates.
   * `tests/test_composio_mcp_ingestion.py`: Verify that tools register as `<name>__mcp__composio` and index into `tool_search_catalog`.
   * `tests/test_composio_risk.py`: Assert write tools trigger confirmation requests while read tools pass through.
2. **Agent Behavioral Tests**:
   * Test: *"Read local README.md"* -> Uses `view_file` (0 cloud calls).
   * Test: *"Send 'Deploy complete' to #releases on Slack"* -> Calls `tool_search("slack message")`, finds `slack_chat_post_message__mcp__composio`, prompts confirmation, and dispatches.
3. **Frontend Tests**:
   * Verify entering `COMPOSIO_API_KEY` in Settings persists correctly.
   * Verify toggling Slack on in Connectors tab updates backend toolkits without server restart.
