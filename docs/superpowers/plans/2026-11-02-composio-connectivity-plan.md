# Unified Composio Connectivity Across Today Widgets and Mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable smooth, reliable Composio tool integration across Today dashboard widgets (email, calendar) and the Mail section, eliminating false timeouts, permanent cooling-down states, and missing-account errors.

**Architecture:** Auto-sync active connected accounts into `get_enabled_toolkits()`, extend widget execution timeouts to 30s for cloud connector calls, implement auto-circuit reset on manual refresh, decouple calendar permissions, and build a Composio Gmail fallback adapter in `backend/mail/gmail.py`.

**Tech Stack:** Python 3.12, FastAPI, SQLite WAL, MCPManager, Composio SDK/HTTP API, Pytest.

**Spec:** [docs/superpowers/specs/2026-11-02-composio-connectivity-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-02-composio-connectivity-design.md)

## Global Constraints

- Preserve local MCP server priority: local Google Workspace/Gmail credentials always take precedence over Composio when present.
- Never write raw connector bodies to shared databases; only projected JSON enters widget and turn caches.
- Keep manifest IDs and schema contracts stable (`comm.unread`, `need.inbox`, `task.agenda`, `glance.travel`).
- All changes must be verified against live endpoints on the running desktop system.

## Review Focus

- **Active account marked disabled:** If a user connects Google Calendar in Composio, `get_enabled_toolkits()` must include `googlecalendar` so `/api/connectors/health` reports `"connected"`.
- **Connector call duration > 10s:** Multi-execute cloud tool calls taking 12–16s must not trigger `asyncio.TimeoutError` in `service.refresh()`.
- **Stuck in cooling down:** Manual widget refresh (`force=True`) must clear expired or active backoffs and `RETRY_AFTER` immediately.
- **Calendar access decoupling:** `glance.travel` or `glance.next-event` must not fail if `task.agenda` is disabled in widget settings.
- **Mail account fallback:** When `~/.google_workspace_mcp/credentials/` is empty, `/api/mail/account` and `/api/mail/threads` must return the Composio connected Gmail account and threads.

---

### Task 1: Auto-Sync Active Composio Connections into Enabled Toolkits

**Files:**
- Modify: `backend/mcp/composio_service.py:1700-1730`
- Test: `tests/test_composio_enabled_toolkits.py`

**Interfaces:**
- Consumes: `composio_service.get_connections()` -> `dict[str, dict[str, Any]]`
- Produces: `composio_service.get_enabled_toolkits() -> list[str]` (contains union of persisted toolkits and active connection slugs)

- [ ] **Step 1: Write failing test for auto-syncing active connections into enabled toolkits**

```python
# tests/test_composio_enabled_toolkits.py
from unittest.mock import patch
from backend.mcp.composio_service import composio_service

def test_active_connections_auto_included_in_enabled_toolkits():
    with patch.object(composio_service, "is_configured", return_value=True), \
         patch.object(composio_service, "get_connections", return_value={"googlecalendar": {"id": "ca_test", "status": "ACTIVE"}}), \
         patch.object(composio_service, "_enabled_toolkits_cache", None):
        toolkits = composio_service.get_enabled_toolkits()
        assert "googlecalendar" in toolkits
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_composio_enabled_toolkits.py -v`
Expected: FAIL (assertion error: "googlecalendar" not in toolkits if db only has "gmail")

- [ ] **Step 3: Update `get_enabled_toolkits()` in `backend/mcp/composio_service.py`**

In `get_enabled_toolkits()`:
Union the SQLite persisted list with keys from `self.get_connections()`:
```python
active_slugs = [tk for tk, data in self.get_connections().items() if data.get("status") == "ACTIVE" or data.get("id")]
for slug in active_slugs:
    if slug not in result:
        result.append(slug)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_composio_enabled_toolkits.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_composio_enabled_toolkits.py backend/mcp/composio_service.py
git commit -m "fix(mcp): auto-sync active connected accounts into enabled toolkits"
```

---

### Task 2: Extend Dashboard Widget Timeouts & Enable Circuit Auto-Recovery

**Files:**
- Modify: `backend/dashboard/service.py:205-230,285-325`
- Modify: `backend/dashboard/connectors.py:165-205,325-360`
- Test: `tests/test_dashboard_circuit_recovery.py`

**Interfaces:**
- Consumes: `REGISTRY[widget_id]["manifest"]["source"]`
- Produces: `connectors.reconcile(toolkit, account, force_reset=True)` and 30s timeout in `service.refresh()`

- [ ] **Step 1: Write failing test for 30s timeout and circuit breaker reset on forced refresh**

```python
# tests/test_dashboard_circuit_recovery.py
import time
from backend.dashboard.connectors import state, failed, reconcile
from backend.db.connection import transaction

def test_circuit_recovery_on_force():
    toolkit = "gmail"
    failed(toolkit, RuntimeError("timeout"))
    current = state(toolkit)
    assert current["failures"] > 0
    # Reconcile with forced reset clears failure count
    reconciled = reconcile(toolkit, {"id": "ca_test"}, force_reset=True)
    assert reconciled["failures"] == 0
    assert reconciled["retry_at"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_dashboard_circuit_recovery.py -v`
Expected: FAIL with `TypeError: reconcile() got an unexpected keyword argument 'force_reset'`

- [ ] **Step 3: Implement timeout upgrade and circuit reset**

