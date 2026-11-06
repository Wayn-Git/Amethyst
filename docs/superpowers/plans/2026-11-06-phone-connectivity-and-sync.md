# Phone Connectivity & Long-Lasting Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver rock-solid, long-lasting phone-PC connection and synchronization with dual transport (Direct LAN + Cloudflare Relay fallback), zero Cloudflare D1 quota leakage, and Happy-inspired mobile companion UI.

**Architecture:** A client-side `TransportManager` probes LAN availability (`/api/remote/status`) with a 1.5s timeout; when home on Wi-Fi it uses Direct LAN (0 cloud cost), and when away on cellular it seamlessly flips to end-to-end encrypted Cloudflare Worker `/ops`. Lifecycle hooks pause all polling when phone screen is locked/hidden, and a durable outbox queue guarantees zero-loss intent delivery. The mobile shell is revamped with Happy's ergonomic status pill, diagnostics modal, and interactive tool approval cards.

**Tech Stack:** JavaScript (ES modules, React, Fastify/FastAPI remote routes, Web Crypto AES-256-GCM), Cloudflare Worker D1 relay, Vitest / Pytest.

**Spec:** `docs/superpowers/specs/2026-11-06-phone-connectivity-and-sync-design.md`

## Global Constraints

- Never republish unchanged database rows on watermark sweep.
- Cloudflare D1 daily read queries must remain strictly under 5,000 queries/day.
- When `document.visibilityState === 'hidden'`, all polling must cease immediately.
- A direct LAN fetch failure must never block or halt Cloudflare relay sync.
- Every remote action must pass `backend/security/remote_access.py` permissions gate.
- Mobile interactive tap targets must measure $\ge 44 \times 44$ px with WCAG AA contrast.

## Review Focus

1. **LAN connection drops mid-turn**: Verify seamless failover to Cloudflare relay within 1.5s without throwing unhandled exceptions or resetting transcript.
2. **Phone locked in pocket for 8 hours**: Verify network tab / D1 metrics show 0 polling requests while phone screen is off.
3. **Airplane mode user prompts**: Verify prompt persists in durable local outbox and auto-flushes immediately when connectivity returns.
4. **Device unpairing from PC**: Verify 401 response from sync clears local key from IndexedDB and displays Disconnected screen with "Pair again".
5. **Tool approval prompt while away from home**: Verify tool confirmation card renders cleanly on phone via relay, and one-tap Approve/Deny executes on PC host.

---

### Task 1: Create Dual-Path `TransportManager`

**Files:**
- Create: `frontend/src/lib/sync/transportManager.js`
- Test: `frontend/src/lib/sync/__tests__/transportManager.test.js`

**Interfaces:**
- Produces:
  - `class TransportManager`:
    - `constructor({ getHostUrl, getRelayUrl, getToken, onStateChange })`
    - `probe(): Promise<'direct' | 'relayed'>`
    - `getState(): { path: 'direct'|'relayed'|'offline', latency: number, lastProbe: number, hostUrl: string, relayUrl: string }`
    - `request(path, options): Promise<Response>`
    - `startAutoProbe(intervalMs?: number): void`
    - `stopAutoProbe(): void`

- [ ] **Step 1: Write test for `TransportManager`**
Create `frontend/src/lib/sync/__tests__/transportManager.test.js` testing LAN probe success -> `direct`, probe timeout/failure -> `relayed`, and state change callbacks.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm --prefix frontend test frontend/src/lib/sync/__tests__/transportManager.test.js` (or node runner). Verify module missing.

- [ ] **Step 3: Implement `frontend/src/lib/sync/transportManager.js`**
Implement `TransportManager` with 1,500ms abort controller probe against `${hostUrl}/api/remote/status`, fallback to `relayed`, latency tracking, and event emission.

- [ ] **Step 4: Run test to verify it passes**
Verify test passes cleanly.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/sync/transportManager.js frontend/src/lib/sync/__tests__/transportManager.test.js
git commit -m "feat(sync): add dual-path TransportManager with LAN probe and failover"
```

---

### Task 2: Quota-Safe Adaptive Polling & Visibility Sleep in `useSync.js`

**Files:**
- Modify: `frontend/src/lib/sync/useSync.js`
- Test: `frontend/src/lib/sync/__tests__/useSync.test.js`

**Interfaces:**
- Consumes: `sync()` and `queued()` from `client.js`
- Produces:
  - `useSync(enabled, onPreferences)`:
    - Halts timer on `visibilitychange` -> `hidden`.
    - Fires immediate single `tick()` on `visibilitychange` -> `visible`.
    - Implements adaptive timing: 3s on active work (max 30s burst), 30s on idle, exponential backoff with jitter on error.

- [ ] **Step 1: Write unit test for visibility sleep and adaptive backoff**
Test that `document.visibilityState = 'hidden'` halts polling timers, and visibility `'visible'` immediately triggers a catch-up poll.

- [ ] **Step 2: Run test to verify it fails**
Verify failure against current `useSync.js`.

- [ ] **Step 3: Implement visibility sleep and adaptive cadence in `frontend/src/lib/sync/useSync.js`**
Update `useSync.js` to strictly enforce zero-polling during `hidden` state and smart backoff.

