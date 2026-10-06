# Theme & Color System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul frontend color system across all 8 curated themes from `DesignMDFiles`, eliminate hardcoded card/surface hexes, resolve light-mode theme switching breakage via universal `data-theme-mode`, and bridge custom accent colors to Tailwind and BoardUI token ramps.

**Architecture:** Dual-layer token system: `store.jsx` applies `data-theme`, `data-theme-mode`, and toggles `.dark`/`.light` on root; `applyAccentColor()` generates both standard CSS vars and the full 11-step Tailwind `--color-accent-*` ramp; `index.css` consolidates all light-mode overrides to `[data-theme-mode='light']` and unifies 8 curated palettes.

**Tech Stack:** React 19, Tailwind CSS v4, Vanilla CSS Custom Properties, Vite.

**Spec:** [docs/superpowers/specs/2026-10-06-theme-color-system-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-06-theme-color-system-design.md)

## Global Constraints

- Preserve all 8 curated palettes with exact hex codes copied verbatim from `DesignMDFiles`.
- Never allow a light theme to omit `data-theme-mode="light"` or `.light` class.
- Never use hardcoded background hexes (`#18181b`, `#27272a`, `#14161d`, `#09090b`) for standard card/menu surfaces.
- Dynamic accent changes must update both CSS `--accent` and Tailwind `--color-accent-50`..`950` without page reload.
- Pass `npm run build` and `npm run lint` in `frontend` without errors.

## Review Focus

1. **Light Mode Switching Breakage:** Switching between `paper`, `sand`, `claude`, and `cursor` must never revert any menu or modal to dark mode styling.
2. **Custom Accent Bleed:** Resetting or changing custom accent to a new hex must immediately tint buttons, toggles, focus rings, and BoardUI accent badges.
3. **Card Contrast in Pitch Black (Ink):** In `ink` theme, surfaces (`--surface`: `#0a0a0a`, `--surface-2`: `#121212`) must remain visibly distinct with subtle borders (`#212327`).
4. **Mismatched Gray/Purple Elements:** No component in Graphite or NVIDIA should exhibit lingering purple or blue card backgrounds.
5. **System Theme Resolution:** `theme === 'system'` must cleanly resolve to `graphite` when OS is dark and `paper` when OS is light.

---

### Task 1: Theme Engine & Accent Ramp Generator in `store.jsx`

**Files:**
- Modify: `frontend/src/store.jsx:145-215`

**Interfaces:**
- Produces: `THEMES`, `DARK_THEMES`, `LIGHT_THEMES`, updated `applyTheme(theme)`, updated `applyAccentColor(hex)`.

- [ ] **Step 1: Update theme registry and classification constants in `frontend/src/store.jsx`**
  Set:
  ```js
  export const THEMES = ['system', 'graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']
  export const DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']
  export const LIGHT_THEMES = ['paper', 'sand', 'claude', 'cursor']
  ```

- [ ] **Step 2: Update `applyTheme(theme)` in `frontend/src/store.jsx`**
  Resolve `system` to `graphite` (dark) or `paper` (light). Set:
  - `root.setAttribute('data-theme', resolved)`
  - `root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light')`
  - `root.style.colorScheme = isDark ? 'dark' : 'light'`
  - `root.classList.toggle('dark', isDark)`
  - `root.classList.toggle('dark-mode', isDark)`
  - `root.classList.toggle('light', !isDark)`

- [ ] **Step 3: Update `applyAccentColor(hex)` in `frontend/src/store.jsx`**
  When valid hex provided, calculate color-mix values and set:
  - Direct tokens: `--accent`, `--accent-hover`, `--accent-line`, `--accent-soft`, `--accent-wash`, `--ember`, `--focus-ring`
  - Tailwind / BoardUI ramp: `--color-accent-50` through `--color-accent-950`
  - Brand tokens: `--color-brand`, `--primary`
  When cleared, remove all custom properties from `root.style`.

