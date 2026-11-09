# Apple-Style Error States via Stageshow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build resilient Apple-designed error state components for Google Drive token expiration, model 429/503 rate limits, and phone companion offline modes, including an interactive Stageshow demo stage and live app integration.

**Architecture:** Translucent Apple acrylic surfaces (`error-states.css`), standalone UI components (`AppleErrorBanner`, `ModelRateLimitCard`, `DynamicIslandStatus`), an interactive Stageshow choreographed showcase (`ErrorStatesShowcase`), and event wiring into `Chat.jsx`, `Companion.jsx`, and `App.jsx`.

**Tech Stack:** React 19, CSS modules / vanilla CSS tokens, Stageshow kit (`.agents/skills/stageshow/kit`), Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-09-apple-stageshow-error-states-design.md`

## Global Constraints

- Apple Human Interface Guidelines: 13px/15px typography, SF Pro rounded numbers, frosted glass (`backdrop-filter: blur(24px)`), amber warning `#FF9F0A`.
- Strictly utilize `.agents/skills/stageshow/kit` primitives for showcase framing (`Stage`, `Window`, `Phone`, `Card`, `Button`, `Act`).
- Non-blocking: conversation context and app navigation must never be frozen by non-fatal errors.
- Zero mock data: real event hooks (`amethyst:auth-expired`, `transportManager.onStateChange`, Chat 429 handling).

## Review Focus

1. **Backdrop-filter fallback:** Browsers or webviews without `backdrop-filter` support must render solid opaque fallback backgrounds.
2. **Timer cleanup:** `ModelRateLimitCard` and `DynamicIslandStatus` must clear intervals on unmount to prevent leaks.
3. **Rapid state changes:** Network flapping (`offline` -> `direct` -> `offline`) must not produce stuck spring animations in Dynamic Island.
4. **Token reauth concurrency:** Multiple simultaneous 401s from Drive must debounce to a single banner instance.
5. **Reduced motion:** Respect `prefers-reduced-motion` with instant transitions instead of spring translations.

---

### Task 1: Apple Error States Styling & Token System

**Files:**
- Create: `frontend/src/components/ui/apple/error-states.css`
- Test: `frontend/tests/error-states-css.test.mjs`

**Interfaces:**
- Produces: CSS utility classes (`.apple-glass-banner`, `.apple-rate-limit-card`, `.apple-dynamic-island`, `.apple-pill-btn`, `.apple-amber-badge`)

- [ ] **Step 1: Write test for CSS classes and token presence**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `frontend/src/components/ui/apple/error-states.css`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: `AppleErrorBanner.jsx` (Drive Token Expired)

**Files:**
- Create: `frontend/src/components/ui/apple/AppleErrorBanner.jsx`
- Test: `frontend/tests/apple-error-banner.test.mjs`

**Interfaces:**
- Produces: `AppleErrorBanner({ visible, service, email, onReauth, onDismiss })`

- [ ] **Step 1: Write failing component test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `AppleErrorBanner` with frosted acrylic, amber icon, and action button**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 3: `ModelRateLimitCard.jsx` (Model Down / 429 Rate-Limited)

**Files:**
- Create: `frontend/src/components/ui/apple/ModelRateLimitCard.jsx`
- Test: `frontend/tests/model-rate-limit-card.test.mjs`

**Interfaces:**
- Produces: `ModelRateLimitCard({ model, error, retryAfter, fallbackModel, onRetry, onSwitchFallback })`

- [ ] **Step 1: Write failing component test for countdown and button triggers**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `ModelRateLimitCard` with circular countdown timer and fallback switcher**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 4: `DynamicIslandStatus.jsx` (Companion Connectivity)

**Files:**
- Create: `frontend/src/components/ui/apple/DynamicIslandStatus.jsx`
- Test: `frontend/tests/dynamic-island-status.test.mjs`

**Interfaces:**
- Produces: `DynamicIslandStatus({ status, latency, onRetry })`

- [ ] **Step 1: Write failing component test for `direct`, `standalone`, and `offline` modes**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `DynamicIslandStatus` with spring morphing pill**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 5: `ErrorStatesShowcase.jsx` (Stageshow Showcase)

**Files:**
- Create: `frontend/src/components/ui/stageshow/ErrorStatesShowcase.jsx`
- Test: `frontend/tests/error-states-showcase.test.mjs`

**Interfaces:**
- Consumes: `.agents/skills/stageshow/kit` (`Stage`, `Window`, `Phone`, `Card`, `Button`, `Act`), `AppleErrorBanner`, `ModelRateLimitCard`, `DynamicIslandStatus`
- Produces: `ErrorStatesShowcase()` interactive demo component

- [ ] **Step 1: Write failing export and instantiation test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `ErrorStatesShowcase` with animated cursor and simulated error recovery**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 6: Application Wiring & Integration

**Files:**
- Modify: `frontend/src/App.jsx` (mount `AppleErrorBanner`)
- Modify: `frontend/src/views/Chat.jsx` (render `ModelRateLimitCard` on 429/503 errors)
- Modify: `frontend/src/mobile/Companion.jsx` (mount `DynamicIslandStatus`)
- Test: `frontend/tests/app-error-integration.test.mjs`

- [ ] **Step 1: Write failing end-to-end integration test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Wire event listener in `App.jsx`, error handler in `Chat.jsx`, and transport listener in `Companion.jsx`**
- [ ] **Step 4: Run tests and execute full frontend build verification (`npm run build`)**
- [ ] **Step 5: Commit**

