# Theme & Color System Design Specification

- **Date:** 2026-10-06
- **Status:** Approved
- **Scope:** Frontend theme engine, semantic color tokens, accent color propagation, and light/dark mode stability.

---

## 1. Problem Statement & Root Cause Analysis

### 1.1 Inconsistent Surface Colors Across Components
* **Symptom:** UI surfaces look mismatched within a single theme: some cards appear neutral grey, others purplish dark grey, others pitch black.
* **Root Cause:** Multiple components and styles bypass theme tokens (`--surface`, `--surface-2`, `--canvas`) and declare hardcoded hex values (such as `#18181b`, `#27272a`, `#14161d`, `#09090b`, `#1a1a24`), creating visual fragmentation.

### 1.2 Broken Light Mode on Theme Switch
* **Symptom:** When switching to light themes (`paper`, `sand`, `claude`, `cursor`, etc.), cards, menus, chips, and modals break or stay dark with black-on-black or white-on-white text.
* **Root Cause:**
  1. `store.jsx` applies `data-theme="{id}"` to `<html>` and toggles `.dark`, but never sets a universal `data-theme-mode="light"` attribute or `.light` class.
  2. Hundreds of CSS rules in `frontend/src/index.css` were written targeting only `[data-theme='light']` or `[data-theme='paper'], [data-theme='sand']`. When any other light theme is selected (or when theme names differ), those rules fail to match, causing components to fall back to dark-mode styling on a light canvas.

### 1.3 Broken Accent Color Propagation
* **Symptom:** Selecting a custom accent color in Settings or Onboarding only tints a subset of elements; many components remain static purple or blue.
* **Root Cause:**
  1. The BoardUI / Tailwind design system in `frontend/src/styles/theme.css` relies on `--color-accent-50` through `--color-accent-950` (aliased to blue primitives), but `store.jsx`'s `applyAccentColor()` only set `--accent`, `--accent-hover`, and `--ember`.
  2. Many components hardcode Tailwind purple utility classes (`bg-purple-600`, `text-purple-400`, `border-purple-500`) instead of semantic accent tokens.

---

## 2. Curated Theme System (8 Palettes from DesignMDFiles)

The system standardizes on 8 high-fidelity palettes strictly derived from `UIInspirations/DesignMDFiles`, split into 4 dark and 4 light themes.

All themes implement the unified semantic token contract:
- Grounds: `--canvas`, `--canvas-deep`, `--raised`
- Surfaces: `--surface`, `--surface-2`, `--surface-3`
- Text: `--text`, `--text-dim`, `--text-faint`
- Hairlines: `--hairline`, `--hairline-strong`
- Accents: `--accent`, `--accent-hover`, `--accent-line`, `--accent-soft`, `--accent-wash`, `--on-accent`, `--ember`
- Status: `--live`, `--confirm`, `--stop`, `--code-literal`
- Overlays: `--glass`, `--scrim`

### 2.1 Dark Themes

#### 1. Graphite (ElevenLabs Dark Stone)
- **Source:** `DESIGN-elevenlabs.md`
- **Atmosphere:** Clean, warm stone-slate dark.
- **Tokens:**
  - `--canvas`: `#0c0a09`
  - `--canvas-deep`: `#080706`
  - `--raised`: `#141211`
  - `--surface`: `#1c1917`
  - `--surface-2`: `#292524`
  - `--surface-3`: `#181615`
  - `--text`: `#fafaf9`
  - `--text-dim`: `#a8a29e`
  - `--text-faint`: `#78716c`
  - `--hairline`: `rgba(255, 255, 255, 0.08)`
  - `--hairline-strong`: `rgba(255, 255, 255, 0.16)`
  - Default `--accent`: `#8b5cf6`

#### 2. Ink (SpaceX & xAI Pure OLED Pitch Black)
- **Source:** `DESIGN-spacex.md` & `DESIGN-x.ai.md`
- **Atmosphere:** Deepest void dark with obsidian surfaces.
- **Tokens:**
  - `--canvas`: `#000000`
  - `--canvas-deep`: `#000000`
  - `--raised`: `#080808`
  - `--surface`: `#0a0a0a`
  - `--surface-2`: `#121212`
  - `--surface-3`: `#181818`
  - `--text`: `#ffffff`
  - `--text-dim`: `#a1a1aa`
  - `--text-faint`: `#71717a`
  - `--hairline`: `#212327`
  - `--hairline-strong`: `#3a3a3f`
  - Default `--accent`: `#a855f7`

#### 3. Nocturne (Together AI Cosmic Midnight)
- **Source:** `DESIGN-together.ai.md`
- **Atmosphere:** Deep cosmic dark with cold indigo undertones.
- **Tokens:**
  - `--canvas`: `#010120`
  - `--canvas-deep`: `#000014`
  - `--raised`: `#070a24`
  - `--surface`: `#0a0d2a`
  - `--surface-2`: `#141838`
  - `--surface-3`: `#06081c`
  - `--text`: `#f1f5ff`
  - `--text-dim`: `#94a9c4`
  - `--text-faint`: `#657b98`
  - `--hairline`: `rgba(241, 245, 255, 0.09)`
  - `--hairline-strong`: `rgba(241, 245, 255, 0.18)`
  - Default `--accent`: `#635bff`

