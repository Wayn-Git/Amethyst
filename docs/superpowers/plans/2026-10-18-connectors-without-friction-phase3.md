# Connectors Without Friction (Phase 3: R12 to R17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove developer friction and opaque failures from Amethyst MCP connectors and autostart capture: add structured runtime requirements, standalone `uv` downloader, GitHub Personal Access Token (PAT) auth mode, unified Google setup instructions, privacy-consented browser capture, and automatic embedding model selection.

**Architecture:** Extend `backend/mcp/catalogue.py` with `RuntimeKind` enumeration and runtime detection, add `POST /api/setup/runtimes/uv/install` endpoint for standalone `uv` binary installation into `~/.amethyst/bin`, wire `api_key_ref` PAT authentication into the GitHub connector, synchronize `scripts/setup_wizard.py` with `GOOGLE_SETUP_HINT`, ensure `backend/runtime/autostart.py` strictly checks SQLite `app_settings` for `browser.enabled == 1`, and automate embedding configuration via `auto_configure_embeddings()`.

**Tech Stack:** Python 3.12, FastAPI, MCP, SQLite, React 19, httpx.

**Spec:** [`docs/superpowers/specs/2026-10-18-connectors-without-friction-phase3-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-18-connectors-without-friction-phase3-design.md)

## Global Constraints
- Python backend test runner: `uv run pytest <path> -v`.
- Frontend lint and checks: `cd frontend && npm run lint && node tests/theme_color_system.mjs`.
- Design System: Follow `AGENTS.md` and `index.css` tokens strictly (`--live`, `--confirm`, `--stop`, `--accent`).
- Security: Never store secrets in plain text files when keychain is available. Always mask tokens in logs.
- Privacy: No auto-enabling of browser history / bookmarks without explicit user consent (ADR-0012).

---

### Task 1: Structured Runtime Requirements & uv Binary Downloader (R12)

**Files:**
- Modify: `backend/mcp/catalogue.py`
- Modify: `backend/setup_status.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_runtime_requirements.py`

**Interfaces:**
- Consumes: System `PATH`, `~/.amethyst/bin`, Astral `uv` release endpoints
- Produces: `RuntimeKind` on `CatalogueEntry`, `missing_runtime` validation, and `POST /api/setup/runtimes/uv/install`

- [ ] **Step 1: Write test in `tests/test_runtime_requirements.py`**
  Assert `RuntimeKind` enumeration exists on `CatalogueEntry`, test `check_runtime_requirement` helper, and test the `/api/setup/runtimes/uv/install` route.

- [ ] **Step 2: Add `RuntimeKind` to `backend/mcp/catalogue.py`**
  Add `RuntimeKind(enum.StrEnum)` with `NONE`, `NODE`, `UV`, `FFMPEG`, `OPENCODE`, `CUA`. Add `runtime: RuntimeKind = RuntimeKind.NONE` to `CatalogueEntry` and tag catalogue entries (`microsoft-todo`, `playwright`, `google`, `fetch`, etc.).

- [ ] **Step 3: Update `backend/setup_status.py` and path search**
  Include `~/.amethyst/bin` in runtime path checks so standalone installed binaries are discovered.

- [ ] **Step 4: Add `POST /api/setup/runtimes/uv/install` in `backend/api/main.py`**
  Implement safe standalone binary fetcher for Linux/macOS/Windows into `~/.amethyst/bin/uv` and make it executable.

- [ ] **Step 5: Run tests and verify**
  `uv run pytest tests/test_runtime_requirements.py -v`.

---

### Task 2: GitHub Personal Access Token (PAT) Auth Mode (R13)

**Files:**
- Modify: `backend/mcp/catalogue.py`
- Modify: `backend/mcp/commands.py`
- Create: `tests/test_github_pat_auth.py`

**Interfaces:**
- Consumes: `amethyst-mcp/github.api_key` in secrets/keychain
- Produces: Bearer token authorization header and bypass of OAuth application requirement when PAT is provided

- [ ] **Step 1: Write test in `tests/test_github_pat_auth.py`**
  Assert that when `amethyst-mcp/github.api_key` is set in secrets, `missing_credentials()` returns empty for GitHub, and `resolved_headers()` outputs `Authorization: Bearer <token>`.

- [ ] **Step 2: Update GitHub entry in `backend/mcp/catalogue.py`**
  Set `api_key_ref="amethyst-mcp/github.api_key"` and update `setup_hint` to document both PAT and OAuth app options.

- [ ] **Step 3: Update `missing_credentials()` in `backend/mcp/commands.py`**
  Allow either valid OAuth credentials OR `api_key_ref` secret to satisfy GitHub connector requirements.

- [ ] **Step 4: Run tests and verify**
  `uv run pytest tests/test_github_pat_auth.py -v`.

---

### Task 3: Unified Google Workspace Setup Guidance (R14)

**Files:**
- Modify: `scripts/setup_wizard.py`
- Create: `tests/test_google_setup_hint_sync.py`

**Interfaces:**
- Consumes: `backend.mcp.catalogue.GOOGLE_SETUP_HINT`
- Produces: Consistent terminal wizard instructions identical to the UI

- [ ] **Step 1: Write test in `tests/test_google_setup_hint_sync.py`**
  Verify that `scripts/setup_wizard.py` imports and prints `GOOGLE_SETUP_HINT`.

- [ ] **Step 2: Update `scripts/setup_wizard.py`**
  Import `GOOGLE_SETUP_HINT` from `backend.mcp.catalogue` and print it during Google Workspace setup.

- [ ] **Step 3: Run tests and verify**
  `uv run pytest tests/test_google_setup_hint_sync.py -v`.

---

### Task 4: Consented Browser Capture (R15)

**Files:**
- Modify: `backend/runtime/autostart.py`
- Modify: `backend/setup_status.py`
- Create: `tests/test_autostart_consent.py`

**Interfaces:**
- Consumes: SQLite `app_settings` (`browser.enabled`)
- Produces: Zero unconsented auto-enables on fresh machines

- [ ] **Step 1: Write test in `tests/test_autostart_consent.py`**
  Verify that when `app_settings` has no `browser.enabled` key, `auto_setup()` does NOT enable browser capture. When `browser.enabled = 1`, it does.

- [ ] **Step 2: Update `_browser_watcher()` in `backend/runtime/autostart.py`**
  Check `app_settings`: if `row is None` or `row[0] != '1'`, return `None` without mutating `save_browser({"enabled": True})`.

- [ ] **Step 3: Expose `browser_available` and `browser_enabled` in `backend/setup_status.py`**
  Report availability without forcing enablement.

- [ ] **Step 4: Run tests and verify**
  `uv run pytest tests/test_autostart_consent.py -v`.

---

### Task 5: Automated Embeddings Selection (R17)

**Files:**
- Modify: `backend/retrieval/embeddings.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_auto_embeddings.py`

**Interfaces:**
- Consumes: Configured providers and Ollama candidates
- Produces: `auto_configure_embeddings()` helper that sets primary embeddings automatically

- [ ] **Step 1: Write test in `tests/test_auto_embeddings.py`**
  Verify that `auto_configure_embeddings()` probes candidates and saves the first working embedder to config, returning `(provider, model)`.

- [ ] **Step 2: Implement `auto_configure_embeddings()` in `backend/retrieval/embeddings.py`**
  Check `load_embeddings()`; if unset, probe `detect()`, save first working result via `save_embeddings(provider, model)`.

- [ ] **Step 3: Wire into provider save & setup completion in `backend/api/main.py`**
  Call `auto_configure_embeddings()` during setup completion or when a provider with embeddings is verified.

- [ ] **Step 4: Run tests and verify**
  `uv run pytest tests/test_auto_embeddings.py -v`.

---

### Task 6: Frontend Integration - Runtime Badges & GitHub PAT (R12, R13)

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/SplashScreenWizard.jsx`
- Modify: `frontend/src/views/Settings.jsx` (or Connectors view)

**Interfaces:**
- Consumes: `GET /api/setup/status`, `POST /api/setup/runtimes/uv/install`
- Produces: Visual runtime status chips, 1-click Install uv button, and GitHub PAT input option

- [ ] **Step 1: Add frontend API bindings in `frontend/src/api.js`**
  Add `installUv()` and `setGithubPat(pat)`.

- [ ] **Step 2: Update connector cards in `SplashScreenWizard.jsx`**
  Show clear "Needs Node.js" or "Needs uv" badges; offer "Install uv" button if uv is missing.

- [ ] **Step 3: Add GitHub PAT input support**
  Allow user to paste a Personal Access Token with a link to GitHub token generation.

- [ ] **Step 4: Run frontend lint & theme checks**
  `npm run lint && node tests/theme_color_system.mjs`.

---

### Task 7: Full Test Suite Verification & Integration Gate

- [ ] **Step 1: Run comprehensive backend tests**
  `uv run pytest tests/test_runtime_requirements.py tests/test_github_pat_auth.py tests/test_google_setup_hint_sync.py tests/test_autostart_consent.py tests/test_auto_embeddings.py -v`

- [ ] **Step 2: Run full regression tests**
  `uv run pytest tests/test_setup_wizard_phase1.py tests/test_desktop_packaging.py tests/test_desktop_supervisor.py tests/test_keychain_fallback.py tests/test_ollama_pull.py tests/test_device_pairing_origins.py -v`

- [ ] **Step 3: Run frontend production build**
  `cd frontend && npm run build`
