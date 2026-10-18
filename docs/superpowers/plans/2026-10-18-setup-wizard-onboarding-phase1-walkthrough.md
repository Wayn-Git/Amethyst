# Walkthrough: Amethyst Setup Wizard & Onboarding Overhaul (Phase 1)

Phase 1 of the Setup Wizard & Onboarding Overhaul has been completed and verified. It eliminates false success, synchronizes provider presets with the backend catalogue, establishes a single source of truth for setup status, persists onboarding completion in SQLite, and provides a streamlined 4-step wizard UI.

---

## 1. Key Changes Implemented

### Backend Architecture
- **Pre-save Provider Verification (`POST /api/providers/{name}/verify`)**:
  - Authenticated pre-flight call against the provider's `/models` endpoint using `model_lister(config)`.
  - Rejects HTTP 401/403 with exact provider error messages without saving anything to `providers.yaml` or keychain.
  - Recognizes HTTP 429 as valid but rate-limited.
  - Returns live models on 200 OK.
- **Centralized System & Setup Status (`backend/setup_status.py` & `GET /api/setup/status`)**:
  - Aggregates true environment status: model verification, local Ollama status & installed models, keychain writability, runtime detection (`npx`, `uvx`, `ffmpeg`, `opencode`), Composio connection status, connectors awaiting sign-in, and active tool counts.
- **Persistent Setup State (`POST /api/setup/complete`)**:
  - Records `setup.completed_at` (ISO timestamp) and `setup.version` (1) in SQLite `app_settings`.
  - Eliminates the bug where Electron switching ports (8000 vs 8001) wiped `localStorage` and restarted onboarding.
  - Persists initial privacy selections (`browser.enabled`, `tray.enabled`).
- **Dynamic Catalogue Enrichment (`GET /api/providers`)**:
  - Catalogue presets now expose `free`, `core`, `adapter`, and `strengths` from `PROVIDER_PRESETS`.

### Frontend & UI Redesign (`SplashScreenWizard.jsx`)
- **Streamlined 4-Step Flow**:
  1. **Welcome**:
     - Live system readiness chip fed by `setup/status`.
     - Explicit consent toggles for Firefox bookmarks reading (default OFF) and tray background supervision (default ON).
     - "Get Started" and "Skip Setup" actions.
  2. **Choose Where Your AI Runs** (The only required step):
     - Segmented control: *Free Cloud Model*, *Local (Ollama)*, and *I Have an API Key*.
     - Dynamic cards generated directly from the backend catalogue.
     - Live pre-save verification with visual feedback (spinner, green success badge with model count, amber/red error alert with exact failure reason).
     - Collapsible "Advanced Configuration" accordion for custom `base_url` or model overrides.
  3. **Connect Your Apps** (Optional):
     - **Composio**: One-click "Sign In in Browser" button triggering `api.startComposioLogin()` with a visible 5-minute countdown and "Cancel" button. Once connected, displays 6 curated cloud apps (Gmail, Calendar, Slack, GitHub, Linear, Notion) with 1-click toggles. Fallback manual key input toggle included.
     - **Local Connectors**: Microsoft To Do badged with honest runtime indicator (`Needs Node.js` when `npx` is absent).
  4. **Ready to Launch**:
     - Verified checklist displaying genuine SQLite status, verified model name, and true count of active tools.
     - 3 clickable starter prompt pills that populate chat upon launch.
     - Fast theme and accent selection matching the 8 curated palettes.
- **Cleaned Up Developer Debt**:
  - Removed loopback Phone Sharing step (P6) and Cloudflare relay step (P18) from first-run onboarding.

---

## 2. Verification Results

### Automated Backend Tests
- **`tests/test_setup_wizard_phase1.py`**:
  ```
  tests/test_setup_wizard_phase1.py::test_catalogue_exposes_free_core_adapter_and_strengths PASSED
  tests/test_setup_wizard_phase1.py::test_provider_verify_valid_key[asyncio] PASSED
  tests/test_setup_wizard_phase1.py::test_provider_verify_invalid_key_401[asyncio] PASSED
  tests/test_setup_wizard_phase1.py::test_provider_verify_rate_limited_429[asyncio] PASSED
  tests/test_setup_wizard_phase1.py::test_setup_status_endpoint PASSED
  tests/test_setup_wizard_phase1.py::test_setup_complete_endpoint PASSED
  6 passed in 1.08s
  ```
- **`tests/test_providers_and_fallback.py`**:
  - 83 passed in 13.95s (zero regressions).

### Frontend Test & Lint Suite
- **`npm run lint` (`oxlint`)**:
  - 0 errors across all 282 frontend files.
- **`node tests/theme_color_system.mjs`**:
  - All 8 curated palettes and mode selectors verified in `SplashScreenWizard.jsx`.
- **Node frontend tests**:
  - `test:widgets` (12 passed)
  - `test:markdown` (44 passed)
  - `test:renderers` (31 passed)
  - `test:media` (18 passed)
  - `test:spotlight` (passed)
  - `test:sync` (35 passed)

---

## 3. Next Steps (Roadmap Phase 2)
With Phase 1 stopping false success and providing a clean, catalogue-driven onboarding wizard, the app is ready for **Phase 2 (Desktop Reliability & Supervision)**:
- R7: Call `backend.cli.main(argv)` from `freeze_entry.py`.
- R8: Supervise backend exit and route logs to `<userData>/logs`.
- R9: Keychain fallback prompt for headless/minimal Linux desktop.
- R10: Ollama in-app pull API with progress.
- R11: Device pairing payload fixes under secure origins.