#### 4. NVIDIA (NVIDIA NIM Deep Engineering Black & Lime)
- **Source:** `DESIGN-nvidia.md`
- **Atmosphere:** Industrial workstation black with GeForce Lime accent.
- **Tokens:**
  - `--canvas`: `#000000`
  - `--canvas-deep`: `#000000`
  - `--raised`: `#0d0d0d`
  - `--surface`: `#111111`
  - `--surface-2`: `#1a1a1a`
  - `--surface-3`: `#0a0a0a`
  - `--text`: `#ffffff`
  - `--text-dim`: `#a7a7a7`
  - `--text-faint`: `#757575`
  - `--hairline`: `#2b2b2b`
  - `--hairline-strong`: `#5e5e5e`
  - Default `--accent`: `#76b900`

### 2.2 Light Themes

#### 5. Paper (Kraken Crisp Gallery White)
- **Source:** `DESIGN-kraken.md`
- **Atmosphere:** High-contrast crisp white with cool slate dividers and Kraken purple accent.
- **Tokens:**
  - `--canvas`: `#ffffff`
  - `--canvas-deep`: `#f6f6f9`
  - `--raised`: `#ffffff`
  - `--surface`: `#f2f2f6`
  - `--surface-2`: `#ededf2`
  - `--surface-3`: `#ebebf1`
  - `--text`: `#101114`
  - `--text-dim`: `#686b82`
  - `--text-faint`: `#9497a9`
  - `--hairline`: `#dedee5`
  - `--hairline-strong`: `#c5c5d1`
  - Default `--accent`: `#7132f5`

#### 6. Sand (ElevenLabs Warm Minimalist Stone)
- **Source:** `DESIGN-elevenlabs.md`
- **Atmosphere:** Warm neutral gallery parchment.
- **Tokens:**
  - `--canvas`: `#f5f5f5`
  - `--canvas-deep`: `#eae7e5`
  - `--raised`: `#ffffff`
  - `--surface`: `#f0efed`
  - `--surface-2`: `#e7e5e4`
  - `--surface-3`: `#dedad6`
  - `--text`: `#0c0a09`
  - `--text-dim`: `#777169`
  - `--text-faint`: `#a8a29e`
  - `--hairline`: `#e7e5e4`
  - `--hairline-strong`: `#d6d3d1`
  - Default `--accent`: `#d97706`

#### 7. Claude (Anthropic Warm Ivory & Coral)
- **Source:** `DESIGN-claude.md`
- **Atmosphere:** Editorial slab ivory with terracotta coral accent.
- **Tokens:**
  - `--canvas`: `#faf9f5`
  - `--canvas-deep`: `#f3f1ea`
  - `--raised`: `#ffffff`
  - `--surface`: `#f5f0e8`
  - `--surface-2`: `#efe9de`
  - `--surface-3`: `#e8e0d2`
  - `--text`: `#141413`
  - `--text-dim`: `#6c6a64`
  - `--text-faint`: `#8e8b82`
  - `--hairline`: `#e6dfd8`
  - `--hairline-strong`: `#cfcac0`
  - Default `--accent`: `#cc785c`

#### 8. Cursor (Cursor Editor Studio Cream)
- **Source:** `DESIGN-cursor.md`
- **Atmosphere:** Engineering cream canvas with electric orange accent.
- **Tokens:**
  - `--canvas`: `#f7f7f4`
  - `--canvas-deep`: `#efeee8`
  - `--raised`: `#ffffff`
  - `--surface`: `#ffffff`
  - `--surface-2`: `#fafaf7`
  - `--surface-3`: `#f0efe8`
  - `--text`: `#26251e`
  - `--text-dim`: `#5a5852`
  - `--text-faint`: `#807d72`
  - `--hairline`: `#e6e5e0`
  - `--hairline-strong`: `#cfcdc4`
  - Default `--accent`: `#f54e00`

---

## 3. Theme Engine & State Architecture

### 3.1 Theme Synchronization in `store.jsx`
* Theme registry:
  ```js
  export const THEMES = [
    'system',
    'graphite',
    'ink',
    'nocturne',
    'nvidia',
    'paper',
    'sand',
    'claude',
    'cursor'
  ]
  export const DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']
  export const LIGHT_THEMES = ['paper', 'sand', 'claude', 'cursor']
  ```
