# Setup Wizard & Onboarding Architecture (Phase 1: Stop False Success)

**Date**: 18 Oct 2026  
**Status**: Proposed  
**Scope**: Phase 1 Roadmap (R1 to R6), fixing P1–P4, P6–P9 from the Setup Wizard & Onboarding Audit.

---

## 1. Context & Objectives

The Amethyst Setup Wizard today suffers from three critical flaws:
1. **False Success**: The key check reports "Verified" for invalid keys (P1) because `availability.ping()` treats HTTP 401 as reachable by design, and `SplashScreenWizard.jsx` persists the key into `providers.yaml` and the keychain *before* testing it (P3).
2. **Catalog & Preset Drift**: The wizard relies on a hard-coded array (`PRIMARY_PROVIDERS`) that overrides the backend catalogue (`backend/provider_catalogue.py`), resulting in broken URLs (OpenCode Zen gets `/api/v1` instead of `/zen/v1`) and wrong adapters (Gemini using an OpenAI proxy base URL rather than the native `google` adapter) (P2).
3. **Misplaced Steps & Ephemeral State**: Non-working developer steps (loopback phone sharing P6, Cloudflare relay P18) block the first-run experience, while onboarding completion state lives solely in origin-partitioned `localStorage` (P9), causing preference resets whenever Electron selects a different port (8000 vs 8001).

### Goals for Phase 1
- **R1**: Add pre-save provider verification endpoint `POST /api/providers/{name}/verify` that performs an authenticated test call against `/models` via `model_lister(config)`. Reject 401/403 with provider error details; treat 429 as valid but quota-exhausted; return live models without writing to disk or keychain.
- **R2**: Render wizard provider choices dynamically from `GET /api/providers` catalogue; expose `free`, `core`, `adapter`, and `strengths` flags; hide `base_url` and `default_model` under an Advanced accordion.
- **R3**: Add `GET /api/setup/status` providing single-source-of-truth status (verified model, keychain writability, Ollama state/models, runtimes on path, Composio link state, connectors awaiting sign-in).
- **R4**: Persist setup completion in SQLite `app_settings` (`setup.completed_at`, `setup.version`) via `POST /api/setup/complete`, using `store.jsx` / `localStorage` as a fast local cache.
- **R5**: Remove loopback Phone Sharing and Cloudflare Relay steps from the first-run wizard; move phone pairing to Settings where HTTPS / relay prerequisites can be verified.
- **R6**: Integrate Composio browser sign-in into the wizard (`api.startComposioLogin` + polling) with visible countdown and cancel button, keeping manual key entry as fallback.

---

## 2. Backend Architecture

### 2.1 Provider Verification (`POST /api/providers/{name}/verify`)
Located in `backend/api/main.py` and `backend/runtime/registry.py`:

```python
class VerifyProviderRequest(BaseModel):
    key: str
    base_url: str | None = None
    default_model: str | None = None
    adapter: str | None = None

class VerifyProviderResponse(BaseModel):
    valid: bool
    status: str  # "ok", "invalid_key", "rate_limited", "unreachable"
    message: str
    models: list[dict[str, Any]] = []
    latency_ms: int = 0
```

**Verification Flow**:
1. Resolve provider configuration:
   - If `name` matches a preset in `backend.provider_catalogue.PROVIDER_PRESETS`, inherit preset defaults (`base_url`, `adapter`, `default_model`).
   - Override with any explicit fields in the request body.
2. Build ephemeral `ProviderConfig(name=name, base_url=base_url, api_key_ref=None, provider=adapter)`.
3. Resolve headers and parser using `backend.runtime.registry.model_lister(config)`.
4. Dispatch authenticated HTTP `GET {base_url}/models` with a 6.0s timeout:
   - **200 OK**: Parse models payload, filter/normalize capabilities, return `valid=True, status="ok"`.
   - **401 Unauthorized / 403 Forbidden**: Return `valid=False, status="invalid_key", message=exc.response.text`.
   - **429 Too Many Requests**: Return `valid=True, status="rate_limited", message="Valid API key, but currently rate-limited or quota-exhausted"`.
   - **Network error / timeout**: Return `valid=False, status="unreachable", message="Could not connect to endpoint"`.
5. **CRITICAL**: No writes to `providers.yaml`, `~/.amethyst/`, or `keyring`.

### 2.2 Setup Status (`backend/setup_status.py` & `GET /api/setup/status`)
A dedicated module `backend/setup_status.py` aggregates:
- **`model`**: `{ verified: bool, provider: str | None, model: str | None, source: str }`
- **`keychain`**: `{ writable: bool, storage_type: "keyring" | "file", file_path: str | None }`
- **`ollama`**: `{ running: bool, installed: bool, models: list[str], endpoint: str }`
- **`runtimes`**: `{ npx: bool, uvx: bool, ffmpeg: bool, opencode: bool }`
- **`composio`**: `{ linked: bool, connected_apps: list[str] }`
- **`connectors`**: `{ awaiting_sign_in: list[str], active_tools: int }`
- **`setup`**: `{ completed: bool, completed_at: str | None, version: int }`

### 2.3 Setup Persistence (`POST /api/setup/complete`)
- Writes `setup.completed_at = <ISO8601>` and `setup.version = 1` into SQLite `app_settings`.
- If user selected initial privacy preferences (e.g. `browser.enabled`, `tray.enabled`), sets these keys in `app_settings` within the same transaction.

