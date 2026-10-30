# Specification: Amethyst Library SaveToList Features (Tier 1: Item Core)

**Date:** 2026-10-31  
**Status:** In Review  
**Scope:** Progress Tracking, Reminders, Pin to Top, Private Notes  
**Reference:** SaveToList App Feature Parity & Wayn Design System

---

## 1. Intent & Scope

Integrate core SaveToList knowledge-management features into the Amethyst Library view:
1. **Track progress:** Kind-aware progress state (`Want to read/watch/visit` | `In progress/Reading/Watching` | `Completed/Read/Watched/Visited`) with segmented toggles on cards, rows, and detail modal.
2. **Set reminders:** Scheduled revisit alerts with quick relative presets (`Tomorrow • 10:00`, `This weekend`, `Next week`, custom), card callout banner, and automated notification via `backend/reminders.py`.
3. **Pin to top:** Priority pushpin toggle locking favorite/active items to the top shelf of the library grid and list views.
4. **Private notes:** Local-only private notes with authentic lock visual indicator, distinct from public AI summaries.

### Design Standards & Constraints
- **Wayn Design System:** Strictly 12px squircles (`rounded-xl` / 12px) for interactive buttons and containers; squircle dashes (`rounded-[2px]`) for status indicators; zero circular dots or pill shapes (`rounded-full` prohibited).
- **30 Laws of UX:** 44px minimum interactive touch targets (Fitts's Law), instant optimistic feedback (Doherty Threshold), 3-choice segmented control (Hick's Law), visual reminder common region (Law of Common Region).
- **Theme Tokens Only:** `#F7F7F5` / `#EDEDEA` light canvas, `#0E131F` / `#18202F` obsidian dark, `#873FFF` / `#7C3AED` brand purple, subtle hairline borders (`border-black/[0.06]`).

---

## 2. Database & Backend Architecture

### 2.1 Database Schema (`backend/db/schema.sql` & `LibraryStore._ensure_columns`)
Add new columns to `library_items` table with automatic SQLite fallback migration:
```sql
ALTER TABLE library_items ADD COLUMN progress TEXT DEFAULT 'unstarted';
ALTER TABLE library_items ADD COLUMN is_pinned INTEGER DEFAULT 0;
ALTER TABLE library_items ADD COLUMN remind_at TEXT;
ALTER TABLE library_items ADD COLUMN remind_action TEXT DEFAULT 'revisit';
ALTER TABLE library_items ADD COLUMN reminded_at TEXT;
ALTER TABLE library_items ADD COLUMN private_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_library_pinned ON library_items(is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_library_progress ON library_items(progress);
CREATE INDEX IF NOT EXISTS idx_library_remind ON library_items(remind_at) WHERE remind_at IS NOT NULL;
```

### 2.2 Store & Model Layer (`backend/library/store.py` & `backend/api/main.py`)
- Update `_UPDATABLE` frozenset in `backend/library/store.py` to allow patching:
  `"progress"`, `"is_pinned"`, `"remind_at"`, `"remind_action"`, `"reminded_at"`, `"private_notes"`.
- Update `LibraryPatch` schema in `backend/api/main.py`:
  ```python
  class LibraryPatch(BaseModel):
      title: str | None = None
      kind: str | None = None
      category: str | None = None
      author: str | None = None
      notes: str | None = None
      consumed_on: str | None = None
      rating: int | None = None
      summary: str | None = None
      tags: list[str] | None = None
      resources: list[dict] | None = None
      progress: str | None = None
      is_pinned: int | bool | None = None
      remind_at: str | None = None
      remind_action: str | None = None
      reminded_at: str | None = None
      private_notes: str | None = None
  ```
- Update `LibraryStore.search()` and `list()` to prioritize pinned items:
  `ORDER BY is_pinned DESC, consumed_on DESC, id DESC`.

### 2.3 Notification Runner (`backend/reminders.py`)
Enhance `fire_due()` to query unreminded library saves:
```python
lib_rows = (
    get_connection()
    .execute(
        "SELECT id, title, kind, remind_action, remind_at FROM library_items "
        "WHERE remind_at IS NOT NULL AND reminded_at IS NULL "
        "AND julianday(remind_at) <= julianday(?)",
        (moment.isoformat(sep=" ", timespec="seconds"),),
    )
    .fetchall()
)
for lib_item in lib_rows:
    action = lib_item["remind_action"] or "revisit"
    get_connection().execute(
        "UPDATE library_items SET reminded_at = ? WHERE id = ?",
        (moment.isoformat(sep=" ", timespec="seconds"), lib_item["id"]),
    )
    get_connection().commit()
    await notify(
        f"Reminder: {lib_item['title']}",
        f"Time to {action} this {lib_item['kind'] or 'save'}",
        source_key=f"library:{lib_item['id']}:{lib_item['remind_at']}",
    )
    sent += 1
```

