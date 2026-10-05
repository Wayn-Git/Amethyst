# Connectors: Clean Split Local vs Composio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a clean ownership split between local MCP and Composio hosted connectors, enforce honest UI states (no fake "Active" rows), deduplicate tool schemas, provide instructional error guards, and recommend Composio by default in onboarding.

**Architecture:** Connectors are split cleanly between local MCP (for no-auth, API keys, and advanced self-hosted apps) and Composio (for hosted OAuth). Real active connections from Composio drive provider readiness; duplicate tools are suppressed at schema generation; unauthenticated tool calls are refused with actionable guidance instructions.

**Tech Stack:** Python 3.12 (FastAPI, Composio SDK v0.22+, SQLite, pytest), React 18 (Vite, Framer Motion, Tailwind/CSS modules).

**Spec:** [`docs/superpowers/specs/2026-10-05-connectors-clean-split-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-05-connectors-clean-split-design.md)

## Global Constraints

- Never register a provider under both Local and Composio at the same time.
- No Composio row or tool may show `Active` or be offered to the model without a verified connected account.
- When Composio is unconfigured, render exactly one honest card in the Connectors tab; no per-provider rows.
- Dispatch guards on unauthenticated connectors must name the screen, button, and state: "Do not retry this tool."
- Preserve the self-hosted / local OAuth path as a first-class advanced option.

## Review Focus

- Unconfigured Composio state in ConnectorsTab: must render 1 honest card and 0 provider rows.
- Partial connection state: only connected toolkits (e.g. Slack connected, Gmail disconnected) show `Active` and schemas; disconnected toolkits show `Connect` button and their tools are withheld from `schemas()`.
- Active Local overrides Composio: when local `google-workspace` is signed in, Composio `gmail` and `googlecalendar` are hidden and withheld.
- Instructional error guard: calling `gmail_send_message__mcp__composio` when disconnected returns `composio_sign_in_instruction` with "Do not retry".
- Composio API errors or network drops: failing to reach Composio during connection checks degrades gracefully without crashing the turn or the tab.

---

### Task 1: Composio Service Real Connections & Authorization

**Files:**
- Modify: `backend/mcp/composio_service.py`
- Modify: `backend/api/main.py:4587-4675`
- Test: `tests/test_composio_service.py`

**Interfaces:**
- Produces: `composio_service.get_connections() -> dict[str, dict[str, Any]]`
- Produces: `composio_service.initiate_connection(toolkit: str) -> str`
- Produces: `POST /api/composio/toolkits/{toolkit}/connect` returning `{"redirect_url": str}`
- Produces: `GET /api/composio/connections` returning `{"connections": dict}`

- [ ] **Step 1: Write failing tests for `get_connections` and `initiate_connection`**

In `tests/test_composio_service.py`:
```python
def test_get_connections_empty_when_unconfigured(monkeypatch):
    from backend.mcp.composio_service import composio_service
    monkeypatch.setattr(composio_service, "is_configured", lambda: False)
    assert composio_service.get_connections() == {}

def test_get_connections_returns_active_accounts(monkeypatch):
    from backend.mcp.composio_service import composio_service
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    
    class DummyItem:
        status = "ACTIVE"
        id = "ca_123"
        created_at = "2026-10-05T00:00:00Z"
        class toolkit:
            slug = "slack"
            
    class DummyResp:
        items = [DummyItem()]
        
    class DummyClient:
        class connected_accounts:
            @staticmethod
            def list(*args, **kwargs):
                return DummyResp()
                
    monkeypatch.setattr(composio_service, "_get_client", lambda: DummyClient())
    conns = composio_service.get_connections()
    assert "slack" in conns
    assert conns["slack"]["id"] == "ca_123"

def test_initiate_connection_returns_redirect_url(monkeypatch):
    from backend.mcp.composio_service import composio_service
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    
    class DummyReq:
        redirect_url = "https://connect.composio.dev/auth/123"
        
    class DummyClient:
        class toolkits:
            @staticmethod
            def authorize(*args, **kwargs):
                return DummyReq()
                
    monkeypatch.setattr(composio_service, "_get_client", lambda: DummyClient())
    url = composio_service.initiate_connection("gmail")
    assert url == "https://connect.composio.dev/auth/123"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_service.py -k "test_get_connections or test_initiate_connection" -v`  
Expected: FAIL (methods not implemented)

- [ ] **Step 3: Implement `get_connections` and `initiate_connection` in `backend/mcp/composio_service.py`**

Implement `get_connections(self) -> dict[str, dict[str, Any]]` with 5-second TTL cache, and `initiate_connection(self, toolkit: str) -> str`.

- [ ] **Step 4: Add endpoints in `backend/api/main.py`**

Add `GET /api/composio/connections`, `POST /api/composio/toolkits/{toolkit}/connect`, and update `GET /api/composio/toolkits` to include `connected: slug in connections`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_composio_service.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/mcp/composio_service.py backend/api/main.py tests/test_composio_service.py
git commit -m "feat(mcp): add composio get_connections and initiate_connection"
```

---

### Task 2: Provider Deduplication & Ownership Matrix

**Files:**
- Create: `backend/mcp/provider_ownership.py`
- Modify: `backend/api/main.py`
- Test: `tests/test_connector_ownership.py`

**Interfaces:**
- Consumes: `composio_service.get_connections()`
- Produces: `is_provider_overridden_by_local(toolkit_slug: str) -> bool`
- Produces: `get_active_local_providers() -> set[str]`

- [ ] **Step 1: Write failing test in `tests/test_connector_ownership.py`**

```python
def test_local_google_workspace_overrides_composio_gmail(monkeypatch):
    from backend.mcp.provider_ownership import is_provider_overridden_by_local
    from backend.mcp.config import ServerConfig, Source, Transport
    
    dummy_servers = {
        "google-workspace": ServerConfig(
            name="google-workspace",
            enabled=True,
            transport=Transport.STDIO,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr("backend.mcp.commands.is_signed_in", lambda cfg: True if cfg.name == "google-workspace" else False)
    
    assert is_provider_overridden_by_local("gmail") is True
    assert is_provider_overridden_by_local("googlecalendar") is True
    assert is_provider_overridden_by_local("slack") is False

def test_unauthenticated_local_does_not_override_composio(monkeypatch):
    from backend.mcp.provider_ownership import is_provider_overridden_by_local
    from backend.mcp.config import ServerConfig, Source, Transport
    
    dummy_servers = {
        "google-workspace": ServerConfig(
            name="google-workspace",
            enabled=True,
            transport=Transport.STDIO,
            source=Source.CONFIGURED,
        )
    }
    monkeypatch.setattr("backend.mcp.config.load_servers", lambda: dummy_servers)
    monkeypatch.setattr("backend.mcp.commands.is_signed_in", lambda cfg: False)
    
    assert is_provider_overridden_by_local("gmail") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_connector_ownership.py -v`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `backend/mcp/provider_ownership.py`**

Define `PROVIDER_MAPPING`:
- `gmail`: `{"google-workspace", "google-gmail"}`
- `googlecalendar`: `{"google-workspace", "google-calendar"}`
- `github`: `{"github"}`
- `spotify`: `{"spotify"}`

Implement `get_active_local_providers() -> set[str]` and `is_provider_overridden_by_local(toolkit_slug: str) -> bool`. Update `GET /api/composio/toolkits` to annotate `overridden_by_local`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_connector_ownership.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mcp/provider_ownership.py backend/api/main.py tests/test_connector_ownership.py
git commit -m "feat(mcp): add provider ownership mapping and deduplication logic"
```

---

### Task 3: Tool Schema Filtering & Instructional Dispatch Guards

**Files:**
- Modify: `backend/mcp/guidance.py`
- Modify: `backend/tools/registry.py`
- Modify: `backend/agent/director.py`
- Test: `tests/test_composio_dispatch_guard.py`

**Interfaces:**
- Consumes: `provider_ownership.is_provider_overridden_by_local`, `composio_service.get_connections()`
- Produces: `guidance.composio_sign_in_instruction(toolkit: str) -> str`
- Produces: `registry.schemas()` filtering out unconnected / overridden Composio tools
- Produces: `registry.dispatch()` refusing unconnected Composio tool calls with instructions

- [ ] **Step 1: Write failing test in `tests/test_composio_dispatch_guard.py`**

```python
import pytest
from backend.tools.base import Tool, ToolContext, ToolResult, ToolSource, RiskLevel
from backend.tools.registry import ToolRegistry

@pytest.mark.asyncio
async def test_composio_unconnected_tool_withheld_from_schemas(monkeypatch):
    from backend.mcp.composio_service import composio_service
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {"slack": {"status": "ACTIVE"}})
    
    registry = ToolRegistry()
    registry.register(Tool(
        name="slack_send__mcp__composio",
        description="send slack message",
        parameters={},
        handler=lambda args, ctx: ToolResult.text("ok"),
        risk=RiskLevel.LOW,
        source=ToolSource.MCP,
        server_name="composio"
    ))
    registry.register(Tool(
        name="gmail_send__mcp__composio",
        description="send gmail message",
        parameters={},
        handler=lambda args, ctx: ToolResult.text("ok"),
        risk=RiskLevel.LOW,
        source=ToolSource.MCP,
        server_name="composio"
    ))
    
    schemas = registry.schemas()
    schema_names = [s.name for s in schemas]
    assert "slack_send__mcp__composio" in schema_names
    assert "gmail_send__mcp__composio" not in schema_names

