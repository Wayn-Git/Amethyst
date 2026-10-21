# Settings & Integrations UX Redesign (Web Search, Cloud Connectors & Onboarding Alignment)

**Date**: 20 Oct 2026  
**Status**: Proposed  
**Scope**: Settings Information Architecture reorganization, dedicated Integrations Hub (`Web Search & Research` + `Composio Cloud Platform`), visual craft polish according to Emil Kowalski design engineering principles, and alignment with the First-Run Setup Wizard (`SplashScreenWizard.jsx`).

---

## 1. Problem Statement & Objectives

### 1.1 The Problems
1. **Misplaced Information Architecture**:
   - Web Search provider keys (`LangSearch`, `Exa`, `Firecrawl`, `Tavily`) and Cloud Integrations (`Composio` auth, quotas, connected accounts) are currently dumped inside **Settings → General** between Composer shortcuts and chat archiving.
   - Users going to "General" expect basic client preferences (hotkeys, workspace directory, startup defaults). Technical API keys and third-party SaaS authentication feel intrusive and are hard to locate.
2. **"Uncanny" Visual Presentation**:
   - Form controls are rendered as flat, repetitive `set-box-row` lists with raw text password inputs and right-aligned `[Clear]` / `[Save]` buttons.
   - Status indicators violate Amethyst's design tokens (e.g. purple `USER KEY` badge used as status; Amethyst rule: *purple is brand only, green is live/running, amber is waiting/partial*).
   - Composio spans 5 full-width rows mixing unstyled password inputs, billing quota links, static descriptions, and an unformatted row of 10 green chips.
3. **Disjointed User Setup Experience**:
   - First-run onboarding (`SplashScreenWizard.jsx`) guides the user through AI model and cloud apps, but when the user opens Settings later, the taxonomy is completely different: search keys are buried in General, tool browsing is in Capabilities, and models are in Models.

### 1.2 Core Objectives
- **Clean Information Architecture**: Restore **General Settings** to core app preferences; introduce a dedicated **Integrations** tab in the `App` group of Settings.
- **Craft & Taste Polish**: Replace uncanny flat form rows with structured **Provider Cards** and a unified **Composio Cloud Hub Card** with tactile `:active` scaling (`0.97`), custom cubic-bezier transitions (`--ease-out`), live latency feedback, and masked credential states.
- **Clear Capability Boundary**: Settings manages platform credentials and connection health; the top-level **Capabilities** view manages discovering and toggling individual tools/connectors.
- **Onboarding Alignment**: Align Step 3 of `SplashScreenWizard.jsx` with the exact same visual primitives and mental model used in Settings.

---

## 2. Information Architecture & Navigation

### 2.1 Settings Navigation (`Settings.jsx`)
In `frontend/src/views/Settings.jsx`, update the `SECTIONS` array:

```javascript
const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'user', group: 'You' },
  { id: 'usage', label: 'Usage', icon: 'dash', group: 'You' },
  { id: 'activity', label: 'Activity', icon: 'logs', group: 'You' },
  { id: 'general', label: 'General', icon: 'sliders', group: 'App' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'models', label: 'Models', icon: 'cpu', group: 'App' },
  { id: 'integrations', label: 'Integrations', icon: 'layers', group: 'App' },
  { id: 'permissions', label: 'Permissions', icon: 'shield', group: 'Advanced' },
  { id: 'devices', label: 'Devices', icon: 'link', group: 'Advanced' },
  { id: 'data', label: 'Data', icon: 'trash', group: 'Advanced' },
  { id: 'about', label: 'About', icon: 'info', group: 'Advanced' },
]
```

### 2.2 Purifying the "General" View
Remove lines 483–739 of `Settings.jsx` (Web Search and Cloud Integrations). The `General` view now contains exclusively:
1. **Composer**: Send with (`Enter` vs `Ctrl+↵`), starting permission mode (`Guard`, `Full access`, `Read-only`), default reasoning effort (`Low`, `Medium`, `High`).
2. **Chats**: Archive chats switch.
3. **Rhythm & Automation**: Maximum agent iterations, morning briefing hour and switch.
4. **Environment**: Working directory folder picker and save action.
5. **Storage**: Local cache usage gauge and clear cache action.

