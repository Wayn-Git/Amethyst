# Desktop Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely replace the legacy onboarding wizard with the floating window design from `docs/UI/mobile/Amethyst Desktop Onboarding.html`, wired to live backend data (local Ollama, Composio, Google Drive, Contract v2 LAN pairing, local profile) with rich animations and dynamic OS copy.

**Architecture:** A modular React component structure under `frontend/src/components/onboarding/` orchestrated by `SplashScreenWizard.jsx`. Uses `framer-motion` for spring transitions and floating ambient satellites, an authentic perforated ticket divider (`.pf`), live backend probing for Ollama and Contract v2 pairing, and instant theme synchronization with `store.jsx`.

**Tech Stack:** React 18, `framer-motion`, CSS Modules / Scoped CSS, FastAPI backend (`/api/setup`, `/api/providers`, `/api/integrations`, `:8443/api/pair`), Node.js `node:test` test suites.

**Spec:** `docs/superpowers/specs/2026-11-08-desktop-onboarding-redesign.md`

## Global Constraints

- Never use fake or mocked mock data: wire to real endpoints (`api.detectModels()`, `api.verifyProvider()`, `api.updateLibraryCloudStorage()`, `api.startPairingV2()`, `api.updateUserProfile()`, `api.completeSetup()`).
- Suppress legacy Cloudflare and `rmy.ch` HTTP Shortcuts references completely.
- Window is not full screen: centered floating window (`width: min(1280px, 94vw); height: min(800px, 90vh)`) with rounded corners (`20px`) and inner card (`960×540px`).
- Bottom disclaimer must adapt dynamically: "Everything stays on this Mac" (macOS), "Everything stays on this PC" (Windows), or "Everything stays on this Linux machine" (Linux).
- Honor `prefers-reduced-motion` using `useReducedMotion()`.
- Use the authentic Amethyst gem logo (`AmethystLogo.jsx`).

## Review Focus

1. **Offline / No Outbound Network**: System must default cleanly to Local Ollama and Local Vault storage without crashing or freezing if external APIs cannot be reached.
2. **Ollama Probing Latency / Failure**: Probing `localhost:11434` must timeout gracefully within 1.5 seconds so user is never blocked on Step 2.
3. **Mobile LAN Firewall / Connection Refused**: If phone cannot reach port 8443 on the PC, pairing screen must show firewall guidance and keep "Pair later from Settings" fully functional.
4. **Theme Immediate DOM Sync**: Choosing a theme or accent in Step 1 must update document tokens immediately so the onboarding window itself theme-morphs without requiring a reload.
5. **Form Validation**: Step 1 must prevent empty Display Name submissions with clear inline feedback.

---

### Task 1: OS Detection Utility & Floating Window Frame

**Files:**
- Create: `frontend/src/components/onboarding/clientOS.js`
- Create: `frontend/src/components/onboarding/OnboardingWindow.jsx`
- Create: `frontend/src/components/onboarding/onboarding.css`
- Test: `frontend/tests/onboarding-os.test.mjs`

**Interfaces:**
- Produces: `getClientOS(): 'Mac' | 'PC' | 'Linux machine' | 'computer'`
- Produces: `OnboardingWindow({ children, step, totalSteps, onBack, onSkip })`

- [ ] **Step 1: Write the failing test for OS detection**

```javascript
// frontend/tests/onboarding-os.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { getClientOSFromUA } from '../src/components/onboarding/clientOS.js'

test('detects macOS from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'Mac')
})

test('detects Windows from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'PC')
})

test('detects Linux from user agent', () => {
  assert.equal(getClientOSFromUA('Mozilla/5.0 (X11; Linux x86_64)'), 'Linux machine')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-os.test.mjs`  
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `clientOS.js`, `OnboardingWindow.jsx`, and `onboarding.css`**

