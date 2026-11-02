# Design Spec: Unified Composio Connectivity Across Today Widgets and Mail

**Date:** 2026-11-02  
**Status:** Approved  
**Author:** Pair programming with Wayne  

---

## 1. Problem Statement

1. **Today Dashboard Widgets**:
   - Widgets backed by Composio (such as `comm.unread`, `need.inbox`, `task.agenda`, `glance.travel`) fail or display "cooling down / unavailable / disabled".
   - Primary causes:
     - Provider timeout in `backend/dashboard/service.py` is hardcoded to 10 seconds for general widgets. Composio cloud tool execution over the network regularly requires 12–16 seconds. The 10s cutoff aborts execution mid-flight.
     - Aborted execution increments failure counters in `dashboard_connector_health`. When failures reach 3, exponential backoffs are applied. Once `retry_at` is set, `backend/dashboard/service.py` sets `RETRY_AFTER = time.monotonic() + 900` (15 minutes), locking the widget in a cooling-down / error state.
     - `get_enabled_toolkits()` in `backend/mcp/composio_service.py` reads a static list from SQLite `composio_state`. Connected accounts present in Composio (such as Google Calendar `ca_EQ-TH5P5mdWb`) that were not explicitly written to `enabled_toolkits` are treated as "disabled" by `health()` and rejected by `_read()`.
     - Arbitrary cross-widget gate in `connectors.py`: reading Google Calendar requires `task.agenda` to be enabled, blocking other calendar widgets (like `glance.travel` and `glance.next-event`).
     - No circuit reset on manual user refresh: pressing "Refresh" does not clear previous backoff timestamps.

2. **Mail Section (`/mail`)**:
   - The `/mail` backend in `backend/mail/gmail.py` and `backend/api/main.py` only reads local credentials from `~/.google_workspace_mcp/credentials/<address>.json`.
   - When a user connects Gmail via Composio rather than a local Google Workspace MCP server, `/api/mail/account` reports `"No Google account is signed in."` and `/api/mail/threads` fails with 409 `MailUnavailable`.

---

## 2. Goals & Non-Goals

### Goals
- Ensure all Today widgets requiring Composio (email, calendar, GitHub, Slack) smoothly fetch live data without false timeouts or permanent cooling-down states.
- Automatically consider toolkits with active connected accounts in Composio as enabled, eliminating the "disabled" state for active accounts.
- Provide automatic circuit recovery and forced refresh capabilities so users are never stuck in backoff after transient network delays.
- Decouple calendar access so any calendar widget can fetch events regardless of `task.agenda` status.
- Add a Composio adapter to `backend/mail/gmail.py` so `/mail` transparently functions with connected Composio accounts when local Google Workspace credentials are not present.

### Non-Goals
- Replacing local MCP servers: local MCP remains the advanced self-hosted option with provider ownership precedence.
- Writing raw connector emails to shared databases: only structured thread projections enter the UI cache.

---

## 3. Architecture & Data Flow

### 3.1 Today Dashboard Service Flow

```mermaid
flowchart TD
    W[Today Widgets] -->|GET /api/widgets/{id}/data or POST /refresh| S[backend/dashboard/service.py]
    S --> C[backend/dashboard/connectors.py]
    C --> AC[composio_service.get_connections_async]
    AC -->|Union with active accounts| ET[composio_service.get_enabled_toolkits]
    C --> H[dashboard_connector_health]
    H -->|Auto-reset on force=True| FL[MCPManager Fast-Lane]
    FL -->|30s timeout| Comp[Composio Cloud MCP Endpoint]
    Comp --> Cache[widget_cache SQLite]
    Cache --> UI[Widget Presentation: Live Data]
```

1. **Timeout Allocation**:
   - Any widget whose manifest `source` contains a `composio` toolkit receives a 30-second timeout in `service.refresh()`, matching real-world cloud roundtrip latency.
2. **Auto-Synchronization of Toolkits**:
   - `composio_service.get_enabled_toolkits()` dynamically unions persisted toolkits with keys from `composio_service.get_connections()`. Any connected account is treated as enabled.
3. **Circuit Reset on Manual Refresh**:
   - When `force=True` (manual refresh triggered by user or UI action):
     - `connectors.reconcile()` clears `failures=0` and `retry_at=0` for the relevant toolkit.
     - `service.schedule()` clears `RETRY_AFTER[(db, widget_id)]`.

### 3.2 Cross-Widget Gate Removal
- In `backend/dashboard/connectors.py` (`_read` and `service.py`), remove `toolkit == "googlecalendar" and not access_enabled("task.agenda")`.
- Calendar widgets check their own `access_enabled(widget_id)` only.

### 3.3 Mail Section Composio Bridge

