# Phase 4: Later Flows and Clean-up Design Specification

**Date**: 2026-10-18  
**Scope**: Phase 4 Roadmap (R16, R18, R19, R20, R21, R22, R23)  
**Status**: In Progress  

---

## 1. Overview & Objectives

Phase 4 concludes the Amethyst Setup Wizard & Onboarding Audit roadmap. While Phase 1 hardened verification, Phase 2 secured desktop reliability, and Phase 3 streamlined connectors, Phase 4 cleans up lingering architectural debt, eliminates dead code, consolidates secret storage, guides post-setup flows, and ensures clean resumption:

1. **R16: Terminal Wizard Secret Storage Consolidation (`scripts/setup_wizard.py`)**  
   - Eliminates writing plaintext secrets into `.env` and `mcp.yaml`.  
   - Routes credential saving through `backend.secrets.set_secret` (OS keychain or consented fallback) and provider configuration through `backend.config.add_provider`.

2. **R18: Guided Cloudflare Relay Deploy & Placeholder Fix (`backend/relay_deploy.py`, `relay/wrangler.jsonc`)**  
   - Fixes `relay/wrangler.jsonc` name drift (`psok-relay` -> `amethyst-relay`) and placeholders.  
   - Provides helper in `backend/relay_deploy.py` to validate Cloudflare API tokens, check/create D1 databases, and deploy the relay.

3. **R19: Cloudflare Workers AI as a Standard Provider Preset (`backend/provider_catalogue.py`, `backend/api/main.py`)**  
   - Updates `cloudflare` preset to support `{account_id}` URL substitution when adding or verifying providers.  
   - Removes obsolete custom fields and aligns with the standard OpenAI-compatible adapter.

4. **R20: Dead Code Elimination & Loader Extraction (`frontend/src/components/LoaderIcon.jsx`, `OnboardingWizard.jsx`)**  
   - Extracts `LoaderIcon` to `frontend/src/components/LoaderIcon.jsx`.  
   - Deletes obsolete `frontend/src/components/OnboardingWizard.jsx` (600 lines of dead code).  
   - Updates imports in `Chat.jsx`, `Settings.jsx`, `SplashScreenWizard.jsx`, and aligns `frontend/tests/theme_color_system.mjs`.

5. **R21: OpenRouter OAuth PKCE Integration (`backend/api/main.py`, `backend/runtime/providers/openrouter.py`)**  
   - Evaluates and provides backend support for OpenRouter OAuth PKCE (`https://openrouter.ai/auth` with loopback redirect `http://localhost:8765/oauth2callback`).  
   - Enables 1-click token exchange for users preferring browser sign-in over copy-pasting API keys.

6. **R22: AgentMail Keychain Integration (`backend/mail/agentmail.py`, `backend/api/main.py`)**  
   - Updates `_api_key()` in `backend/mail/agentmail.py` to resolve from OS keychain (`amethyst/agentmail.api_key` or `amethyst/agentmail`) with `.env` fallback.  
   - Adds endpoints to get status and store AgentMail key securely.

7. **R23: Setup Wizard Resumption at Earliest Incomplete Step (`frontend/src/components/SplashScreenWizard.jsx`)**  
   - Inspects `setupStatus` when opening the wizard:  
     - If AI model is not verified: jumps directly to Step 2 (AI Engine).  
     - If AI model is verified but connectors require attention: jumps to Step 3 (Connect Apps).  
     - Otherwise starts at Step 1 (Welcome).  
   - Never resets or overwrites previously configured providers or preferences.

---

## 2. Technical Design & Architecture

### 2.1 R16: Terminal Wizard Secret Storage Consolidation
In `scripts/setup_wizard.py`:
- Remove `write_env_key(...)` for secrets.
- For AI providers:
  - Call `backend.secrets.set_secret(f"amethyst/{name}", key)`.
  - Call `backend.config.add_provider(...)` so `providers.yaml` is updated immediately.
- For Google Workspace / GitHub / Spotify connectors:
  - Call `backend.secrets.set_secret(...)`.
  - Use `backend.mcp.commands.add_from_catalogue(...)`.

