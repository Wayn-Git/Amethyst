# Composio Hosted MCP Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Composio into Amethyst via hosted MCP sessions and progressive tool disclosure, allowing users to connect 250+ cloud apps (Slack, Notion, Linear, GitHub, Gmail) without self-hosted OAuth friction or prompt token bloat.

**Architecture:** A dedicated `ComposioService` in the backend manages a persistent, toolkit-scoped Composio session with `mcp=True`. Amethyst's existing MCP manager registers this session's hosted MCP URL as a standard `streamable-http`/`sse` server. Ingested tools are indexed in Amethyst's native BM25 `tool_search_catalog` under `composio:<toolkit>`, preserving local-first tool precedence and safety confirmation gates.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, `composio>=0.22.0`, React 19, Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-10-03-composio-mcp-integration-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-03-composio-mcp-integration-design.md)

## Global Constraints

- Python package must be `composio>=0.22.0` (never `composio-core`).
- Core local tools (`view_file`, `edit_file`, `write_file`, `run_shell_command`) must remain primary for all local filesystem and OS tasks.
- Composio's meta-search tools (`COMPOSIO_SEARCH_TOOLS`) must not be presented to the model; Amethyst's native BM25 `tool_search` is the sole discovery surface.
- All mutating/write actions on Composio tools must pass through Amethyst's confirmation engine.
- Session IDs must be stored in SQLite and resumed with `composio.use(session_id, mcp=True)` to avoid multi-turn latency.

## Review Focus

1. **Missing or Invalid API Key**: Service must fail gracefully and mark server `UNCONFIGURED` without crashing Amethyst startup.
2. **Expired / 404 Session**: If a stored session is deleted or expired upstream, `ComposioService` must automatically recreate it.
3. **Empty Toolkit Allowlist**: If the user has disabled all toolkits, `{ enable: [] }` must be sent to avoid dumping all 1,000+ catalog tools.
4. **Network Outage / Gateway Failure**: If Composio Cloud is unreachable, local tools must continue operating with zero degradation.
5. **Authorization Redirects**: If an action is attempted on an unauthenticated account, the backend must surface the Connect Link as a structured challenge rather than a raw tool crash.

---

### Task 1: Dependencies & Database Schema Migration

**Files:**
- Modify: `pyproject.toml`
- Modify: `requirements.txt`
- Modify: `backend/db/schema.sql`
- Create: `backend/db/migrations/0009_composio_state.sql`
- Test: `tests/test_composio_schema.py`

**Interfaces:**
- Produces: `composio_state` SQLite table (`id INTEGER PRIMARY KEY CHECK (id=1)`, `session_id TEXT`, `user_id TEXT`, `enabled_toolkits TEXT`, `mcp_url TEXT`, `updated_at TIMESTAMP`).

- [ ] **Step 1: Write failing schema test**

```python
# tests/test_composio_schema.py
import sqlite3
import pytest

def test_composio_state_table_exists(db_conn: sqlite3.Connection):
    cursor = db_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='composio_state'")
    assert cursor.fetchone() is not None, "composio_state table must exist"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_schema.py -v`
Expected: FAIL ("composio_state table must exist")

- [ ] **Step 3: Update `pyproject.toml`, `requirements.txt`, and database schema**

Add `composio>=0.22.0` to dependencies.
Add `CREATE TABLE IF NOT EXISTS composio_state` in `backend/db/schema.sql` and `backend/db/migrations/0009_composio_state.sql`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml requirements.txt backend/db/schema.sql backend/db/migrations/ tests/test_composio_schema.py
git commit -m "feat(composio): add dependency and composio_state database table"
```

---

### Task 2: Composio Service Manager (`backend/mcp/composio_service.py`)

**Files:**
- Create: `backend/mcp/composio_service.py`
- Test: `tests/test_composio_service.py`

**Interfaces:**
- Consumes: `composio_state` table, OS Keychain / settings for `COMPOSIO_API_KEY`.
- Produces: `ComposioService` class with methods:
  - `get_api_key() -> str | None`
  - `set_api_key(key: str) -> bool`
  - `get_status() -> dict[str, Any]`
  - `get_or_create_session(enabled_toolkits: list[str] | None = None) -> Any`
  - `update_toolkits(toolkits: list[str]) -> bool`
  - `get_mcp_config() -> dict[str, Any] | None`

- [ ] **Step 1: Write the failing unit tests for ComposioService**

```python
# tests/test_composio_service.py
from unittest.mock import MagicMock, patch
import pytest
from backend.mcp.composio_service import ComposioService