- [ ] **Step 4: Verify syntax and build step for store changes**
  Run: `npm --prefix frontend run build`

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/store.jsx
  git commit -m "feat(store): expand theme engine with universal mode and accent ramp generator"
  ```

---

### Task 2: Define 8 Curated Theme Palettes in `frontend/src/index.css`

**Files:**
- Modify: `frontend/src/index.css:290-850`

**Interfaces:**
- Consumes: Theme names from `store.jsx` (`graphite`, `ink`, `nocturne`, `nvidia`, `paper`, `sand`, `claude`, `cursor`).
- Produces: CSS custom properties for all 8 themes.

- [ ] **Step 1: Write Dark Theme token blocks in `frontend/src/index.css`**
  - `:root[data-theme='graphite']`: ElevenLabs dark stone (`#0c0a09`, `#1c1917`, `#292524`, accent `#8b5cf6`).
  - `:root[data-theme='ink']`: SpaceX/xAI pitch black (`#000000`, `#0a0a0a`, `#121212`, hairlines `#212327`, accent `#a855f7`).
  - `:root[data-theme='nocturne']`: Together AI cosmic midnight (`#010120`, `#0a0d2a`, `#141838`, accent `#635bff`).
  - `:root[data-theme='nvidia']`: NVIDIA workstation black (`#000000`, `#111111`, `#1a1a1a`, accent `#76b900`).

- [ ] **Step 2: Write Light Theme token blocks in `frontend/src/index.css`**
  - `:root[data-theme='paper']`: Kraken clean gallery white (`#ffffff`, `#f6f6f9`, `#f2f2f6`, slate text `#101114`, accent `#7132f5`).
  - `:root[data-theme='sand']`: ElevenLabs warm stone (`#f5f5f5`, `#eae7e5`, `#f0efed`, `#e7e5e4`, accent `#d97706`).
  - `:root[data-theme='claude']`: Anthropic warm ivory & coral (`#faf9f5`, `#f3f1ea`, `#f5f0e8`, `#efe9de`, accent `#cc785c`).
  - `:root[data-theme='cursor']`: Cursor studio cream & orange (`#f7f7f4`, `#efeee8`, `#ffffff`, `#fafaf7`, accent `#f54e00`).

- [ ] **Step 3: Define universal mode fallbacks**
  Add `:root[data-theme-mode='light']` and `:root[data-theme-mode='dark']` base rules ensuring consistent baseline text/hairlines across any dynamic state.

- [ ] **Step 4: Verify syntax and lint**
  Run: `npm --prefix frontend run lint`

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/index.css
  git commit -m "feat(css): implement 8 curated theme palettes from DesignMDFiles"
  ```

---

### Task 3: Unify Light Mode Selectors in `frontend/src/index.css`

**Files:**
- Modify: `frontend/src/index.css` (throughout file)

**Interfaces:**
- Consumes: `[data-theme-mode='light']` and `.light` from `store.jsx`.
- Produces: Bulletproof light-mode styling across all 4 light themes.

- [ ] **Step 1: Replace narrow light theme selectors across `index.css`**
  Find and replace:
  - `[data-theme='light']` -> `[data-theme-mode='light']`
  - `[data-theme='paper'], [data-theme='sand']` -> `[data-theme-mode='light']`
  - `[data-theme='dark']` -> `[data-theme-mode='dark']`
  - Include `.pm-menu-container`, `.pm-flyout`, `.mcp-modal`, `.model-menu-v2`, `.doc-card-preview`, `.conn-card-core`, `.plugin-row`, `.skel`, `.sb-conv-item`.

- [ ] **Step 2: Clean hardcoded card and modal background hexes**
  Replace instances of `background: #09090b;`, `background: #18181b;`, `background: #14161d;`, `background: #252937;` in menus, drawers, and cards with `var(--surface)`, `var(--surface-2)`, or `var(--canvas)`.