```mermaid
flowchart TD
    Client[frontend/src/views/Mail.jsx] --> Endpoints[/api/mail/account & /api/mail/threads]
    Endpoints --> GmailMod[backend/mail/gmail.py]
    GmailMod --> CredCheck{Local credentials in ~/.google_workspace_mcp?}
    CredCheck -->|Yes| LocalMCP[Direct Google Workspace OAuth]
    CredCheck -->|No| CompCheck{is_provider_owned_by_composio('gmail')?}
    CompCheck -->|Yes| CompAdapter[Composio Gmail Adapter via MCPManager]
    CompAdapter --> Projection[Thread & Message Projections]
    CompCheck -->|No| Unavail[MailUnavailable: No Google Account Connected]
```

- When local credentials are not found:
  - `accounts()`: Retrieves the connected Gmail account details from `composio_service.get_connections()["gmail"]`. Returns `MailAccount(address=email, can_send=True, can_modify=True)`.
  - `threads(q, limit)`: Dispatches `GMAIL_FETCH_EMAILS` through `MCPManager` or fast-lane handler, grouping individual messages into thread objects matching the schema expected by `Mail.jsx`:
    ```json
    {
      "id": "threadId",
      "subject": "Subject Line",
      "snippet": "...",
      "date": "2026-11-02T14:45:25Z",
      "from": "Sender Name <sender@example.com>",
      "unread": true,
      "labels": ["INBOX", "UNREAD"],
      "message_count": 1
    }
    ```
  - `thread(thread_id)`: Fetches thread messages and formats the body, headers, and attachments.
  - `reply(thread_id, body)`: Dispatches `GMAIL_REPLY_TO_THREAD`.

---

## 4. Components & Detailed Changes

### 4.1 `backend/mcp/composio_service.py`
- Modify `get_enabled_toolkits()`:
  - Combine persisted `enabled_toolkits` with active connection slugs from `self.get_connections()`.
  - Ensures toolkits with active connected accounts are never marked "disabled".

### 4.2 `backend/dashboard/connectors.py`
- In `_read()`:
  - Remove `toolkit == "googlecalendar" and not access_enabled("task.agenda")`.
  - On start of turn or when `force=True`, clear `retry_at` if the cooldown timestamp has passed.
- In `health()`:
  - An account with an active connection is marked `"connected"` rather than `"disabled"`.
  - When `force=True`, if `retry_at <= time.time()`, reset `failures=0` and `retry_at=0`.

### 4.3 `backend/dashboard/service.py`
- In `refresh()`:
  - Extend `wait_for` timeout to 30 seconds for connector-backed widgets:
    ```python
    is_connector_widget = any(
        s.get("type") == "composio"
        for s in (sources if isinstance(sources, list) else [sources])
    )
    timeout = 60 if widget_id in LONG_RUNNING_WIDGETS else (30 if is_connector_widget else 10)
    ```
  - On `force=True` in `schedule()`, remove `key` from `RETRY_AFTER`.

### 4.4 `backend/mail/gmail.py`
- Add Composio fallback functions:
  - `_composio_accounts()` -> list of `MailAccount`
  - `_composio_threads(q, limit)` -> list of thread dicts
  - `_composio_thread(thread_id)` -> thread detail dict with messages
  - `_composio_reply(thread_id, body)` -> reply execution
- Integrate transparently into `accounts()`, `threads()`, `thread()`, and `reply()`:
  - If local credentials directory has no credentials, seamlessly call the Composio fallback if `is_provider_owned_by_composio("gmail")`.

---

## 5. Error Handling & Edge Cases

1. **Cold Start & Revalidation**:
   - `get_connections_async()` returns cached good connections while background revalidation executes, preventing UI blocking.
2. **Circuit Recovery**:
   - Explicit user refresh clears failure locks immediately, avoiding the 15-minute wait.
3. **Empty Mailboxes vs. Error**:
   - Empty mail results return `{"messages": []}` and widget state `"empty"`, distinct from `"error"` or `"not-connected"`.

---

## 6. Verification Plan

1. **Automated Tests**:
   - Run existing dashboard tests: `pytest tests/test_dashboard_connectors.py`.
   - Add test cases verifying:
     - Active accounts are in `get_enabled_toolkits()`.
     - Connector-backed widgets receive 30s timeout.
     - Circuit breaker resets on forced refresh.
     - Mail service falls back to Composio when local credentials absent.
2. **Live System Verification**:
   - `curl http://localhost:8000/api/connectors/health`: Confirm `gmail` and `googlecalendar` both report status `"connected"`.
   - `POST /api/widgets/comm.unread/refresh`: Verify 200 OK with messages populated.
   - `POST /api/widgets/task.agenda/refresh`: Verify 200 OK with calendar events populated.
   - `GET /api/mail/account`: Verify email address returned from Composio.
   - `GET /api/mail/threads`: Verify live threads returned from Composio.