---

## 3. Frontend Component Design

### 3.1 Kind-Aware Progress Control (`ProgressSegmentedControl.jsx`)
A reusable squircle segmented control matching SaveToList's Piranesi design:
- **Labels by Item Kind:**
  - `book`, `article`, `paper`, `newsletter`: `Want to read` | `Reading` | `Read`
  - `video`, `podcast`, `music`: `Want to watch` | `Watching` | `Watched` (or `Want to listen` | `Listening` | `Listened`)
  - `place`: `Want to visit` | `Visited`
  - Default: `To do` | `Doing` | `Done`
- **Visual Presentation:**
  - Squircle container: `bg-neutral-100 dark:bg-neutral-800/60 rounded-xl p-1 gap-1 flex items-center min-h-[44px]`.
  - Inactive options: `px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 rounded-lg min-h-[40px] flex items-center justify-center`.
  - Active option: `bg-[#3B82F6] text-white shadow-xs rounded-lg font-semibold min-h-[40px] flex items-center justify-center px-3 py-2 transition-all`.
  - Completed Badge (`✓ Read` / `✓ Watched`): Compact `rounded-lg` badge in soft blue tint (`bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-3 py-1.5 min-h-[36px] flex items-center gap-1.5 text-xs font-semibold`).

### 3.2 Reminder Banner & Quick Scheduler (`LibraryReminderBanner.jsx`)
Matching SaveToList's Berenjak design:
- Full-width callout container: `bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-xl px-3.5 py-2.5 flex items-center justify-between min-h-[44px] gap-2`.
- Left: Bell icon (`<Icon name="bell" size={15} />`) with text: `Remind me to {action}`.
- Right: Interactive target pill: `{formatted_time} ✓` (e.g. `Tomorrow • 10:00 ✓`).
- Clicking opens a popover with smart presets:
  - `Tomorrow Morning (09:00)`
  - `Tomorrow Evening (18:00)`
  - `This Weekend (Saturday 10:00)`
  - `Next Week (Monday 09:00)`
  - `Custom Date & Time`
  - `Clear Reminder` (destructive button)

### 3.3 Pin to Top (`is_pinned`)
- Discrete pushpin button on Card top-right, List row, and Detail rail.
- Pinned items sort to the very top of grid and list layouts.
- Subtle pinned badge indicator: `pinned` squircle micro-badge with Phosphor pushpin icon.

### 3.4 Private Notes (`private_notes`)
- Detail modal Notes section enhanced with privacy lock header:
  `Lock` icon + "Private notes" + "Only you can see them. Stored locally."
- Separate from public AI summary and external share/export.
- Autosaves on change with checkmark indicator.

---

## 4. 30 Laws of UX Compliance Matrix

| Law | Implementation in Tier 1 |
|---|---|
| **Fitts's Law** | All buttons, segmented choices, and reminder triggers enforce `min-height: 44px` / `min-width: 44px`. |
| **Hick's Law** | Progress segmented control limited to 3 progressive states; reminder scheduler provides 4 instant presets. |
| **Jakob's Law** | Standard SaveToList / iOS segmented bar and callout banner layouts. |
| **Doherty Threshold** | Instant optimistic state application for pin, progress toggle, and reminder setting (<50ms UI update). |
| **Law of Common Region** | Reminder banner and segmented control encapsulated inside distinct squircle enclosures. |
| **Zeigarnik Effect** | Highlight in-progress reads/watches to motivate completion. |
| **Peak-End Rule** | Smooth badge transformation and checkmark when moving item to `Read` / `Watched`. |

---

## 5. Verification Plan

1. **Automated Backend Tests:**
   - Run `pytest tests/test_library.py` to verify store operations, migrations, and patch routes.
   - Test reminder delivery in `tests/test_connectors_and_reminders.py`.
2. **Automated Frontend Tests:**
   - Run existing frontend library tests: `node frontend/tests/library_card.mjs` and `node frontend/tests/library_detail_modal.mjs`.
3. **Manual Verification:**
   - Verify card layout in Bento grid and List view.
   - Verify 44px touch targets on mobile / responsive viewports.
   - Verify reminder notification fires on due timestamp.
