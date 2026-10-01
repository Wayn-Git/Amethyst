# Widgets Visual Rework and Apple-Style Widget Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework dashboard widgets with vibrant backgrounds, gradients, animations, and image/SVG accents matching reference bento screenshots, and rebuild the widget picker into an Apple/macOS-style two-panel Widget Studio.

**Architecture:** Extend `home.css` with modular widget gradient tokens, squircle card classes, and keyframe micro-animations; enhance core widget renderers (`Clock`, `Weather`, `Music`, `FocusTimer`, `ProgressGauge`, `Items`) with rich SVG dials, arcs, and squircle checkboxes; refactor `Gallery.jsx` into a two-panel Widget Studio with live stage previews, S/M/L size toggling, and 1-click install.

**Tech Stack:** React (JSX), Vanilla CSS (Theme variables, CSS Grid, SVG primitives, CSS Keyframes), Node.js test runner.

**Spec:** [docs/superpowers/specs/2026-10-25-widgets-visual-rework-and-studio-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-25-widgets-visual-rework-and-studio-design.md)

## Global Constraints

* Existing test suite (`frontend/tests/today.mjs`, `frontend/tests/widgets.mjs`) must stay green.
* Respect `prefers-reduced-motion` for all keyframe animations.
* Colors must maintain WCAG AA text contrast in dark and light modes.
* No nested scrollbars in widget cards (max 5 rows with "Show all" drawer expanders).
* Fitts's law: Touch targets for primary actions must be at least 44–48px high.

## Review Focus

1. **Unsupported size toggle**: When a widget only supports size `s`, switching to `m` or `l` in the studio must disable non-viable sizes and preserve a valid selection.
2. **Timer persistence**: Refreshing or navigating away while Focus Timer is active must preserve remaining time and running status from `localStorage`.
3. **Empty state / Disconnected source**: Disconnected widgets must display a clean, single-row connection prompt rather than an empty card or crashing.
4. **Theme contrast**: Gradient cards (solar orange, sky blue, vinyl dark) must render high-contrast text and chips in both dark and light themes.
5. **Reduced motion**: When `prefers-reduced-motion: reduce` is active, pulsating glows, vinyl rotations, and soundwave flutter animations must halt.

---

### Task 1: Design Tokens, Gradients, and Micro-Animations

**Files:**
- Modify: `frontend/src/dashboard/home.css`
- Test: `frontend/tests/widgets.mjs`

**Interfaces:**
- Consumes: CSS root variables (`--accent`, `--canvas`, `--hairline`, `--text`).
- Produces: Utility classes `.widget-solar`, `.widget-sky`, `.widget-emerald`, `.widget-vinyl`, `.widget-bento-card`, `.widget-squircle-check`, and keyframe animations `soundwave-flutter`, `timer-pulse`, `gauge-stroke`, `drawer-slide-in`.

- [ ] **Step 1: Write failing test in `frontend/tests/widgets.mjs` asserting token presence**
Verify that the stylesheet exports or declares the essential widget theme classes and keyframes.

- [ ] **Step 2: Run test to verify it fails**
Run: `node frontend/tests/widgets.mjs`
Expected: FAIL if test looks for new studio/bento classes.

- [ ] **Step 3: Implement tokens and keyframes in `frontend/src/dashboard/home.css`**
Add CSS variables, gradient definitions, squircle borders (`border-radius: 20px–24px`), ambient shadows, and `@media (prefers-reduced-motion: reduce)` rules.

- [ ] **Step 4: Run test to verify it passes**
Run: `node frontend/tests/widgets.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/dashboard/home.css frontend/tests/widgets.mjs
git commit -m "style(dashboard): add widget gradient tokens, squircle cards, and micro-animations"
```

---

### Task 2: Hero & Glance Widgets Visual Overhaul

**Files:**
- Modify: `frontend/src/dashboard/widgets/Clock.jsx`
- Modify: `frontend/src/dashboard/widgets/Weather.jsx`
- Modify: `frontend/src/dashboard/widgets/Music.jsx`
- Modify: `frontend/src/dashboard/widgets/NextEvent.jsx`
- Modify: `frontend/src/dashboard/home.css`
- Test: `frontend/tests/today.mjs`

**Interfaces:**
- Consumes: Dashboard context (`now`, `manifests`).
- Produces: Styled Glance row tiles with dot-matrix mesh, atmospheric sky gradients, animated vinyl soundwaves, and calendar chips.

- [ ] **Step 1: Write/Update test assertions for glance widgets**
Verify `Clock`, `Weather`, `Music`, and `NextEvent` render proper semantic structures and classes.

- [ ] **Step 2: Run test to verify baseline**
Run: `node frontend/tests/today.mjs`
Expected: PASS

- [ ] **Step 3: Implement visuals in `Clock.jsx`, `Weather.jsx`, `Music.jsx`, and `NextEvent.jsx`**
* `Clock.jsx`: Tabular monospace numerals, glowing second indicator dot, SVG dot-matrix background.
* `Weather.jsx`: Atmospheric dynamic gradient background, bold temperature, floating weather icon badge.
* `Music.jsx`: Vinyl grooved record disc SVG, 4-bar dancing soundwave equalizer, track info.
* `NextEvent.jsx`: Calendar date block with accent badge, time pill, relative countdown.

- [ ] **Step 4: Run tests to verify they pass**
Run: `node frontend/tests/today.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/dashboard/widgets/Clock.jsx frontend/src/dashboard/widgets/Weather.jsx frontend/src/dashboard/widgets/Music.jsx frontend/src/dashboard/widgets/NextEvent.jsx frontend/src/dashboard/home.css
git commit -m "feat(dashboard): overhaul glance widgets with atmospheric gradients, vinyl disc, and dot matrix"
```

