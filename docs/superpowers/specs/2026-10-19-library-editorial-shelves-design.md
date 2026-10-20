# Library Editorial Shelves & Chrome Consolidation Design Spec

**Date:** 2026-10-19  
**Status:** Approved for Implementation  
**Target Subsystems:** `frontend/src/views/Library.jsx`, `frontend/src/views/library/`

---

## 1. Overview & Problem Statement

Amethyst's library view currently exhibits significant visual clutter and underutilizes vertical and horizontal screen real estate:

1. **Heavy Chrome Before Content:**  
   The page currently stacks three dense vertical control bars taking over ~180px before any saved content appears:
   - Header with title, live status badge, verbose explanatory paragraph, and 4 action buttons.
   - Omnibar / Search bar with redundant borders, sort dropdown, and capture triggers.
   - Multi-tier Filter Bar with format tabs, rating pills, source dropdown, and category dropdown.

2. **Unstructured Chronological Grid Mixing:**  
   Content is currently grouped strictly by timestamp (*Today*, *Yesterday*, *Earlier This Week*). Within each date bucket, wildly different media formats (tall 9:16 reels, 16:9 YouTube videos, text-heavy articles, personal notes, and GitHub repositories) are thrown together into one bento grid. This creates jagged row heights, awkward whitespace, and cognitive overload.

This specification defines a **consolidated single-tier command deck** and a **curated editorial shelves architecture** guided by `@minimalist-ui`, `@emil-design-eng`, and the repository design tokens (`AGENTS.md` / `index.css`).

---

## 2. Goals & Non-Goals

### Goals
- **Single-Tier Command Deck:** Unify header actions, live sync status, search, instant URL capture, view switcher, and add triggers into a single compact bar, saving >100px of vertical space.
- **Curated Editorial Shelves:** When in default view ("All", no search active), segment content into four natural shelves:
  1. *Jump Back In* (recent 48h captures and items currently syncing/processing)
  2. *Essential Knowledge* (curated 5★ references and high-impact entities with rich synopsis and action CTAs)
  3. *Media & Watchlist* (videos, reels, podcasts with media aspect ratio cards, play triggers, and duration badges)
  4. *Reading & Insights* (articles, documentation, code repositories, and notes with high typographic legibility)
- **Fluid Filter State Transition:** Clicking any shelf's "View all →" or selecting a format tab (like `Videos` or `Articles`), or typing a search query, instantly transitions the canvas into a focused grid or list view for that query.
- **Tactile Polish & Performance:** Active press feedback (`scale(0.97)` on buttons, `scale(0.99)` on cards), sub-200ms transitions, staggered entry reveals, and 1px hairline borders (`var(--border)`).
- **Strict Theme & Token Compliance:** Adheres to Kraken tokens (`index.css`), semantic font scaling (`--text-scale`), and light/dark theme modes.

### Non-Goals
- Modifying backend SQLite schemas or API contracts (all required data is already exposed by `/api/library`).
- Removing the existing Bento Grid or Stream List layouts; both remain available in the focused/filtered view mode.

---

## 3. UI & Component Architecture

### 3.1 Consolidated Command Deck (`LibraryToolbar.jsx`)
The header row and search omnibar are merged into one cohesive top bar:
- **Left:** `Library` title with subtle monospace artifact count / live syncing status indicator.
- **Center:** Streamlined Search / Quick-Capture input. Entering a URL dynamically renders a `Save ↵` pill.
- **Right:** 
  - Integrated sort selector (`Newest first` / `Oldest first`).
  - Segmented layout switch (`⊞ Bento` / `☰ Stream`).
  - Secondary actions: `Playlist` (if audio exists), `Sync & Capture` modal trigger.
  - Primary `＋ Add` capsule button (`⌘K` shortcut).

### 3.2 Flush Filter Ribbon (`LibraryFilterBar.jsx`)
Sits flush directly beneath the command deck with a subtle hairline separator:
- **Left:** Clean segmented format tabs (*All*, *Articles*, *Videos*, *Notes*) with count badges.
- **Right:** Curated rating pill (*★ Essential*), *Sources* platform dropdown, and *Categories* dropdown.

### 3.3 Curated Editorial Shelves (`LibraryEditorialShelves.jsx` - New Component)
When no specific filter or search query is active (`!hasFilter`), the canvas renders four dedicated shelves:

1. **Jump Back In**:
   - Filter: `isProcessing === true` OR `created_at` within last 48 hours.
   - Layout: Compact horizontal feed with live status pulse dot on syncing items.
2. **Essential Knowledge**:
   - Filter: `item.rating === 5` or high-value curated entity.
   - Layout: Two-column editorial bento cards with entity subtitle, rating badge, synopsis, and action CTAs.
3. **Media & Watchlist**:
   - Filter: `isVideo === true` or audio items.
   - Layout: Aspect-ratio aware grid (16:9 for YouTube/Vimeo, 9:16 for Reels/TikTok) with duration pill and hover play overlay.
4. **Reading, Code & Notes**:
   - Filter: Articles, newsletters, GitHub repositories, and markdown notes.
   - Layout: Clean 3-column typographic card grid focusing on title, author, domain, and excerpt.

Each shelf includes a header row with shelf icon, title, item count badge, and a `View all →` button that sets the active filter.

### 3.4 Focused Filtered Mode (`LibraryGrid.jsx` / `LibraryListView.jsx`)
When `hasFilter === true` (query, category, kind, tag, or rating is set), the canvas smoothly transitions to the existing full-canvas bento grid or stream list, honoring the user's selected layout.

---

## 4. Micro-Interactions & Styling (`library.css`)

- **Press Scale:** Active state feedback on interactive elements:
  ```css
  .lib-card:active { transform: scale(0.99); }
  .lib-btn:active, .lib-shelf-action:active { transform: scale(0.97); }
  ```
- **Hover Transitions:** `transform: translateY(-2px)` with subtle diffuse elevation `box-shadow: 0 2px 8px rgba(0,0,0,0.04)` over `180ms cubic-bezier(0.23, 1, 0.32, 1)`.
- **Staggered Reveals:** Cards animate in with a light cascade (`delay: calc(index * 35ms)`, `translateY(8px) -> 0`, `opacity: 0 -> 1`).
- **Whitespace & Elevation:** Generous vertical rhythm between shelves (`margin-bottom: 40px`), clean 1px borders (`1px solid var(--border)`), warm monochrome background, no heavy drop shadows.

---

## 5. Verification Plan

### Automated / Syntax Verification
- Run frontend lint and build checks: `npm run build` in `frontend/`.
- Ensure no broken imports or missing prop types.

### Manual Verification
- Test default view: ensure all 4 shelves render populated items accurately.
- Test empty shelf handling: shelves with 0 items are omitted gracefully without breaking the layout.
- Test filter activation: clicking `View all →` on "Media & Watchlist" sets `selectedKind='video'` and switches to full grid.
- Test command deck: search query typing, instant URL paste with `Save ↵` trigger, and layout toggling.
- Test theme consistency in light and dark mode.
