# Phase 3: Connectors Without Friction - Walkthrough & Verification

**Date**: 2026-10-18  
**Milestone**: Phase 3 (R12, R13, R14, R15, R17)  
**Status**: Completed and Verified  

---

## 1. Overview of Completed Work

Phase 3 resolves friction across MCP connectors, runtimes, authentication, privacy, and background services identified in the Onboarding & Setup Wizard Audit:

| Requirement | Scope & Files | Implementation Summary |
| :--- | :--- | :--- |
| **R12: Structured Runtimes & uv Binary Downloader** | `backend/mcp/catalogue.py`<br>`backend/setup_status.py`<br>`backend/api/main.py`<br>`frontend/src/api.js`<br>`frontend/src/components/SplashScreenWizard.jsx` | - Added `RuntimeKind(StrEnum)` (`NONE`, `NODE`, `UV`, `FFMPEG`, `OPENCODE`, `CUA`) tagging catalogue entries.<br>- Added `check_runtime` and updated `check_runtimes` searching `~/.amethyst/bin` alongside `PATH`.<br>- Added `POST /api/setup/runtimes/uv/install` endpoint downloading standalone `uv`/`uvx` binaries directly into `~/.amethyst/bin` with `0755` permissions.<br>- Added `api.installUv()` and 1-click installer card in `StepConnectors`. |
| **R13: GitHub Personal Access Token (PAT) Mode** | `backend/mcp/catalogue.py`<br>`backend/mcp/commands.py`<br>`backend/api/main.py`<br>`frontend/src/components/SplashScreenWizard.jsx` | - Configured `api_key_ref="amethyst-mcp/github.api_key"` and `Authorization` header for GitHub.<br>- Allowed PAT to satisfy missing credentials check and mark connector signed in.<br>- Added `POST /api/mcp/servers/{name}/api-key` endpoint to persist connector credentials directly in OS keychain.<br>- Added direct GitHub PAT input modal with recommended scope generation link (`repo, read:org, gist`) in `StepConnectors`. |
| **R14: Unified Google Workspace Setup Guidance** | `backend/mcp/catalogue.py`<br>`scripts/setup_wizard.py` | - Unified `GOOGLE_SETUP_HINT` in `backend/mcp/catalogue.py`.<br>- Updated `scripts/setup_wizard.py` to import and print `GOOGLE_SETUP_HINT` verbatim, aligning terminal setup with the web interface. |
| **R15: Consented Browser Capture** | `backend/runtime/autostart.py`<br>`backend/setup_status.py` | - Eliminated unconsented auto-enabling of Firefox bookmark capture on fresh boots.<br>- Checked SQLite `app_settings` for explicit user enablement (`1`).<br>- Exposed `browser: { available: bool, enabled: bool }` in setup status. |
| **R17: Automated Embeddings Selection** | `backend/retrieval/embeddings.py`<br>`backend/api/main.py` | - Implemented `auto_configure_embeddings()` to probe candidate models (Ollama, cloud providers) and save the first working match to `providers.yaml`.<br>- Hooked into `POST /api/setup/complete` and added `POST /api/setup/embeddings/auto`. |

---

## 2. Test Verification

### Phase 3 Test Suite
Command: `uv run pytest tests/test_runtime_requirements.py tests/test_github_pat_auth.py tests/test_google_setup_hint_sync.py tests/test_autostart_consent.py tests/test_auto_embeddings.py -v`

```
tests/test_runtime_requirements.py::test_catalogue_entries_have_runtime_kind PASSED
tests/test_runtime_requirements.py::test_check_runtime_helper PASSED
tests/test_runtime_requirements.py::test_setup_status_discovers_amethyst_bin PASSED
tests/test_runtime_requirements.py::test_install_uv_endpoint PASSED
tests/test_github_pat_auth.py::test_github_catalogue_declares_api_key_ref PASSED
tests/test_github_pat_auth.py::test_github_resolved_headers_with_pat PASSED
tests/test_github_pat_auth.py::test_github_missing_credentials_resolved_by_pat PASSED
tests/test_github_pat_auth.py::test_set_mcp_api_key_endpoint PASSED
tests/test_google_setup_hint_sync.py::test_setup_wizard_imports_google_setup_hint PASSED
tests/test_google_setup_hint_sync.py::test_setup_wizard_prints_true_redirect_uri PASSED
tests/test_autostart_consent.py::test_browser_watcher_refuses_without_consent PASSED
tests/test_autostart_consent.py::test_browser_watcher_honors_explicit_rejection PASSED
tests/test_autostart_consent.py::test_browser_watcher_with_consent PASSED
tests/test_autostart_consent.py::test_check_browser_status PASSED
tests/test_auto_embeddings.py::test_auto_configure_returns_existing_configuration PASSED
tests/test_auto_embeddings.py::test_auto_configure_picks_and_saves_first_working_candidate PASSED
tests/test_auto_embeddings.py::test_auto_configure_returns_none_when_no_candidates PASSED
tests/test_auto_embeddings.py::test_complete_setup_triggers_auto_embeddings PASSED
tests/test_auto_embeddings.py::test_auto_configure_embeddings_route PASSED

19 passed, 1 warning in 1.53s
```

### Regression Gate (Phases 1 & 2)
Command: `uv run pytest tests/test_setup_wizard_phase1.py tests/test_desktop_packaging.py tests/test_desktop_supervisor.py tests/test_keychain_fallback.py tests/test_ollama_pull.py tests/test_device_pairing_origins.py -v`

```
18 passed, 1 warning in 2.08s
```

### Frontend Build & Lint Verification
- `npm run lint` in `frontend/`: 0 errors.
- `node tests/theme_color_system.mjs`: All assertions passed.
- `npm run build` in `frontend/`: Built cleanly in 3.28s.

---

## 3. Git Commit Log for Phase 3

- `b546e44`: `feat(connectors): add structured runtime requirements and uv downloader endpoint` (Task 1)
- `6ffe5ae`: `feat(mcp): support github personal access token as alternative to oauth` (Task 2)
- `8d6abb8`: `fix(wizard): sync terminal setup wizard google guidance with catalogue` (Task 3)
- `50004d8`: `feat(privacy): enforce explicit user consent before enabling browser capture` (Task 4)
- `0861c5b`: `feat(embeddings): implement automated embeddings candidate selection and setup hook` (Task 5)
- `176ce0e`: `feat(connectors): add uv downloader banner, GitHub PAT modal, and api-key endpoint` (Task 6)