---

## 3. Dedicated "Integrations" View Specification

The new `Integrations` view contains two primary sections: **Web Search & Research Engines** and **Cloud Toolkits & Accounts (Composio)**.

### 3.1 Web Search & Research Section

#### A. Active Router Status Banner
At the top of the search section, render an active router status banner:
- Primary Engine: Shows active provider name (e.g., `Exa (Semantic)`) with a live green indicator dot.
- Automatic Fallback Sequence: Shows fallback chain (`LangSearch → Tavily → Scrapers`).
- Quota / Health Warning: If a circuit breaker is open or a provider returns 429, displays an amber notice with explanation.

#### B. Provider Cards (`SearchProviderCard`)
Four dedicated cards for `LangSearch`, `Exa`, `Firecrawl`, and `Tavily`:
- **Card Header**:
  - Provider Name (`--font-display`, semibold 15px)
  - Purpose Tag:
    - `LangSearch`: `[General Search · Fast Hybrid]`
    - `Exa`: `[Semantic & Neural Search · Deep Research]`
    - `Firecrawl`: `[Web Scraping · Clean Markdown]`
    - `Tavily`: `[Fact Verification · Consensus]`
  - Status Badge:
    - `Active Primary` (green `--live` dot + text)
    - `Saved Fallback` (neutral badge)
    - `Not Configured` (dim badge)
  - External link button: `[Get free key ↗]` (anchored top right)
- **Card Body**:
  - Concise description of what the engine does and why the assistant benefits from it.
- **Card Footer / Action Strip**:
  - **When Configured**:
    - Masked key preview: `••••••••••••••••` with subtle last-4 or check indicator.
    - `[Test Connection]` button (runs test query, returns live latency `138ms · Connected`).
    - `[Set as Primary]` button (only shown if not currently primary).
    - `[Clear]` button (opens confirmation toast or clear action).
  - **When Not Configured**:
    - `[+ Add API Key]` button. Clicking expands an inline input container with `Save & Test` and `Cancel`.

### 3.2 Cloud Toolkits & Accounts (Composio Hub Card)

#### A. Unconnected State (First-Time / Logged Out)
- **Title**: `Composio Cloud Platform` with status badge `Not Connected`.
- **Value Proposition**: "Connect 100+ external apps (Slack, GitHub, Linear, Google Calendar, Notion, Gmail) with local-first privacy and on-demand tool execution."
- **Supported Apps Strip**: Authentic brand SVG icons for Google, Slack, GitHub, Linear, Notion, Microsoft.
- **Actions**:
  - `[⚡ Connect via Browser]` (Primary capsule button): Calls `api.startComposioLogin()`, opens browser tab, starts polling session with visible countdown and cancellation.
  - `[Enter API Key Manually]` (Secondary subtle button): Expands an API key input field with `Save & Test`.
  - `[Free Tier Quota Guide ↗]` (External link).

#### B. Connected State (Active Session)
- **Title**: `Composio Cloud Platform` with status badge `[● Connected]` (green `--live` dot) and key mode badge (`[Consumer Key]` / `[User Key]`).
- **Connected Toolkits Preview**:
  - Compact grid/chips of authenticated apps (e.g. `Gmail`, `Google Calendar`, `Slack`, `GitHub`, `Linear`, `Web Scraper`).
  - Total count: e.g. `10 Connected Apps`.
- **Actions Bar**:
  - `[Manage Connectors ↗]` (Primary capsule button): Smoothly navigates user to `Capabilities → Connectors` view.
  - `[Dashboard ↗]` (Secondary button): Opens `dashboard.composio.dev`.
  - `[Key Actions ▾]` (Secondary button): Dropdown offering *Test Key*, *Rotate Key*, and *Disconnect*.

---

## 4. Visual Polish & Emil Kowalski Design Tokens

### 4.1 Polish Review Table