### 2.2 R18: Guided Relay Deploy & Placeholder Fix
- In `relay/wrangler.jsonc`:
  - Change `"name": "psok-relay"` -> `"name": "amethyst-relay"`.
  - Change `"database_name": "psok-relay"` -> `"database_name": "amethyst-relay"`.
  - Change hardcoded database ID -> `"YOUR_D1_DATABASE_ID"`.
- In `backend/relay_deploy.py`:
  - Implement `async def verify_cloudflare_token(token: str) -> tuple[bool, str]`.
  - Implement `async def check_or_create_d1(token: str, account_id: str, db_name: str = "amethyst-relay") -> dict[str, Any]`.
  - Expose API endpoints `/api/relay/verify` and `/api/relay/deploy`.

### 2.3 R19: Workers AI Provider Preset
- In `backend/provider_catalogue.py`:
  - Update `cloudflare` preset base URL format to `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`.
- In `backend/api/main.py`:
  - In `add_provider_route` and `verify_provider_route`:
    - Accept `account_id: str | None = None`.
    - If `account_id` is supplied and `base_url` contains `{account_id}` or `ACCOUNT_ID`, perform string replacement.

### 2.4 R20: Delete OnboardingWizard.jsx & Extract LoaderIcon
- Create `frontend/src/components/LoaderIcon.jsx` containing `LoaderIcon({ type, size })`.
- Update imports:
  - `frontend/src/views/Chat.jsx`: `import { LoaderIcon } from '../components/LoaderIcon.jsx'`
  - `frontend/src/views/Settings.jsx`: `import { LoaderIcon } from '../components/LoaderIcon.jsx'`
  - `frontend/src/components/SplashScreenWizard.jsx`: `import { LoaderIcon } from './LoaderIcon.jsx'`
- Delete `frontend/src/components/OnboardingWizard.jsx`.
- Update `frontend/tests/theme_color_system.mjs` to remove reference to `OnboardingWizard.jsx`.

### 2.5 R21: OpenRouter OAuth PKCE
- Implement `backend/auth/openrouter_pkce.py` with:
  - `generate_pkce_challenge()` -> `(verifier, challenge)`.
  - `exchange_code(code, verifier)` -> `api_key`.
- Wire into `backend/api/main.py`:
  - `POST /api/auth/openrouter/start`: returns auth URL with code challenge.
  - `POST /api/auth/openrouter/exchange`: exchanges authorization code for API key and saves to keychain under `amethyst/openrouter`.

### 2.6 R22: AgentMail Keychain Integration
- In `backend/mail/agentmail.py`:
  - Import `get_secret` from `backend.secrets`.
  - `_api_key()` returns `get_secret("amethyst/agentmail") or get_secret("amethyst/agentmail.api_key") or os.environ.get("AGENTMAIL_API_KEY")`.
- In `backend/api/main.py`:
  - `POST /api/mail/agentmail/key` saving key to `amethyst/agentmail`.
  - `GET /api/mail/agentmail/status` reporting whether configured and reaching inbox.

### 2.7 R23: Setup Wizard Resumption
- In `frontend/src/components/SplashScreenWizard.jsx`:
  - Add `determineInitialStep(status)`:
    - If `!status?.model?.verified` -> Step 1 (index 1: AI Engine).
    - Else if `status?.connectors?.awaiting_sign_in?.length > 0` -> Step 2 (index 2: Connect Apps).
    - Else -> Step 0 (index 0: Welcome).
  - Automatically initialize `step` when opened after previous completion without clobbering in-progress state.

---

## 3. Verification Plan

### Automated Tests
1. `tests/test_terminal_wizard_secrets.py`: Verifies `scripts/setup_wizard.py` uses `set_secret` and `add_provider` without writing plaintext `.env` secrets (R16).
2. `tests/test_relay_deploy.py`: Verifies Cloudflare token verification and D1 database handling (R18).
3. `tests/test_workers_ai_provider.py`: Verifies `cloudflare` preset account ID substitution and model verification (R19).
4. `tests/test_openrouter_pkce.py`: Verifies PKCE challenge generation, loopback callback exchange, and secret persistence (R21).
5. `tests/test_agentmail_keychain.py`: Verifies AgentMail reads from keychain reference (R22).
6. Frontend tests:
   - `npm run lint` in `frontend/`.
   - `node tests/theme_color_system.mjs`.
   - `npm run build` in `frontend/`.
