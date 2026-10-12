# Settings & Integrations UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate Amethyst's settings and setup experience by removing uncanny Web Search and Composio inputs from General Settings into a dedicated, high-craft "Integrations" hub with interactive provider cards, tactile feedback, and direct alignment with the onboarding wizard.

**Architecture:** Split external services out of the monolithic `Settings.jsx` into a modular `frontend/src/views/settings/Integrations.jsx` view. Wire `integrations` into `SECTIONS` and `PANELS` under the `App` group. Unify Web Search (LangSearch, Exa, Firecrawl, Tavily) with active router diagnostics and live test probes, and build a cohesive Composio Cloud Hub card that bridges to `Capabilities → Connectors`. Update `SplashScreenWizard.jsx` to mirror this design language during initial onboarding.

**Tech Stack:** React 19, Tailwind v4, Motion (Framer Motion), Base UI, Amethyst Design System Tokens (`--k-*`, `--canvas`, `--surface`, `--hairline`, `--live`, `--confirm`, `--stop`).

**Spec:** [`docs/superpowers/specs/2026-10-20-settings-integrations-ux-redesign.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-20-settings-integrations-ux-redesign.md)

## Global Constraints

- **Color Semantics**: Purple (`--accent`, `#7132f5`) is the brand color, NEVER a status indicator. Green (`--live`) is running/connected; amber (`--confirm`) is waiting/rate-limited; coral/red (`--stop`) is error/destructive.
- **Button Tactility**: All buttons must have `:active` scale (`transform: scale(0.97)`), transition `<= 140ms`, and custom easing (`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`).
- **Geometry**: Inputs and action buttons use capsule geometry (`--radius-buttons: 9999px`); cards use `--radius-cards: 6px`; separation uses hairline borders (`--hairline`) with no heavy drop shadows.
- **Write-Only Security**: Plaintext API keys must never be echoed back; show masked strings with test status.
- **Motion Accessibility**: All animations and height morphs must strictly honor `prefers-reduced-motion: reduce`.

## Review Focus

1. **Active search router fallback**: Setting or clearing a primary search key must immediately update the active router status banner without requiring a browser refresh.
2. **Key testing validation**: Testing an invalid search key or Composio key must show an inline error message rather than silently failing or throwing an unhandled toast.
3. **Composio browser login flow**: The 1-click browser login modal countdown and cancellation must function reliably, transitioning the card to connected state upon polling success.
4. **General settings purity**: Removing Web Search and Composio from `General` must not break or leave orphan state variables in Composer, Rhythm, Workspace, or Chat archiving.
5. **Onboarding wizard parity**: Step 3 of `SplashScreenWizard.jsx` must render consistent cards and brand SVGs matching the new Settings Integrations hub.

---

### Task 1: Create Search & Research Components in `Integrations.jsx`

**Files:**
- Create: `frontend/src/views/settings/Integrations.jsx`
- Create: `frontend/src/styles/integrations.css`
- Test: `frontend/tests/smoke.mjs`

**Interfaces:**
- Consumes: `api.searchProvider()`, `api.setSearchProvider(name, key)`, `useApp()`, `Icon.jsx`, `Badge.jsx`
- Produces: `SearchSection` component with active router status banner and 4 specialized provider cards (`LangSearch`, `Exa`, `Firecrawl`, `Tavily`)

- [ ] **Step 1: Write the failing smoke test or component verification**
Verify that `frontend/src/views/settings/Integrations.jsx` can be imported and renders the search section container.
Run: `npm run smoke`

- [ ] **Step 2: Create `frontend/src/styles/integrations.css`**
Define card styles using Kraken tokens (`--surface`, `--hairline`, `--hairline-strong`, `--radius-cards`, `--radius-buttons`).
Include responsive press feedback:
```css
.int-btn-sm {
  transition: transform 120ms var(--ease-out), background-color 120ms ease;
  border-radius: var(--radius-buttons);
}
.int-btn-sm:active {
  transform: scale(0.97);
}
```

- [ ] **Step 3: Implement `SearchSection` in `frontend/src/views/settings/Integrations.jsx`**
Build the active router banner:
- Display current active engine with live green status dot (`Spotlight is searching the web through {activeSearch}`)
- Fallback sequence summary (`Fallback: LangSearch → Tavily → Scrapers`)
Build the 4 provider cards (`LangSearch`, `Exa`, `Firecrawl`, `Tavily`):
- Role badges (`[General Search]`, `[Semantic & Neural]`, `[Markdown Scrape]`, `[Fact Verification]`)
- External link `[Get free key ↗]`
- Expandable key input with `Save & Test`, `Set as Primary`, and `Clear`
- Inline latency feedback on test (`✓ Valid · 142ms`)

- [ ] **Step 4: Verify component compiles with `npm run build`**
Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/views/settings/Integrations.jsx frontend/src/styles/integrations.css
git commit -m "feat(settings): create search provider cards and router status in Integrations"
```

---

### Task 2: Build Composio Cloud Hub Card in `Integrations.jsx`

**Files:**
- Modify: `frontend/src/views/settings/Integrations.jsx`
- Modify: `frontend/src/styles/integrations.css`

**Interfaces:**
- Consumes: `api.composioStatus()`, `api.startComposioLogin()`, `api.pollComposioLogin()`, `api.saveComposioKey()`, `api.deleteComposioKey()`, `setView('capabilities')`
- Produces: `ComposioHubCard` with distinct Unconnected and Connected states, authentic brand SVGs, and deep-link bridge to `Capabilities → Connectors`

- [ ] **Step 1: Add SVG brand icons for top cloud apps**
Add inline authentic brand SVGs or Phosphor/Hugeicons icons for Google, Slack, GitHub, Linear, Notion, Microsoft in `Integrations.jsx`.

- [ ] **Step 2: Implement Unconnected State for Composio**
Render:
- Status badge `Not Connected` (dim tone)
- Value proposition text
- Supported apps strip
- `[⚡ Connect via Browser]` primary button with login polling modal
- `[Enter API Key Manually]` collapsible accordion with `Save & Test`
- Link to free tier quota guide

- [ ] **Step 3: Implement Connected State for Composio**
Render:
- Status badge `[● Connected]` (green `--live` dot) and key mode badge (`[Consumer Key]` / `[User Key]`)
- Connected accounts preview grid showing active apps count and badges
- Primary action `[Manage Connectors ↗]` triggering `setView('capabilities')` and setting tab to connectors
- Secondary actions: `[Dashboard ↗]` and `[Key Settings ▾]` popover (Test, Rotate, Disconnect)

- [ ] **Step 4: Verify build succeeds**
Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/views/settings/Integrations.jsx frontend/src/styles/integrations.css
git commit -m "feat(settings): add Composio cloud hub card with browser auth and capabilities bridge"
```

---

### Task 3: Wire `Integrations` into `Settings.jsx` and Clean Up `General`

**Files:**
- Modify: `frontend/src/views/Settings.jsx:24-36` (SECTIONS array)
- Modify: `frontend/src/views/Settings.jsx:4762-4774` (PANELS mapping)
- Modify: `frontend/src/views/Settings.jsx:207-298` (Remove search/composio state from General)
- Modify: `frontend/src/views/Settings.jsx:483-739` (Remove search/composio JSX from General)

**Interfaces:**
- Consumes: `frontend/src/views/settings/Integrations.jsx`
- Produces: Cleaned up `General` panel and functional `Integrations` settings tab

- [ ] **Step 1: Import `Integrations` into `Settings.jsx`**
Import `Integrations` from `./settings/Integrations.jsx`.
Add `{ id: 'integrations', label: 'Integrations', icon: 'layers', group: 'App' }` to `SECTIONS`.
Add `integrations: Integrations` to `PANELS`.

- [ ] **Step 2: Strip Web Search and Composio from `General`**
Remove search provider and Composio state and effects from `General()`:
- `searchProviders`, `activeSearch`, `searchDraft`, `savingSearch`, `loadSearchProviders`, `saveSearchKey`
- `composioStatus`, `composioData`, `composioKeyDraft`, `savingComposio`, `showComposioKey`, `loadComposioStatus`, `saveComposioKey`, `deleteComposioKey`
Remove Category: Web Search (`lines 484–529`) and Category: Cloud Integrations (`lines 532–738`) from the return JSX of `General()`.

- [ ] **Step 3: Verify `General` settings remain fully functional**
Ensure Composer options, starting permission mode, reasoning effort, chat archiving, rhythm, working directory, and storage remain intact.

- [ ] **Step 4: Run build to verify clean compilation without unused variables**
Run: `npm run build`
Expected: PASS with 0 build errors.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/views/Settings.jsx
git commit -m "refactor(settings): extract Web Search and Composio into dedicated Integrations tab"
```

---

### Task 4: Align Setup Wizard (`SplashScreenWizard.jsx`) with New Integrations Design

**Files:**
- Modify: `frontend/src/components/SplashScreenWizard.jsx:1040-1175` (Step 3: Connect Apps)

**Interfaces:**
- Consumes: `api.startComposioLogin()`, `api.searchProvider()`, `api.setSearchProvider()`
- Produces: Cohesive onboarding Step 3 matching the new card styling and optional Web Search setup

- [ ] **Step 1: Update Composio card styling in Step 3**
Harmonize the Composio card styling in `SplashScreenWizard.jsx` with the new `ComposioHubCard` tokens:
- Use consistent brand SVGs
- Clean button hierarchy (`⚡ Connect via Browser` as primary capsule)
- Respect semantic color tokens (`--live` for connected dot)

- [ ] **Step 2: Add optional Web Search quick-start card to Step 3**
Add a lightweight, optional Web Search card:
- Title: "Web Search Intelligence (Spotlight & Research)"
- Description: "Connect a free search key (LangSearch or Exa) to give your AI live web search capabilities, or continue with default local scrapers."
- 1-click key input with free key signup link

- [ ] **Step 3: Test and build**
Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/SplashScreenWizard.jsx
git commit -m "feat(wizard): align onboarding Step 3 with new Integrations card design"
```

---

### Task 5: End-to-End Verification and Polish

**Files:**
- Test: All frontend test scripts in `frontend/package.json`
- Test: Manual verification across 8 themes

- [ ] **Step 1: Run frontend test suites**
Run: `npm run build && npm run smoke`
Expected: PASS

- [ ] **Step 2: Verify theme adaptability**
Check that card borders, background grounds, and text colors resolve properly across:
- Dark themes: `graphite`, `ink`, `nocturne`, `nvidia`
- Light themes: `paper`, `sand`, `claude`, `cursor`

- [ ] **Step 3: Verify button press scale and motion reduction**
Ensure buttons respond with `scale(0.97)` on `:active` and no motion glitches occur under `prefers-reduced-motion`.

- [ ] **Step 4: Final verification commit**
```bash
git commit --allow-empty -m "chore(settings): complete Settings & Integrations UX polish verification"
```
