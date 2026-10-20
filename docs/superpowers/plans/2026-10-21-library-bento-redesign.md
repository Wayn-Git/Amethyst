# Library True Bento & Unified Command Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Amethyst Library section with true bento aspect-ratio media cards, generous non-congested typography, a single unified command deck, and strict zero-pill geometry.

**Architecture:** 
1. Card components use dedicated aspect ratios (9:16 for Reels/Shorts, 16:9 for landscape, 1:1 for square, tinted editorial block for notes) with flush top fitting, frosted play/platform overlays, and 20px interior padding with clean title/summary hierarchy.
2. The top bar is consolidated into a single unified command deck integrating the omnibar search/capture, embedded Framer Motion format tabs, categorized filter popover, view toggles, and primary add action into one cohesive row.
3. The Bento grid layout restores intelligent 2-row vertical spans for reels and 2-col wide spans for hero saves.

**Tech Stack:** React 19, Framer Motion, Base UI (`@base-ui/react`), Lucide/Phosphor Icons, CSS Variables & Design Tokens.

**Spec:** [`docs/superpowers/specs/2026-10-21-library-bento-redesign.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-21-library-bento-redesign.md)

## Global Constraints
- Zero pill-sized elements (`border-radius: 9999px` / `rounded-full` strictly forbidden on cards, tags, buttons, badges, tabs, and inputs).
- Standard radii: 4px (`--radius-sm`), 6px (`--radius-cards`), 10px (`--radius-lg`), 14px (`--radius-xl`).
- Media containers must fit flush at top with card edge (6px top radius, 0 bottom radius) with no letterboxing borders or margins.
- Card interior body must have generous 20px padding (`padding: 20px 22px 18px 22px`) with distinct 12px vertical rhythm.
- Preserve Kraken color rules: purple is never a status; green is live/running; amber is confirm/waiting.

## Review Focus
1. **Vertical Media Cropping:** Tall 9:16 Reels/TikToks must render in 2-row vertical bento cells with `aspect-ratio: 9/16` without chopping off video subjects or heads.
2. **Summary Readability:** AI summaries must render as clean, readable prose clamped to 3 lines without concatenating bullet points with ugly inline `·` separators.
3. **Empty / Note Cards:** Notes and items without thumbnails must render as handsome editorial text cards rather than broken empty media boxes.
4. **Command Deck Responsiveness:** The unified command deck must seamlessly adapt on smaller viewports without overlapping controls or broken layout.
5. **Filter Popover Interaction:** The filter popover must open reliably from the command deck and correctly apply Significance, Platform, and Tag filters.

---

### Task 1: Card Interior & Aspect Ratio Media Hero

**Files:**
- Modify: `frontend/src/views/library/LibraryCard.jsx`
- Modify: `frontend/src/views/library/library.css`
- Test: `frontend/tests/library_card.mjs`

**Interfaces:**
- Consumes: `item` knowledge object (`id`, `title`, `summary`, `url`, `app`, `kind`, `duration_seconds`, `thumbnail_path`, `rating`, `tags`)
- Produces: True bento card component with variant classes (`lib-card--portrait`, `lib-card--landscape`, `lib-card--square`, `lib-card--wide`, `lib-card--note`)

- [ ] **Step 1: Update unit tests in `frontend/tests/library_card.mjs` to assert bento aspect-ratio classes, non-pill radii, and clean summary rendering**
- [ ] **Step 2: Run test to observe baseline output**
  Run: `node frontend/tests/library_card.mjs`
- [ ] **Step 3: Implement true aspect-ratio hero media and spacious body in `LibraryCard.jsx`**
  - Restore media aspect ratio styles (`portrait`: 9/16 max 380px, `landscape`: 16/9, `square`: 1/1, `wide`: horizontal split, `note`: text-first).
  - Re-introduce video play button overlay (`.lib-card-play-btn`) and top-left platform badge (`.lib-card-platform-pill`) with 4px/6px radii.
  - Fix summary text rendering: remove the ugly dot-concatenation (`formatInlineMarkdown` with ` · `); render clean prose with 3-line clamp.
  - Set interior body padding to `padding: 20px 22px 18px 22px` with 12px vertical spacing between metadata, title, summary, tags, and footer.
- [ ] **Step 4: Update `library.css` card rules to enforce flush fitting, aspect ratios, and zero pills**
- [ ] **Step 5: Run tests to verify all card tests pass**
  Run: `node frontend/tests/library_card.mjs`
  Expected: 3 passed, 0 failed
- [ ] **Step 6: Commit**
  ```bash
  git add frontend/src/views/library/LibraryCard.jsx frontend/src/views/library/library.css frontend/tests/library_card.mjs
  git commit -m "feat(library): restore true bento card aspect ratios, spacious interior hierarchy, and flush hero media"
  ```

---

### Task 2: Dynamic Bento Grid Layout Calculations

**Files:**
- Modify: `frontend/src/views/library/LibraryGrid.jsx`
- Modify: `frontend/src/views/library/library.css`

**Interfaces:**
- Consumes: `getBentoItemConfig(item, index, totalInGroup)`
- Produces: `{ spanClass: string, variant: string }`

- [ ] **Step 1: Restore intelligent bento item configuration in `LibraryGrid.jsx`**
  - Detect vertical media (Reels, TikTok, Shorts, Pinterest): return `spanClass: 'col-span-1 sm:row-span-2'`, `variant: 'portrait'`.
  - Detect wide hero items (index 0 or 5-star essential in groups of 4+): return `spanClass: 'col-span-1 sm:col-span-2 sm:row-span-1'`, `variant: 'wide'`.
  - Detect square slide posts: return `spanClass: 'col-span-1'`, `variant: 'square'`.
  - Detect notes / no thumbnail: return `spanClass: 'col-span-1'`, `variant: 'note'`.
  - Default: return `spanClass: 'col-span-1'`, `variant: 'standard'`.
- [ ] **Step 2: Update `.lib-bento-grid` styling in `library.css`**
  - Define `grid-auto-flow: dense` with 22px row and column gaps.
  - Set responsive breakpoints for columns: 1 column on mobile, 2 columns at 640px, 3 columns at 1100px, 4 columns at 1600px.
- [ ] **Step 3: Verify grid compilation**
  Run: `npm run build` in `frontend`
- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/views/library/LibraryGrid.jsx frontend/src/views/library/library.css
  git commit -m "feat(library): restore dynamic bento grid layout with 2-row vertical spans"
  ```

---

### Task 3: Single Unified Command Deck

**Files:**
- Modify: `frontend/src/views/library/LibraryToolbar.jsx`
- Modify: `frontend/src/views/library/LibraryFilterBar.jsx`
- Modify: `frontend/src/views/library/library.css`

**Interfaces:**
- Consumes: `total`, `isProcessingCount`, `query`, `onQueryChange`, `selectedKind`, `onSelectKind`, `selectedCategory`, `selectedTag`, `selectedRating`, `order`, `layout`, `onOpenAddModal`
- Produces: Single unified header element with embedded search, format tabs, filter dropdown popover, and view controls

- [ ] **Step 1: Rebuild `LibraryToolbar.jsx` as a unified command deck**
  - Section 1 (Brand): "Library" heading with real-time syncing counter and green live dot.
  - Section 2 (Search Omnibar): Clean input supporting instant search, URL paste capture mode with `Save (↵)` button, shortcut indicator (`Ctrl+/`), and clear button.
  - Section 3 (Embedded Format Tabs): Framer Motion sliding tab bar (`layoutId="libUnifiedFormatTab"`) for `All`, `Videos`, `Posts`, `Notes`, `Code`, `Reading`.
  - Section 4 (Filter Dropdown): Button with filter icon and active count badge opening categorized filter popover (Significance, Platform, Categories, Tags).
  - Section 5 (Actions): Segmented Grid/List toggle (6px radius), sort selector (Newest, Oldest, Rating), and primary `+ Add` button (`Ctrl+K`).
- [ ] **Step 2: Update `LibraryFilterBar.jsx` to render slim active filter chips**
  - Only visible when active filters are set (Format, Category, Tag, Rating, Query).
  - Clean `AnimatePresence` chip badges with "Clear all" button.
- [ ] **Step 3: Style the Unified Command Deck in `library.css`**
  - Modern instrument panel aesthetic: single flush bar with hairline border, background `var(--raised)`, zero pills.
- [ ] **Step 4: Verify frontend build**
  Run: `npm run build` in `frontend`
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/views/library/LibraryToolbar.jsx frontend/src/views/library/LibraryFilterBar.jsx frontend/src/views/library/library.css
  git commit -m "feat(library): build single unified command deck with embedded format tabs and filter popover"
  ```

---

### Task 4: Integration, Full Test Suite & Live Verification

**Files:**
- Modify: `frontend/src/views/Library.jsx`
- Test: `frontend/tests/library_card.mjs`
- Test: `frontend/tests/library_detail_modal.mjs`

- [ ] **Step 1: Verify seamless prop integration in `Library.jsx` between `LibraryToolbar` and `LibraryFilterBar`**
- [ ] **Step 2: Run full library test suite**
  Run: `npm run test:library`
  Expected: All tests pass (0 failures).
- [ ] **Step 3: Run production bundle build**
  Run: `npm run build`
  Expected: Built cleanly with 0 errors.
- [ ] **Step 4: Validate live rendering on `http://localhost:8001/library`**
  Confirm:
  - Cards have native aspect ratios (tall reels, 16:9 videos, 1:1 posts).
  - No letterbox margins or borders around thumbnails.
  - Spacious 20px interior body padding with clean typography.
  - Single unified command deck with sliding tabs and filter popover.
  - Zero pills anywhere.
- [ ] **Step 5: Final commit**
  ```bash
  git add frontend/src/views/Library.jsx
  git commit -m "chore(library): finalize integration of true bento cards and unified command deck"
  ```