1. In `backend/dashboard/service.py`:
   - In `refresh()`: Check if manifest source contains `type == "composio"`. If true, set timeout to 30s (unless widget is already in 60s list).
   - In `refresh()`: Remove check `if any(source.get("toolkit") == "googlecalendar" ... and not access_enabled("task.agenda"))`.
   - In `schedule()`: When `force=True`, remove `(str(paths().db), widget_id)` from `RETRY_AFTER`.
2. In `backend/dashboard/connectors.py`:
   - In `reconcile(toolkit, account, force_reset=False)`: If `force_reset=True`, reset `failures=0` and `retry_at=0` in `dashboard_connector_health`.
   - In `_read()`: Remove check `toolkit == "googlecalendar" and not access_enabled("task.agenda")`.
   - In `health()`: If account is present and status is not reauth-required, mark status as `"connected"`. When `force=True`, clear expired backoffs.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_dashboard_circuit_recovery.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_dashboard_circuit_recovery.py backend/dashboard/service.py backend/dashboard/connectors.py
git commit -m "fix(dashboard): increase connector widget timeout to 30s and enable circuit recovery"
```

---

### Task 3: Implement Composio Gmail Fallback in `backend/mail/gmail.py`

**Files:**
- Modify: `backend/mail/gmail.py`
- Test: `tests/test_mail_composio_fallback.py`

**Interfaces:**
- Consumes: `composio_service.get_connections()`, `get_manager().registry.resolve_tool("GMAIL_FETCH_EMAILS")`
- Produces: `accounts() -> list[MailAccount]`, `threads(q, limit) -> list[dict]`, `thread(id) -> dict`, `reply(id, body) -> dict`

- [ ] **Step 1: Write failing test for Composio Gmail fallback in `backend/mail/gmail.py`**

```python
# tests/test_mail_composio_fallback.py
from unittest.mock import patch
from backend.mail import accounts, threads, MailAccount

def test_mail_accounts_falls_back_to_composio():
    with patch("backend.mail.gmail.CREDENTIALS_DIR") as mock_dir, \
         patch("backend.mcp.provider_ownership.is_provider_owned_by_composio", return_value=True), \
         patch("backend.mcp.composio_service.composio_service.get_connections", return_value={"gmail": {"id": "ca_test", "status": "ACTIVE", "word_id": "test@gmail.com"}}):
        mock_dir.glob.return_value = []
        accs = accounts()
        assert len(accs) == 1
        assert isinstance(accs[0], MailAccount)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_mail_composio_fallback.py -v`
Expected: FAIL (assertion error: `len(accs) == 0`)

- [ ] **Step 3: Implement Composio Gmail fallback in `backend/mail/gmail.py`**

1. In `accounts()`:
   - When no local `.json` credentials found in `CREDENTIALS_DIR`:
   - Check `is_provider_owned_by_composio("gmail")`.
   - If true, extract email address from Composio Gmail connection (`word_id` or query user info) and return `[MailAccount(address=email, can_send=True, can_modify=True)]`.
2. In `threads(q, limit)`:
   - When local accounts absent and Composio Gmail is active, call `GMAIL_FETCH_EMAILS` via `connectors._read("comm.unread", "gmail", "GMAIL_FETCH_EMAILS", {"query": q, "max_results": limit, "verbose": False})`.
   - Group projected messages by `thread_id` and map to thread dict format expected by `/api/mail/threads` and `Mail.jsx`.
3. In `thread(thread_id)`:
   - Fetch thread messages and return thread detail structure.
4. In `reply(thread_id, body)`:
   - Dispatch `GMAIL_REPLY_TO_THREAD` via Composio tool.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mail_composio_fallback.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_mail_composio_fallback.py backend/mail/gmail.py
git commit -m "feat(mail): fall back to Composio Gmail when local workspace credentials absent"
```

---

### Task 4: Full System Verification & Parity Checks

**Files:**
- Run: `scripts/check-widget-map.py`
- Verify: Live endpoints on `http://localhost:8000`

- [ ] **Step 1: Run dashboard test suite and widget map check**

Run: `.venv/bin/pytest tests/test_dashboard_*.py -v`
Run: `.venv/bin/python scripts/check-widget-map.py`
Expected: PASS with 0 errors.

- [ ] **Step 2: Reset circuit breaker and test live connector health**

Run:
```bash
sqlite3 ~/.amethyst/amethyst.db "UPDATE dashboard_connector_health SET retry_at=0, failures=0;"
curl -s http://localhost:8000/api/connectors/health?force=true | jq '.items[] | {id, status}'
```
Expected:
- `gmail`: `"connected"`
- `googlecalendar`: `"connected"`

- [ ] **Step 3: Test live widget refresh**

Run:
```bash
curl -s -X POST http://localhost:8000/api/widgets/comm.unread/refresh | jq .
curl -s -X POST http://localhost:8000/api/widgets/task.agenda/refresh | jq .
```
Wait 2 seconds and verify `GET /api/widgets/comm.unread/data` and `GET /api/widgets/task.agenda/data` have `state: "ok"` or `"empty"` and `error: null`.

- [ ] **Step 4: Test live `/mail` endpoints**

Run:
```bash
curl -s http://localhost:8000/api/mail/account | jq .
curl -s "http://localhost:8000/api/mail/threads?limit=5" | jq .
```
Expected: Returns valid account address and email threads without 409 error.

- [ ] **Step 5: Commit and wrap up**

```bash
git commit --allow-empty -m "chore: verify live Composio connectivity across widgets and mail"
```