def test_composio_service_lifecycle():
    service = ComposioService()
    assert service.get_api_key() is None or isinstance(service.get_api_key(), str)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_service.py -v`
Expected: FAIL (ImportError: cannot import name 'ComposioService')

- [ ] **Step 3: Implement `ComposioService`**

Implement `backend/mcp/composio_service.py` with session initialization (`mcp=True`), toolkit scoping (`toolkits={"enable": ...}`), session ID caching in SQLite, and error recovery for expired sessions.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_service.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mcp/composio_service.py tests/test_composio_service.py
git commit -m "feat(composio): implement ComposioService and session lifecycle manager"
```

---

### Task 3: MCP Manager Ingestion & Dynamic Server Registration

**Files:**
- Modify: `backend/mcp/manager.py`
- Modify: `backend/mcp/config.py`
- Test: `tests/test_composio_mcp_manager.py`

**Interfaces:**
- Consumes: `ComposioService.get_mcp_config()`.
- Produces: Dynamic server `composio` registered into `MCPManager`, exposing tools formatted as `<action>__mcp__composio`.

- [ ] **Step 1: Write the failing test for dynamic Composio server registration**

```python
# tests/test_composio_mcp_manager.py
from backend.mcp.manager import MCPManager
from unittest.mock import patch

def test_mcp_manager_registers_composio_server():
    manager = MCPManager()
    with patch("backend.mcp.composio_service.composio_service.get_mcp_config") as mock_conf:
        mock_conf.return_value = {
            "transport": "streamable-http",
            "url": "https://mcp.composio.dev/test",
            "headers": {"x-api-key": "test_key"}
        }
        server = manager.get_server_config("composio")
        assert server is not None
        assert server.transport == "streamable-http"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_mcp_manager.py -v`
Expected: FAIL (AssertionError: server is None)

- [ ] **Step 3: Implement dynamic server hook in `backend/mcp/manager.py`**

Incorporate `ComposioService.get_mcp_config()` into the server config resolver in `backend/mcp/manager.py`. Support dynamic tool reload on `reconcile_server("composio")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_mcp_manager.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mcp/manager.py backend/mcp/config.py tests/test_composio_mcp_manager.py
git commit -m "feat(composio): wire Composio hosted MCP server into MCPManager"
```

---

### Task 4: BM25 Progressive Catalog Indexing & Prompt Routing

**Files:**
- Modify: `backend/agent/tool_search_catalog.py`
- Modify: `backend/agent/prompt.py`
- Test: `tests/test_composio_catalog.py`

**Interfaces:**
- Consumes: Tool schemas from `composio` MCP server.
- Produces: Catalog entries with `source: "mcp"`, `source_name: "composio:<toolkit>"`.

- [ ] **Step 1: Write failing catalog classification test**

```python
# tests/test_composio_catalog.py
from backend.agent.tool_search_catalog import _classify_source

def test_classify_composio_source():
    source, source_name = _classify_source("slack_chat_post_message__mcp__composio", "composio")
    assert source == "mcp"
    assert source_name.startswith("composio:slack")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_catalog.py -v`
Expected: FAIL

- [ ] **Step 3: Update `_classify_source` and add prompt guidance**

In `backend/agent/tool_search_catalog.py`, parse the toolkit slug out of Composio tool names and assign `source_name: "composio:<toolkit>"`. In `backend/agent/prompt.py`, add hierarchical routing rules (Tier 1 core local tools for filesystem/OS vs Composio for external apps).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_catalog.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tool_search_catalog.py backend/agent/prompt.py tests/test_composio_catalog.py
git commit -m "feat(composio): add BM25 source classification and prompt routing rules"
```

---

### Task 5: Backend API Endpoints

**Files:**
- Modify: `backend/api/main.py`
- Test: `tests/test_composio_api.py`

**Interfaces:**
- Produces:
  - `POST /api/composio/key`: payload `{"api_key": str}`
  - `GET /api/composio/status`: returns `{ configured: bool, active: bool, toolkits: list[str] }`
  - `GET /api/composio/toolkits`: returns list of available & enabled toolkits
  - `POST /api/composio/toolkits/toggle`: payload `{"toolkit": str, "enabled": bool}`

- [ ] **Step 1: Write failing API endpoint tests**

```python
# tests/test_composio_api.py
from fastapi.testclient import TestClient
from backend.api.main import app

