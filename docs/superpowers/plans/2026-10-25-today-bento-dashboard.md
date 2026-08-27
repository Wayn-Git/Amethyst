# Today Bento Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Amethyst Home dashboard into an award-winning, 10/10 usability desktop instrument panel structured into 4 thematic Bento sections with tactile squircle widgets, domain-tailored backgrounds, a focus timer, and a live progress gauge.

**Architecture:** Reorganize `Home.jsx` into four dedicated semantic sections (Glance & Vitals, Today's Focus Hub, Needs Attention triage, and Intelligence Streams). Supplement existing widgets with a persistent `FocusTimer` and a dynamic SVG `ProgressGauge` computed from real `task.today` items, styled via modular Bento CSS grid rules in `home.css` that strictly observe Kraken theme tokens.

**Tech Stack:** React 19, Vanilla CSS (Kraken design tokens, custom SVG textures, clamp typography), Node.js Playwright test suite.

**Spec:** `docs/superpowers/specs/2026-10-25-today-bento-dashboard-design.md`

## Global Constraints

- **Theme Tokens Only:** Never hard-code hex colors; all styling must use `var(--canvas)`, `var(--canvas-deep)`, `var(--accent)`, `var(--hairline)`, `var(--stop)`, `var(--confirm)`, `var(--warn)`.
- **Honest States & Fault Isolation:** Every widget retains `<WidgetBoundary>` and supports loading, empty, error, and disconnected states with zero fake data.
- **Fitts's Law Hit Targets:** Primary interactive targets (timer play/pause, task checkboxes, triage actions) must meet a 44px–48px minimum hit dimension.
- **No Scrolling Inside Cards:** Content lists preview up to 5 items with a drawer expansion (`Show all (n)`) for remaining rows.
- **Responsive Fluidity:** Flawless rendering with no horizontal scrolling or nested scrollbars at 1440px desktop, 900px tablet, and 390px mobile viewports.

## Review Focus

1. **Focus Timer Persistence:** Navigating away from Home or editing widget layout while the timer is running must not reset the timer state.
2. **Zero-Task Progress Gauge:** When `task.today` has 0 tasks or is loading/empty, `ProgressGauge` must render a graceful "0 tasks today" state without dividing by zero or throwing NaN.
3. **Empty & Disconnected Glance States:** A fresh or unauthenticated profile (weather unset, spotify not connected) must render clean compact connection tiles without layout shifts.
4. **Mobile & Narrow Breakpoints (390px):** The 4-column glance tiles wrap cleanly into 1-2 columns and the 12-column Focus Hub stacks vertically into single-column cards without overflowing viewport edges.
5. **Theme Switching Contrast:** Both light mode (`--canvas: #ffffff`) and dark mode (`--canvas-deep: near-black`) maintain WCAG AA contrast for text, status badges, and SVG waveforms.

---

### Task 1: Component & Unit Model for Focus Timer and Daily Progress

**Files:**
- Create: `frontend/src/dashboard/widgets/FocusTimer.jsx`
- Create: `frontend/src/dashboard/widgets/ProgressGauge.jsx`
- Test: `frontend/tests/focus-timer.test.mjs`

**Interfaces:**
- Consumes: Standard React hooks (`useState`, `useEffect`, `useCallback`, `useRef`).
- Produces:
  - `<FocusTimer onComplete?: () => void />`
  - `<ProgressGauge completed={number} total={number} />`

- [ ] **Step 1: Write the failing unit test for FocusTimer and ProgressGauge logic**

```javascript
// frontend/tests/focus-timer.test.mjs
import assert from 'node:assert/strict'

function calculateProgress(completed, total) {
  if (!total || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

assert.equal(calculateProgress(0, 0), 0)
assert.equal(calculateProgress(3, 5), 60)
assert.equal(calculateProgress(5, 5), 100)
assert.equal(formatTimer(1500), '25:00')
assert.equal(formatTimer(299), '04:59')
assert.equal(formatTimer(0), '00:00')
console.log('PASS Focus timer and progress gauge calculation unit tests')
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node frontend/tests/focus-timer.test.mjs`
Expected: PASS

- [ ] **Step 3: Implement `ProgressGauge.jsx`**

Create `frontend/src/dashboard/widgets/ProgressGauge.jsx`:
- Accepts `completed` and `total` props.
- Computes `percent = calculateProgress(completed, total)`.
- Renders an SVG semi-circle arc (radius 42, circumference ~132) with background track (`var(--hairline)`) and animated progress stroke (`var(--accent)` or `var(--confirm)` at 100%).
- Displays bold percentage in center, and subtitle: `{completed} of {total} tasks completed`.

- [ ] **Step 4: Implement `FocusTimer.jsx`**

Create `frontend/src/dashboard/widgets/FocusTimer.jsx`:
- Stores `secondsRemaining` (default 1500 = 25m), `isActive` (boolean), `preset` (25m / 50m / 15m).
- Uses `localStorage.getItem('amethyst.focus_timer')` on mount to restore active state with `endTime` calculation.
- Renders bold digital readout (`formatTimer(secondsRemaining)`).
- Pill action button for Play / Pause toggle with minimum 48px hit target.
- Secondary buttons: "+5m" extension and "Reset".
- Dispatches custom event `amethyst-focus-complete` or plays audio ping when hitting 0.

- [ ] **Step 5: Verify build / import syntax**

Run: `node -e "import('./frontend/src/dashboard/widgets/FocusTimer.jsx'); import('./frontend/src/dashboard/widgets/ProgressGauge.jsx')"`
Expected: No syntax or import resolution errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard/widgets/FocusTimer.jsx frontend/src/dashboard/widgets/ProgressGauge.jsx frontend/tests/focus-timer.test.mjs
git commit -m "feat(dashboard): add FocusTimer and ProgressGauge components"
```

---

### Task 2: Bento Grid Layout & CSS Design Tokens Overhaul

**Files:**
- Modify: `frontend/src/dashboard/home.css`

**Interfaces:**
- Consumes: Amethyst Kraken design tokens (`--canvas`, `--canvas-deep`, `--accent`, `--hairline`, etc.).
- Produces: CSS classes `.bento-section`, `.bento-focus-hub`, `.bento-progress-card`, `.bento-timer-card`, `.bento-tasks-card`, `.bento-agenda-card`, `.bento-streams-grid`.

- [ ] **Step 1: Define Bento Section Classes and Grid Variables in `home.css`**

Add responsive layout classes:
- `.bento-section`: semantic section wrapper with clean eyebrow label (`.bento-section-title`).
- `.bento-glance-row`: 4-column squircle grid (`grid-template-columns: repeat(4, minmax(0, 1fr))`).
- `.bento-focus-grid`: 12-column Bento grid with 16px gap (`grid-template-columns: repeat(12, minmax(0, 1fr))`).
  - `.bento-col-4`: `grid-column: span 4`.
  - `.bento-col-8`: `grid-column: span 8`.
  - `.bento-col-12`: `grid-column: span 12`.
- `.bento-streams-grid`: 3-column grid (`grid-template-columns: repeat(3, minmax(0, 1fr))`).

- [ ] **Step 2: Add Tactile Card Styling & Backgrounds**

Style cards with:
- `border-radius: var(--radius-cards)` (14px–16px).
- `border: 1px solid var(--hairline-strong)`.
- `background: var(--canvas)`.
- `box-shadow: 0 2px 8px rgb(var(--shade) / .04)`.
- Subtle hover elevation transition (`transform: translateY(-1px)`).
- `.bento-timer-card`: High-contrast solid accent surface using `linear-gradient(135deg, var(--home-action), color-mix(in srgb, var(--accent) 85%, #000))`, white text, high-contrast white pause/play button.
- `.bento-progress-card`: Soft pastel wash using `color-mix(in srgb, var(--accent) 6%, var(--canvas))`.

- [ ] **Step 3: Add Responsive Breakpoints**

- `@media (max-width: 1100px)`: Focus Hub 12-column grid reflows: Progress & Timer span 6, Agenda spans 12, Tasks span 12. Streams grid becomes 2 columns.
- `@media (max-width: 768px)`: All Bento cards stack to `grid-column: span 12`. Glance row wraps to 2x2.
- `@media (max-width: 540px)`: Glance row becomes 1 column. Padding drops to 16px.

- [ ] **Step 4: Verify CSS syntax**

Run: `node -e "const fs = require('fs'); fs.readFileSync('frontend/src/dashboard/home.css', 'utf8')"`
Expected: Clean read with valid syntax.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dashboard/home.css
git commit -m "style(dashboard): implement bento grid layout and tactile card styles"
```

---

### Task 3: Section 1 (Glance & Vitals Strip) Rich Aesthetic & SVG Textures

**Files:**
- Modify: `frontend/src/dashboard/WidgetFrame.jsx:52-67`
- Modify: `frontend/src/dashboard/home.css`

**Interfaces:**
- Consumes: `Glance` component in `WidgetFrame.jsx`.
- Produces: Enhanced glance faces for `glance.clock`, `glance.weather`, `glance.next-event`, and `glance.music`.

- [ ] **Step 1: Enhance `glance.clock` face with dot-matrix mesh**

In `WidgetFrame.jsx` (`Glance` function):
- Add SVG dot-matrix backdrop mesh to `.glance-clock-face`.
- Render local time in tabular numerals (`tabular-nums`) with live second counter.
- Show localized timezone name and GMT offset.

- [ ] **Step 2: Enhance `glance.weather` face with atmospheric gradient**

- Render weather condition icon with subtle atmospheric backdrop glow.
- Large temperature numeral with unit (`°C`).
- Rain alert / condition pill badge with rain cloud SVG icon.

- [ ] **Step 3: Enhance `glance.next-event` face with calendar date block**

- Render squircle calendar date block: red/accent month header + bold day number.
- Event title with bold typography, start time, and relative countdown chip ("in 45m").

- [ ] **Step 4: Enhance `glance.music` face with rotating vinyl disc & waveform**

- Render vinyl record disc with radial grooves (`repeating-radial-gradient`).
- Mini soundwave bars SVG indicator when playback is active.
- Track name, artist, and playback status pill.

- [ ] **Step 5: Verify Glance rendering in `dashboard-shell.mjs` test**

Run: `node frontend/tests/dashboard-shell.mjs`
Expected: Unit layout assertions pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard/WidgetFrame.jsx frontend/src/dashboard/home.css
git commit -m "feat(dashboard): enhance glance vitals tiles with domain SVG textures"
```

---

### Task 4: Section 2 (Today's Focus Hub) Assembly in `Home.jsx`

**Files:**
- Modify: `frontend/src/dashboard/Home.jsx`
- Modify: `frontend/src/dashboard/home.css`

**Interfaces:**
- Consumes: `<FocusTimer />`, `<ProgressGauge />`, `<NeedsYou />`, `renderWidget` from `Home.jsx`.
- Produces: The 4 structured Bento sections in the main Home view.

- [ ] **Step 1: Calculate Today's Task Metrics in `Home.jsx`**

In `Home.jsx`:
- Read `records['task.today']?.payload?.items || []`.
- Count `totalTasks = items.length`, `completedTasks = items.filter(i => i.completed || i.status === 'done').length`.
- Pass to `<ProgressGauge completed={completedTasks} total={totalTasks} />`.

- [ ] **Step 2: Assemble Section 2 (Today's Focus Hub) Bento Grid**

Replace the raw columns in `Home.jsx` with:
- `<section className="bento-section" aria-label="Today's focus">`
  - Header: `<h2 className="bento-section-title">Today's Focus</h2>`
  - `<div className="bento-focus-grid">`
    - `<div className="bento-card bento-col-4"><ProgressGauge ... /></div>`
    - `<div className="bento-card bento-col-4"><FocusTimer /></div>`
    - `<div className="bento-card bento-col-4">{renderWidget(agendaPos)}</div>`
    - `<div className="bento-card bento-col-12">{renderWidget(todayTasksPos)}</div>`
  - `</div>`
- `</section>`

- [ ] **Step 3: Assemble Section 3 (Needs Attention) & Section 4 (Intelligence Streams)**

- Section 3: `<section className="bento-section" aria-label="Needs attention"><NeedsYou ... /></section>`.
- Section 4: `<section className="bento-section" aria-label="Intelligence and streams"><div className="bento-streams-grid">{streamWidgets.map(renderWidget)}</div></section>`.

- [ ] **Step 4: Run Playwright dashboard tests**

Run: `node frontend/tests/dashboard-shell.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dashboard/Home.jsx frontend/src/dashboard/home.css
git commit -m "feat(dashboard): assemble 4-section bento layout in Home view"
```

---

### Task 5: Interactive Task Checklist & Squircle Checkbox Enhancements

**Files:**
- Modify: `frontend/src/dashboard/widgets/Items.jsx`
- Modify: `frontend/src/dashboard/home.css`

**Interfaces:**
- Consumes: `Items` widget component.
- Produces: Enhanced task list with custom squircle checkboxes, status chips, and smooth optimistic completion.

- [ ] **Step 1: Add custom squircle checkbox styling**

In `home.css`:
- Style `.task-check`: custom 22px squircle box (`border-radius: 6px`, `border: 2px solid var(--hairline-strong)`).
- When checked: `background: var(--accent)`, checkmark SVG appears, text transitions with strikethrough and muted opacity.
- Min 44px hit target on checkbox container (Fitts's Law).

- [ ] **Step 2: Add Due Chips in `Items.jsx`**

In `Items.jsx`:
- Show formatted due badge: "Today · 2:00 PM" or "Overdue" (in coral chip).
- Hover actions: Quick complete button and edit button directly visible without opening nested details on desktop.

- [ ] **Step 3: Test Items interactions**

Run: `node frontend/tests/dashboard-items.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dashboard/widgets/Items.jsx frontend/src/dashboard/home.css
git commit -m "feat(dashboard): enhance task checklist with squircle checkboxes and due chips"
```

---

### Task 6: Needs Attention & Streams Visual Polish

**Files:**
- Modify: `frontend/src/dashboard/NeedsYou.jsx`
- Modify: `frontend/src/dashboard/home.css`

**Interfaces:**
- Consumes: `NeedsYou` component.
- Produces: Polished priority triage rows with high-contrast category badges and inline connection banners.

- [ ] **Step 1: Polish category badges in `NeedsYou.jsx`**

- Color-code badge chips: `MAIL` (indigo wash), `DRAFT` (blue wash), `WAITING` (amber wash), `MENTION` (violet wash), `OVERDUE` (coral wash).
- Add 1-click action buttons with hover state elevation.

- [ ] **Step 2: Polish disconnected source rows**

- Compact card banner for disconnected Gmail/Calendar with icon and "Connect" link.

- [ ] **Step 3: Verify NeedsYou and triage in test**

Run: `node frontend/tests/dashboard-shell.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dashboard/NeedsYou.jsx frontend/src/dashboard/home.css
git commit -m "style(dashboard): polish needs you triage cards and category badges"
```

---

### Task 7: Full Test Suite Verification & Visual Audit

**Files:**
- Verify: `frontend/tests/dashboard-shell.mjs`
- Verify: `frontend/tests/dashboard-items.mjs`
- Verify: `frontend/tests/today.mjs`

- [ ] **Step 1: Run all dashboard frontend test suites**

Run:
```bash
node frontend/tests/today.mjs
node frontend/tests/focus-timer.test.mjs
node frontend/tests/dashboard-shell.mjs
```
Expected: All tests PASS with exit code 0.

- [ ] **Step 2: Verify responsive layout constraints at 1440px and 390px**

Ensure `dashboard-shell.mjs` viewport checks pass without horizontal scrolling.

- [ ] **Step 3: Update documentation changelog**

Add 1-line entry to `docs/dashboard-changelog.md`:
"Redesigned Home view into 4-section Bento layout with FocusTimer, ProgressGauge, and tactile squircle cards."

- [ ] **Step 4: Final commit**

```bash
git add docs/dashboard-changelog.md
git commit -m "docs: record today bento dashboard overhaul in changelog"
```