- [ ] **Step 3: Test build**
  Run: `npm --prefix frontend run build`

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/index.css
  git commit -m "fix(css): unify light-mode selectors under data-theme-mode and remove hardcoded card hexes"
  ```

---

### Task 4: Clean Hardcoded Component Colors & Bind Accent in Components

**Files:**
- Modify: `frontend/src/components/CommandPalette.jsx`
- Modify: `frontend/src/components/OnboardingWizard.jsx`
- Modify: `frontend/src/components/SplashScreenWizard.jsx`
- Modify: `frontend/src/components/nexus-ui/questions.tsx`
- Modify: `frontend/src/components/foundations/featured-icon/featured-icon.tsx`

**Interfaces:**
- Consumes: Semantic tokens (`var(--accent)`, `var(--surface)`, `var(--hairline)`).
- Produces: Adaptive component styling across all themes and custom accents.

- [ ] **Step 1: Refactor hardcoded purple in `nexus-ui/questions.tsx`**
  Replace hardcoded purple classes (`border-purple-500`, `bg-purple-500/15`, `shadow-[0_0_16px_rgba(135,63,255,...)]`, `bg-purple-600`) with accent utilities (`border-accent-500`, `bg-accent-500/15`, `bg-accent-600`) or inline style with `var(--accent)`.

- [ ] **Step 2: Refactor hardcoded purple in `featured-icon.tsx`**
  Ensure brand variant uses `bg-accent-500/15 text-accent-500 border border-accent-500/25` or `var(--accent-soft)`.

- [ ] **Step 3: Test build**
  Run: `npm --prefix frontend run build`

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/components/
  git commit -m "refactor(components): replace hardcoded purple classes with semantic accent tokens"
  ```

---

### Task 5: Align Theme Choosers in `Settings.jsx`, `OnboardingWizard.jsx`, and `SplashScreenWizard.jsx`

**Files:**
- Modify: `frontend/src/views/Settings.jsx:37-49`, `1064-1130`
- Modify: `frontend/src/components/OnboardingWizard.jsx:160-205`
- Modify: `frontend/src/components/SplashScreenWizard.jsx:1500-1540`

**Interfaces:**
- Consumes: 8 curated themes from `store.jsx`.
- Produces: Updated theme selection UI cards with accurate labels, hints, and mockup swatches.

- [ ] **Step 1: Update `THEME_CHOICES` in `frontend/src/views/Settings.jsx`**
  Update list:
  ```js
  const THEME_CHOICES = [
    { id: 'system', label: 'System', hint: 'Follows OS mode' },
    { id: 'graphite', label: 'Graphite', hint: 'ElevenLabs dark stone' },
    { id: 'ink', label: 'Ink', hint: 'SpaceX / xAI pitch black' },
    { id: 'nocturne', label: 'Nocturne', hint: 'Together AI cosmic midnight' },
    { id: 'nvidia', label: 'NVIDIA', hint: 'Deep engineering black & lime' },
    { id: 'paper', label: 'Paper', hint: 'Kraken crisp clean gallery' },
    { id: 'sand', label: 'Sand', hint: 'ElevenLabs warm stone' },
    { id: 'claude', label: 'Claude', hint: 'Anthropic warm ivory & coral' },
    { id: 'cursor', label: 'Cursor', hint: 'Cursor studio cream & orange' },
  ]
  ```
  Update mockup sidebar/content swatch coloring in `Settings.jsx` to reflect dark vs light theme groups.

- [ ] **Step 2: Update theme arrays in `OnboardingWizard.jsx` and `SplashScreenWizard.jsx`**
  Ensure theme options match the curated 8 themes with updated swatch previews.

- [ ] **Step 3: Test build and lint**
  Run: `npm --prefix frontend run build && npm --prefix frontend run lint`

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/views/Settings.jsx frontend/src/components/OnboardingWizard.jsx frontend/src/components/SplashScreenWizard.jsx
  git commit -m "feat(settings): update theme chooser grids and swatches for curated 8 themes"
  ```

---

### Task 6: Full Integration Verification

**Files:**
- Test verification across the whole frontend.

- [ ] **Step 1: Run comprehensive build and lint**
  Run: `npm --prefix frontend run build && npm --prefix frontend run lint`
  Verify exit code 0.

- [ ] **Step 2: Verify theme switching via simulated script or runtime check**
  Verify that switching `data-theme` across all 8 themes updates background, surface, text, and hairlines properly.

- [ ] **Step 3: Final Commit and cleanup**
  ```bash
  git status
  ```
