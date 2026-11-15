# Mobile Library Revamp — Architectural Design Spec

**Date**: 2026-11-14  
**Status**: Approved (Approach A: Modular Global Decomposition)  
**Author**: Antigravity  
**Target Platform**: Android Capacitor Companion (`app.amethyst.companion`) + Mobile Web  
**Design Reference**: Verbatim HTML mockups from `/home/wayne/Pictures/Amethyst Library Revamp.html` (32 screens)  

---

## 1. Intent, Constraints & Success Criteria

### 1.1 Intent
Completely revamp the layout and components of the Amethyst mobile Library section according to the 32 design screens in `/home/wayne/Pictures/Amethyst Library Revamp.html`. Decompose monolithic views into modular, reusable global components, eliminate duplicate code, adjust spacing for mobile-native ergonomics, and wire all UI interactions directly to live backend endpoints.

### 1.2 Constraints
1. **Zero Mock Data**: All items, collections, tags, notes, checklists, and status toggles must read and write to live backend APIs (`/api/library*`).
2. **Apple iOS 18 Liquid-Glass Design**: Base canvas `#F2F2F7`, ink `#151517`, action blue `#0B5FD9`, deep blue `#0A55C4`, red `#B3261E`, card radius 22, sheet radius 28, glass blur `28px` with saturation `200%`.
3. **Mobile-Native Ergonomics**:
   - Touch targets must meet or exceed WCAG 44×44 px minimums (`better-accessibility` / `better-layout`).
   - Bottom bars and floating action buttons must account for device safe areas (`env(safe-area-inset-bottom)` / `pb-safe`).
   - Content lists must include bottom padding so elements never clip under floating chrome or the navigation dock.
   - Text containers use flexible bounds (`min-height`, line-clamp with ellipsis) to prevent overflow clipping.
4. **No Component Duplication**: Shared controls (buttons, chips, segmented selectors, action menus, modals) are defined once in global components and reused across all views.
5. **Live Device Verification**: Verification must execute against the connected physical Android phone (`10BD6N042K000F3`) via ADB.

### 1.3 Success Criteria
- [x] All 32 screens/sheets/cards are implemented in React with high-fidelity visual alignment to the design HTML.
- [x] Monolithic files (`MobileLibrary.jsx`, `MobileLibraryItem.jsx`) decomposed into clean modules under `apps/web/src/mobile/components/library/`.
- [x] Live backend CRUD:
  - Create item via URL or manual type.
  - Delete item with confirmation alert.
  - Edit item tags and checklist items.
  - Add to / remove from collections.
  - Update status (movie watch status, recipe cooking status, game status, book progress, place visit status).
  - Search items with live text filter, kind filter, and tag filter.
  - Multi-select actions (batch delete, batch collection add, batch tag).
- [x] `npm run build` succeeds cleanly.
- [x] Capacitor assets synced and APK built/installed via ADB on connected phone.
- [x] Screen dump / screenshot confirms live functionality and visual polish.

---

## 2. Global Component Architecture (Approach A)

### 2.1 File & Directory Structure

