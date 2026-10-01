# Phase 4: Later Flows and Clean-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

### Task 1: Terminal Wizard Secret Storage Consolidation (R16)

**Files:**
- Modify: `scripts/setup_wizard.py`
- Create: `tests/test_terminal_wizard_secrets.py`

**Interfaces:**
- Consumes: `backend.secrets.set_secret`, `backend.config.add_provider`
- Produces: Keychain-stored secrets without plaintext `.env` leakage

- [ ] **Step 1: Write test in `tests/test_terminal_wizard_secrets.py`**
  Verify setting an AI key in `scripts/setup_wizard.py` writes to `set_secret` and `add_provider` without modifying `.env`.
- [ ] **Step 2: Update `scripts/setup_wizard.py`**
  Replace `write_env_key` calls for API keys with `set_secret` and `add_provider`.
- [ ] **Step 3: Run tests and verify**
  `uv run pytest tests/test_terminal_wizard_secrets.py -v`.

---

### Task 2: Cloudflare Relay Configuration & Guided Deploy (R18)

**Files:**
- Modify: `relay/wrangler.jsonc`
- Create: `backend/relay_deploy.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_relay_deploy.py`

**Interfaces:**
- Consumes: Cloudflare API token
- Produces: Cloudflare token verification, D1 check, and deploy routes

- [ ] **Step 1: Update `relay/wrangler.jsonc`**
  Fix project name drift (`psok-relay` -> `amethyst-relay`) and replace personal database id with placeholder.
- [ ] **Step 2: Write test in `tests/test_relay_deploy.py`**
  Test Cloudflare token validation and D1 database discovery.
- [ ] **Step 3: Implement `backend/relay_deploy.py` and API routes**
  Implement `verify_cloudflare_token` and `check_or_create_d1`, route at `POST /api/relay/verify`.
- [ ] **Step 4: Run tests and verify**
  `uv run pytest tests/test_relay_deploy.py -v`.

---

### Task 3: Cloudflare Workers AI Account ID Substitution (R19)

**Files:**
- Modify: `backend/provider_catalogue.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_workers_ai_provider.py`

**Interfaces:**
- Consumes: `account_id` in provider add/verify
- Produces: Resolved base URL for Cloudflare Workers AI

- [ ] **Step 1: Write test in `tests/test_workers_ai_provider.py`**
  Verify adding `cloudflare` with `account_id` properly substitutes `ACCOUNT_ID` in the base URL.
- [ ] **Step 2: Update `backend/provider_catalogue.py` and `backend/api/main.py`**
  Support `account_id` substitution in `verify_provider_route` and `add_provider_route`.
- [ ] **Step 3: Run tests and verify**
  `uv run pytest tests/test_workers_ai_provider.py -v`.

---

### Task 4: Dead Code Elimination & Loader Extraction (R20)

**Files:**
- Create: `frontend/src/components/LoaderIcon.jsx`
- Modify: `frontend/src/views/Chat.jsx`
- Modify: `frontend/src/views/Settings.jsx`
- Modify: `frontend/src/components/SplashScreenWizard.jsx`
- Modify: `frontend/tests/theme_color_system.mjs`
- Delete: `frontend/src/components/OnboardingWizard.jsx`

**Interfaces:**
- Consumes: Extracted `LoaderIcon`
- Produces: Zero broken imports and removed dead `OnboardingWizard.jsx`

- [ ] **Step 1: Create `frontend/src/components/LoaderIcon.jsx`**
  Export `LoaderIcon` component from original `OnboardingWizard.jsx`.
- [ ] **Step 2: Update imports in `Chat.jsx`, `Settings.jsx`, and `SplashScreenWizard.jsx`**
  Point to `./LoaderIcon.jsx`.
- [ ] **Step 3: Delete `frontend/src/components/OnboardingWizard.jsx` and update `theme_color_system.mjs`**
  Delete file and verify theme color system test.
- [ ] **Step 4: Verify with `npm run lint` and `node tests/theme_color_system.mjs`**

---

### Task 5: OpenRouter OAuth PKCE Integration (R21)

**Files:**
- Create: `backend/auth/openrouter_pkce.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_openrouter_pkce.py`

**Interfaces:**
- Consumes: OpenRouter OAuth PKCE flow
- Produces: `POST /api/auth/openrouter/start` and `POST /api/auth/openrouter/exchange`

- [ ] **Step 1: Write test in `tests/test_openrouter_pkce.py`**
  Verify challenge generation and token exchange payload formatting.
- [ ] **Step 2: Implement `backend/auth/openrouter_pkce.py` and routes**
- [ ] **Step 3: Run tests and verify**
  `uv run pytest tests/test_openrouter_pkce.py -v`.

---

### Task 6: AgentMail Keychain Integration (R22)

**Files:**
- Modify: `backend/mail/agentmail.py`
- Modify: `backend/api/main.py`
- Create: `tests/test_agentmail_keychain.py`

**Interfaces:**
- Consumes: `amethyst/agentmail` secret reference
- Produces: Keychain-backed AgentMail credential lookup

- [ ] **Step 1: Write test in `tests/test_agentmail_keychain.py`**
  Verify `_api_key()` reads from keychain reference before checking environment variable.
- [ ] **Step 2: Update `backend/mail/agentmail.py` and add API routes**
  Add keychain lookup to `_api_key()`, add `POST /api/mail/agentmail/key` endpoint.
- [ ] **Step 3: Run tests and verify**
  `uv run pytest tests/test_agentmail_keychain.py -v`.

---

### Task 7: Setup Resumption at Earliest Incomplete Step (R23)

**Files:**
- Modify: `frontend/src/components/SplashScreenWizard.jsx`

**Interfaces:**
- Consumes: `setupStatus`
- Produces: Dynamic resumption step calculation

- [ ] **Step 1: Implement `determineInitialStep` in `SplashScreenWizard.jsx`**
  Calculate resumption step based on model verification and connector status.
- [ ] **Step 2: Verify lint and build**
  `cd frontend && npm run lint && npm run build`.

---

### Task 8: Full Overhaul Verification Gate

- [ ] **Step 1: Run complete backend test suite across all 4 phases**
- [ ] **Step 2: Run frontend build and linter**
- [ ] **Step 3: Create final Phase 4 walkthrough document**