* Applying theme to root:
  ```js
  function applyTheme(theme) {
    const root = document.documentElement
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'paper')
      : theme

    const isDark = DARK_THEMES.includes(resolved)
    root.setAttribute('data-theme', resolved)
    root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light')
    root.style.colorScheme = isDark ? 'dark' : 'light'
    root.classList.toggle('dark', isDark)
    root.classList.toggle('dark-mode', isDark)
    root.classList.toggle('light', !isDark)

    const tag = document.querySelector('meta[name="theme-color"]')
    if (tag) {
      const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim()
      if (canvas) tag.setAttribute('content', canvas)
    }
  }
  ```

### 3.2 Dynamic Accent Ramp Generation
`applyAccentColor(hex)` updates both direct CSS variables and the Tailwind/BoardUI ramp:
```js
function applyAccentColor(hex) {
  const root = document.documentElement
  if (!hex || typeof hex !== 'string') {
    // Clear custom overrides to inherit theme defaults
    ...
    return
  }

  const validHex = hex.startsWith('#') ? hex : '#' + hex

  // Direct CSS vars
  root.style.setProperty('--accent', validHex)
  root.style.setProperty('--accent-hover', `color-mix(in srgb, ${validHex} 82%, black)`)
  root.style.setProperty('--accent-line', validHex)
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${validHex} 16%, transparent)`)
  root.style.setProperty('--accent-wash', `color-mix(in srgb, ${validHex} 8%, transparent)`)
  root.style.setProperty('--ember', validHex)
  root.style.setProperty('--focus-ring', `color-mix(in srgb, ${validHex} 35%, transparent)`)

  // Tailwind BoardUI 11-step ramp
  root.style.setProperty('--color-accent-50', `color-mix(in srgb, ${validHex} 6%, white)`)
  root.style.setProperty('--color-accent-100', `color-mix(in srgb, ${validHex} 12%, white)`)
  root.style.setProperty('--color-accent-200', `color-mix(in srgb, ${validHex} 24%, white)`)
  root.style.setProperty('--color-accent-300', `color-mix(in srgb, ${validHex} 45%, white)`)
  root.style.setProperty('--color-accent-400', `color-mix(in srgb, ${validHex} 70%, white)`)
  root.style.setProperty('--color-accent-500', validHex)
  root.style.setProperty('--color-accent-600', `color-mix(in srgb, ${validHex} 85%, black)`)
  root.style.setProperty('--color-accent-700', `color-mix(in srgb, ${validHex} 70%, black)`)
  root.style.setProperty('--color-accent-800', `color-mix(in srgb, ${validHex} 52%, black)`)
  root.style.setProperty('--color-accent-900', `color-mix(in srgb, ${validHex} 36%, black)`)
  root.style.setProperty('--color-accent-950', `color-mix(in srgb, ${validHex} 20%, black)`)
  root.style.setProperty('--color-brand', validHex)
}
```

---

## 4. CSS Refactoring & Light-Mode Harmonization

1. **Root & Theme Palette Declarations:**
   * Rewrite `:root[data-theme='...']` blocks for the 8 curated themes in `frontend/src/index.css`.
   * Add `:root[data-theme-mode='light']` and `:root[data-theme-mode='dark']` base rules for common properties.
2. **Selector Consolidation:**
   * Global replace of fragmented selectors:
     * Replace `[data-theme='light']` with `[data-theme-mode='light']`
     * Replace `[data-theme='paper'], [data-theme='sand']` with `[data-theme-mode='light']`
     * Replace `[data-theme='dark']` with `[data-theme-mode='dark']`
3. **Card & Surface Hex Replacement:**
   * Replace hardcoded dark hexes in `.pm-menu-container`, `.mcp-modal`, `.model-menu-v2`, `.doc-card-preview`, `.conn-card-core`, and related overlays with `var(--surface)` / `var(--surface-2)` / `var(--canvas)`.
4. **Accent Utility Cleanup:**
   * Replace hardcoded purple utility styles in interactive badges, questions, and action bars with `var(--accent)` or `var(--color-accent-500)`.

---

## 5. UI Views Alignment

* **`frontend/src/views/Settings.jsx`:**
  * Update `THEME_CHOICES` to match the curated 8 themes with updated labels and hints.
  * Update mockup color indicators for each theme preview card.
* **`frontend/src/components/OnboardingWizard.jsx` & `SplashScreenWizard.jsx`:**
  * Align theme lists and preview swatches to the curated themes.

---

## 6. Verification & Test Plan

1. **Theme Switch Stability:**
   * Cycle through all 8 themes in Settings.
   * Verify every light theme (`paper`, `sand`, `claude`, `cursor`) renders without dark card relics or illegible text.
   * Verify every dark theme (`graphite`, `ink`, `nocturne`, `nvidia`) has consistent surface tone.
2. **Accent Customization:**
   * Change accent to Blue, Green, Amber, Coral, Purple, and custom hex.
   * Verify both primary controls, focus rings, and BoardUI elements react immediately.
3. **Lint & Build:**
   * Run `npm run lint` and `npm run build` in `frontend` to ensure 0 syntax errors or styling regressions.
