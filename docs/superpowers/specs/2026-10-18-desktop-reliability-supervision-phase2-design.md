# Desktop Reliability & Supervision Architecture (Phase 2: R7 to R11)

**Date**: 18 Oct 2026  
**Status**: Approved  
**Scope**: Phase 2 Roadmap (R7 to R11), fixing P10–P14, P17, P20 from the Setup Wizard & Desktop Supervisor Audit.

---

## 1. Context & Objectives

Following Phase 1 (Stop False Success), which established honest provider verification, dynamic catalogue presets, and persistent setup status in SQLite, Phase 2 addresses **Desktop Reliability & Supervision**.

Desktop users and packaged builds face five distinct friction points:
1. **Broken CLI In Packaged Builds (P10, P13)**: `freeze_entry.py` currently invokes `uvicorn.run(app)` directly, bypassing `backend.cli.main(argv)`. This causes packaged builds to skip loading `.env` from `~/.amethyst/`, drop service summaries, disable CLI subcommands (`amethyst doctor`, `amethyst secrets`), and allows dev Electron to bind to `0.0.0.0` unintentionally.
2. **Brittle Electron Supervisor & Misplaced Tray Exit (P11, P12)**: If the backend fails to start, Electron hangs for 30s before displaying a generic error with no logs. Furthermore, closing the main window calls `mainWindow.on('close') => app.quit()`, instantly terminating background automations, relay polling, and sync even when a system tray icon exists.
3. **Keychain Failure on Minimal/Headless Linux (P14)**: On Linux distributions lacking a SecretService daemon (GNOME Keyring / KWallet), `keyring` raises `NoKeyringError`, blocking API key saves with a 503 error.
4. **Ollama Empty Model State (P20)**: When Ollama is running without any models installed, turns fail with `model_not_found`. The wizard currently displays a static terminal command rather than offering a native 1-click model download.
5. **Insecure Device Pairing Payloads (P17)**: `start_pairing` generates plain `http://<LAN-IP>` QR payloads by default, which modern mobile browsers reject because `crypto.subtle` requires a secure origin (HTTPS or localhost). In addition, frozen builds fail to set `AMETHYST_BIND_PORT`, causing port drift.

---

## 2. Technical Architecture & Component Design

### 2.1 R7: Route Frozen Entry through Backend CLI (`packaging/freeze_entry.py`, `backend/cli.py`, `electron/main.cjs`)

#### Routing Architecture:
```
[ Packaged Executable / CLI invocation ]
                │
                ▼
      packaging/freeze_entry.py
                │ (forwards sys.argv[1:] or defaults to ['serve', ...])
                ▼
        backend.cli.main(argv)
                ├─► Loads ~/.amethyst/.env
                ├─► Sets BIND_HOST_ENV & BIND_PORT_ENV
                ├─► Skips frontend build in frozen mode
                └─► Starts uvicorn with FastAPI app instance
```

#### Detailed Changes:
- **`packaging/freeze_entry.py`**:
  - Replace direct `uvicorn.run(app)` with `from backend.cli import main as cli_main`.
  - Check `sys.argv[1:]`:
    - If arguments are present (e.g. `amethyst-backend doctor`, `amethyst-backend secrets list`), forward them directly to `cli_main(sys.argv[1:])`.
    - If no arguments are provided, default to:
      `cli_main(['serve', '--port', str(port), '--host', host, '--no-build'])`.
- **`backend/cli.py`**:
  - In `_ensure_frontend(args)`: if `getattr(sys, "frozen", False)` is True, immediately return `True` without checking for `npm`.
  - In `cmd_serve`: when `getattr(sys, "frozen", False)` is True, pass the imported FastAPI `app` object directly to `uvicorn.run(app, ...)` rather than the string `"backend.api.main:app"` to avoid import resolution quirks in single-binary PyInstaller packages.
- **`electron/main.cjs`**:
  - When spawning the backend process in both development (`python -m backend.cli`) and packaged mode (`amethyst-backend`), explicitly pass `--host 127.0.0.1` and `--port <port>`.
  - Set `AMETHYST_BIND_PORT: port.toString()` and `AMETHYST_BIND_HOST: '127.0.0.1'` in `env`.

---