### 2.4 Catalogue Enrichment in `GET /api/providers`
Extend catalogue payload in `list_providers()`:
```python
"catalogue": [
    {
        "slug": preset.slug,
        "label": preset.label,
        "base_url": preset.base_url,
        "default_model": preset.default_model,
        "context_window": preset.context_window,
        "keys_url": preset.keys_url,
        "docs_url": preset.docs_url,
        "local": preset.local,
        "note": preset.note,
        "free": preset.free,
        "core": preset.core,
        "adapter": preset.adapter,
        "strengths": sorted(preset.strengths),
        "listed": preset.slug in listed,
    }
    for preset in PROVIDER_PRESETS
]
```

---

## 3. Frontend Wizard UI Overhaul (`SplashScreenWizard.jsx`)

The wizard transforms from 5 developer-centric steps to 4 human-friendly steps:

```
[ Step 1: Welcome ] ──> [ Step 2: Choose Your AI ] ──> [ Step 3: Connect Apps ] ──> [ Step 4: Ready ]
```

### Screen 1: Welcome & System Detection
- **Hero Title**: "Welcome to Amethyst"
- **Detected Environment Card**:
  - Live chip: "Ollama is running with N models" / "Ready for local or cloud AI".
- **Explicit Privacy & Daemon Toggles** (fixing P19 & P11):
  - `[Toggle]` *Read browser bookmarks* (default OFF).
  - `[Toggle]` *Keep background automations active in system tray when closed* (default ON).
- **Actions**: "Get Started" (primary) and "Skip Setup" (subtle link; skipping still preserves composer prompt banner).

### Screen 2: Choose Your AI (The Only Required Step)
Segmented or tabbed into 3 clear cards:
1. **On This Computer (Ollama)**:
   - If running with models: Select model dropdown + "Set as Default".
   - If running without models: Notice with quick command `ollama run llama3.2` and download guide.
   - If not running: Link to `ollama.com` with a 1-click "Check Again" probe.
2. **Free Cloud Model (Recommended No-Card Options)**:
   - Rendered from catalogue where `free === true` (Groq, Cerebras, OpenCode Zen, Kilocode).
   - "Get a free API key" external link to provider console.
   - API key input field with "Verify & Save" button:
     - Calls `api.verifyProvider(name, { key })`.
     - Shows live spinner during verification.
     - On success: Green `--live` checkmark, populates model picker, automatically saves via `api.addProvider` and sets as primary provider.
     - On failure: Amber/Red alert with exact reason returned from provider (e.g. `Invalid API Key (401)`).
3. **I Have an API Key**:
   - Searchable preset select across all 21 catalogue presets.
   - Key paste with pre-save verification.
   - "Advanced Configuration" accordion (collapsed by default) for custom `base_url` or custom model name.

### Screen 3: Connect Your Apps (Optional)
- **Cloud Apps (Composio)**:
  - If not linked: "Sign In with Composio" button using `api.startComposioLogin()` opening browser tab, polling with visible 5-minute countdown and "Cancel" button.
  - Collapsible fallback: "Or paste Composio API Key".
  - Once linked: 6 curated app cards (Gmail, Google Calendar, Slack, GitHub, Linear, Notion) with 1-click connect toggles.
- **Local Connectors**:
  - Microsoft To Do (device code flow), Vercel.
  - Honest badges: If Node/npx is missing on machine, display "Needs Node.js" chip with link, rather than misleading "Ready" label (P8).
- **Navigation**: "Continue" is always enabled; nothing here blocks progress.

### Screen 4: Ready to Launch
- **Live Checklist** (strictly fed by `setup/status`, no hardcoded values):
  - Storage & Database: `✓ Local SQLite Connected`
  - AI Engine: `✓ {model_name} via {provider}` (or warning if skipped)
  - Connected Tools: `✓ {active_tools} tools ready` (or `0 tools connected`)
- **Quick Starter Prompts**: 3 curated prompts matching configured apps.
- **Finish Button**: Calls `api.completeSetup()`, updates store `onboardingDone = true`, and enters Chat view.

---

## 4. Design System Compliance
- **Typography**: Inter for display/UI, Geist Mono for code/keys/latencies.
- **Tokens**:
  - Fills: `--canvas`, `--surface`, `--accent`.
  - Status: `--live` (#149e61) for verified success, `--confirm` (amber) for rate limits, `--stop` (red) for invalid keys. **Purple is never used as a status.**
  - Radii: capsules (`--radius-buttons`: 9999px) for buttons, `--radius-cards` (6px–10px) for cards.
  - Motion: Entrance transitions under 200ms; reduced motion strictly respected via `useReducedMotion()`.

---

## 5. Testing & Verification Plan

### Backend Unit & Integration Tests (`tests/test_setup_wizard_phase1.py`)
1. Test `POST /api/providers/{name}/verify`:
   - Mock 200 `/models` response -> returns `valid: True` and models list.
   - Mock 401 response -> returns `valid: False, status: "invalid_key"` and preserves clean providers.yaml.
   - Mock 429 response -> returns `valid: True, status: "rate_limited"`.
2. Test `GET /api/setup/status`:
   - Verify structure, Ollama probing, runtime paths detection, keyring health check.
3. Test `POST /api/setup/complete`:
   - Verifies SQLite `app_settings` writes `setup.completed_at` and `setup.version`.
4. Test `GET /api/providers`:
   - Verifies `free`, `core`, `adapter`, `strengths` fields in catalogue presets.

### Frontend Smoke & Lint
- Run `npm run lint` (`oxlint`) to verify 0 syntax/hook errors.
- Run `node tests/smoke.mjs` against a test server.
