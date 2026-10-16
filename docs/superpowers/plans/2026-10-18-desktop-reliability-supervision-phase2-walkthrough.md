# Walkthrough: Amethyst Desktop Reliability & Supervision (Phase 2)

Phase 2 of the Amethyst Desktop Reliability & Supervision overhaul (Roadmap R7 through R11) has been completely implemented and verified. It eliminates frozen binary entry point divergences, loopback host binding leaks, silent 30-second supervisor hangs on backend crashes, unconsented keychain failures in headless environments, unassisted Ollama setup, and mobile Web Crypto pairing failures over HTTPS.

---

## 1. Key Changes Implemented

### Task 1: Frozen Entry & CLI Subcommands (R7)
- **`packaging/freeze_entry.py`**:
  - Refactored to delegate directly to `backend.cli.main()`, supporting all CLI subcommands (`serve`, `status`, `config`, etc.).
  - Explicitly loads `~/.amethyst/.env` if present before dispatching.
  - In default server mode, defaults `--host` strictly to `127.0.0.1` and passes through `--port`.
  - Sets `AMETHYST_BIND_PORT` and `AMETHYST_BIND_HOST` environment variables for consistent downstream consumption.
- **`electron/main.cjs`**:
  - Explicitly passes `--host 127.0.0.1` when spawning `amethyst-backend` executable to ensure complete loopback isolation on multi-interface systems.
- **`tests/test_desktop_packaging.py`**:
  - Verified package.json build configurations, binary execution delegation, and default serve arguments.

### Task 2: Electron Supervisor Fail-Fast & Supervision (R8)
- **`electron/main.cjs`**:
  - Replaced the blind 30-second polling timeout with immediate fail-fast error detection:
    - Attached an `exit`/`close` listener to child process that rejects splash readiness immediately with the process exit code.
    - Appends all stdout and stderr streams to `<userData>/logs/backend.log` (capped at 5MB).
    - Stores the last 50 lines in a circular memory buffer and pushes an `engine-failed` IPC event with the snippet to `splash.html`.
    - Handles retry attempts (`retry-backend` IPC event) without restarting the entire desktop application.
    - Added `set-tray-enabled` IPC handler to synchronize tray preference; window `close` event hides to tray when enabled rather than terminating the process.
- **`electron/splash.html` & `electron/splash.css`**:
  - Render a dark-mode styled crash card when backend fails to start, displaying the captured log snippet, an "Open Logs" button, and a "Retry" button.
- **`electron/preload.cjs`**:
  - Exposed `openLogs()`, `retryBackend()`, and `setTrayEnabled(enabled)` via context bridge.
- **`tests/test_desktop_supervisor.py`**:
  - Verified exit code handlers, preload bridge methods, and log file rotation.

### Task 3: Consented Keychain File Fallback (R9)
- **`backend/setup_status.py`**:
  - Enhanced `check_keychain` to detect failing backends (`keyrings.alt.file.PlaintextKeyring`, priority <= 0 backends, or SecretService D-Bus timeouts).
  - Reports `writable: false`, `reason: "No SecretService or OS keychain available"`, and `can_fallback: true`.
- **`backend/secrets.py`**:
  - Implemented `enable_file_store()` to switch keyring backend to owner-only permissioned (`0600`) storage at `~/.amethyst/secrets.json`.
  - Respects explicit user consent: checks `keychain.fallback_consented` in SQLite `app_settings` before allowing file-backed secrets storage (zero silent downgrades per ADR-0012).
- **`backend/api/main.py`**:
  - Added `POST /api/setup/keychain/fallback` endpoint to persist user consent in `app_settings` and activate file store.
- **`tests/test_keychain_fallback.py`**:
  - Verified fallback detection, refusal without consent, and successful activation upon consent.

### Task 4: Ollama Streaming Pull API (R10)
- **`backend/runtime/providers/ollama.py`**:
  - Implemented `stream_pull(model, host)` generator yielding parsed JSON chunk dictionaries from Ollama's `POST /api/pull` streaming endpoint.
- **`backend/api/main.py`**:
  - Added `POST /api/ollama/pull` endpoint streaming NDJSON events directly to client with `StreamingResponse(media_type="application/x-ndjson")`.
  - Upon pull completion, automatically registers or updates the `ollama` provider in `providers.yaml` and sets `active_model` to the pulled model.
- **`tests/test_ollama_pull.py`**:
  - Verified streaming response headers, progress chunks, and automatic provider catalogue registration.