```
apps/web/src/mobile/
├── companion.css                                # Core liquid-glass & iOS utility styles
├── components/
│   ├── libraryUi.jsx                            # Shared UI primitives: GlassIconButton, Segmented,
│   │                                            # ChipRow, BottomSheet, AddToCollectionSheet
│   └── library/
│       ├── tokens.js                            # Design tokens: colors, glass styles, kind metadata
│       │
│       │── # Subviews for MobileLibrary:
│       ├── LibraryListView.jsx                  # Main list view (timeline cards, jump-back-in, stats)
│       ├── LibraryGridView.jsx                  # 2-column image/card visual grid
│       ├── LibraryCollectionsView.jsx           # Collections grid (2x2 preview cards + smart groups)
│       ├── CollectionDetailView.jsx             # Single collection view with item list and management
│       ├── LibrarySearchScreen.jsx              # Full search screen with suggestions, recent, filters
│       │
│       │── # Global Sheets & Modals:
│       ├── CreateItemSheet.jsx                  # Bottom sheet for URL capture + 8 manual type tiles
│       ├── FilterSortSheet.jsx                  # Bottom sheet for sorting & multi-facet filtering
│       ├── ItemActionSheet.jsx                  # Kebab/long-press menu for item actions
│       ├── ConfirmDeleteModal.jsx               # iOS-style centered alert modal
│       ├── TagManagerSheet.jsx                  # Tag management sheet with search & pill removal
│       ├── MultiSelectBar.jsx                   # Sticky bottom action bar during selection
│       ├── SavingToast.jsx                      # Floating capsule status toast (saving, done, failed)
│       │
│       │── # Per-Kind Detail Screens:
│       ├── VideoDetailScreen.jsx                # Video overview, outbound links, and notes tabs
│       ├── PostArticleScreen.jsx                # Article/post reader with markdown & metadata
│       ├── MovieScreen.jsx                      # Movie poster, synopsis, ratings, and watch status
│       ├── RecipeScreen.jsx                     # Recipe ingredients checklist, instructions, times
│       ├── CookingModeScreen.jsx                # Fullscreen cooking assistant step-by-step runner
│       ├── GameScreen.jsx                       # Game cover, platforms, developer, play status
│       ├── BookScreen.jsx                       # Book cover, progress slider, reading status
│       ├── PlaceScreen.jsx                      # Place category, address, hours, status
│       ├── PlacesMapScreen.jsx                  # Map preview & fullscreen map view with pins
│       ├── PodcastScreen.jsx                    # Podcast player, audio timeline, show notes
│       ├── ProductScreen.jsx                    # Product pricing, store link, specs
│       ├── NoteChecklistScreen.jsx              # Editable note & checklist item manager
│       └── LibrarySettingsScreen.jsx            # Library sync, enrichment, and storage preferences
│
└── views/
    ├── MobileLibrary.jsx                        # Root Library controller: tab router & state coordinator
    ├── MobileLibraryItem.jsx                    # Root Detail controller: pinned headers, tabs & kind host
    ├── LibraryTypeDetails.jsx                   # Router mapping item.kind -> DetailScreen component
    └── libraryPresentation.js                   # Presentation logic & kind normalization
```

---

## 3. Screen Inventory & Feature Specifications (32 Screens)

### 3.1 Main Views (Screens 1, 2, 4, 7, 8, 9)
1. **Library List (Full Scroll)** (`LibraryListView.jsx`):
   - Top Header: "Library" H1 (40px/800), sync status pill ("Synced Just now"), summary counter ("Saved 373", "Collections 2").
   - Filter chips horizontal scroller: All, Videos, Articles, Posts, Movies, Recipes, Games, Notes, Books, Places.
   - "Jump Back In" horizontal carousel: active cooking recipes, in-progress videos, unread bookmarks with kind badges.
   - Timeline grouped sections: Today, Yesterday, This Week, Earlier months. Each card has 84×84 thumbnail, kind badge, duration, title, metadata line, source pill.
   - Floating Action Button (FAB): Blue circular "+" button (56×56 px) pinned bottom-right above safe area.
2. **Library Grid View** (`LibraryGridView.jsx`):
   - 2-column masonry grid.
   - Aspect ratio 1:1 or 4:3 cards with kind badge top-left, title caption single-line clamp, duration badge bottom-right.
   - Quick kebab menu on each tile.
3. **Empty Library State** (`empty_library.html`):
   - Centered crystal illustration, friendly copy, "Save your first link" primary action button.
4. **Collections Tab** (`LibraryCollectionsView.jsx`):
   - 2×2 thumbnail collage preview cards for custom collections.
   - Smart Collections row: Favorites (heart), Wishlist (bookmark), Not Opened (inbox).
   - "+ New Collection" action.
5. **Empty Collections State** (`empty_collections.html`):
   - Explanatory copy, "+ Create Collection" dashed button.
6. **Collection Detail View** (`CollectionDetailView.jsx`):
   - Header with collection title, item count, rename/delete actions.
   - Grid or list of items belonging to the collection, with remove-item capability.

