# Mobile Library Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely revamp the mobile Library section layout and components to match the 32 design screens from `/home/wayne/Pictures/Amethyst Library Revamp.html`, decompose monolithic files into global reusable modules, eliminate duplicate components, and wire all actions to live backend APIs with live ADB device verification.

**Architecture:** Decompose `MobileLibrary.jsx` and `MobileLibraryItem.jsx` into modular global subviews and sheets under `apps/web/src/mobile/components/library/`. Centralize shared design tokens in `tokens.js` and UI primitives in `libraryUi.jsx`. Wire all data operations through `apps/web/src/api.js` (`api.library`, `api.libraryItem`, `api.updateLibraryItem`, `api.deleteLibraryItem`, `syncCollections`).

**Tech Stack:** React 19, Framer Motion, Capacitor 8 (Android), Vite 8, Tailwind/Liquid-Glass CSS.

**Spec:** [docs/superpowers/specs/2026-11-14-library-revamp-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-14-library-revamp-design.md)

## Global Constraints

- Canvas width: 390 px responsive; base canvas background `#F2F2F7`; ink `#151517`.
- Primary blue `#0B5FD9`; deep blue `#0A55C4`; danger red `#B3261E`.
- Card corner radius: 22 px; bottom sheet corner radius: 28 px.
- Glass effect: `background: rgba(255,255,255,.42–.55); backdrop-filter: blur(28px) saturate(200%)`.
- Touch targets: Minimum 44×44 px for interactive buttons and controls.
- Safe areas: Account for `env(safe-area-inset-bottom)` / `pb-safe` on sticky bars and FABs.
- Zero mock data: All reads and writes must execute against real FastAPI endpoints.
- No duplicate components: All reused controls are defined globally.

## Review Focus

1. **Content clipping behind sticky navigation dock**: List views and detail scroll containers must include sufficient bottom padding (`padding-bottom: 110px`) so bottom elements are fully visible and clickable.
2. **Safe-area insets on Android/iOS**: FAB and bottom action bars must float above system gestures/home indicators using `safe-area-inset-bottom`.
3. **Optimistic update sync races**: Immediate optimistic update in UI must reconcile cleanly with background sync without card duplication or phantom state.
4. **Touch responsiveness of horizontal carousels**: "Jump back in" and type filter chips must support smooth, non-blocking touch scrolling without preventing vertical page scrolls.
5. **Item deletion confirmation**: Delete action must always trigger `ConfirmDeleteModal` and cleanly navigate back if triggered from a detail view.

---

### Task 1: Shared UI Primitives & Design Tokens

**Files:**
- Modify: `apps/web/src/mobile/components/library/tokens.js`
- Modify: `apps/web/src/mobile/components/libraryUi.jsx`
- Modify: `apps/web/src/mobile/companion.css`

**Interfaces:**
- Produces: `INK`, `MUTED`, `BLUE`, `DEEP_BLUE`, `RED`, `KIND_META`, `GlassIconButton`, `Segmented`, `ChipRow`, `BottomSheet`, `StatusPill`.

- [ ] **Step 1: Verify presentation tests run cleanly**
Run: `node apps/web/tests/mobile-library-presentation.mjs`
Expected: PASS

- [ ] **Step 2: Update tokens in `tokens.js` and `companion.css`**
Add missing tokens from spec §1.1 (danger red `#B3261E`, success green `#34C759`, rating chip `#FBEBC8`), ensure glass styles and touch-target minimums (44px) are standardized in `libraryUi.jsx`.

- [ ] **Step 3: Run tests to verify token consistency**
Run: `node apps/web/tests/mobile-library-presentation.mjs`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/mobile/components/library/tokens.js apps/web/src/mobile/components/libraryUi.jsx apps/web/src/mobile/companion.css
git commit -m "feat(mobile-library): standardize design tokens and UI primitives"
```

---

### Task 2: Global Modals & Action Sheets

**Files:**
- Create: `apps/web/src/mobile/components/library/CreateItemSheet.jsx`
- Create: `apps/web/src/mobile/components/library/FilterSortSheet.jsx`
- Create: `apps/web/src/mobile/components/library/ItemActionSheet.jsx`
- Create: `apps/web/src/mobile/components/library/ConfirmDeleteModal.jsx`
- Create: `apps/web/src/mobile/components/library/TagManagerSheet.jsx`
- Create: `apps/web/src/mobile/components/library/MultiSelectBar.jsx`
- Create: `apps/web/src/mobile/components/library/SavingToast.jsx`

**Interfaces:**
- `CreateItemSheet`: `({ isOpen, onClose, onSaveUrl, onManualCreate })`
- `FilterSortSheet`: `({ isOpen, onClose, sort, onSortChange, activeFilter, onFilterChange, tags, selectedTags, onTagsChange })`
- `ItemActionSheet`: `({ isOpen, item, onClose, onShare, onAddToCollection, onEditTags, onOpenOriginal, onDelete })`
- `ConfirmDeleteModal`: `({ isOpen, title, count, onConfirm, onCancel })`
- `TagManagerSheet`: `({ isOpen, onClose, allTags, itemTags, onToggleTag, onAddTag })`
- `MultiSelectBar`: `({ count, onSelectAll, isAllSelected, onDelete, onAddToCollection, onTag, onCancel })`
- `SavingToast`: `({ status, message, onRetry })`

- [ ] **Step 1: Implement `ConfirmDeleteModal.jsx` and `SavingToast.jsx`**
Build the centered iOS-style alert dialog and floating status capsule per spec §7.2 and §5.3.

- [ ] **Step 2: Implement `ItemActionSheet.jsx` and `TagManagerSheet.jsx`**
Build the item action bottom sheet (Share, Add to collection, Edit tags, Open URL, Delete) and tag manager sheet with live tag search and add/delete actions per spec §7.1 and §6.2.

- [ ] **Step 3: Implement `CreateItemSheet.jsx`, `FilterSortSheet.jsx`, and `MultiSelectBar.jsx`**
Build the URL capture sheet with 8 manual type tiles, filter & sort bottom sheet, and multi-select bottom bar per spec §5.1, §6.1, and §2.3.

- [ ] **Step 4: Verify syntax and exports**
Run: `node -e "import('./apps/web/src/mobile/components/library/CreateItemSheet.jsx'); import('./apps/web/src/mobile/components/library/ConfirmDeleteModal.jsx');"`
Expected: Clean exit without syntax errors.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/mobile/components/library/
git commit -m "feat(mobile-library): create global action sheets and modals"
```