### Task 5: Secure Device Pairing Origins & Binding Port (R11)
- **`backend/sync/devices.py`**:
  - Updated `pairing_payload()` to prioritize secure HTTPS/Cloudflare tunnel URLs over raw LAN IP addresses.
  - When an HTTPS origin is configured, omits raw plain HTTP LAN addresses to satisfy mobile Web Crypto (`crypto.subtle`) requirements and prevent mixed-content blocks on iOS/Android.
- **`backend/api/main.py`**:
  - Updated `start_pairing` endpoint to pass the effective public app URL to `pairing_payload`.
  - Ensured `_host_url()` checks `AMETHYST_BIND_PORT` (set by packaging/CLI) alongside `AMETHYST_PORT`.
- **`tests/test_device_pairing_origins.py`**:
  - Verified HTTPS origin precedence, `prefer_lan` override, and environment port resolution.

### Task 6: Frontend Integration & UX
- **`frontend/src/api.js`**:
  - Added `enableKeychainFallback()` and streaming `pullOllamaModel(model, onProgress, signal)`.
- **`frontend/src/components/SplashScreenWizard.jsx`**:
  - Synchronized `trayEnabled` state with Electron supervisor via `window.amethystDesktop.setTrayEnabled`.
  - Rendered a consented warning banner with 1-click "Enable File Storage Fallback" when `setupStatus.keychain.writable === false`.
  - Added 1-click "Download Recommended Model (llama3.2)" button with live percentage and MB progress bar during model streaming pulls.

---

## 2. Verification Results

### Automated Pytest Suite
```
uv run pytest tests/test_setup_wizard_phase1.py tests/test_desktop_packaging.py tests/test_desktop_supervisor.py tests/test_keychain_fallback.py tests/test_ollama_pull.py tests/test_device_pairing_origins.py -v

============================== 18 passed in 1.52s ==============================
tests/test_setup_wizard_phase1.py::test_catalogue_exposes_free_core_adapter_and_strengths PASSED
tests/test_setup_wizard_phase1.py::test_provider_verify_valid_key[asyncio] PASSED
tests/test_setup_wizard_phase1.py::test_provider_verify_invalid_key_401[asyncio] PASSED
tests/test_setup_wizard_phase1.py::test_provider_verify_rate_limited_429[asyncio] PASSED
tests/test_setup_wizard_phase1.py::test_setup_status_endpoint PASSED
tests/test_setup_wizard_phase1.py::test_setup_complete_endpoint PASSED
tests/test_desktop_packaging.py::test_electron_package_json_configuration PASSED
tests/test_desktop_packaging.py::test_freeze_entry_routes_through_cli PASSED
tests/test_desktop_packaging.py::test_freeze_entry_default_serve PASSED
tests/test_desktop_supervisor.py::test_main_process_logic_and_preload PASSED
tests/test_desktop_supervisor.py::test_supervisor_fail_fast_and_tray_handling PASSED
tests/test_keychain_fallback.py::test_check_keychain_detects_fail_backend PASSED
tests/test_keychain_fallback.py::test_keychain_fallback_activation PASSED
tests/test_keychain_fallback.py::test_keychain_fallback_refuses_without_consent PASSED
tests/test_ollama_pull.py::test_ollama_pull_streaming PASSED
tests/test_device_pairing_origins.py::test_start_pairing_prioritizes_secure_origin PASSED
tests/test_device_pairing_origins.py::test_start_pairing_honors_prefer_lan_flag PASSED
tests/test_device_pairing_origins.py::test_host_url_uses_amethyst_bind_port PASSED
```

### Full Device Sync Regression Suite
```
uv run pytest tests/test_sync_*.py
============================= 120 passed in 1.59s ==============================
```

### Frontend Linting & Theme Verification
```
cd frontend && npm run lint && node tests/theme_color_system.mjs
Found 0 errors.
--- Verifying Theme Color System Integrity ---
✓ store.jsx: Theme and accent ramp contracts verified
✓ index.css: 8 curated palettes declared and mode selectors unified
✓ Settings.jsx: All 8 curated themes present in THEME_CHOICES and mockups
✓ CommandPalette.jsx: All 8 curated themes present
✓ OnboardingWizard & SplashScreenWizard: Theme choices aligned
✓ Skiper26.jsx: View transition CSS and dark theme list aligned
✓ nexus-ui questions and featured-icon: bound to semantic accent
All Theme Color System assertions passed successfully! 🚀
```

### Frontend Build
```
cd frontend && npm run build
✓ 16468 modules transformed.
✓ built in 3.80s
```