Implement OS detection function and the floating window shell featuring window traffic lights, `#2441ff` gradient background, `960×540px` inner card, and perforated ticket edge (`.pf`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-os.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/clientOS.js frontend/src/components/onboarding/OnboardingWindow.jsx frontend/src/components/onboarding/onboarding.css frontend/tests/onboarding-os.test.mjs
git commit -m "feat(onboarding): add client OS detection and floating window container"
```

---

### Task 2: Splash & Welcome Screens

**Files:**
- Create: `frontend/src/components/onboarding/StepSplash.jsx`
- Create: `frontend/src/components/onboarding/StepWelcome.jsx`
- Test: `frontend/tests/onboarding-welcome.test.mjs`

**Interfaces:**
- Consumes: `AmethystLogo.jsx`, `clientOS.js`
- Produces: `StepSplash({ onReady })`
- Produces: `StepWelcome({ onStart })`

- [ ] **Step 1: Write the failing test for Welcome screen structure**

```javascript
// frontend/tests/onboarding-welcome.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepWelcome source contains 4 floating satellite chips and get-started action', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepWelcome.jsx', 'utf8')
  assert.match(content, /Meet Amethyst\./)
  assert.match(content, /Get started/)
  assert.match(content, /AI/)
  assert.match(content, /Files/)
  assert.match(content, /Phone/)
  assert.match(content, /Apps/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-welcome.test.mjs`  
Expected: FAIL with ENOENT

- [ ] **Step 3: Implement `StepSplash.jsx` and `StepWelcome.jsx`**

- `StepSplash.jsx`: Centered squircle badge with Amethyst logo, loading bar, "Starting local services" status, auto-calls `onReady` once `api.setupStatus()` or ping succeeds.
- `StepWelcome.jsx`: Left pane with headline, description, "Get started" button with arrow; right pane with 164×164px center badge and 4 floating animated satellite pills (`AI`, `Files`, `Phone`, `Apps`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-welcome.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepSplash.jsx frontend/src/components/onboarding/StepWelcome.jsx frontend/tests/onboarding-welcome.test.mjs
git commit -m "feat(onboarding): implement splash boot and welcome hero screens"
```

---

### Task 3: Step 1 — Profile & Theme Customizer

**Files:**
- Create: `frontend/src/components/onboarding/StepProfile.jsx`
- Test: `frontend/tests/onboarding-profile.test.mjs`

**Interfaces:**
- Consumes: `useApp()`, `api.updateUserProfile()`
- Produces: `StepProfile({ onNext, onBack })`

- [ ] **Step 1: Write the failing test for StepProfile**

```javascript
// frontend/tests/onboarding-profile.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepProfile implements 9 themes and 5 accents matching Settings', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepProfile.jsx', 'utf8')
  for (const theme of ['system', 'graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']) {
    assert.ok(content.includes(theme), `Missing theme: ${theme}`)
  }
  for (const accent of ['#7132f5', '#2563eb', '#10b981', '#f43f5e', '#f59e0b']) {
    assert.ok(content.includes(accent), `Missing accent: ${accent}`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-profile.test.mjs`  
Expected: FAIL with ENOENT

- [ ] **Step 3: Implement `StepProfile.jsx`**

Implement Display Name, Full Name, `@handle` inputs, Avatar monogram/photo badge, 9 theme preview cards, 5 accent swatches. Selecting theme/accent calls `setTheme()` and `setAccent()` in `useApp()` store for immediate visual update.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-profile.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepProfile.jsx frontend/tests/onboarding-profile.test.mjs
git commit -m "feat(onboarding): add profile and live theme customization step"
```

---

### Task 4: Step 2 — AI Engine Discovery & Cloud Keys

**Files:**
- Create: `frontend/src/components/onboarding/StepAiEngine.jsx`
- Test: `frontend/tests/onboarding-ai-engine.test.mjs`

**Interfaces:**
- Consumes: `api.detectModels()`, `api.providers()`, `api.verifyProvider()`
- Produces: `StepAiEngine({ onNext, onBack, onSkip })`

- [ ] **Step 1: Write the failing test for StepAiEngine**

```javascript
// frontend/tests/onboarding-ai-engine.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepAiEngine probes local Ollama and lists free cloud providers', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepAiEngine.jsx', 'utf8')
  assert.match(content, /localhost:11434/)
  assert.match(content, /detectModels/)
  assert.match(content, /Groq/)
  assert.match(content, /Gemini|Google/)
  assert.match(content, /Skip for now/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-ai-engine.test.mjs`  
Expected: FAIL with ENOENT

- [ ] **Step 3: Implement `StepAiEngine.jsx`**

- Probes local Ollama at `localhost:11434/v1` via `api.detectModels()`.
- Renders detected models as chips (`llama3.2:3b`, etc.) with benefit tagline "Private · No API cost · Works offline".
- Lists free cloud providers (Groq, Gemini, Kilo) with fast paste button and live credential verification test.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-ai-engine.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepAiEngine.jsx frontend/tests/onboarding-ai-engine.test.mjs
git commit -m "feat(onboarding): add Ollama local scan and cloud AI provider step"
```

---

### Task 5: Step 3 — Storage & Knowledge (Google Drive & Composio)

**Files:**
- Create: `frontend/src/components/onboarding/StepStorage.jsx`
- Test: `frontend/tests/onboarding-storage.test.mjs`

**Interfaces:**
- Consumes: `api.updateLibraryCloudStorage()`, `api.integrations()`
- Produces: `StepStorage({ onNext, onBack })`

- [ ] **Step 1: Write the failing test for StepStorage**

```javascript
// frontend/tests/onboarding-storage.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepStorage has Composio API key, Google Drive Amethyst root, and optional toolkits', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepStorage.jsx', 'utf8')
  assert.match(content, /Composio/)
  assert.match(content, /Google Drive/)
  assert.match(content, /My Drive \/ Amethyst \//)
  assert.match(content, /Gmail/)
  assert.match(content, /Slack/)
  assert.match(content, /GitHub/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-storage.test.mjs`  
Expected: FAIL with ENOENT

- [ ] **Step 3: Implement `StepStorage.jsx`**

- Required section: Composio API key input and Google Drive account connection row with root directory `My Drive / Amethyst /`.
- Optional toolkits: 3-column grid for Gmail, Google Calendar, Slack, GitHub, Linear, Notion.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-storage.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepStorage.jsx frontend/tests/onboarding-storage.test.mjs
git commit -m "feat(onboarding): add Composio Google Drive storage and toolkits step"
```

---

### Task 6: Step 4 — Mobile Companion (Download & Pair)

**Files:**
- Create: `frontend/src/components/onboarding/StepMobile.jsx`
- Test: `frontend/tests/onboarding-mobile.test.mjs`

**Interfaces:**
- Consumes: `api.startPairingV2()`, `api.converterGenerateQR()`
- Produces: `StepMobile({ onNext, onBack, onSkip })`

- [ ] **Step 1: Write the failing test for StepMobile**

```javascript
// frontend/tests/onboarding-mobile.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('StepMobile has Scan to pair tab, Download app tab, and no Cloudflare references', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepMobile.jsx', 'utf8')
  assert.match(content, /Scan to pair/)
  assert.match(content, /Download app/)
  assert.match(content, /LAN :8443/)
  assert.match(content, /Pair later from Settings/)
  assert.equal(content.includes('cloudflare'), false, 'Should not mention cloudflare')
  assert.equal(content.includes('http-shortcuts'), false, 'Should not mention http-shortcuts')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-mobile.test.mjs`  
Expected: FAIL with ENOENT

- [ ] **Step 3: Implement `StepMobile.jsx`**

- Segmented control: `Scan to pair` and `Download app`.
- Scan tab: Real Contract v2 pairing QR code (LAN port 8443, cert-pinned), 3-step instructions, pulsing radar badge "Listening for your phone…".
- Download tab: QR code linking directly to `/install` APK download.
- Local network privacy note: "Pairing happens over your local network. Nothing goes through a server."

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-mobile.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepMobile.jsx frontend/tests/onboarding-mobile.test.mjs
git commit -m "feat(onboarding): add mobile companion Contract v2 pairing and download step"
```

---

### Task 7: Step 5 Launchpad & Integration into `SplashScreenWizard.jsx`

**Files:**
- Create: `frontend/src/components/onboarding/StepLaunch.jsx`
- Modify: `frontend/src/components/SplashScreenWizard.jsx`
- Modify: `frontend/src/components/SplashScreenWizard.css`
- Test: `frontend/tests/onboarding-flow.test.mjs`

**Interfaces:**
- Consumes: All `Step*.jsx` components, `api.completeSetup()`, `triggerConfetti()`
- Produces: Complete first-run onboarding lifecycle

- [ ] **Step 1: Write the integration test for full onboarding flow**

```javascript
// frontend/tests/onboarding-flow.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('SplashScreenWizard integrates the 7 modern onboarding screens', () => {
  const content = fs.readFileSync('frontend/src/components/SplashScreenWizard.jsx', 'utf8')
  assert.match(content, /StepSplash/)
  assert.match(content, /StepWelcome/)
  assert.match(content, /StepProfile/)
  assert.match(content, /StepAiEngine/)
  assert.match(content, /StepStorage/)
  assert.match(content, /StepMobile/)
  assert.match(content, /StepLaunch/)
  assert.equal(content.includes('StepCloudflare'), false)
  assert.equal(content.includes('StepMobileShortcuts'), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/onboarding-flow.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Implement `StepLaunch.jsx` and refactor `SplashScreenWizard.jsx`**

- `StepLaunch.jsx`: Displays "You're all set, {Name}." with verified checklist for Profile, AI engine, Storage, Apps, and Mobile.
- "Open Amethyst" button triggers `api.completeSetup()`, fires confetti cannon, and unmounts wizard.
- Replace internal legacy steps in `SplashScreenWizard.jsx` with the modular onboarding screens.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/onboarding-flow.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/onboarding/StepLaunch.jsx frontend/src/components/SplashScreenWizard.jsx frontend/src/components/SplashScreenWizard.css frontend/tests/onboarding-flow.test.mjs
git commit -m "feat(onboarding): connect complete 7-screen flow and launchpad into SplashScreenWizard"
```
