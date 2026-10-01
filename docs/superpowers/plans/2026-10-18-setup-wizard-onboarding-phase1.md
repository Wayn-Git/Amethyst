# Implementation Plan: Amethyst Setup Wizard & Onboarding Overhaul (Phase 1: Stop False Success)

Phase 1 of the Setup Wizard & Onboarding overhaul addresses problems P1–P4, P6–P9 from the audit. It eliminates false success, connects provider choices directly to the backend catalogue, establishes an authoritative status endpoint, persists onboarding completion in SQLite, and streamlines the first-run wizard UI to 4 clean, human-friendly screens.

---

## User Review Required

> [!IMPORTANT]
> **Streamlined First-Run Funnel**: The loopback Phone Sharing step (P6) and Cloudflare Relay step (P18) are completely removed from the initial onboarding wizard. Both are moved to Settings where prerequisite checks (such as an HTTPS app URL or Cloudflare credentials) can be guided properly. First-run setup becomes 4 steps: **Welcome** (with privacy toggles), **Choose Your AI** (the only required step), **Connect Apps** (optional), and **Ready**.

> [!NOTE]
> **Pre-Save Verification**: Keys are verified against the provider's `/models` endpoint **before** saving. Invalid keys (401/403) will not be saved into `providers.yaml` or the OS keychain. Rate-limited keys (429) are saved with a clear warning.

---

## Open Questions

None. The frontier architectural decisions were confirmed:
1. Deliver Phase 1 (R1 to R6) as an immediate, clean milestone.
2. Ephemeral pre-save verification via `POST /api/providers/{name}/verify`.
3. Catalogue-driven provider cards with `base_url` under Advanced.
4. Setup status and completion persisted in SQLite `app_settings`.
5. Composio browser login with 5-minute countdown and cancel.

---

## Proposed Changes

```
┌────────────────────────────────────────────────────────┐
│                   Frontend (React)                     │
│  SplashScreenWizard.jsx ───> store.jsx ───> api.js    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP REST
┌──────────────────────────▼─────────────────────────────┐
│                   Backend (FastAPI)                    │
│  main.py (verify, setup/status, setup/complete)        │
│    ├── setup_status.py (System detection & SQLite)     │
│    ├── runtime/registry.py (model_lister)             │
│    └── provider_catalogue.py (Presets)                 │
└────────────────────────────────────────────────────────┘
```

---

### Backend Components

#### [NEW] `backend/setup_status.py`
Provides centralized detection and status aggregation:
- `get_setup_status()`:
  - **`model`**: Queries `configured_providers()`. Finds the first enabled provider with a valid key/local server and checks reachability via `availability.cached()`.
  - **`keychain`**: Tests keyring writability with a dry-run check; returns `writable: bool, storage_type: "keyring" | "file"`.
  - **`ollama`**: Checks `http://localhost:11434/api/tags` with a 1.5s timeout. Returns `{ running: bool, installed: bool, models: list[str] }`.
  - **`runtimes`**: Checks `shutil.which` for `"npx"`, `"uvx"`, `"ffmpeg"`, `"opencode"`.
  - **`composio`**: Checks if Composio API key is set in keychain or env; queries connected toolkits count.
  - **`connectors`**: Gathers connectors awaiting sign-in from `_mcp["errors"]` and counts active tools.
  - **`setup`**: Reads `setup.completed_at` and `setup.version` from `app_settings`.
- `mark_setup_complete(options: dict)`:
  - Updates `setup.completed_at = datetime.utcnow().isoformat()` and `setup.version = 1` in `app_settings`.
  - Persists optional privacy toggles (e.g. `browser.enabled`, `tray.enabled`) in `app_settings`.

```python
# Conceptual snippet: backend/setup_status.py
import shutil
import httpx
from datetime import datetime
from backend.db.connection import get_connection, transaction
from backend.config import configured_providers, has_key
from backend.runtime import availability

async def get_setup_status() -> dict:
    ...
```

#### [MODIFY] `backend/api/main.py`
1. **Add `POST /api/providers/{name}/verify`**:
   Accepts `{ key: str, base_url: str | None = None, default_model: str | None = None, adapter: str | None = None }`.
   Resolves headers and parse function via `backend.runtime.registry.model_lister(config)`.
   Dispatches `GET {base_url}/models` with 6s timeout:
   - Status 200: Returns `{ "valid": True, "status": "ok", "models": parsed_models, "latency_ms": elapsed }`.
   - Status 401/403: Returns `{ "valid": False, "status": "invalid_key", "message": "Invalid API key or unauthorized", "models": [] }`.
   - Status 429: Returns `{ "valid": True, "status": "rate_limited", "message": "Key is valid, but rate-limited or quota exceeded", "models": [] }`.
   - Network error: Returns `{ "valid": False, "status": "unreachable", "message": "Could not connect to provider endpoint", "models": [] }`.
   Does NOT write to disk or keychain.

2. **Add `GET /api/setup/status`**:
   Calls `backend.setup_status.get_setup_status()`.

3. **Add `POST /api/setup/complete`**:
   Calls `backend.setup_status.mark_setup_complete(body)`.

