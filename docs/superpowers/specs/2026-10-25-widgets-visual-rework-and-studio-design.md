# Widgets Visual Rework and Apple-Style Widget Studio Specification

**Status**: Approved Design  
**Date**: 2026-10-25  
**Scope**: Frontend Home Dashboard (`frontend/src/dashboard/`)  
**Design Reference**: Bento Grid Modular Architecture (Screenshots 1–5: Nothing OS, Digesto, macOS/iOS Widget Gallery, Health Bento, Editorial Clinic)  

---

## 1. Goal & Principles

Transform the Amethyst Home widgets into vibrant, tactile, highly aesthetic Bento cards with rich backgrounds, subtle animations, fading gradients, realistic image elements, and glowing status indicators. In addition, replace the existing widget list picker with an Apple/macOS-style two-panel Widget Studio that simplifies discovery, live previews, and customization.

### Applied 30 Laws of UX

1. **Aesthetic-Usability Effect**: High-craftsmanship gradients, typography, and micro-animations make the dashboard feel calm, reliable, and delightful.
2. **Jakob's Law**: The Widget Studio mirrors the proven two-panel mental model (categories on left, large live preview and size switcher on right) familiar to macOS and iOS users.
3. **Fitts's Law**: Primary interaction targets (play/pause timer, size pills, `+ Add to Dashboard` button) have a minimum height of 44–48px with generous hit margins.
4. **Hick's Law**: Categorizing 32+ widgets into 8 high-level domains with search filtering prevents choice paralysis.
5. **Miller's Law**: Information is chunked into groups of 3–5 items per card, with expand drawers for long lists.
6. **Von Restorff Effect**: High-priority widgets (e.g. Focus Timer in solar flame, active notifications in amber/coral) stand out with bold visual contrast.
7. **Goal-Gradient & Zeigarnik Effects**: Concentric progress rings and checklist strike-throughs visually motivate users toward completing daily objectives.
8. **Doherty Threshold**: Instantaneous UI responses (<100ms) for size toggling, category switching, and timer actions.
9. **Law of Common Region & Proximity**: Clear squircle card boundaries (`border-radius: 20px–24px`) with ambient backdrops isolate context cleanly.
10. **Law of Prägnanz**: No nested scrollbars; cards clamp row counts with dedicated "Show all" drawer links.

---

## 2. Widget Visual Identities & Aesthetics

Each widget features an iconic visual personality harmonized with the active theme's lightness and contrast:

### 2.1 Glance Row (Hero Vitals)
* **`glance.clock`**:
  * Dark matte background with subtle dot-matrix background pattern.
  * Large tabular monospace numerals (`font-variant-numeric: tabular-nums`).
  * Glowing live second indicator dot.
* **`glance.weather`**:
  * Atmospheric gradient background (sky blues and twilight sunset amber).
  * Floating cloud/sun icon badge.
  * Large bold temperature readout (`32°` / `15°`) and condition chip.
* **`glance.music`**:
  * Dark vinyl record disc illustration with circular concentric groove lines.
  * Dynamic soundwave equalizer with 4 bouncing bars animated via CSS keyframes.
  * Track title, artist attribution, and duration tracker.
* **`glance.next-event`**:
  * Mini calendar date block with month header and day number.
  * Event title, time pill (`10:30 AM`), and relative countdown (`in 35m`).

### 2.2 Today's Focus Hub
* **`focus-timer`**:
  * Radiant solar flame gradient background (`#ea580c` to `#f97316`).
  * SVG radial tick dial around countdown time.
  * Prominent digital countdown (`25:00`).
  * Contrast play/pause pill button with active running pulse animation, plus quick `+5m` and reset buttons.
  * `localStorage` persistence across navigation.
* **`progress-gauge`**:
  * Concentric circular SVG progress arcs (Daily Tasks, Focus Time, Reviews).
  * Smooth CSS transitions on `stroke-dashoffset`.
  * Real-time percentage calculation with celebratory particle/spark effect upon 100% completion.
* **`task.today`**:
  * Clean, elevated bento card with subtle hairline border and ambient shadow.
  * Custom squircle checkboxes (`border-radius: 8px`) with check-simple SVG icon and strike-through animation.
  * Due time chips with priority colors: green (later), amber (soon), coral (overdue).
  * Top inline task creation field with autofocus.
* **`agenda`**:
  * Schedule timeline with connected route dots and status pills.
  * Active meeting highlight with 1-click "Join / Open" link.

### 2.3 Attention & Intelligence Streams
* **`needs-you`**:
  * Unified triage list with category badge pills (Mail = indigo, Draft = violet, Waiting = amber, Overdue = coral).
  * Two-line layout: primary subject + "why it needs you" explanation.
  * Trailing action button (Review, Approve, Reply).