@pytest.mark.asyncio
async def test_composio_unconnected_dispatch_returns_instruction(monkeypatch):
    from backend.mcp.composio_service import composio_service
    monkeypatch.setattr(composio_service, "is_configured", lambda: True)
    monkeypatch.setattr(composio_service, "get_connections", lambda: {})
    
    registry = ToolRegistry()
    registry.register(Tool(
        name="gmail_send__mcp__composio",
        description="send gmail message",
        parameters={},
        handler=lambda args, ctx: ToolResult.text("ok"),
        risk=RiskLevel.LOW,
        source=ToolSource.MCP,
        server_name="composio"
    ))
    
    ctx = ToolContext(conversation_id="conv_1")
    result = await registry.dispatch("gmail_send__mcp__composio", {}, ctx)
    assert result.success is False
    assert "composio:gmail" in result.output
    assert "Do not retry" in result.output
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_composio_dispatch_guard.py -v`  
Expected: FAIL

- [ ] **Step 3: Update `backend/mcp/guidance.py`**

Add `composio_sign_in_instruction(toolkit: str) -> str`.  
Update `ready_connectors_block()` to list active Composio toolkits as `composio:<toolkit>` instead of a monolithic `composio` entry.

- [ ] **Step 4: Update `backend/tools/registry.py`**

- In `registry.schemas()`: filter out any `composio` tool whose extracted toolkit is overridden by local or not present in `composio_service.get_connections()`.
- In `registry.dispatch()`: intercept `composio` tools. If Composio is not configured or the toolkit is not in `get_connections()`, return `ToolResult.error(guidance.composio_sign_in_instruction(toolkit))`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_composio_dispatch_guard.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/mcp/guidance.py backend/tools/registry.py tests/test_composio_dispatch_guard.py
git commit -m "feat(mcp): filter unconnected composio tools in schemas and add instructional dispatch guard"
```