---

### Task 3: Focus Hub & Triage Widgets (Timer, Gauge, Tasks, Needs You)

**Files:**
- Modify: `frontend/src/dashboard/widgets/FocusTimer.jsx`
- Modify: `frontend/src/dashboard/widgets/ProgressGauge.jsx`
- Modify: `frontend/src/dashboard/widgets/Items.jsx`
- Modify: `frontend/src/dashboard/widgets/NeedsYou.jsx`
- Modify: `frontend/src/dashboard/home.css`
- Test: `frontend/tests/today.mjs`

**Interfaces:**
- Consumes: Task and item lists, `localStorage` for timer session.
- Produces: Radiant solar flame Focus Timer, concentric SVG completion rings, squircle checklist items, and ranked triage cards.

- [ ] **Step 1: Write/Update test assertions for Focus Hub**
Ensure task toggling, timer actions, and triage category badges remain stable.

- [ ] **Step 2: Run test to verify baseline**
Run: `node frontend/tests/today.mjs`
Expected: PASS

- [ ] **Step 3: Implement visuals in `FocusTimer.jsx`, `ProgressGauge.jsx`, `Items.jsx`, and `NeedsYou.jsx`**
* `FocusTimer.jsx`: Radiant solar flame gradient card (`#ea580c` → `#f97316`), radial tick SVG dial, large countdown time, play/pause pill with running pulse, +5m and reset buttons, `localStorage` persistence.
* `ProgressGauge.jsx`: Concentric circular SVG progress arcs with animated `stroke-dashoffset` and milestone celebrations.
* `Items.jsx`: Squircle checkboxes with checkmark transition and urgency chips (green, amber, coral).
* `NeedsYou.jsx`: Clean triage rows with category badges (Mail = indigo, Draft = violet, Waiting = amber, Overdue = coral).

- [ ] **Step 4: Run tests to verify they pass**
Run: `node frontend/tests/today.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/dashboard/widgets/FocusTimer.jsx frontend/src/dashboard/widgets/ProgressGauge.jsx frontend/src/dashboard/widgets/Items.jsx frontend/src/dashboard/widgets/NeedsYou.jsx frontend/src/dashboard/home.css
git commit -m "feat(dashboard): add solar focus timer, concentric progress gauge, and squircle task checklist"
```

---

### Task 4: Apple/macOS-Style Widget Studio

**Files:**
- Modify: `frontend/src/dashboard/widgets/Gallery.jsx`
- Modify: `frontend/src/dashboard/WidgetFrame.jsx`
- Modify: `frontend/src/dashboard/Drawer.jsx`
- Modify: `frontend/src/dashboard/home.css`
- Test: `frontend/tests/widgets.mjs`

**Interfaces:**
- Consumes: `useDashboard` (`manifests`, `layout`, `addWidget`, `toggleWidget`, `openWidget`).
- Produces: Two-panel modal with category rail, real-time search, S/M/L segment switcher, live stage preview, 48px add/remove action button, and categorized browse tray.

- [ ] **Step 1: Write unit tests in `frontend/tests/widgets.mjs` for Widget Studio**
Test category filtering, size validation, and add/remove callbacks.

- [ ] **Step 2: Run test to verify it fails**
Run: `node frontend/tests/widgets.mjs`
Expected: FAIL if missing studio-specific selectors or callbacks.

- [ ] **Step 3: Implement Widget Studio in `Gallery.jsx` and styling in `home.css`**
* Two-panel layout: Left category rail with badge counts; Right panel with search, S/M/L switcher, live interactive stage (`WidgetFrame` preview), metadata action footer, and thumbnail browse cards.
* Responsive collapse to 1-column on narrow viewports.
* Fitts's Law 48px hit area for `+ Add to Dashboard` / `✓ Added (Remove)` button.

- [ ] **Step 4: Run tests to verify they pass**
Run: `node frontend/tests/widgets.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add frontend/src/dashboard/widgets/Gallery.jsx frontend/src/dashboard/WidgetFrame.jsx frontend/src/dashboard/home.css frontend/tests/widgets.mjs
git commit -m "feat(dashboard): implement Apple-style two-panel Widget Studio with live stage and size switcher"
```

---

### Task 5: End-to-End Integration, Responsiveness & Test Suite Validation

**Files:**
- Modify: `frontend/src/dashboard/Home.jsx`
- Modify: `frontend/tests/widgets.mjs`
- Modify: `docs/dashboard-changelog.md`

**Interfaces:**
- Consumes: All updated widgets and Widget Studio.
- Produces: Seamless user journey from dashboard view to "Add widget" studio and back.

- [ ] **Step 1: Validate full dashboard test suite**
Run: `node frontend/tests/today.mjs && node frontend/tests/widgets.mjs`
Expected: PASS (0 failures).

- [ ] **Step 2: Test responsive breakpoints (desktop 1440px, tablet 768px, mobile 390px)**
Ensure bento grid gracefully scales columns and Widget Studio stacks cleanly on mobile.

- [ ] **Step 3: Record changelog entry in `docs/dashboard-changelog.md`**
Add entry documenting the widget visual overhaul and Widget Studio release.

- [ ] **Step 4: Final commit**
```bash
git add frontend/src/dashboard/Home.jsx docs/dashboard-changelog.md frontend/tests/widgets.mjs
git commit -m "feat(dashboard): complete widget visual overhaul and Apple-style Widget Studio integration"
```