4. **Enrich `GET /api/providers` catalogue**:
   Include `free`, `core`, `adapter`, and `strengths` from `PROVIDER_PRESETS` in the catalogue array.

---

### Frontend Components

#### [MODIFY] `frontend/src/api.js`
Add API wrappers:
```javascript
verifyProvider: (name, body) => j(`/providers/${encodeURIComponent(name)}/verify`, json('POST', body)),
setupStatus: () => j('/setup/status'),
completeSetup: (body = {}) => j('/setup/complete', json('POST', body)),
```

#### [MODIFY] `frontend/src/store.jsx`
- At store initialization, invoke `api.setupStatus()` to check `status.setup.completed`.
- If `setup.completed` is true, sync `onboardingDoneRaw(true)`.
- When `setOnboardingDone(true)` is called, invoke `api.completeSetup()` to write to SQLite `app_settings` while saving to `localStorage`.

#### [MODIFY] `frontend/src/components/SplashScreenWizard.jsx`
Complete overhaul to the 4-step target wizard:
1. **Step 1: Welcome**:
   - System detection banner fed by `api.setupStatus()` ("Ollama running with 3 models" / "Ready for local or cloud AI").
   - Explicit consent toggles:
     - "Capture browser bookmarks from Firefox" (default OFF)
     - "Keep running in background tray when window closes" (default ON)
   - "Get Started" and "Skip Setup" buttons.
2. **Step 2: Choose Your AI**:
   - **Ollama Card**: Reads installed models from status; offers model dropdown or install guide.
   - **Free Cloud Model Card**: Dynamic list of presets with `free: true` (Groq, Cerebras, OpenCode Zen, Kilocode). External "Get a free key" link. Inline API key paste with live "Verify & Save" button. On success, sets as primary provider.
   - **I Have an API Key Card**: Dropdown of all catalogue presets. "Advanced" collapsible accordion for custom `base_url` or custom model name.
3. **Step 3: Connect Apps (Optional)**:
   - **Composio**: One-click "Sign In with Composio" button via `api.startComposioLogin()` opening browser tab, with 5-minute visible countdown and "Cancel" button. 6 quick-connect cards for Gmail, Calendar, Slack, GitHub, Linear, Notion.
   - **Local MCPs**: Microsoft To Do (device code inline), Vercel. Honest badges indicating runtime requirement (e.g. "Needs Node.js" if `npx` is missing).
4. **Step 4: Ready**:
   - Live checklist populated from `setup/status`:
     - Local storage: `✓ Ready`
     - AI Model: `✓ {verified_model_name}` (or warning if skipped)
     - Connected Apps: `✓ {tool_count} tools ready`
   - Curated starter prompts.
   - "Finish Setup" button calling `api.completeSetup()`.

#### [MODIFY] `frontend/src/index.css`
- Add CSS rules for verification feedback states, countdown timers, runtime requirement badges (`splash-badge-runtime`), and privacy toggle rows.

---

### Automated Tests

#### [NEW] `tests/test_setup_wizard_phase1.py`
Unit and integration tests using `pytest` and `httpx.AsyncClient` test client:
1. Test `POST /api/providers/{name}/verify`:
   - Mock 200 `/models` response -> asserts `valid: True`, `status: "ok"`, models list.
   - Mock 401 `/models` response -> asserts `valid: False`, `status: "invalid_key"`.
   - Mock 429 response -> asserts `valid: True`, `status: "rate_limited"`.
   - Verify `providers.yaml` and keychain were untouched by failed verification.
2. Test `GET /api/setup/status`:
   - Asserts returned schema (`model`, `keychain`, `ollama`, `runtimes`, `composio`, `connectors`, `setup`).
3. Test `POST /api/setup/complete`:
   - Asserts `setup.completed_at` and `setup.version` written into SQLite `app_settings`.
4. Test `GET /api/providers`:
   - Asserts `free`, `core`, `adapter`, `strengths` present in catalogue preset items.

---

## Verification Plan

### Automated Tests
Run backend test suite:
```bash
uv run pytest tests/test_setup_wizard_phase1.py -v
uv run pytest tests/test_providers_and_fallback.py -v
```
Run frontend linter and smoke tests:
```bash
cd frontend && npm run lint
```

### Manual Verification
1. Launch app with fresh backend:
   - Splash screen displays Welcome screen with detected system info and privacy toggles.
2. Step 2 (Choose AI):
   - Enter an intentionally wrong API key (e.g. `sk-invalid-12345`) for Groq or OpenCode Zen and click "Verify & Save".
   - Confirm: Key check fails with exact provider error, button re-enables, nothing is saved to `providers.yaml`.
   - Enter a valid key (or select local Ollama).
   - Confirm: Verification succeeds with green checkmark, provider is saved as primary.
3. Step 3 (Connect Apps):
   - Confirm Composio button starts browser login with countdown timer and cancel option.
   - Confirm missing runtimes show honest "Needs Node.js" badge instead of false "Ready".
4. Step 4 (Ready):
   - Confirm live checklist displays the verified model name and accurate tool count.
   - Click "Finish Setup" and verify the main Chat interface mounts.
   - Restart the server on a different port (e.g. 8001); verify wizard does not reappear and onboarding state persists.
