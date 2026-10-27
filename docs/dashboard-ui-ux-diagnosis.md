# Amethyst Home Dashboard: UI/UX Defect Diagnosis & Remediation Guide

**Target Audience:** Next Implementing Agent / Developer  
**Status:** Actionable Technical Brief  
**Originating Issues:** Layout overlap, naked floating elements, drawer-vs-live preview mismatch, rigid size clamping, and corner clipping.

---

## 1. Executive Summary

Recent dashboard modernization work introduced `@tugan/widgets` and adopted card styling for a subset of Glance widgets (`glance.air`, `glance.sun`, `glance.weather`, `glance.clock`, `glance.music`). However, blanket global CSS overrides and slot-level layout constraints caused severe regressions across the Home dashboard (`/today`):

1. **Z-index & Layout Collisions:** Content overflows slot boundaries due to `overflow: visible !important`, causing widgets to physically render on top of adjacent widgets.
2. **Naked Floating Elements:** Slot container borders and backgrounds were stripped universally on `task.*`, `glance.*`, `need.*`, and `agent.*` widgets. Non-adopted widgets and all empty/disconnected/error states now float as raw text and buttons without card containers.
3. **Menu vs. Dashboard Mismatch:** Designs selected in the drawer (e.g., "Atmospheric" Weather or "Night Rotation" Music) do not match what renders on the live dashboard.
4. **Rigid Height Clamping:** 170px fixed slot rows force cards to truncate critical controls (e.g. music scrubbers, play buttons, weather rows).
5. **Corner Radius Clipping:** 24px border radii clip bottom-row text and numbers because internal padding does not account for corner curvature.

---

## 2. Deep Root-Cause Analysis