* **`lib.resurface`**:
  * Card-cover aspect ratio with reading progress bar (`43 / 416 pages`, green bar).
  * Note/book title, author attribution, and reading time estimate.
* **`dev.prs`**:
  * Monospace repository badge and branch chip.
  * CI status badges (green pass / red fail) and review state chips.

---

## 3. Apple/macOS-Style "Add Widget" Studio

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ WIDGET STUDIO                                                                      [✕] │
├──────────────────────────┬─────────────────────────────────────────────────────────────┤
│ 🔍 Search widgets...     │ [ S ] [ M (Active) ] [ L ]                  Showing 32      │
├──────────────────────────┼─────────────────────────────────────────────────────────────┤
│ CATEGORIES               │ ┌─────────────────────────────────────────────────────────┐ │
│ • All Widgets        (32)│ │ LIVE STAGE PREVIEW (Interactive `WidgetFrame`)          │ │
│ • Glance              (4)│ │ [ Real interactive preview with current styling ]       │ │
│ • Focus & Tasks       (4)│ └─────────────────────────────────────────────────────────┘ │
│ • Needs Attention     (5)│                                                             │
│ • Intelligence        (3)│ Focus Timer · Time Management                               │
│ • Developer           (3)│ Boost deep work intervals with Pomodoro presets and alarms. │
│ • Communication       (4)│                                                             │
│ • Library & Feeds     (5)│                                        [ + Add to Dashboard ]│
│ • System & Settings   (4)├─────────────────────────────────────────────────────────────┤
│                          │ BROWSE FOCUS & TASKS                                        │
│                          │ [ Focus Timer ▾ ] [ Task Checklist ] [ Daily Gauge ]        │
└──────────────────────────┴─────────────────────────────────────────────────────────────┘
```

### 3.1 Studio Components & Interaction Architecture
* **Left Navigation Rail**:
  * 8 categories: All Widgets, Glance, Focus & Tasks, Needs Attention, Intelligence, Developer, Communication, Library & Feeds, System.
  * Each item displays an icon, category label, and real-time widget count badge.
  * Keyboard accessible with full arrow navigation.
* **Stage Header**:
  * Real-time search field with instant clear button and match counter.
  * Segmented Size Control (`S`, `M`, `L`) with active indicator. Non-supported sizes are disabled with descriptive tooltip.
* **Live Interactive Stage**:
  * Renders `WidgetFrame` in `preview={true}` mode on an elevated backdrop.
  * Allows users to see the exact gradients, animations, and typography before committing.
* **Action Footer**:
  * Widget metadata: Title, domain badge, refresh cadence, and source connector.
  * Primary action button (min 48px height):
    * If not on dashboard: `+ Add to Dashboard` (accent fill, tactile feedback).
    * If on dashboard: `✓ Added (Remove)` toggle.
    * If system widget: `Open Settings`.
* **Category Browse Tray**:
  * Card grid displaying widgets belonging to the active category.
  * Clicking any card instantly swaps the live stage preview.

---

## 4. Technical Implementation & Files Touched

1. **`frontend/src/dashboard/home.css`**:
   * Add gradient background tokens (`--widget-solar`, `--widget-sky`, `--widget-emerald`, `--widget-vinyl`, etc.).
   * Add keyframe animations (`soundwave-flutter`, `timer-pulse`, `gauge-stroke`, `drawer-slide-in`).
   * Add studio layout CSS rules (`.widget-studio`, `.studio-sidebar`, `.studio-stage`, `.studio-tray`).
   * Ensure strict `@media (prefers-reduced-motion: reduce)` compliance.
2. **`frontend/src/dashboard/widgets/Gallery.jsx`**:
   * Re-architect into the two-panel Apple-style Widget Studio.
   * Provide category navigation, instant search, size toggle, live preview stage, and one-click add/remove.
3. **`frontend/src/dashboard/WidgetFrame.jsx`**:
   * Add widget-specific visual theme hooks and classes.
   * Support live preview mode without side effects.
4. **Widgets (`FocusTimer.jsx`, `ProgressGauge.jsx`, `Clock.jsx`, `Weather.jsx`, `Music.jsx`, `Items.jsx`)**:
   * Apply rich backgrounds, radial tick dials, SVG concentric arcs, vinyl records, and squircle checkboxes.
5. **`frontend/src/dashboard/Home.jsx`**:
   * Wire `Add widget` action to open the redesigned Widget Studio.

---

## 5. Verification & Testing

* **`node frontend/tests/today.mjs`**: Ensure ranking, date rendering, and safe links pass without regression.
* **`node frontend/tests/widgets.mjs`**: Validate widget manifests, registration, category filtering, and size management.
* **Responsive checks**: Verify layout integrity at 1440px desktop, 768px tablet, and 390px mobile widths.
