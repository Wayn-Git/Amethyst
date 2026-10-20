# Amethyst Library Redesign Specification

**Date:** 2026-10-20  
**Status:** Approved  
**Topic:** Library Cards, Top Bar, and Filters Redesign  

---

## 1. Executive Summary

This document specifies the redesign of the **Library** section in Amethyst. The update tackles card presentation issues (awkward thumbnail sizing, extra borders/margins, congested interiors, and inconsistent typography) and replaces the top bar and filter bar with an animation-packed, feature-packed command interface. The entire redesign adheres strictly to Amethyst's Kraken design tokens, eliminating all pill-shaped and overly rounded geometries in favor of crisp, modern 4px, 6px, and 10px radii, while leveraging prebuilt UI component primitives (`@base-ui/react`, `components/ui/`).

---

## 2. Requirements & Design Principles

### 2.1 Geometry & Design Language
- **Strictly No Pills:** Zero `border-radius: 9999px`, `rounded-full`, or large pill capsules anywhere in the library view (including tags, badges, buttons, inputs, tabs, and modals).
- **Scale Radii:**
  - Micro-elements (links, tags, chips, keyboard hints, badges): `4px` (`--radius-links` / `--radius-sm`).
  - Cards, rows, and buttons: `6px` (`--radius-cards` / `--radius-buttons`).
  - Dropdown popovers, menus, and modals: `10px` (`--radius-lg`).
- **Grounds & Elevation:**
  - Ground cards using `--raised` over `--canvas-deep`.
  - Borders use `--hairline` (`var(--hairline-strong)` on hover).
  - Cards utilize hairline separation plus subtle ambient shadow (`0 1px 3px rgba(0,0,0,0.04)` resting, `0 8px 24px -4px rgba(0,0,0,0.12)` hover), with no clumsy drop shadows.

### 2.2 Card Layout & Sizing
- **Flush Top Hero Media:**
  - Thumbnail container is flush to the top and side borders (0 margin, 0 outer padding, 0 inner border seams).
  - Consistent standard height: `190px` on grid cards (`object-fit: cover`, `object-position: center top`).
  - Removes blurred background backdrops and awkward letterboxing.
  - Subtle dark bottom vignette (`linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 40%)`) solely to guarantee legibility of duration badges.
- **Spacious Interiors (No Congestion):**
  - Card body padding increased to `18px 20px 16px 20px`.
  - Defined vertical rhythm with `gap: 10px`.
- **Typography Consistency:**
  - **Source Strip:** 16px favicon or author avatar, domain or author handle (`--text-dim`, 11.5px), and smooth hover quick-action buttons.
  - **Title:** `--text-body-lg` (16px), line-height 1.4, font-weight 600, clamped to strictly 2 lines.
  - **Subtitle / Summary:** `--text-input` (13.5px), line-height 1.55, `--text-dim`, clamped to 2–3 lines with inline markdown formatting (`strong`, `code`, `em`).
  - **Tag Badges:** Crisp 4px rectangular badges with `#` prefix, max 3 visible + `+N` count badge.
  - **Pinned Footer:** Full date (`dateFull`), read time or duration metadata, and crisp rectangular curator rating tier badge.

### 2.3 Top Bar & Filters
- **Top Command Deck (`LibraryToolbar.jsx`):**
  - **Brand & Live Status:** Library title with live sync indicator (pulsing dot when background indexing is active) and item count.
  - **Smart Search & Omnibar:** Integrated search and quick-capture input with instant URL detection. If a URL is entered, reveals a primary "Save" button (`↵`); otherwise acts as search with clear button (`X`) and shortcut hint (`⌘/`).
  - **Sort Menu:** Prebuilt `DropdownMenu` or sleek button toggle for Newest, Oldest, Rating.
  - **Layout Switcher:** Segmented 6px toggle between Bento Grid and Stream List.
  - **Action Suite:** Primary "+ Add" button (`⌘K`), Spotify playlist export, and external capture/relay modal triggers.
- **Animation-Packed Filter Ribbon (`LibraryFilterBar.jsx`):**
  - **Framer Motion Sliding Tab Indicator:** Horizontal format tabs (All, Articles, Videos, Posts, Notes) with spring sliding indicator (`layoutId="libActiveFilterTab"`).
  - **Curated 5★ Essential Quick Toggle:** 1-click filter button highlighting top reference knowledge.
  - **Feature-Packed Filter Popover:** Prebuilt Base-UI dropdown housing:
    - *Significance:* 5★ Essential, 4★+ High Impact.
    - *Platforms:* YouTube, Instagram, Spotify, Threads, Pinterest, GitHub, X (Twitter), Reddit.
    - *Categories:* Auto-discovered categories with live counts.
    - *Tags:* Searchable tag list with count pills.
  - **Active Filter Strip:** Animated entrance/exit (`AnimatePresence`) for applied filters with 1-click "Reset all".