- [ ] **Step 4: Run test to verify it passes**
Verify test passes.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/sync/useSync.js frontend/src/lib/sync/__tests__/useSync.test.js
git commit -m "fix(sync): enforce visibility sleep and adaptive backoff in useSync"
```

---

### Task 3: Decouple LAN Calls and Integrate Transport in `client.js` and `Companion.jsx`

**Files:**
- Modify: `frontend/src/lib/sync/client.js`
- Modify: `frontend/src/mobile/Companion.jsx`
- Modify: `frontend/src/dashboard/api.js`

**Interfaces:**
- Consumes: `TransportManager`
- Produces:
  - `requestRemote(path, method, body)` in `dashboard/api.js`: uses `TransportManager` to route directly if LAN reachable, or graceful no-op/relay fallback if away.
  - `Companion.jsx` `refresh()`: calls `sync()` directly without being blocked behind a failing `request('/remote/capabilities')`.

- [ ] **Step 1: Write integration test verifying sync runs when LAN endpoint throws**
Verify that `sync()` succeeds over relay even when `request('/remote/capabilities')` fails with network error.

- [ ] **Step 2: Verify failure before fix**
Confirm current `Companion.jsx` halts on LAN error.

- [ ] **Step 3: Update `frontend/src/dashboard/api.js`, `frontend/src/lib/sync/client.js`, and `frontend/src/mobile/Companion.jsx`**
Remove blocking `await request('/remote/capabilities')`. Ensure `sync()`, `flushCaptures()`, and state queries continue regardless of LAN connection status.

- [ ] **Step 4: Verify test passes**
Confirm phone companion sync succeeds over relay when host IP is unreachable.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/dashboard/api.js frontend/src/lib/sync/client.js frontend/src/mobile/Companion.jsx
git commit -m "fix(mobile): decouple relay sync from direct LAN reachability"
```

---

### Task 4: Happy-Inspired `ConnectionDiagnosticsModal.jsx`

**Files:**
- Create: `frontend/src/mobile/ConnectionDiagnosticsModal.jsx`
- Modify: `frontend/src/mobile/companion.css`

**Interfaces:**
- Consumes: `TransportManager.getState()`, `replica.load()`, `outbox()`
- Produces:
  - `<ConnectionDiagnosticsModal open={boolean} onClose={function} />`:
    - Renders Connection Status, Transport Path (`Direct LAN` / `Cloud Relay`), Roundtrip Latency, Outbox Queue Count, Host URL, Relay URL, Last Synced timestamp.
    - Provides "Copy Diagnostics" button with clipboard write.

- [ ] **Step 1: Create `ConnectionDiagnosticsModal.jsx`**
Implement modal matching Happy's `ConnectionDiagnosticsScreen.kt` layout, token styling, and copy diagnostics action.

- [ ] **Step 2: Add styles in `frontend/src/mobile/companion.css`**
Add styles for modal backdrop, item groups, status pills, and copy button with $>44$px touch targets.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/mobile/ConnectionDiagnosticsModal.jsx frontend/src/mobile/companion.css
git commit -m "feat(mobile): add Happy-inspired ConnectionDiagnosticsModal"
```

---

### Task 5: Revamp Mobile Header, Status Pill & Tool Approvals in `Companion.jsx` & `RemoteAgent.jsx`

**Files:**
- Modify: `frontend/src/mobile/Companion.jsx`
- Modify: `frontend/src/views/remote/RemoteAgent.jsx`
- Modify: `frontend/src/mobile/companion.css`

**Interfaces:**
- Consumes: `ConnectionDiagnosticsModal`, `TransportManager`
- Produces:
  - Dynamic connection pill in Companion top bar (`🟢 Direct LAN` / `🟡 Cloud Relay` / `🔵 Reconnecting`).
  - Tapping pill opens `ConnectionDiagnosticsModal`.
  - Rich tool confirmation card in `RemoteAgent.jsx` with formatted tool args, syntax highlighting, and responsive `Approve` / `Deny` buttons.
  - Collapsible thinking / reasoning section for agent turns.

- [ ] **Step 1: Update `Companion.jsx` Header**
Add host device name, transport status pill, and diagnostics modal trigger.

- [ ] **Step 2: Update `RemoteAgent.jsx`**
Refactor tool approval card and confirmation polling: fetch approvals via Direct LAN when reachable or via synced replica/intents when relayed. Add collapsible reasoning block and auto-scroll composer.

- [ ] **Step 3: Update `companion.css` for Happy-style chat cards**
Style tool cards with clear warning accents, readable parameter blocks, and touch-friendly approval buttons.

- [ ] **Step 4: Verify frontend build**
Run: `npm --prefix frontend run build`
Ensure build compiles without errors or missing imports.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/mobile/Companion.jsx frontend/src/views/remote/RemoteAgent.jsx frontend/src/mobile/companion.css
git commit -m "feat(mobile): add transport pill, diagnostics trigger, and rich tool approval cards"
```

---

### Task 6: End-to-End Verification & Test Suite Run

**Files:**
- Test: `tests/test_sync_devices.py`
- Test: `tests/test_sync_remote_control.py`
- Test: `tests/test_sync_end_to_end.py`

- [ ] **Step 1: Run backend sync & remote control tests**
Run: `pytest tests/test_sync_devices.py tests/test_sync_remote_control.py tests/test_sync_end_to_end.py -v`
Expected: ALL PASS.

- [ ] **Step 2: Run frontend build verification**
Run: `npm --prefix frontend run build`
Expected: PASS with 0 build errors.

- [ ] **Step 3: Verify relay unit tests**
Run: `npm --prefix relay test`
Expected: ALL PASS.

- [ ] **Step 4: Final commit & documentation update**
Update `docs/agent-context/sections/remote-mobile.md` and `docs/agent-context/systems/sync.md` to record dual-transport behavior and diagnostics.
```bash
git add docs/agent-context/
git commit -m "docs(sync): update remote-mobile and sync architecture documentation"
```