### Issue 1: Overlapping Elements & Z-Index Collisions
- **Files Affected:**  
  - [`frontend/src/dashboard/widget-adoptions.css`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widget-adoptions.css#L40-L56)  
  - [`frontend/src/dashboard/home-bento.css`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/home-bento.css#L97-L107)  
  - [`frontend/src/dashboard/WidgetFrame.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/WidgetFrame.jsx#L64-L78)
- **Mechanism:**
  - `home-bento.css` sets `grid-auto-rows: var(--w-unit, 170px);`. Slots are assigned fixed spans (`data-size="s"` = 1 row, `data-size="m"` = 1 row).
  - In `widget-adoptions.css` lines 40 & 56, `.today-slot-body` and `.home-widget.widget-adoption` have `overflow: visible !important`.
  - When widget content exceeds 170px (e.g., Overdue tasks card, Upcoming calendar, Deadlines list), the content does not scroll or expand the grid cell. It bleeds downward by 50–150px and draws directly across the widget below it.
  - In `WidgetFrame.jsx`, `.widget-header` has `position: absolute !important; top: 8px; right: 8px; z-index: 10 !important;` with absolute connection buttons, which collide with overlapping content from above.
  - `grid-auto-flow: dense` in `home-bento.css` line 100 arbitrarily backfills slots, breaking visual reading order.

---

### Issue 2: Naked Floating Components & Missing Card Enclosures
- **Files Affected:**  
  - [`frontend/src/dashboard/WidgetSlot.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/WidgetSlot.jsx#L10-L11)  
  - [`frontend/src/dashboard/WidgetFrame.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/WidgetFrame.jsx#L70-L84)  
  - [`frontend/src/dashboard/layout.js`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/layout.js#L59-L64)  
  - [`frontend/src/dashboard/widget-adoptions.css`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widget-adoptions.css#L3-L11)  
  - [`frontend/src/dashboard/widgets/Music.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widgets/Music.jsx#L520-L585)
- **Mechanism:**
  - In `WidgetSlot.jsx` and `WidgetFrame.jsx`, the adoption flag was expanded indiscriminately:
    ```javascript
    const adopted = ADOPTED_WIDGETS.has(id) || Boolean(id && (id.startsWith('task.') || id.startsWith('glance.') || id.startsWith('need.') || id.startsWith('agent.')))
    ```
  - In `widget-adoptions.css`:
    ```css
    .home-layout-grid .today-widget-slot.widget-slot-adopted,
    .home-layout-grid .today-widget-slot:has(.widget-adoption),
    .home-layout-grid .today-widget-slot:has(.wg-card) {
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      padding: 0 !important;
    }
    ```
  - This stripped container borders and backgrounds under the false assumption that every child widget renders its own `.wg-card` surface.
  - In reality, only a few widgets (`glance.clock`, `glance.air`, `glance.sun`, `glance.weather`, `glance.music` when active) render standalone cards.
  - All `need.*` widgets (`need.inbox`, `need.drafts`, `need.waiting`, `need.mentions`, `need.overdue`), `task.*` widgets, and fallback states (`.home-connect`, `.widget-setup`, `.ui-state`, `EmptyState`) rely on the outer slot container for their card styling.
  - When rendered inside a transparent, borderless slot, they turn into naked text lines ("No items.", "Connect Slack", "Live data unavailable") and uncontained pills floating on the raw page canvas.
  - Even in `Music.jsx`, the empty state ("Open a desktop music player to start listening") and error states have explicit inline styles: `style={{ background: 'transparent', border: 0 }}`, leaving them completely naked when inactive.

---

### Issue 3: Drawer/Menu Preview vs. Dashboard Live Mismatch
- **Files Affected:**  
  - [`frontend/src/dashboard/widgets/WeatherGlance.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widgets/WeatherGlance.jsx#L295-L335)  
  - [`widgets/glance.weather/template.txt`](file:///home/wayne/Documents/GitHub/amethyst/widgets/glance.weather/template.txt#L68-L105)  
  - [`frontend/src/dashboard/widgets/Music.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widgets/Music.jsx#L42-L56)  
  - [`frontend/src/dashboard/widgets/music/NowPlayingCard.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widgets/music/NowPlayingCard.jsx#L1100-L1160)  
  - [`frontend/src/dashboard/Home.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/Home.jsx#L148-L162)
- **Mechanism:**
  - **Weather (`glance.weather`):**
    - `WeatherGlance` does NOT accept or consume `props.design`.
    - It uses isolated local state: `const [directionChoice, setDirectionChoice] = useState(...)`.
    - When the user selects "Atmospheric" in the drawer, it updates the drawer component's local state and writes to `localStorage.setItem('glance.weather.direction', dirId)`.
    - It never calls `changeDesign()` in `Home.jsx`. Because `views` in `Home.jsx` is memoized and does not observe `localStorage`, the dashboard instance never updates.
    - Additionally, in `widgets/glance.weather/template.txt`, the illustrated clouds/sun artwork only renders when `sizeChoice === "large"` (which the drawer uses), whereas the dashboard widget is forced into `sizeChoice === "medium"` (which only renders a text table).
  - **Music (`glance.music`):**
    - In the drawer preview, the "Night Rotation" (`media-md-03`) design is shown at its natural height (~340px) with 140px square album artwork, metadata, progress scrubber, and full transport controls (shuffle, prev, play circle, next, repeat).
    - When active on the dashboard, it is rendered in a 170px slot (`size="m"`).
    - The layout squeezes the artwork to a tiny 40px thumbnail, clips the timestamp line in half, and completely chops off the play/pause transport row below the slot edge.

---

### Issue 4: Rigid Size Clamping vs. Natural Widget Footprint
- **Files Affected:**  
  - [`frontend/src/dashboard/home-bento.css`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/home-bento.css#L97-L107)  
  - [`backend/dashboard/models.py`](file:///home/wayne/Documents/GitHub/amethyst/backend/dashboard/models.py)  
  - [`frontend/src/dashboard/Home.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/Home.jsx#L136-L147)
- **Mechanism:**
  - The bento grid forces every widget into strict, discrete height buckets:
    - Small (`s`) = 1 unit height (170px)
    - Medium (`m`) = 1 unit height (170px)
    - Large (`l`) = 2 unit height (352px)
  - The backend schema and `Home.jsx` support variable heights (`height: 2` to `8`), but `home-bento.css` ignores `position.height` and hardcodes `grid-row: span 1` and `grid-row: span 2`.
  - Content-rich medium cards (such as 5-day weather forecasts or music players with transport controls) require 220px–300px to avoid clipping. Forcing them into 170px either truncates content or forces text onto adjacent rows when `overflow: visible` is set.

---

### Issue 5: Corner Radius Clipping & Edge Jamming
- **Files Affected:**  
  - [`frontend/src/components/ui/bento/system.css`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/components/ui/bento/system.css#L5)  
  - [`widgets/glance.weather/template.txt`](file:///home/wayne/Documents/GitHub/amethyst/widgets/glance.weather/template.txt#L60-L110)  
  - [`frontend/src/dashboard/widgets/music/NowPlayingCard.jsx`](file:///home/wayne/Documents/GitHub/amethyst/frontend/src/dashboard/widgets/music/NowPlayingCard.jsx)
- **Mechanism:**
  - Cards apply `--w-radius: 24px` with `overflow: hidden`.
  - In `WeatherGlance`, the bottom row (`Today 21° 30°`) sits within 4–6px of the bottom edge.
  - Because `border-radius: 24px` curves inward dramatically across both axes, content sitting within 20px of the bottom corners collides with the inner boundary of the curve.
  - Per the `better-ui` skill: *Outer radius equals inner radius plus padding*. Insufficient bottom padding (`padding: 3` = 12px) causes visual tangency and cutting of numbers and glyphs against the corner radius.

---

## 3. Step-by-Step Remediation Plan for the Next Agent

### Step 1: Fix Surface Isolation & Eliminate Naked Floating States
1. **Scope `.widget-slot-adopted` strictly:**
   - In `WidgetSlot.jsx` and `WidgetFrame.jsx`, do NOT blanket-adopt based on string prefixes (`task.*`, `need.*`, etc.).
   - Only apply `.widget-slot-adopted` if the widget actually provides an internal `.wg-card` surface or is verified in `ADOPTED_WIDGETS`.
2. **Restore Card Enclosures for Fallbacks:**
   - In `widget-adoptions.css`, ensure fallback states (`.home-connect`, `.widget-setup`, `.ui-state`, `EmptyState`) retain:
     - `background: var(--tile-bg, var(--w-card));`
     - `border: 1px solid var(--w-border, var(--hairline));`
     - `border-radius: var(--w-radius, 24px);`
     - `padding: var(--w-pad, 16px);`
   - In `Music.jsx`, update the empty and error states to render an enclosed card (`background: var(--w-card); border: 1px solid var(--w-border); border-radius: var(--w-radius);`) instead of `style={{ background: 'transparent', border: 0 }}`.

### Step 2: Prevent Content Overlap & Grid Overflow Collisions
1. **Eliminate Uncontrolled Bleed:**
   - In `widget-adoptions.css`, remove `overflow: visible !important` from `.today-slot-body` and `.home-widget.widget-adoption`.
   - Set `contain: paint` or `overflow: hidden` on slot containers so content cannot physically draw outside its assigned cell.
2. **Support Dynamic Grid Heights:**
   - In `home-bento.css`, support discrete height spans based on `position.height` or manifest requirements (e.g., allow `grid-row: span var(--slot-span-y, 1)`).
   - If a widget requires more vertical space (e.g. Medium music card with full transport controls), set its slot height to span 2 rows (~352px) or use an aspect ratio that fits the complete transport bar.
3. **Turn off `grid-auto-flow: dense`:**
   - Change `grid-auto-flow: dense` to `grid-auto-flow: row` in `home-bento.css` line 100 so widgets do not randomly scramble visual hierarchy.

### Step 3: Wire Design Direction to Dashboard State
1. **Weather Design Synchronization:**
   - In `WeatherGlance.jsx`, accept `design` from props.
   - When the user selects a design direction in the drawer ("Atmospheric", "Minimal", etc.), call `changeDesign('glance.weather', dirId)` via `useDashboard()`.
   - Persist the selected design into layout state so the dashboard instance re-renders with the chosen template variant.
2. **Ensure Size / Variant Parity:**
   - In `widgets/glance.weather/template.txt`, allow the "Atmospheric" sky illustration to render in medium/large sizes if atmospheric mode is chosen, rather than restricting it strictly to large drawers.
   - For `glance.music`, when "Night rotation" is selected, allocate sufficient row height so the scrubber and transport controls are visible and not clipped.

### Step 4: Fix Corner Radius Geometry & Internal Insets
1. **Concentric Padding Calculation:**
   - For cards with `border-radius: 24px`, ensure internal content padding is at least `16px`–`18px` on all sides, with `padding-bottom: 16px;`.
   - In `widgets/glance.weather/template.txt` and `NowPlayingCard.jsx`, add sufficient bottom clearance (`paddingBottom: 16px`) so bottom-row elements never touch the 24px corner arc.

---

## 4. Verification Checklist

Before marking the dashboard fixes complete, the agent must verify:
- [ ] No widget overflows its slot boundary or overlaps any neighboring widget.
- [ ] Empty, not-connected, and error states all render inside clean card surfaces with visible borders and backgrounds.
- [ ] Selecting "Atmospheric" in the Weather drawer updates the live weather widget on the dashboard.
- [ ] Selecting "Night rotation" in the Music drawer displays without clipped timestamps or truncated playback buttons.
- [ ] All bottom text and icons have clear margin separation from the 24px rounded corners.
- [ ] Dark, light, and high-contrast themes render cards with correct contrast and no unstyled elements.