| Area | Before | After | Rationale |
| --- | --- | --- | --- |
| **Row Structure** | Flat text rows with inputs on the far right | Structured cards with hairline borders (`--hairline`) and subtle canvas lift (`--surface`) | Groups related metadata into clear spatial containers |
| **Button States** | Generic CSS hover | Interactive `:active` scale (`scale(0.97)`), transition `120ms` (`--press`), curve `var(--ease-out)` | Provides responsive tactile feedback on every interaction |
| **Status Semantics** | Purple badge for `USER KEY` | Purple reserved strictly for brand accent; green `--live` for active; neutral `--hairline` for mode chips | Adheres strictly to design system color rule: purple is never a status |
| **Feedback Latency** | Static "key saved" text | Live test probe reporting actual roundtrip latency (e.g. `128ms · OK`) | Gives users immediate confidence that their credentials actually work |
| **Motion & Density** | Sudden DOM changes without easing | Smooth height animation using `grid-template-rows` and `@starting-style` / Framer Motion AnimatePresence | Prevents layout jumping and creates polished transitions |

### 4.2 Tokens Utilized
- **Grounds**: `--canvas` (page), `--surface` (card background), `--surface-2` (hover state).
- **Hairlines**: `--hairline` (`rgba(255,255,255,0.08)` / light mode equivalent), `--hairline-strong`.
- **Status Colors**:
  - `--live` (`#149e61` / green) & `--live-soft` (washes)
  - `--confirm` (amber for rate limit / quota warnings)
  - `--stop` (coral/red for invalid key / network errors)
- **Typography**:
  - Headers: `--font-sans` with `-0.01em` tracking.
  - Latency & Key hints: `--font-mono` (`Geist Mono`).

---

## 5. First-Run Setup Wizard (`SplashScreenWizard.jsx`) Alignment

In `frontend/src/components/SplashScreenWizard.jsx`:
- Step 3 ("Connect Apps") currently features Composio browser login and local connectors.
- **Alignment Update**:
  - Apply the exact same `Composio Hub Card` visual styling and brand icons to Step 3.
  - Add an optional, clean **Web Search** card in Step 3:
    - *"Add a search provider for real-time web intelligence (LangSearch, Exa, or Tavily) — or continue with default local scrapers."*
    - Provides a quick 1-click key paste or free signup link, so users configure search right from the start rather than stumbling upon it later.
- After completing onboarding, users visiting **Settings → Integrations** recognize the exact same card layout, creating a coherent mental model.

---

## 6. Verification Plan

### 6.1 Automated Tests
- Run existing frontend build and unit test suites:
  ```bash
  npm run build
  npm test
  ```
- Verify backend search and Composio routes continue passing without regressions:
  ```bash
  pytest tests/test_task_aware_router.py tests/test_search_providers.py
  ```

### 6.2 Manual Verification Checklist
1. **Settings Navigation**:
   - Verify `Integrations` appears in the Settings sidebar under the `App` group.
   - Verify `General` no longer contains search provider inputs or Composio forms.
   - Verify composer settings, chat archive, rhythm, and workspace settings in `General` continue functioning properly.
2. **Web Search Cards**:
   - Verify all 4 providers (LangSearch, Exa, Firecrawl, Tavily) render with their role badges.
   - Verify entering a key and clicking Save updates the router and displays a green latency badge.
   - Verify clearing a key removes the provider and adjusts the active search fallback.
3. **Composio Cloud Hub**:
   - Verify unconnected state shows 1-click browser sign-in and authentic app icons.
   - Verify connected state shows the active connected apps count, connected chips, and `Manage Connectors ↗` button.
   - Verify clicking `Manage Connectors ↗` navigates to `Capabilities → Connectors`.
4. **Theme & Responsive Motion**:
   - Switch between all 8 themes (`graphite`, `ink`, `nocturne`, `nvidia`, `paper`, `sand`, `claude`, `cursor`) and verify contrast.
   - Verify `scale(0.97)` on button press and respect for `prefers-reduced-motion`.
