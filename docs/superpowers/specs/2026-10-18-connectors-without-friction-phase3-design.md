# Connectors Without Friction Architecture (Phase 3: R12 to R17)

**Date**: 18 Oct 2026  
**Status**: Approved  
**Scope**: Phase 3 Roadmap (R12, R13, R14, R15, R17), fixing P8, P15, P16, P19, and I10 from the Setup Wizard & Connectors Audit.

---

## 1. Context & Objectives

Following Phase 1 (Stop False Success) and Phase 2 (Desktop Reliability & Supervision), Phase 3 addresses **Connectors Without Friction**.

Currently, users attempting to extend Amethyst with MCP tools and integrations encounter several friction points:
1. **Opaque Runtime Dependencies (P8, R12)**: Connectors relying on `npx` (Microsoft To Do, Playwright, Chrome DevTools, Spotify) or `uvx` (Google Workspace, Web Fetch, LinkedIn) fail cryptically if the host machine lacks Node.js or `uv`. While `setup_status.py` detects binary paths, connector entries in `backend/mcp/catalogue.py` only express dependencies as unstructured descriptive strings (`requires = "Node.js (npx)"`). Connectors cannot programmatically declare or test their requirements, and desktop users without `uv` have no seamless installation mechanism.
2. **GitHub OAuth Registration Hurdle (P15, R13)**: Connecting GitHub currently requires registering a dedicated OAuth Application in GitHub developer settings, configuring a local callback port, and copying client secrets. Most users simply want to supply a Personal Access Token (PAT with `repo` scopes).
3. **Divergent Setup Instructions (P16, R14)**: The Google Workspace connector documentation has drifted between the UI's detailed `GOOGLE_SETUP_HINT` in `backend/mcp/catalogue.py` and a truncated prompt in `scripts/setup_wizard.py`.
4. **Unconsented Browser Capture (P19, R15)**: `backend/runtime/autostart.py` silently enables Firefox bookmark capture (`browser.enabled = True`) on fresh boots if a profile folder exists, violating the zero-surprise privacy principle.
5. **Disconnected Embeddings Setup (I10, R17)**: When a user configures their primary AI model, semantic search embeddings remain unconfigured unless manually discovered via `amethyst embeddings detect --set` or falling back to Ollama.

---

## 2. Technical Architecture & Component Design

### 2.1 R12: Structured Runtime Detection, Connector Gating & uv Downloader (`backend/mcp/catalogue.py`, `backend/setup_status.py`, `backend/api/main.py`)

#### Architecture:
- Extend `CatalogueEntry` in `backend/mcp/catalogue.py` with structured runtime requirements:
  ```python
  class RuntimeKind(enum.StrEnum):
      NONE = "none"
      NODE = "node"  # requires npx / node
      UV = "uv"      # requires uvx / uv
      FFMPEG = "ffmpeg"
      OPENCODE = "opencode"
      CUA = "cua"
  ```
  Add `runtime: RuntimeKind = RuntimeKind.NONE` to `CatalogueEntry`. Each catalogue entry specifies its primary execution runtime.
- Update `missing_credentials()` or add `missing_requirements(config)` in `backend/mcp/commands.py` to evaluate whether required runtimes are present on system `PATH` (including `~/.amethyst/bin`).
- Add static `uv` binary installation endpoint:
  `POST /api/setup/runtimes/uv/install`:
  - Detects platform architecture (`x86_64`, `aarch64` / `arm64`, Linux / macOS / Windows).
  - Downloads official standalone binary from Astral GitHub releases into `~/.amethyst/bin/uv` and `~/.amethyst/bin/uvx`.
  - Sets executable permissions (`0755`).
  - Prepends `~/.amethyst/bin` to `os.environ["PATH"]` dynamically.
  - Returns `{ "ok": True, "path": "~/.amethyst/bin/uv", "version": "..." }`.