---

### Task 4: Connectors Tab UI (Honest State & One-Click OAuth)

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/views/capabilities/ConnectorsTab.jsx`

**Interfaces:**
- Produces: `api.connectComposioToolkit(slug: string)` calling `POST /api/composio/toolkits/${slug}/connect`
- Produces: `api.composioConnections()` calling `GET /api/composio/connections`
- Produces: Honest single card when unconfigured, no fake Active tags, Connect button for inactive providers.

- [ ] **Step 1: Add frontend API methods in `frontend/src/api.js`**

```javascript
connectComposioToolkit: (slug) =>
  j(`/composio/toolkits/${encodeURIComponent(slug)}/connect`, json('POST')),
composioConnections: () => j('/composio/connections'),
```

- [ ] **Step 2: Update `frontend/src/views/capabilities/ConnectorsTab.jsx`**

- When `!composioStatus?.configured`:
  Render a single honest card with `dashboard.composio.dev/settings` link and shortcut to Settings. No per-provider rows.
- When `composioStatus?.configured`:
  - Show "Active" pill with green dot **only** if `item.connected === true`.
  - Show "Connect" button for disconnected toolkits.
  - Clicking "Connect": calls `api.connectComposioToolkit(item.slug)`, gets `res.redirect_url`, opens via `window.open(res.redirect_url, '_blank')`, and refreshes connection state.
  - Hide toolkits where `item.overridden_by_local === true`.

- [ ] **Step 3: Verify frontend compilation**

Run: `npm --prefix frontend run build`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/views/capabilities/ConnectorsTab.jsx
git commit -m "feat(ui): render honest composio state in connectors tab with one-click oauth"
```

