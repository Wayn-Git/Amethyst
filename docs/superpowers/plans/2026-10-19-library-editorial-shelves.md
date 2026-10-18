# Library Editorial Shelves & Chrome Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the cluttered library section into a consolidated single-tier studio command deck and an organized, serene editorial canvas with four curated shelves (*Jump Back In*, *Essential Knowledge*, *Media & Watchlist*, and *Reading & Insights*).

**Architecture:** A pure client-side layout and component architecture upgrade that partitions library items into four distinct editorial shelves in default view while providing fluid transitions to focused grid/stream views during search or filtering. Consolidates header chrome into a single high-efficiency command deck.

**Tech Stack:** React 18, Vite, Framer Motion, Tailwind CSS, Kraken Design System (`frontend/src/index.css`), Node test runner.

**Spec:** [`docs/superpowers/specs/2026-10-19-library-editorial-shelves-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-19-library-editorial-shelves-design.md)

## Global Constraints

- **Design System Tokens:** Adhere strictly to `AGENTS.md` and `frontend/src/index.css` Kraken tokens (`--k-*`, `--canvas`, `--surface`, `--accent`, `--border`, `--text`, `--text-dim`). Never hardcode font pixel sizes or brand hexes.
- **Micro-Interactions (Emil Kowalski principles):** Press feedback with `scale(0.97)` on buttons and `scale(0.99)` on cards; UI transitions under 200ms using `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Never animate keyboard shortcuts.
- **Minimalist Aesthetic:** 1px hairline borders (`var(--border)`), warm monochrome surfaces, macro-whitespace between shelves (40px), no heavy drop shadows or rainbow badges.
- **Zero API Breaking Changes:** Consume existing `/api/library` endpoints without modifying backend database schemas.

## Review Focus

1. **Empty / Sparse Shelf Handling:** What if a user has zero 5★ essential items or zero videos? Each shelf must gracefully omit itself if empty, without breaking layout balance or throwing runtime errors.
2. **Deduplication Between Shelves:** Items displayed in *Essential Knowledge* (5★) must not redundantly dominate *Media* or *Reading* shelves.
3. **Smooth Filter Transition:** Clicking "View all →" on any shelf must smoothly set the corresponding filter (`selectedKind` or `selectedRating`) and transition the view without flicker or lost scroll position.
4. **URL Quick-Capture Integrity:** Entering a valid URL into the consolidated search/capture input must immediately expose the `Save ↵` pill and trigger background enrichment.
5. **Theme Switching:** All borders, surfaces, text, and active states must render cleanly in both dark (`graphite`, `ink`, `nocturne`) and light (`paper`, `sand`, `claude`, `cursor`) modes.

---

### Task 1: Shelf Partitioning Logic (`shelfUtils.js`) and Unit Tests

**Files:**
- Create: `frontend/src/views/library/shelfUtils.js`
- Create: `frontend/tests/library_shelves.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: Raw item objects from `/api/library`.
- Produces: `partitionLibraryShelves(items: Array) -> { jumpBackIn: Array, essential: Array, media: Array, reading: Array }`

- [ ] **Step 1: Write the failing unit test for shelf partitioning**

Create `frontend/tests/library_shelves.mjs` verifying that `partitionLibraryShelves`:
1. Places processing or fresh items (< 48h) into `jumpBackIn`.
2. Places 5★ items into `essential`.
3. Places video/audio items into `media`.
4. Places articles/notes/repos into `reading`.
5. Handles empty arrays and missing fields without throwing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/library_shelves.mjs`  
Expected: FAIL (cannot find module `shelfUtils.js`).

- [ ] **Step 3: Implement `partitionLibraryShelves` in `frontend/src/views/library/shelfUtils.js`**

Implement deterministic partitioning:
```javascript
export function partitionLibraryShelves(items = []) {
  const now = Date.now()
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000

  const jumpBackIn = []
  const essential = []
  const media = []
  const reading = []

  const essentialIds = new Set()

  for (const item of items) {
    const isProcessing = Boolean(item.isProcessing || item.status === 'processing' || item.status === 'enriching' || item.isOptimistic)
    const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0
    const isRecent = createdAt > 0 && (now - createdAt) < FORTY_EIGHT_HOURS

    if ((isProcessing || isRecent) && jumpBackIn.length < 6) {
      jumpBackIn.push(item)
    }

    if (item.rating === 5 && essential.length < 4) {
      essential.push(item)
      essentialIds.add(item.id)
    }
  }

  for (const item of items) {
    if (essentialIds.has(item.id)) continue

    const url = (item.url || '').toLowerCase()
    const app = item.app || ''
    const isVideo = item.kind === 'video' || app === 'youtube' || app === 'tiktok' || url.includes('/reel/') || url.includes('/shorts/') || Boolean(item.duration_seconds)
    const isAudio = item.kind === 'music' || item.kind === 'podcast' || app === 'spotify'

    if (isVideo || isAudio) {
      if (media.length < 8) media.push(item)
    } else {
      if (reading.length < 9) reading.push(item)
    }
  }

  return { jumpBackIn, essential, media, reading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/library_shelves.mjs`  
Expected: PASS with 0 failures. Add script `"test:shelves": "node tests/library_shelves.mjs"` to `frontend/package.json`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/library/shelfUtils.js frontend/tests/library_shelves.mjs frontend/package.json
git commit -m "feat(library): add shelf partitioning utility and test suite"
```

---

### Task 2: Curated Editorial Shelves Component (`LibraryEditorialShelves.jsx`)

**Files:**
- Create: `frontend/src/views/library/LibraryEditorialShelves.jsx`
- Modify: `frontend/tests/library_shelves.mjs`

**Interfaces:**
- Consumes: `{ shelves: { jumpBackIn, essential, media, reading }, onSelect, onNavigateShelf, onReindex, onEnrich, onDelete, onTagClick, busyId }`
- Produces: React DOM rendering of the 4 editorial shelves with clean shelf headers, item counts, and "View all →" triggers.

- [ ] **Step 1: Add SSR render test to `frontend/tests/library_shelves.mjs`**

Add test rendering `<LibraryEditorialShelves />` with sample partitioned data to assert that shelf titles (`Jump Back In`, `Essential Knowledge`, `Media & Watchlist`, `Reading & Insights`) render without crashing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/library_shelves.mjs`  
Expected: FAIL (cannot find module `LibraryEditorialShelves.jsx`).

- [ ] **Step 3: Implement `LibraryEditorialShelves.jsx`**

Build the component with four modular sections:
1. `Jump Back In`: Compact horizontal row with live pulse badge on syncing cards.
2. `Essential Knowledge`: 2-column bento cards showing entity synopsis, rating badge, and action CTAs (`LibraryActionTile.jsx` / `LibraryCard.jsx`).
3. `Media & Watchlist`: Aspect-ratio grid (16:9 and 9:16) with play overlay and duration pill.
4. `Reading & Insights`: 3-column clean editorial typographic grid.
Each section includes a header with title, count badge, and a `View all →` button invoking `onNavigateShelf(shelfKey)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/library_shelves.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/library/LibraryEditorialShelves.jsx frontend/tests/library_shelves.mjs
git commit -m "feat(library): create LibraryEditorialShelves component"
```

---

### Task 3: Consolidated Command Deck (`LibraryToolbar.jsx`) and Flush Ribbon (`LibraryFilterBar.jsx`)

**Files:**
- Modify: `frontend/src/views/library/LibraryToolbar.jsx`
- Modify: `frontend/src/views/library/LibraryFilterBar.jsx`

**Interfaces:**
- Consumes: Props for title, item counts, search query, quick capture, sort order, layout mode, and modal triggers.
- Produces: Unified single-tier header deck (`LibraryToolbar`) and slim secondary filter ribbon (`LibraryFilterBar`).

- [ ] **Step 1: Refactor `LibraryToolbar.jsx` into the single-tier studio command deck**

Integrate:
- Left: `Library` title and live syncing / total item count pill badge.
- Center: Streamlined search & quick capture omnibar with integrated sort dropdown and `Save ↵` pill.
- Right: Layout segmented switch (`grid` vs `list`), external capture button, playlist button (if audio present), and primary `＋ Add Resource` capsule button with `⌘K` keyboard badge.

- [ ] **Step 2: Streamline `LibraryFilterBar.jsx` into a flush hairline ribbon**

- Remove unnecessary vertical padding.
- Render clean underline/pill format tabs (*All*, *Articles*, *Videos*, *Notes*) on the left.
- Render *★ Essential*, *Sources* dropdown, and *Categories* dropdown flush on the right.

- [ ] **Step 3: Run build check to verify syntax and exports**

Run: `cd frontend && npm run build`  
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/library/LibraryToolbar.jsx frontend/src/views/library/LibraryFilterBar.jsx
git commit -m "refactor(library): consolidate header into single-tier command deck and flush filter ribbon"
```

---

### Task 4: Integrate Editorial Canvas and Filtered View Switching in `Library.jsx`

**Files:**
- Modify: `frontend/src/views/Library.jsx:500-750`

**Interfaces:**
- Consumes: `partitionLibraryShelves` from `./library/shelfUtils.js`, `LibraryEditorialShelves` from `./library/LibraryEditorialShelves.jsx`.
- Produces: Dynamically switched canvas between `LibraryEditorialShelves` (when `!hasFilter`) and `LibraryGrid` / `LibraryListView` (when `hasFilter === true`).

- [ ] **Step 1: Compute shelves in `Library.jsx` using `useMemo`**

Call `partitionLibraryShelves(items)` to produce `{ jumpBackIn, essential, media, reading }`.

- [ ] **Step 2: Wire up `onNavigateShelf` handler**

- `jumpBackIn` → resets filters and ensures `order='desc'`.
- `essential` → calls `setSelectedRating('5')`.
- `media` → calls `setSelectedKind('video')`.
- `reading` → calls `setSelectedKind('article')`.

- [ ] **Step 3: Replace redundant header and render `LibraryEditorialShelves` when `!hasFilter`**

- Remove the standalone `<header className="lib-header">` block (now unified inside `LibraryToolbar`).
- Conditional render:
  ```jsx
  {!hasFilter ? (
    <LibraryEditorialShelves
      shelves={shelves}
      busyId={busyId}
      onSelect={(item) => setActiveModalItem(item)}
      onNavigateShelf={handleNavigateShelf}
      onReindex={handleReindex}
      onEnrich={handleEnrich}
      onDelete={handleDelete}
      onTagClick={(tag) => setSelectedTag(tag)}
    />
  ) : layout === 'grid' ? (
    <LibraryGrid ... />
  ) : (
    <LibraryListView ... />
  )}
  ```

- [ ] **Step 4: Verify frontend build passes**

Run: `cd frontend && npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Library.jsx
git commit -m "feat(library): integrate editorial shelves and dynamic view switching"
```

---

### Task 5: Tactile CSS Polish, Responsive Layouts & Design Tokens (`library.css`)

**Files:**
- Modify: `frontend/src/views/library/library.css`

**Interfaces:**
- Consumes: Kraken CSS tokens (`--canvas`, `--surface`, `--accent`, `--border`, `--text`, `--text-dim`, `--ease-out`).
- Produces: Polished CSS classes for command deck, shelves, aspect-ratio containers, active press feedback, and responsive breakpoints.

- [ ] **Step 1: Add command deck and shelf grid styling**

- Style `.lib-command-deck`: clean 1-row flex layout with subtle border-bottom.
- Style `.lib-shelf`: 40px vertical separation, clean shelf headers, item count badge.
- Style `.lib-shelf-grid--media`: responsive aspect-ratio grid (16:9 and 9:16 support).
- Style `.lib-shelf-grid--reading`: 3-column editorial typography cards.

- [ ] **Step 2: Add Emil Kowalski tactile micro-interactions**

```css
.lib-card:active {
  transform: scale(0.99);
}
.lib-btn:active, .lib-shelf-action:active {
  transform: scale(0.97);
}
.lib-shelf-action {
  transition: transform 160ms var(--ease-out), color 160ms var(--ease-out);
}
```

- [ ] **Step 3: Test light and dark theme token variables**

Ensure `--border`, `--surface`, and `--text` resolve seamlessly in both dark and light modes.

- [ ] **Step 4: Verify build and lint**

Run: `cd frontend && npm run build && npm run lint`  
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/library/library.css
git commit -m "style(library): add tactile press states, shelf layout grids, and design token polish"
```

---

### Task 6: Comprehensive Verification & Theme Audit

**Files:**
- Review: `frontend/src/views/Library.jsx`
- Review: `frontend/src/views/library/LibraryEditorialShelves.jsx`
- Review: `frontend/src/views/library/LibraryToolbar.jsx`
- Review: `frontend/src/views/library/LibraryFilterBar.jsx`

- [ ] **Step 1: Run all frontend test suites**

Run: `cd frontend && npm run test:library && npm run test:shelves`  
Expected: ALL PASS.

- [ ] **Step 2: Run frontend production build**

Run: `cd frontend && npm run build`  
Expected: Zero build warnings or errors.

- [ ] **Step 3: Commit completed plan**

```bash
git add docs/superpowers/plans/2026-10-19-library-editorial-shelves.md
git commit -m "docs: finalize library editorial shelves implementation plan"
```