### 2.2 R8: Electron Supervisor, Fail-Fast, Logs Streaming & Tray Lifecycle (`electron/main.cjs`, `electron/splash.html`, `electron/preload.cjs`)

#### Process Lifecycle & Fail-Fast:
- **Immediate Failure Detection**:
  - In `electron/main.cjs`, monitor `backendProcess.on('exit', (code, signal))`:
    - If the backend exits while `pingInterval` is running (during boot), immediately cancel the interval.
    - Read the last 25 lines of the backend log file (`<userData>/logs/backend.log`).
    - Instruct `splashWindow` via `splashWindow.webContents.send('splash:error', { message, logSnippet })` or `executeJavaScript` to display the failure immediately.
    - This eliminates the 30-second hung splash window.
- **Persistent Log Capture**:
  - Ensure `<userData>/logs` exists.
  - Create a write stream to `<userData>/logs/backend.log`.
  - Pipe `backendProcess.stdout` and `backendProcess.stderr` to both the Electron console and the log file.
- **Interactive Boot Error UI (`electron/splash.html`)**:
  - Show a clear error header, a scrollable `<pre>` block with syntax-colored log output, an **"Open Logs"** button calling `desktop:open-logs`, and a **"Retry"** button calling `desktop:retry-boot`.
- **System Tray Window Management**:
  - Load `tray.enabled` from SQLite `app_settings` or maintain a preference cache via IPC.
  - In `mainWindow.on('close', (e))`:
    - If `trayEnabled && !isQuitting`:
      `e.preventDefault();`
      `mainWindow.hide();`
    - If `!trayEnabled || isQuitting`:
      Terminate the backend cleanly with `killBackendProcess()`, and proceed with `app.quit()`.
  - IPC handler `desktop:set-tray-enabled`: updates Electron's in-memory `trayEnabled` boolean dynamically when the user flips the toggle in Settings or the Wizard.
  - Tray context menu: provides "Show Amethyst", "Check for Updates", and "Quit Amethyst" (which sets `isQuitting = true` and exits).

---

### 2.3 R9: Consented Keychain Fallback (`backend/secrets.py`, `backend/setup_status.py`, `backend/api/main.py`)

#### Accurate Writability Detection:
- In `backend/setup_status.py` `check_keychain()`:
  - If `_store()` is already a `_FileStore`: return `{ writable: True, storage_type: "file", path: str(store.path) }`.
  - If `_store()` is `_keyring()`:
    - Check `keyring.get_keyring()`. If its priority <= 0 or it is an instance of `keyring.backends.fail.Keyring`, report `writable: False`.
    - Perform a dry-run probe: attempt to store and delete a sentinel key `amethyst/__probe__`.
    - If an exception is caught (`NoKeyringError`, `KeyringLocked`, `KeyringError`), report:
      ```json
      {
        "writable": false,
        "storage_type": "none",
        "path": null,
        "error": "No OS SecretService daemon available",
        "fallback_available": true
      }
      ```

#### Consented File Storage Activation:
- Endpoint: `POST /api/setup/keychain/fallback`
  - Body: `{"consent": true}`
  - Resolves fallback path: `os.environ.get("AMETHYST_SECRETS_FILE")` or `~/.amethyst/secrets.json`.
  - Initializes `secrets.json` with strict `0o600` permissions (owner read/write only).
  - Persists `keychain.fallback_consented = 1` in SQLite `app_settings`.
  - Activates `_FileStore` in `backend.secrets` so subsequent calls to `set_secret()` use the file store without restarting the server.
- Wizard UI (`SplashScreenWizard.jsx`) & Settings:
  - When `setupStatus.keychain.writable === false`, display an alert informing the user:
    "OS Keychain is unavailable on this Linux system. Enable secure file storage (`~/.amethyst/secrets.json`) with strict 0600 permissions to save API keys?"
  - Provide an **"Enable File Storage"** button calling `api.enableKeychainFallback()`.

---

### 2.4 R10: Ollama Backend Management & Pull API (`backend/runtime/providers/ollama.py`, `backend/api/main.py`, `SplashScreenWizard.jsx`)