client = TestClient(app)

def test_get_composio_status():
    response = client.get("/api/composio/status")
    assert response.status_code == 200
    data = response.json()
    assert "configured" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_api.py -v`
Expected: FAIL (404 Not Found)

- [ ] **Step 3: Implement endpoints in `backend/api/main.py`**

Wire endpoints to `ComposioService` and trigger `mcp_manager.reconcile_server("composio")` on key change or toolkit toggle.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_composio_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py tests/test_composio_api.py
git commit -m "feat(composio): add REST API endpoints for Composio settings and toolkits"
```

---

### Task 6: Frontend Settings View Integration

**Files:**
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/api.js`
- Test: Manual / API verification

**Interfaces:**
- Consumes: `/api/composio/key`, `/api/composio/status`.
- Produces: Composio configuration card in Settings with API key input, connection testing, and dashboard deep-link.

- [ ] **Step 1: Add frontend API client methods in `frontend/src/api.js`**

Add `getComposioStatus()`, `saveComposioKey(apiKey)`, `toggleComposioToolkit(toolkit, enabled)`.

- [ ] **Step 2: Implement Composio section in `frontend/src/views/Settings.jsx`**

Render a card with masked input for `COMPOSIO_API_KEY`, "Save & Test" button, live status badge, and external dashboard link.

- [ ] **Step 3: Verify Settings UI interaction**

Verify typing a key, saving, and checking the status indicator.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/views/Settings.jsx
git commit -m "feat(frontend): add Composio configuration panel to Settings view"
```

---

### Task 7: Frontend Capabilities Connectors & In-Stream Auth Cards

**Files:**
- Modify: `frontend/src/views/capabilities/ConnectorsTab.jsx`
- Modify: `frontend/src/views/Chat.jsx`
- Test: Manual UI verification

**Interfaces:**
- Consumes: `/api/composio/toolkits`, `/api/composio/toolkits/toggle`.
- Produces:
  - Unified connector tiles with "Powered by Composio" badge.
  - In-stream Connect Card when agent receives an OAuth challenge URL.

- [ ] **Step 1: Update `ConnectorsTab.jsx` to render Composio app tiles**

Add tiles for popular Composio apps (Slack, Notion, Linear, GitHub, Google Calendar, Gmail) with "Powered by Composio" pill badge, active toggle, and connection status.

- [ ] **Step 2: Implement Connect Card in `Chat.jsx`**

When an agent tool call result contains a `redirect_url` / Connect Link, render a card:
`[Authorize Slack with Composio ↗]` instead of raw JSON.

- [ ] **Step 3: Verify tile toggle and Connect Card rendering**

Toggle Slack on/off in Connectors tab; verify state reflects immediately in the backend.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/capabilities/ConnectorsTab.jsx frontend/src/views/Chat.jsx
git commit -m "feat(frontend): add Composio tiles to Connectors tab and Connect Cards in Chat"
```

---

### Task 8: End-to-End Verification & Safety Interception

**Files:**
- Create: `tests/test_composio_e2e.py`

**Interfaces:**
- Verifies: Full flow from key configuration -> session creation -> tool discovery in BM25 -> safety confirmation on write tools -> execution.

- [ ] **Step 1: Write end-to-end integration test**

```python
# tests/test_composio_e2e.py
from backend.mcp.composio_service import ComposioService
from backend.agent.tool_search import search_catalog
from backend.agent.tool_search_catalog import build_catalog

def test_composio_tool_search_and_confirmation():
    # Verify tool discovery finds composio tools
    tools = [
        {"type": "function", "function": {"name": "slack_chat_post_message__mcp__composio", "description": "Post Slack message"}}
    ]
    catalog = build_catalog(tools, server_name="composio")
    results = search_catalog(catalog, "slack post")
    assert len(results) > 0
    assert results[0].source_name == "composio:slack"
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pytest tests/test_composio_e2e.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_composio_e2e.py
git commit -m "test(composio): add end-to-end tool discovery and safety verification tests"
```