---

### Task 3: Main Navigation & Subviews Decomposition

**Files:**
- Create: `apps/web/src/mobile/components/library/LibraryListView.jsx`
- Create: `apps/web/src/mobile/components/library/LibraryGridView.jsx`
- Create: `apps/web/src/mobile/components/library/LibraryCollectionsView.jsx`
- Create: `apps/web/src/mobile/components/library/CollectionDetailView.jsx`
- Create: `apps/web/src/mobile/components/library/LibrarySearchScreen.jsx`
- Create: `apps/web/src/mobile/components/library/LibrarySettingsScreen.jsx`

**Interfaces:**
- `LibraryListView`: `({ items, jumpItems, activeFilter, onFilterChange, onOpenItem, onItemAction, onOpenCreate, isMultiSelect, selectedIds, onToggleSelect })`
- `LibraryGridView`: `({ items, onOpenItem, onItemAction, isMultiSelect, selectedIds, onToggleSelect })`
- `LibraryCollectionsView`: `({ collections, items, onOpenCollection, onCreateCollection })`
- `CollectionDetailView`: `({ collection, items, onBack, onOpenItem, onRemoveItem })`
- `LibrarySearchScreen`: `({ items, query, onQueryChange, onBack, onOpenItem })`
- `LibrarySettingsScreen`: `({ onBack, syncStatus, onTriggerSync })`

- [ ] **Step 1: Implement `LibraryListView.jsx` and `LibraryGridView.jsx`**
Extract list timeline grouping (Today, Yesterday, This Week, Earlier), Jump-Back-In carousel, stats pill, filter chips, and 2-column grid view from `MobileLibrary.jsx`. Ensure WCAG 44px touch targets and padding-bottom for the navigation dock.

- [ ] **Step 2: Implement `LibraryCollectionsView.jsx` and `CollectionDetailView.jsx`**
Build 2x2 collage thumbnail preview cards for custom collections and smart collection pills (Favorites, Wishlist, Not opened). Wire single collection view with item removal via `api.removeLibraryListMember`.

- [ ] **Step 3: Implement `LibrarySearchScreen.jsx` and `LibrarySettingsScreen.jsx`**
Implement full search with suggestions, recent searches, creator chips, and live results. Implement settings screen with cloud sync trigger (`api.librarySyncStart`) and storage metrics.

- [ ] **Step 4: Verify subview imports**
Run: `node -e "import('./apps/web/src/mobile/components/library/LibraryListView.jsx'); import('./apps/web/src/mobile/components/library/LibraryCollectionsView.jsx');"`
Expected: Clean exit without syntax errors.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/mobile/components/library/
git commit -m "feat(mobile-library): implement modular library subviews"
```

---

### Task 4: Per-Kind Detail Screens Completion & Wiring

**Files:**
- Create: `apps/web/src/mobile/components/library/VideoDetailScreen.jsx`
- Create: `apps/web/src/mobile/components/library/PostArticleScreen.jsx`
- Create: `apps/web/src/mobile/components/library/CookingModeScreen.jsx`
- Modify: `apps/web/src/mobile/components/library/MovieScreen.jsx`
- Modify: `apps/web/src/mobile/components/library/RecipeScreen.jsx`
- Modify: `apps/web/src/mobile/components/library/GameScreen.jsx`
- Modify: `apps/web/src/mobile/components/library/BookScreen.jsx`
- Modify: `apps/web/src/mobile/components/library/PlaceScreen.jsx`
- Modify: `apps/web/src/mobile/views/LibraryTypeDetails.jsx`

**Interfaces:**
- Detail screens accept: `({ item, onUpdate, showToast, onOpenCookingMode, onOpenMap })`
- `onUpdate(id, patch)` calls live `api.updateLibraryItem(id, patch)` for status, notes, checklists, and ratings.

- [ ] **Step 1: Implement `VideoDetailScreen.jsx`**
Build Video overview (embed, title, AI summary, key takeaways), outbound links tab, and user notes tab per spec §8.1–§8.3.

- [ ] **Step 2: Implement `PostArticleScreen.jsx`**
Build Article/Post view with header metadata, author pill, key points callout, and Markdown reader per spec §8.4.

- [ ] **Step 3: Implement `CookingModeScreen.jsx`**
Build fullscreen cooking assistant with step countdown timer, step navigation, and ingredient drawer per spec §8.7.

- [ ] **Step 4: Refine status toggles and wiring in `MovieScreen`, `RecipeScreen`, `GameScreen`, `BookScreen`, `PlaceScreen`**
Wire watch status, cooking status, play status, reading progress slider, and visit status directly to `api.updateLibraryItem`.

- [ ] **Step 5: Update `LibraryTypeDetails.jsx` router**
Register all screens in `LibraryTypeDetails.jsx` and export `KIND_SCREEN_NAMES`.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/mobile/components/library/ apps/web/src/mobile/views/LibraryTypeDetails.jsx
git commit -m "feat(mobile-library): complete per-kind detail screens with live status updates"
```