#### Streaming Pull Proxy (`POST /api/ollama/pull`):
- Endpoint in `backend/api/main.py`:
  - Request body: `{"model": "llama3.2"}` (default model: `llama3.2`).
  - Probes local Ollama base URL (`http://localhost:11434/api/pull`).
  - Streams NDJSON progress directly from Ollama to the client via `StreamingResponse(media_type="application/x-ndjson")`:
    ```json
    {"status": "pulling manifest"}
    {"status": "downloading", "digest": "sha256:...", "total": 2048000000, "completed": 512000000}
    {"status": "verifying sha256 digest"}
    {"status": "success"}
    ```
  - When `status == "success"`, automatically registers `ollama` with `default_model: model` in `providers.yaml` and sets it as the primary provider if none was configured.

#### Wizard UI 1-Click Download:
- In `SplashScreenWizard.jsx` (and Settings provider tab):
  - When `ollama?.running && ollama.models?.length === 0`:
    - Show an interactive card:
      - Title: "Ollama is running with 0 models"
      - Action: **"Download Recommended Model (llama3.2)"** button.
    - When clicked, stream the response:
      - Display a progress bar showing percentage calculated from `completed / total`.
      - Show status label (e.g. `Downloading layer: 450 MB / 2.0 GB`).
      - On completion: toast success, refresh setup status, and transition smoothly.

---

### 2.5 R11: Device Pairing Secure Origin Payload (`backend/sync/devices.py`, `backend/api/main.py`)

#### Secure Origin Prioritization:
- In `backend/sync/devices.py` & `backend/api/main.py` (`start_pairing`):
  - Inspect `app_url` and `relay_url`.
  - Prioritize `https://` origins (`web_payload` or relay payload) over plain `http://` LAN addresses.
  - Only use plain `http://<LAN-IP>` payload when:
    - Explicitly requested via query parameter `?prefer_lan=true`, OR
    - The server itself is running under `localhost` and no external secure origin is known.
- In `packaging/freeze_entry.py` & `electron/main.cjs`:
  - Ensure `AMETHYST_BIND_PORT` is always set in `os.environ` to match `activePort`.
  - This guarantees `sync_devices.host_url()` resolves to the actual bound port (e.g. 8001) instead of defaulting to 8000.

---

## 3. Design System Compliance
- **Typography**: Inter for display/UI, Geist Mono for code/ports/diagnostics.
- **Color tokens**:
  - `--live` (#149e61) for connected engines and verified keychains.
  - `--confirm` (#f59e0b) for rate limits and permission prompts.
  - `--stop` (#f43f5e) for process exit failures and key errors.
  - Purple (`--accent`: #7132f5) reserved strictly for actions and branding.
- **Elevation and Geometry**:
  - Hairline borders (`--hairline`), pills (`--radius-buttons`: 9999px) for primary action buttons.
  - Log snippet cards styled with `--surface-2`, `--border`, and monospaced typography.

---

## 4. Testing & Verification Plan

### Test Suites to Add / Update:
1. `tests/test_desktop_packaging.py`:
   - Test `freeze_entry.py` forwards CLI arguments to `backend.cli.main()`.
   - Verify `--host 127.0.0.1` and `--port` CLI arguments.
2. `tests/test_desktop_supervisor.py`:
   - Verify `electron/main.cjs` exit listener fail-fast logic.
   - Verify log capture path and tray window hiding logic when `tray.enabled` is true.
3. `tests/test_keychain_fallback.py`:
   - Test non-writable keyring detection.
   - Test `POST /api/setup/keychain/fallback` creates `0o600` file and activates `_FileStore`.
4. `tests/test_ollama_pull.py`:
   - Test `POST /api/ollama/pull` proxies streaming progress and handles successful completion.
5. `tests/test_device_pairing_origins.py`:
   - Test `start_pairing` prioritizes HTTPS/Cloudflare relay over plain HTTP LAN.

### Verification Commands:
```bash
uv run pytest tests/test_setup_wizard_phase1.py -v
uv run pytest tests/test_desktop_packaging.py -v
uv run pytest tests/test_desktop_supervisor.py -v
uv run pytest tests/test_keychain_fallback.py tests/test_ollama_pull.py tests/test_device_pairing_origins.py -v
cd frontend && npm run lint && node tests/theme_color_system.mjs
```