### 3.2 Search Experience (Screens 5, 6)
7. **Search Screen** (`LibrarySearchScreen.jsx`):
   - Search input with clear button and cancel action.
   - Suggestions pill row, Recent searches list with clear-all.
   - Browse creators / channels section.
   - Instant live results with highlighted query markups and filter chips.
8. **No Search Results** (`no_search_results.html`):
   - Empty magnifying glass icon, helpful search suggestions and broad filter resets.

### 3.3 Create, Capture & Save (Screens 10, 11, 12)
9. **Create Sheet** (`CreateItemSheet.jsx`):
   - Grabber, "Save to Library" title, close button.
   - URL input field with "Paste" button auto-reading system clipboard.
   - 8 Type Tiles: Video, Article, Post, Movie, Recipe, Game, Book, Place / Note.
   - Manual creation triggers appropriate form or blank note editor.
10. **Share Sheet Save** (`share_sheet_save.html`):
    - System share target receiver preview showing parsed URL, extracted metadata, thumbnail, and collection selector.
11. **Saving & Failed States** (`SavingToast.jsx`):
    - Floating pill capsule: "Saving..." with activity spinner -> "Saved to Library" checkmark.
    - Failed state: Red error tint, error message, "Retry" button.

### 3.4 Filter, Sort & Tags (Screens 13, 14)
12. **Filter & Sort Sheet** (`FilterSortSheet.jsx`):
    - Segmented Sort Order: Date Saved, Date Created, Title (A-Z).
    - Status filter: All, Unread, In Progress, Done, Favorites.
    - Type multi-chips filter.
    - Tags filter with search input.
13. **Tag Manager** (`TagManagerSheet.jsx`):
    - Search tags field.
    - Tag list showing tag name, item count, delete tag button.
    - "+ Add Tag" input with instant save.

### 3.5 Item Actions & Multi-Select (Screens 3, 15, 16, 17)
14. **Multi-Select Mode** (`MultiSelectBar.jsx`):
    - Checkboxes appear on list and grid cards.
    - Top bar displays "X selected", "Select All", "Cancel".
    - Sticky bottom bar: "Add to Collection", "Tag", "Delete (X)".
15. **Item Action Menu** (`ItemActionSheet.jsx`):
    - Triggered via kebab button or long press.
    - Actions: Share, Add to Collection, Edit Tags, Open Original URL, Mark as Done, Delete Item (red).
16. **Confirm Delete Alert** (`ConfirmDeleteModal.jsx`):
    - Centered iOS alert: "Delete item?", "This action cannot be undone.", "Cancel", "Delete" (destructive red).
17. **Add to Collection Sheet** (`AddToCollectionSheet` in `libraryUi.jsx`):
    - Search collection input.
    - List of collections with checkboxes indicating membership. Immediate toggle via API.

### 3.6 Per-Kind Detail Screens (Screens 18–31)
18. **Video Detail** (`VideoDetailScreen.jsx`):
    - Overview: Embedded player (YouTube/Instagram iframe), video title, author, AI summary, key takeaways bullet list.
    - Links: Outbound referenced links extracted from description/subtitles.
    - Notes: User notes with timestamp bookmarks.
19. **Post & Article** (`PostArticleScreen.jsx`):
    - Hero banner, author badge, reading time, published date.
    - Executive summary box with key points.
    - Markdown reader view (`.m-shell`) with optimized typography.
20. **Movie Detail** (`MovieScreen.jsx`):
    - Hero movie poster, release year, IMDb/Rotten Tomatoes score chips.
    - Watch status segmented button: "Want to Watch" vs "Watched".
    - Director, cast, synopsis, streaming platforms list.
21. **Recipe Detail & Cooking Mode** (`RecipeScreen.jsx`, `CookingModeScreen.jsx`):
    - Recipe image, prep time, cook time, servings counter.
    - Interactive Ingredients checklist with checkmarks.
    - Step-by-step instructions.
    - "Start Cooking Mode" button launching fullscreen step runner with timer countdown.