---

### Task 5: Onboarding & Settings Alignment

**Files:**
- Modify: `frontend/src/components/SplashScreenWizard.jsx:1120-1230`
- Modify: `frontend/src/views/Settings.jsx:522-610`

**Interfaces:**
- `StepConnectors` in `SplashScreenWizard.jsx`: recommends Composio by default for OAuth apps (Gmail, Slack, GitHub, Linear, Notion) with free tier callout, while keeping self-hosted OAuth under an Advanced accordion.
- `Settings.jsx`: surfaces free tier limits, supported toolkits list, and active connected accounts.

- [ ] **Step 1: Update `SplashScreenWizard.jsx` (`StepConnectors`)**

- Split into two visual sections:
  1. **Hosted OAuth via Composio (Recommended, Zero Setup)**:
     - Clear description: "Zero manual OAuth console setup. 100+ integrations with free tier included."
     - If Composio is not configured: display a quick API key entry field with link to `dashboard.composio.dev/settings`.
  2. **Self-hosted / Local-first (Advanced)**:
     - Foldable/accessible list of local MCP servers (Google Workspace, GitHub, Spotify) with note: "Requires setting up your own OAuth client ID and secret in developer consoles."

- [ ] **Step 2: Update `Settings.jsx` (Cloud Integrations section)**

- Document free-tier details: "Composio hosted OAuth (free tier: generous monthly calls, zero cloud console configuration)."
- Display active connected accounts when configured with timestamps and direct management link to Composio dashboard.

- [ ] **Step 3: Verify frontend compilation**

Run: `npm --prefix frontend run build`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SplashScreenWizard.jsx frontend/src/views/Settings.jsx
git commit -m "feat(ui): align onboarding wizard and cloud integrations settings with composio defaults"
```

---

### Task 6: Documentation & Verification

**Files:**
- Modify: `docs/architecture/connectors.md`

- [ ] **Step 1: Update `docs/architecture/connectors.md`**

Add section: **"Ownership: Local vs. Composio Split"**:
- The ownership split table (local-first vs. hosted OAuth).
- The deduplication rule and dynamic precedence.
- The instructional error contract for cloud tools (`composio_sign_in_instruction`).
- Honest UI states and onboarding philosophy.

- [ ] **Step 2: Run backend test suite**

Run: `pytest tests/test_composio*.py tests/test_connector*.py -v`  
Expected: All tests PASS.

- [ ] **Step 3: Run frontend build check**

Run: `npm --prefix frontend run build`  
Expected: Build PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/connectors.md
git commit -m "docs: document local vs composio ownership split and deduplication rules"
```