### 2.2 R13: GitHub Personal Access Token (PAT) Dual-Auth Mode (`backend/mcp/catalogue.py`, `backend/mcp/commands.py`, `frontend`)

#### Architecture:
- In `backend/mcp/catalogue.py`:
  - Update `github` catalogue entry to support PAT auth mode via `api_key_ref="amethyst-mcp/github.api_key"`.
  - Retain `auth=AuthKind.OAUTH` for users with dedicated OAuth applications, but allow `api_key_ref` to satisfy credentials check in `missing_credentials(config)`.
  - When `api_key_ref` is present and populated in keychain, `resolved_headers()` automatically adds `Authorization: Bearer <pat>`.
- In `backend/mcp/commands.py`:
  - In `missing_credentials(config)`: if `config.id == "github"`, verify if either OAuth credentials exist OR `get_secret(config.api_key_ref or "amethyst-mcp/github.api_key")` is set. If either is satisfied, no credentials are missing.
- In Connector UI:
  - Provide a tab or direct input for "Personal Access Token" with a direct link to `github.com/settings/tokens?scopes=repo,read:org,read:user,gist,notifications,workflow`.

### 2.3 R14: Unified Google Workspace Setup Guidance (`scripts/setup_wizard.py`, `backend/mcp/catalogue.py`)

#### Architecture:
- In `scripts/setup_wizard.py`:
  - Import `GOOGLE_SETUP_HINT` directly from `backend.mcp.catalogue`.
  - Print `GOOGLE_SETUP_HINT` verbatim during terminal connector setup so the instructions (authorisation callback `http://localhost:8765/oauth2callback`, test user requirements, Google Auth Platform navigation) match the web interface.

### 2.4 R15: Consented Browser Capture (`backend/runtime/autostart.py`, `backend/setup_status.py`)

#### Architecture:
- In `backend/runtime/autostart.py`:
  - `_browser_watcher()` must never automatically write `save_browser({"enabled": True})` on fresh installs where `app_settings` has no `browser.enabled` key.
  - Instead, check `app_settings` for `browser.enabled`:
    - If `row is None` or `row[0] != "1"`: do not enable.
    - If `row[0] == "1"`: ensure watcher is enabled.
  - Report browser capture availability via `backend/setup_status.py` under `runtimes` / `features`:
    `features: { browser_available: bool, browser_enabled: bool }`.

### 2.5 R17: Automated Embeddings Selection (`backend/retrieval/embeddings.py`, `backend/api/main.py`)

#### Architecture:
- In `backend/retrieval/embeddings.py`:
  - Implement `async def auto_configure_embeddings() -> tuple[str, str] | None`:
    - Checks `load_embeddings()`. If already configured, returns existing `(provider, model)`.
    - Invokes `detect()`.
    - If any candidate answers, saves the first result via `save_embeddings(provider, model)`.
    - Returns `(provider, model)`.
- In `backend/api/main.py`:
  - Hook `auto_configure_embeddings()` after successful `verify_provider` / `add_provider` and in `complete_setup`.

---

## 3. Verification Plan

### Automated Tests
1. `tests/test_runtime_requirements.py`: Test runtime kind tagging, missing requirement detection, and `PATH` resolution including `~/.amethyst/bin`.
2. `tests/test_github_pat_auth.py`: Test GitHub connector credential check with PAT in keychain, header formatting as `Bearer <token>`, and missing credential resolution.
3. `tests/test_google_setup_hint_sync.py`: Test that `scripts/setup_wizard.py` references and prints `GOOGLE_SETUP_HINT`.
4. `tests/test_autostart_consent.py`: Test that `auto_setup()` does not enable browser capture without explicit `browser.enabled = 1` in `app_settings`.
5. `tests/test_auto_embeddings.py`: Test `auto_configure_embeddings()` probes candidates and saves configuration without manual CLI commands.

### Manual Verification
- Run `npm run lint` and `node tests/theme_color_system.mjs`.
- Launch Amethyst and verify connector runtime badges and GitHub PAT option in Connectors UI.