---

### Task 5: Refactor Root Controllers (`MobileLibrary.jsx` & `MobileLibraryItem.jsx`)

**Files:**
- Modify: `apps/web/src/mobile/views/MobileLibrary.jsx`
- Modify: `apps/web/src/mobile/views/MobileLibraryItem.jsx`

**Interfaces:**
- `MobileLibrary`: Connects to `api.library`, `syncCollections`, manage view state (list/grid/collections/search/settings), multi-select, and sheets.
- `MobileLibraryItem`: Owns pinned top bar, bottom action dock, and delegates content to `LibraryTypeDetails` or kind screens.

- [ ] **Step 1: Refactor `MobileLibrary.jsx`**
Replace monolithic inline rendering with routing to `LibraryListView`, `LibraryGridView`, `LibraryCollectionsView`, `LibrarySearchScreen`, and `LibrarySettingsScreen`. Wire FAB, `CreateItemSheet`, `FilterSortSheet`, `ItemActionSheet`, `ConfirmDeleteModal`, and `MultiSelectBar`.

- [ ] **Step 2: Refactor `MobileLibraryItem.jsx`**
Streamline top bar (back, share, kebab), bottom action dock, and delegate kind-specific layouts to `LibraryTypeDetails`. Wire kebab to `ItemActionSheet` and deletion to `ConfirmDeleteModal`.

- [ ] **Step 3: Run mobile presentation and merge tests**
Run: `node apps/web/tests/mobile-library-merge.test.mjs && node apps/web/tests/mobile-library-presentation.mjs`
Expected: PASS (all tests green).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/mobile/views/MobileLibrary.jsx apps/web/src/mobile/views/MobileLibraryItem.jsx
git commit -m "refactor(mobile-library): streamline root controllers and eliminate duplicates"
```

---

### Task 6: Build & Test Suite Verification

**Files:**
- Test: `apps/web/tests/`
- Build: `apps/web/dist/`

- [ ] **Step 1: Run complete test suite**
Run: `cd apps/web && npm test` (or `node --test tests/mobile-*.mjs`)
Expected: PASS

- [ ] **Step 2: Run production Vite build**
Run: `cd apps/web && npm run build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Commit**
```bash
git add -u
git commit -m "chore(mobile-library): verify build and test passes"
```

---

### Task 7: ADB Android Deployment & Live Device Verification

**Files:**
- Sync: `apps/web/android/app/src/main/assets/public/`
- APK: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 1: Sync Capacitor Android assets**
Run: `cd apps/web && npx cap sync android`
Expected: `Sync finished` successfully.

- [ ] **Step 2: Build Android debug APK**
Run: `JAVA_HOME=/home/wayne/.local/share/amethyst-build/jdk ANDROID_HOME=/home/wayne/.local/share/amethyst-build/android-sdk PATH=$JAVA_HOME/bin:$PATH /home/wayne/Documents/GitHub/amethyst/apps/web/android/gradlew -p /home/wayne/Documents/GitHub/amethyst/apps/web/android assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Install APK to connected phone via ADB**
Run: `adb install -r apps/web/android/app/build/outputs/apk/debug/app-debug.apk`
Expected: `Success`.

- [ ] **Step 4: Launch companion app on phone**
Run: `adb shell monkey -p app.amethyst.companion -c android.intent.category.LAUNCHER 1`
Expected: App launches.

- [ ] **Step 5: Navigate to Library tab and verify interactions**
Tap Library tab (`adb shell input tap 518 2206`). Test list scrolling, filter chips, search screen, and open an item detail view.

- [ ] **Step 6: Capture screenshot of verified screen**
Run: `adb shell screencap -p /sdcard/library_verified.png && adb pull /sdcard/library_verified.png /tmp/library_verified.png`
Verify layout and styling against design mockups.