---

## 3. Component Architecture & Prebuilt Integrations

```
frontend/src/views/
├── Library.jsx                     # Top-level view orchestrator
└── library/
    ├── LibraryToolbar.jsx          # Top Command Deck (Prebuilt Buttons, Inputs, DropdownMenu)
    ├── LibraryFilterBar.jsx        # Animated Filter Ribbon (Framer Motion sliding tab, Base UI popover)
    ├── LibraryCard.jsx             # Flush-media spacious Bento Card (Zero pills, 190px hero media)
    ├── LibraryGrid.jsx             # Bento grid container with staggered motion
    ├── LibraryListView.jsx         # Dense list view alternative
    └── library.css                 # Refactored CSS tokens (Zero pills, crisp radii, spacious padding)
```

### Prebuilt Components Utilized:
1. `components/ui/button.tsx` (Base-UI Button with variant system: default, outline, secondary, ghost)
2. `components/ui/dropdown-menu.tsx` (Base-UI Menu for filters, sorting, actions)
3. `components/ui/tooltip.tsx` (Base-UI Tooltip for quick action tooltips)
4. `components/ui/Badge.jsx` (Status & counter badge)
5. Framer Motion (`motion.div`, `AnimatePresence`, `layoutId`)

---

## 4. Detailed Component Changes

### 4.1 `LibraryCard.jsx`
- Replace `aspect-ratio` hacks with fixed `190px` height container on `.lib-card-media`.
- Set image `object-fit: cover; object-position: center top;` with 0 margins, 0 paddings, 0 inner borders.
- Replace `.lib-card-rating-badge` pill (`border-radius: 9999px`) with `border-radius: 4px`.
- Replace carousel indicator pill with crisp 4px badge.
- Standardize title font size, line-height, and 2-line clamp.
- Standardize summary font size, line-height, and 3-line clamp.
- Ensure all quick actions in `.lib-card-inline-actions` use `border-radius: 4px`.

### 4.2 `LibraryToolbar.jsx`
- Rebuild layout using prebuilt `Button` and `DropdownMenu` primitives.
- Replace `.lib-capture-pill-btn` with crisp 6px button.
- Clean up search input with 6px radius, hairline border, and focus ring.
- Provide smooth layout transition for layout switcher.

### 4.3 `LibraryFilterBar.jsx`
- Implement `<motion.div layoutId="libActiveFilterTab" />` with spring physics behind active format tab.
- Replace `.lib-filter-curated-pill` and all `.lib-pill-count` pills with 4px rectangular counters.
- Clean up the filter dropdown popover using `@base-ui/react` with smooth entrance animation and categorized sections.
- Wrap active filter chips in `AnimatePresence` for smooth exit transitions.

### 4.4 `library.css`
- Global audit of `border-radius: 9999px` / pills in `library.css`:
  - `.lib-header-badge` -> `border-radius: 4px`
  - `.lib-capture-pill-btn` -> `border-radius: 6px`
  - `.lib-deck-sort-pill` -> `border-radius: 6px`
  - `.lib-card-platform-pill` -> `border-radius: 4px`
  - `.lib-card-carousel-pill` -> `border-radius: 4px`
  - `.lib-card-rating-badge` -> `border-radius: 4px`
  - `.lib-pill-count` -> `border-radius: 4px`
  - `.lib-filter-curated-pill` -> `border-radius: 6px`
- Standardize `.lib-card`:
  - `border-radius: 6px`
  - `.lib-card-media`: `height: 190px; border: none; margin: 0; padding: 0;`
  - `.lib-card-body`: `padding: 18px 20px 16px; gap: 10px;`

---

## 5. Verification Plan

### 5.1 Automated Tests
- Run existing test suites:
  ```bash
  npm run test:library
  ```
  Ensure all `LibraryCard` SSR tests and `LibraryDetailModal` tests pass with zero regressions.
- Run production bundle build check:
  ```bash
  npm run build
  ```
  Ensure there are no TypeScript, CSS, or Rollup bundling errors.

### 5.2 Manual Verification
- Open `http://localhost:8001/library` in desktop browser:
  1. Verify card thumbnails fill top container edge-to-edge without borders or margins.
  2. Verify cards look spacious with ample padding and clean typography between title, summary, tags, and footer.
  3. Verify zero pills exist across cards, top bar, and filter bar.
  4. Test format tab switching with the sliding Framer Motion indicator.
  5. Test filter popover opening, selecting platforms/categories/ratings, and active filter chip removals.
  6. Test search and URL quick capture.