22. **Game Detail** (`GameScreen.jsx`):
    - Game banner, platform pills, status toggle: Backlog, Playing, Completed.
    - Developer, publisher, release date, synopsis.
23. **Book Detail** (`BookScreen.jsx`):
    - Book cover, author, page count, reading status toggle: Want to Read, Reading, Finished.
    - Progress slider (% read / page number).
24. **Place Detail & Map** (`PlaceScreen.jsx`, `PlacesMapScreen.jsx`):
    - Photo, address, category, phone, hours, visit status toggle: Want to Go, Visited.
    - Mini map card tapping into interactive fullscreen Leaflet map with pinned items.
25. **Podcast Detail** (`PodcastScreen.jsx`):
    - Cover art, episode title, podcast name, duration.
    - Audio player controls, show notes, mentioned links.
26. **Product Detail** (`ProductScreen.jsx`):
    - Product photo, store, price badge, buy button.
    - Specifications list, price tracking toggle.
27. **Note & Checklist** (`NoteChecklistScreen.jsx`):
    - Note title, markdown body editor, reminder time picker.
    - Checklist items with inline add, toggle complete, and drag/delete.

### 3.7 Settings (Screen 32)
28. **Library Settings** (`LibrarySettingsScreen.jsx`):
    - Auto-enrichment model selector and toggle.
    - Cloud storage provider (Local SQLite / Google Drive) sync status and manual sync trigger.
    - Purge legacy media button.

---

## 4. Backend API Wiring & Data Contracts

All components interact through standard client methods in `frontend/src/api.js`:

| Action | API Call | Method & Endpoint | Payload / Params |
|---|---|---|---|
| Load Library | `api.library({ limit, offset, kind, query })` | `GET /api/library` | `{ limit: 500 }` |
| Load Single Item | `api.libraryItem(id)` | `GET /api/library/{id}` | - |
| Save Link/URL | `api.addLibraryItem({ url, title, kind })` | `POST /api/library` | `{ url: "..." }` |
| Update Item | `api.updateLibraryItem(id, patch)` | `PATCH /api/library/{id}` | `{ status, checklist, remind_at, notes, tags }` |
| Delete Item | `api.deleteLibraryItem(id)` | `DELETE /api/library/{id}` | - |
| Re-Enrich | `api.enrichLibraryItem(id)` | `POST /api/library/{id}/enrich` | - |
| Re-Index | `api.reindexLibraryItem(id)` | `POST /api/library/{id}/reindex` | - |
| Sync Status | `api.librarySyncStatus()` | `GET /api/library/sync/status` | - |
| Trigger Sync | `api.librarySyncStart()` | `POST /api/library/sync/start` | - |
| Add Collection Member | `api.addLibraryListMember(listId, itemId)` | `POST /api/library/lists/{id}/members` | `{ item_id: itemId }` |
| Remove Collection Member | `api.removeLibraryListMember(listId, itemId)` | `DELETE /api/library/lists/{id}/members` | `{ item_id: itemId }` |

---

## 5. Verification Plan

1. **Automated Unit & Presentation Tests**:
   - `node apps/web/tests/mobile-library-merge.test.mjs` (passes)
   - `node apps/web/tests/mobile-library-presentation.mjs` (passes)
2. **Web Build Verification**:
   - `cd apps/web && npm run build` (must complete with zero errors).
3. **Capacitor Sync**:
   - `npx cap sync android` (copies `dist/` to `android/app/src/main/assets/public`).
4. **Android Build & ADB Deployment**:
   - `JAVA_HOME=... ANDROID_HOME=... ./gradlew assembleDebug`
   - `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
   - `adb shell monkey -p app.amethyst.companion -c android.intent.category.LAUNCHER 1`
5. **Live Device Functional & Visual Checks**:
   - Navigate to Library tab (`adb shell input tap ...`).
   - Check list view scrolling, jump-back-in carousel, filter chips.
   - Open detail modal for video, movie, recipe, book, and note items.
   - Test search, collections tab, create sheet, and kebab actions.
   - Capture device screenshots via `adb shell screencap` and inspect layout geometry.

