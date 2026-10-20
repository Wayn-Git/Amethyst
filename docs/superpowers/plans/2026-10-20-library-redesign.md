# Library Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the Amethyst Library section by implementing flush top hero media, spacious typography-consistent cards without pill shapes, and a completely revamped, animation-packed top bar and filter deck utilizing prebuilt UI components.

**Architecture:** Refactor `library.css` to remove pill styling (`9999px`) in favor of crisp 4px/6px/10px radii; overhaul `LibraryCard.jsx` to render flush 190px hero media with 20px interior padding; rebuild `LibraryToolbar.jsx` using prebuilt Base-UI button and dropdown primitives; and rebuild `LibraryFilterBar.jsx` with Framer Motion sliding tabs (`layoutId="libActiveFilterTab"`) and an animated Base-UI filter popover.

**Tech Stack:** React 19, `@base-ui/react`, Framer Motion (`framer-motion` / `motion`), Kraken CSS tokens (`--raised`, `--hairline`, `--accent`, `--text`), TailwindCSS v4, Vite.

**Spec:** [`docs/superpowers/specs/2026-10-20-library-redesign.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-20-library-redesign.md)

## Global Constraints

- Zero pill shapes: absolutely no `border-radius: 9999px` or `rounded-full` anywhere in the library view.
- Allowed radii: `4px` (`--radius-sm`), `6px` (`--radius-cards`), `10px` (`--radius-lg`).
- Color rule: Kraken tokens only (`--accent`, `--hairline`, `--raised`, `--text`, `--text-dim`). Purple is never a status.
- Card padding: generous `18px 20px 16px 20px` to prevent congestion.
- Card thumbnail: flush edge-to-edge container, fixed 190px height, `object-fit: cover`, no margins, no inner borders.
- Prebuilt component usage: integrate `Button`, `DropdownMenu`, `Tooltip`, and `Badge` from `components/ui/` and `@base-ui/react`.

## Review Focus

1. **Card media overflow / clipping:** Images must fill 100% width and exactly 190px height without leaking or showing background letterbox gaps.
2. **Typography consistency across content types:** Articles, videos, tweets/posts, notes, and songs must all share the same 2-line title and 2–3 line summary clamp and font size hierarchy.
3. **Filter tab sliding motion glitching:** Framer Motion layout animations (`layoutId="libActiveFilterTab"`) must smoothly transition between tabs without jumping when filters change.
4. **Pill regression audit:** Verify that no pills or 9999px border-radii remain in badge chips, inputs, tag badges, or rating indicators.
5. **SSR / Test suite compatibility:** Ensure `LibraryCard` and `LibraryDetailModal` SSR tests pass without throwing React hydration or key warnings.

---

## Task Structure

### Task 1: Audit and Replace Pill Geometry & Refactor Spacing in `library.css`

**Files:**
- Modify: `frontend/src/views/library/library.css`

- [ ] **Step 1: Replace all pill border-radii in `library.css`**
  Find every instance of `9999px` or capsule borders in `library.css` and replace them with tokens:
  - `.lib-header-badge` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-capture-pill-btn` -> `border-radius: var(--radius-cards, 6px)`
  - `.lib-deck-sort-pill` -> `border-radius: var(--radius-cards, 6px)`
  - `.lib-card-platform-pill` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-card-carousel-pill` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-card-rating-badge` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-pill-count` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-filter-curated-pill` -> `border-radius: var(--radius-cards, 6px)`
  - `.lib-card-tag-badge` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-card-link-chip` -> `border-radius: var(--radius-sm, 4px)`
  - `.lib-active-filter-chip` -> `border-radius: var(--radius-sm, 4px)`

- [ ] **Step 2: Define Flush Media and Spacious Card Layout in `library.css`**
  Update `.lib-card`, `.lib-card-media`, and `.lib-card-body`:
  - `.lib-card`: `border-radius: var(--radius-cards, 6px); border: 1px solid var(--hairline); background: var(--raised);`
  - `.lib-card-media`: `height: 190px; width: 100%; border: none; border-bottom: 1px solid var(--hairline); margin: 0; padding: 0; overflow: hidden;`
  - `.lib-card-media-img`: `width: 100%; height: 100%; object-fit: cover; object-position: center top;`
  - Remove blurred backdrop pseudo-bleed `.lib-card-media-backdrop` styling that caused strange halo letterboxing.
  - `.lib-card-body`: `padding: 18px 20px 16px 20px; display: flex; flex-direction: column; gap: 10px;`
  - Standardize `.lib-card-title`: `font-size: var(--text-body-lg, 16px); line-height: 1.4; font-weight: 600; -webkit-line-clamp: 2;`
  - Standardize `.lib-card-summary`: `font-size: var(--text-input, 13.5px); line-height: 1.55; color: var(--text-dim); -webkit-line-clamp: 3;`

- [ ] **Step 3: Run quick test check to verify CSS parse**
  Run `npm run test:library` to confirm no SSR errors are triggered by CSS changes.

---

### Task 2: Overhaul `LibraryCard.jsx` for Flush Media, Zero Pills, and Consistent Typography

**Files:**
- Modify: `frontend/src/views/library/LibraryCard.jsx`
- Test: `frontend/tests/library_card.mjs`

- [ ] **Step 1: Refactor media container in `LibraryCard.jsx`**
  - Simplify `.lib-card-media` structure to remove `.lib-card-media-backdrop` and aspect-ratio styling overrides on grid cards.
  - Ensure duration badge and carousel pill sit cleanly on the bottom-right and top-right of the flush 190px media container.
  - Use crisp 4px rectangular badges for `.lib-card-carousel-pill` and `.lib-card-duration-badge`.

- [ ] **Step 2: Standardize typography and metadata hierarchy**
  - Ensure the source strip displays 16px favicon or author avatar with clear domain/author typography.
  - Apply consistent title rendering with 2-line clamp.
  - Apply clean summary/excerpt rendering with 3-line clamp and markdown styling.
  - Ensure tags row uses 4px rectangular `#tag` badges with `+N` badge.
  - Ensure footer has calendar icon, full date, duration/read time, and crisp 4px rectangular rating badge.

- [ ] **Step 3: Run test suite**
  Run:
  ```bash
  npm run test:library
  ```
  Verify all card tests pass.

---

### Task 3: Rebuild `LibraryToolbar.jsx` as an Elevated Command Deck with Prebuilt Components

**Files:**
- Modify: `frontend/src/views/library/LibraryToolbar.jsx`
- Test: `frontend/tests/library_card.mjs`

- [ ] **Step 1: Integrate prebuilt UI primitives in `LibraryToolbar.jsx`**
  - Import `Button` from `../../components/ui/button.tsx`.
  - Import `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `../../components/ui/dropdown-menu.tsx`.
  - Import `Tooltip`, `TooltipTrigger`, `TooltipContent` from `../../components/ui/tooltip.tsx`.

- [ ] **Step 2: Build Brand & Omnibar Quick-Capture Deck**
  - Left: "Library" title with 4px live status badge showing item count and real-time indexing status.
  - Center: Omnibar search & quick-capture input with 6px radius, integrated URL detection, primary "Save" button (`↵`), clear button (`X`), and shortcut hint (`⌘/`).
  - Right:
    - Sort dropdown using prebuilt `DropdownMenu` with options: "Newest first", "Oldest first", "Highest rated".
    - Segmented layout switcher (Grid vs Stream List) with 6px crisp buttons and active indicator.
    - Quick actions: Spotify playlist export button, external sync modal button, and primary "+ Add" button (`⌘K`).

- [ ] **Step 3: Eliminate all pill styles in `LibraryToolbar.jsx`**
  - Change `.lib-capture-pill-btn` to a clean 6px rectangular button with subtle hover elevation.
  - Replace any round pills with 4px/6px rectangular buttons.

---

### Task 4: Rebuild `LibraryFilterBar.jsx` with Framer Motion Sliding Tabs & Prebuilt Filter Popover

**Files:**
- Modify: `frontend/src/views/library/LibraryFilterBar.jsx`
- Test: `frontend/tests/library_card.mjs`

- [ ] **Step 1: Implement Framer Motion Sliding Format Tabs**
  - Format tabs: All, Articles, Videos, Posts, Notes.
  - Wrap tab list in layout-aware container with `<motion.div layoutId="libActiveFilterTab" />` providing smooth sliding background transition between tabs with spring easing.
  - Crisp 6px tab buttons with counts in 4px badges.

- [ ] **Step 2: Build Curated 5★ Essential Quick Toggle**
  - 1-click filter button with gold star icon, "Essential" label, and 4px count badge.
  - Active state lights up with amber accent wash and hairline ring.

- [ ] **Step 3: Rebuild the Filter Popover using `@base-ui/react` Dropdown**
  - Replace custom dropdown markup with prebuilt `DropdownMenu` primitive.
  - Filter sections:
    - *Significance:* 5★ Essential, 4★+ High Impact.
    - *Platforms:* YouTube, Instagram, Spotify, Threads, Pinterest, GitHub, X, Reddit.
    - *Categories:* Discovered categories.
    - *Tags:* Searchable tag list.
  - All filter chips formatted as 4px crisp rectangles with counter badges.

- [ ] **Step 4: Animated Active Filter Strip**
  - Wrap active filter chips in `AnimatePresence` and `<motion.span>` with spring entrance/exit.
  - Clean "Clear all" button to reset all active filters with one click.

---

### Task 5: Polish Layout & Grid Integration in `Library.jsx` & `LibraryGrid.jsx`

**Files:**
- Modify: `frontend/src/views/Library.jsx`
- Modify: `frontend/src/views/library/LibraryGrid.jsx`

- [ ] **Step 1: Standardize Grid Spacing**
  - Ensure `LibraryGrid` utilizes a spacious 24px gap (`gap-6`) between cards.
  - Ensure date group headers are crisp and aligned with the new top bar.

- [ ] **Step 2: Connect Toolbar Sort & Filter State**
  - Ensure sort order (desc / asc / rating) connects seamlessly to backend API queries.
  - Ensure layout switching (grid / list) persists correctly in `amethyst_lib_layout` storage.

---

### Task 6: Full Verification & Build Validation

**Files:**
- Test: `frontend/tests/library_card.mjs`
- Test: `frontend/tests/library_detail_modal.mjs`

- [ ] **Step 1: Run automated test suite**
  ```bash
  npm run test:library
  ```
  Confirm all tests pass with 0 failures.

- [ ] **Step 2: Run production bundle build check**
  ```bash
  npm run build
  ```
  Confirm Vite compiles the bundle without syntax errors, missing imports, or CSS parsing failures.

- [ ] **Step 3: Visual and Manual Review**
  - Check `http://localhost:8001/library` in browser:
    - Cards: verify 190px flush thumbnails, generous padding, zero pill borders.
    - Top bar: test search, URL paste capture, sort dropdown, layout switch.
    - Filters: test sliding Framer Motion format tab, filter popover, and active filter tags.
