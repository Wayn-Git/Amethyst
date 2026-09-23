# Desktop Reliability & Supervision (Phase 2: R7 to R11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate Amethyst desktop packaging, supervisor lifecycle, process fail-fast, keychain headless fallback, streaming Ollama model download, and device pairing origin security to production readiness.

**Architecture:** Route PyInstaller entry via `backend.cli.main()`, wire Electron supervisor exit listeners for immediate failure logging to `<userData>/logs/backend.log`, intercept window close to honor `tray.enabled`, add consented file fallback for headless Linux keychains, implement streaming proxy for Ollama model pulls, and prioritize HTTPS/relay pairing payloads.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, Electron, PyInstaller, React 19, SQLite, Keyring.

**Spec:** [`docs/superpowers/specs/2026-10-18-desktop-reliability-supervision-phase2-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-18-desktop-reliability-supervision-phase2-design.md)

## Global Constraints
- Python backend test runner: `uv run pytest <path> -v`.
- Frontend lint and checks: `cd frontend && npm run lint && node tests/theme_color_system.mjs`.
- Design System: Follow `AGENTS.md` and `index.css` tokens strictly (`--live`, `--confirm`, `--stop`, `--accent`).
- Host Isolation: Desktop supervisor must strictly bind to loopback (`127.0.0.1`), never `0.0.0.0` unintentionally.
- Security: Never downgrade from OS keychain to unencrypted file storage without explicit user consent (ADR-0012). File fallback must be created with `0o600` permissions.

## Review Focus
1. Backend exit during boot immediately cancels ping loop and displays error snippet without hanging.
2. CLI subcommands (`doctor`, `secrets`, etc.) work when passed to the packaged binary.
3. Closing the main window with `tray.enabled = 1` hides the window without killing the backend process.
4. `POST /api/ollama/pull` proxies NDJSON progress streaming without blocking or buffering the entire download.
5. `start_pairing` prioritizes HTTPS / Cloudflare relay URLs so mobile `crypto.subtle` does not throw an insecure origin error.

---

### Task 1: Route Frozen Entry through Backend CLI & Propagate Host/Port (R7)

**Files:**
- Modify: `packaging/freeze_entry.py:1-39`
- Modify: `backend/cli.py:930-990`
- Modify: `electron/main.cjs:135-165`
- Test: `tests/test_desktop_packaging.py`

**Interfaces:**
- Consumes: `backend.cli.main(argv: list[str] | None) -> int`
- Produces: Seamless CLI argument delegation and reliable loopback binding (`127.0.0.1`)

- [ ] **Step 1: Write the failing test for frozen entry routing in `tests/test_desktop_packaging.py`**

```python
def test_freeze_entry_routes_through_cli(monkeypatch):
    import sys
    import packaging.freeze_entry as fe
    
    called_argv = []
    def mock_cli_main(argv=None):
        called_argv.append(argv)
        return 0

    monkeypatch.setattr("backend.cli.main", mock_cli_main)
    monkeypatch.setattr(sys, "argv", ["amethyst-backend", "doctor"])
    fe.main()
    assert called_argv == [["doctor"]]

def test_freeze_entry_default_serve(monkeypatch):
    import sys
    import packaging.freeze_entry as fe
    
    called_argv = []
    def mock_cli_main(argv=None):
        called_argv.append(argv)
        return 0

    monkeypatch.setattr("backend.cli.main", mock_cli_main)
    monkeypatch.setattr(sys, "argv", ["amethyst-backend"])
    monkeypatch.setenv("AMETHYST_PORT", "8005")
    monkeypatch.setenv("AMETHYST_HOST", "127.0.0.1")
    fe.main()
    assert len(called_argv) == 1
    assert "serve" in called_argv[0]
    assert "--port" in called_argv[0] and "8005" in called_argv[0]
    assert "--host" in called_argv[0] and "127.0.0.1" in called_argv[0]
    assert "--no-build" in called_argv[0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_desktop_packaging.py -v`
Expected: FAIL (AttributeError or assertion failure because `freeze_entry.py` does not call `cli.main`)

- [ ] **Step 3: Update `packaging/freeze_entry.py`, `backend/cli.py`, and `electron/main.cjs`**

In `packaging/freeze_entry.py`:
- Import `from backend.cli import main as cli_main`.
- If `len(sys.argv) > 1`: forward `sys.argv[1:]` to `cli_main()`.
- Else: forward `['serve', '--port', str(port), '--host', host, '--no-build']` to `cli_main()`.

In `backend/cli.py`:
- In `_ensure_frontend`: return `True` immediately if `getattr(sys, "frozen", False)` is True.
- In `cmd_serve`: if `getattr(sys, "frozen", False)` is True, pass the FastAPI `app` instance directly to `uvicorn.run(app, ...)` instead of string `"backend.api.main:app"`.

In `electron/main.cjs`:
- Ensure `args` passes `--host 127.0.0.1` and `--port <port>` in both dev and packaged modes.
- Ensure `AMETHYST_BIND_PORT: port.toString()` and `AMETHYST_BIND_HOST: '127.0.0.1'` are present in the child process env.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_desktop_packaging.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packaging/freeze_entry.py backend/cli.py electron/main.cjs tests/test_desktop_packaging.py
git commit -m "feat(desktop): route frozen entrypoint through backend cli and isolate loopback host"
```

---

### Task 2: Electron Supervisor Fail-Fast, Log Capture, and Tray Lifecycle (R8)

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/splash.html`
- Modify: `electron/preload.cjs`
- Test: `tests/test_desktop_supervisor.py`

**Interfaces:**
- Consumes: Backend process stdout/stderr streams and exit code
- Produces: `<userData>/logs/backend.log`, fail-fast splash error rendering, tray minimization on close

- [ ] **Step 1: Write tests for supervisor exit listener, log streaming, and tray handling in `tests/test_desktop_supervisor.py`**

```python
def test_supervisor_fail_fast_and_tray_handling():
    from pathlib import Path

    main_cjs = Path("electron/main.cjs").read_text()
    assert "backendProcess.on('exit'" in main_cjs
    assert "backend.log" in main_cjs
    assert "tray.enabled" in main_cjs or "trayEnabled" in main_cjs
    assert "desktop:set-tray-enabled" in main_cjs
    assert "desktop:open-logs" in main_cjs

    splash_html = Path("electron/splash.html").read_text()
    assert "splash-log-snippet" in splash_html or "splash-error-box" in splash_html
    assert "splash-open-logs" in splash_html or "openLogs" in splash_html

    preload_cjs = Path("electron/preload.cjs").read_text()
    assert "setTrayEnabled" in preload_cjs
    assert "openLogs" in preload_cjs
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_desktop_supervisor.py -v`
Expected: FAIL

- [ ] **Step 3: Implement supervisor improvements in `electron/main.cjs`, `splash.html`, and `preload.cjs`**

- In `electron/main.cjs`:
  - Create `<userData>/logs/backend.log` stream and pipe stdout/stderr chunks to it. Maintain last 30 log lines in memory ring buffer.
  - On `backendProcess.on('exit', (code, signal))`: if `pingInterval` is running, immediately clear interval, format recent logs, and send error to `splashWindow`.
  - Add IPC handlers: `desktop:set-tray-enabled`, `desktop:open-logs` (`shell.openPath(logsDir)`).
  - In `mainWindow.on('close', (e))`: if `trayEnabled && !isQuitting`, `e.preventDefault()` and `mainWindow.hide()`.
- In `electron/splash.html`:
  - Add log snippet display container `<pre id="splash-log-snippet" class="splash-log-snippet">` and an **"Open Logs"** button.
- In `electron/preload.cjs`:
  - Expose `setTrayEnabled(enabled)` and `openLogs()` on `window.amethystDesktop` and `window.electronSplash`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_desktop_supervisor.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main.cjs electron/splash.html electron/preload.cjs tests/test_desktop_supervisor.py
git commit -m "feat(desktop): implement fail-fast supervisor exit handling, log capture, and tray lifecycle"
```

---

### Task 3: Consented Keychain Headless Fallback (R9)

**Files:**
- Modify: `backend/setup_status.py:60-88`
- Modify: `backend/secrets.py:100-195`
- Modify: `backend/api/main.py`
- Create: `tests/test_keychain_fallback.py`

**Interfaces:**
- Consumes: `keyring.get_keyring()`, `app_settings`
- Produces: `POST /api/setup/keychain/fallback` endpoint and accurate `check_keychain()` writability status

- [ ] **Step 1: Write test for keychain probe and consented fallback in `tests/test_keychain_fallback.py`**

```python
import pytest
from starlette.testclient import TestClient
from backend.api.main import app
from backend.setup_status import check_keychain

def test_check_keychain_detects_fail_backend(monkeypatch):
    class MockFailKeyring:
        priority = 0
    import keyring
    monkeypatch.setattr(keyring, "get_keyring", lambda: MockFailKeyring())
    monkeypatch.delenv("AMETHYST_SECRETS_FILE", raising=False)
    
    status = check_keychain()
    assert status["writable"] is False
    assert status["fallback_available"] is True

def test_keychain_fallback_activation(tmp_path, monkeypatch):
    test_secrets = tmp_path / "secrets.json"
    monkeypatch.setenv("AMETHYST_SECRETS_FILE", str(test_secrets))
    
    with TestClient(app) as client:
        resp = client.post("/api/setup/keychain/fallback", json={"consent": True})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["storage_type"] == "file"
        assert test_secrets.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_keychain_fallback.py -v`
Expected: FAIL with 404 Not Found on `/api/setup/keychain/fallback`

- [ ] **Step 3: Implement accurate probe in `backend/setup_status.py` and fallback activation in `backend/api/main.py`**

- In `backend/setup_status.py`:
  - In `check_keychain()`: check if `_store()` is `_FileStore`. If `_keyring()`, inspect `keyring.get_keyring()`. If priority <= 0 or dry-run write fails with `NoKeyringError`, return `writable: False, storage_type: "none", fallback_available: True`.
- In `backend/api/main.py`:
  - Add route `POST /api/setup/keychain/fallback`:
    - Validates consent boolean.
    - Creates `~/.amethyst/secrets.json` (or `AMETHYST_SECRETS_FILE`) with `0o600` permissions.
    - Writes `keychain.fallback_consented = 1` into SQLite `app_settings`.
    - Activates `_FileStore`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_keychain_fallback.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/setup_status.py backend/secrets.py backend/api/main.py tests/test_keychain_fallback.py
git commit -m "feat(security): implement consented keychain file fallback for headless Linux"
```

---

### Task 4: Ollama Backend Management & Streaming Pull API (R10)

**Files:**
- Modify: `backend/runtime/providers/ollama.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_ollama_pull.py`

**Interfaces:**
- Consumes: Local Ollama service `POST http://localhost:11434/api/pull`
- Produces: `POST /api/ollama/pull` streaming NDJSON endpoint

- [ ] **Step 1: Write test for `POST /api/ollama/pull` in `tests/test_ollama_pull.py`**

```python
import pytest
from starlette.testclient import TestClient
from backend.api.main import app

def test_ollama_pull_streaming(monkeypatch):
    import httpx
    
    async def mock_stream_post(*args, **kwargs):
        class MockStreamResponse:
            status_code = 200
            async def aiter_bytes():
                yield b'{"status": "pulling manifest"}\n'
                yield b'{"status": "downloading", "total": 1000, "completed": 500}\n'
                yield b'{"status": "success"}\n'
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
        return MockStreamResponse()

    monkeypatch.setattr(httpx.AsyncClient, "send", mock_stream_post)
    
    with TestClient(app) as client:
        resp = client.post("/api/ollama/pull", json={"model": "llama3.2"})
        assert resp.status_code == 200
        content = resp.text
        assert "pulling manifest" in content
        assert "success" in content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ollama_pull.py -v`
Expected: FAIL with 404 Not Found on `/api/ollama/pull`

- [ ] **Step 3: Implement streaming pull in `backend/api/main.py` and helper in `backend/runtime/providers/ollama.py`**

- In `backend/runtime/providers/ollama.py`:
  - Add helper `async def stream_pull(model: str, base_url: str = DEFAULT_BASE) -> AsyncIterator[bytes]` that streams chunks from Ollama.
- In `backend/api/main.py`:
  - Implement `@app.post("/api/ollama/pull")` returning `StreamingResponse(stream_pull(model), media_type="application/x-ndjson")`.
  - When `"status": "success"` is emitted, register Ollama in `providers.yaml` with the pulled model and set as primary if no model is currently configured.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_ollama_pull.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/runtime/providers/ollama.py backend/api/main.py tests/test_ollama_pull.py
git commit -m "feat(ollama): add streaming model pull api and auto-registration"
```

---

### Task 5: Device Pairing Secure Origin Payload & Binding Port Consistency (R11)

**Files:**
- Modify: `backend/sync/devices.py:440-475`
- Modify: `backend/api/main.py:6530-6575`
- Create: `tests/test_device_pairing_origins.py`

**Interfaces:**
- Consumes: `app_url`, `relay_url`, `host_url`, `AMETHYST_BIND_PORT`
- Produces: Secure QR payload prioritized over insecure plain LAN HTTP

- [ ] **Step 1: Write test for pairing origin prioritization in `tests/test_device_pairing_origins.py`**

```python
import pytest
from starlette.testclient import TestClient
from backend.api.main import app

def test_start_pairing_prioritizes_secure_origin(monkeypatch):
    from backend.sync import devices as sync_devices
    
    monkeypatch.setattr(sync_devices, "app_url", lambda conn=None: "https://my-app.amethyst.ai")
    monkeypatch.setattr(sync_devices, "host_url", lambda: "http://192.168.1.100:8000")
    
    with TestClient(app) as client:
        resp = client.post("/api/devices/pair")
        assert resp.status_code == 200
        data = resp.json()
        assert data["qr"].startswith("https://my-app.amethyst.ai")
        assert "192.168.1.100" not in data["qr"]

def test_start_pairing_honors_prefer_lan_flag(monkeypatch):
    from backend.sync import devices as sync_devices
    
    monkeypatch.setattr(sync_devices, "app_url", lambda conn=None: "https://my-app.amethyst.ai")
    monkeypatch.setattr(sync_devices, "host_url", lambda: "http://192.168.1.100:8000")
    
    with TestClient(app) as client:
        resp = client.post("/api/devices/pair?prefer_lan=true")
        assert resp.status_code == 200
        data = resp.json()
        assert "192.168.1.100" in data["qr"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_device_pairing_origins.py -v`
Expected: FAIL (because `start_pairing` currently prefers `lan_payload` over `web_payload`)

- [ ] **Step 3: Update `backend/api/main.py` and `backend/sync/devices.py`**

- In `backend/api/main.py` (`start_pairing`):
  - Check whether `web_payload` starts with `https://` or relay is configured.
  - If secure origin is available, set `active_payload = web_payload` unless `prefer_lan` is explicitly requested.
- In `backend/sync/devices.py`:
  - Ensure `host_url()` checks `AMETHYST_BIND_PORT` (set by CLI / supervisor) to prevent port drift when running on 8001.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_device_pairing_origins.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/sync/devices.py backend/api/main.py tests/test_device_pairing_origins.py
git commit -m "fix(sync): prioritize secure https origins in qr pairing payloads"
```

---

### Task 6: Frontend Integration - Ollama Pull & Keychain Fallback UX (R9 & R10)

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/SplashScreenWizard.jsx`
- Test: `tests/theme_color_system.mjs` & `npm run lint`

**Interfaces:**
- Consumes: `/api/setup/keychain/fallback`, `/api/ollama/pull`
- Produces: 1-click model download with live progress bar and keychain consent alert banner

- [ ] **Step 1: Add API client methods in `frontend/src/api.js`**

```javascript
pullOllamaModel: (model, onProgress) => {
  // Uses fetch() + response.body.getReader() to stream NDJSON chunks
  // Calls onProgress({ status, completed, total, percent })
},
enableKeychainFallback: () => post('/api/setup/keychain/fallback', { consent: true }),
```

- [ ] **Step 2: Update `frontend/src/components/SplashScreenWizard.jsx`**

- In `StepChooseAi`:
  - When `setupStatus?.keychain?.writable === false`:
    - Render a clean warning banner with explanation and **"Enable Secure File Storage"** button.
  - When `activeTab === 'ollama'` and `ollama?.running && ollama.models?.length === 0`:
    - Display 1-click **"Download Recommended Model (llama3.2)"** button.
    - Show animated progress bar with percentage, formatted bytes (`500 MB / 2.0 GB`), and status.
    - On completion: toast success, refresh status, and select `llama3.2`.
- Synchronize tray preference toggle with Electron:
  - When `trayEnabled` changes, call `window.amethystDesktop?.setTrayEnabled?.(trayEnabled)`.

- [ ] **Step 3: Run lint and design system tests to verify compliance**

Run: `cd frontend && npm run lint && node tests/theme_color_system.mjs`
Expected: PASS (0 errors, design system tokens verified)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/components/SplashScreenWizard.jsx
git commit -m "feat(ui): add 1-click ollama model downloader and keychain consent in wizard"
```

---

### Task 7: Full Test Suite Verification & Integration Gate

**Files:**
- Touch: All test files and verification scripts

- [ ] **Step 1: Run complete backend pytest suite**

Run:
```bash
uv run pytest tests/test_setup_wizard_phase1.py tests/test_desktop_packaging.py tests/test_desktop_supervisor.py tests/test_keychain_fallback.py tests/test_ollama_pull.py tests/test_device_pairing_origins.py -v
```
Expected: All tests PASS with 0 failures.

- [ ] **Step 2: Run frontend lint & theme system suite**

Run:
```bash
cd frontend && npm run lint && node tests/theme_color_system.mjs
```
Expected: 0 errors and all design assertions PASS.

- [ ] **Step 3: Final Phase 2 commit**

```bash
git commit --allow-empty -m "chore(release): complete Phase 2 desktop reliability and supervision overhaul"
```
