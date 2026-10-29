# Settings General Section & Sidebar Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp Amethyst Settings by restructuring the sidebar into a 3-group taxonomy with top live search, implementing 7 modular General setting cards according to the 30 Laws of UX and Wayn Design System, and establishing 100% functional backend persistence and endpoints for editor launching, OS sleep prevention, chat archiving, and database compression.

**Architecture:** Extend SQLite `app_settings` and `SYNCED_PREFERENCES` for robust state syncing across devices. Implement dedicated backend endpoints for editor spawning, sleep inhibition, and database compaction. Rebuild the frontend Settings sidebar with real-time fuzzy filtering and the General panel with 12px squircle geometry.

**Tech Stack:** Python 3.12, FastAPI, SQLite, React (JSX), Tailwind CSS, Framer Motion, Pytest.

**Spec:** `docs/superpowers/specs/2026-10-30-settings-general-and-sidebar-design.md`

## Global Constraints

- Button geometry: Unified 12px squircle (`rounded-xl` / 0.75rem). Prohibited: `rounded-full` pills or circular buttons for CTAs or close icons.
- Indicators & Badges: Squircle dashes (`rounded-[2px]`), zero circular dot indicators.
- Colors: Dark obsidian `#0E131F` / `#18202F`, Light canvas `#F7F7F5` / `#EDEDEA`, Brand purple accent `#873FFF` / `#7C3AED`, Hairline border `border-black/[0.06]`.
- Card containers: `rounded-2xl` with 16px row gaps and 12px inner padding.
- Backend writes: Must use atomic transactions or `app_settings` upserts.

## Review Focus

- Invalid editor binary or path does not crash `/api/desktop/open-in-editor` and returns informative HTTP 400 or 404.
- Inactive chat archive with `days=0` safely no-ops without archiving all conversations.
- Database compression endpoint (`/api/db/compress`) gracefully runs on locked databases and returns freed byte counts.
- OS sleep inhibitor handles environments without `systemd-inhibit` or DBus smoothly without raising uncaught exceptions.
- Sidebar search query matching is case-insensitive, ignores leading/trailing whitespace, and gracefully shows empty states.

---

### Task 1: Synced Preferences & Backend Config Knobs

**Files:**
- Modify: `backend/sync/registry.py:64-80`
- Modify: `backend/config.py:510-600`
- Test: `tests/test_general_settings.py`

**Interfaces:**
- Produces: `SYNCED_PREFERENCES` containing `editorDestination`, `confirmClose`, `fullViewDefault`, `restoreTabs`, `preventSleep`, `autoArchiveDays`, `compressHistory`, `speedProfile`, `followUpBehavior`, `plainTextComposer`, `showContextUsage`, `confettiEnabled`, `defaultStandaloneChat`.
- Produces: `load_general_settings() -> dict[str, Any]` and `save_general_setting(key: str, value: Any) -> Any` in `backend.config`.

- [ ] **Step 1: Write the failing test for synced preferences and config helpers**

```python
# tests/test_general_settings.py
from backend.sync.registry import SYNCED_PREFERENCES
from backend.config import load_general_settings, save_general_setting

def test_synced_preferences_includes_general_keys():
    expected_keys = {
        "editorDestination", "confirmClose", "fullViewDefault",
        "restoreTabs", "preventSleep", "autoArchiveDays",
        "compressHistory", "speedProfile", "followUpBehavior",
        "plainTextComposer", "showContextUsage", "confettiEnabled",
        "defaultStandaloneChat",
    }
    assert expected_keys.issubset(set(SYNCED_PREFERENCES))

def test_save_and_load_general_settings():
    save_general_setting("editor_destination", "cursor")
    settings = load_general_settings()
    assert settings.get("editor_destination") == "cursor"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_general_settings.py -v`
Expected: FAIL with `ImportError` or `AssertionError`.

- [ ] **Step 3: Implement preferences allowlist and config loaders**

In `backend/sync/registry.py`, append the new preference keys to `SYNCED_PREFERENCES`.
In `backend/config.py`, implement `load_general_settings()` and `save_general_setting()` reading and writing to `app_settings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_general_settings.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sync/registry.py backend/config.py tests/test_general_settings.py
git commit -m "feat(settings): add general settings synced preferences and config helpers"
```

---

### Task 2: Power Sleep Inhibitor & OS Integration

**Files:**
- Modify: `backend/remote/power.py`
- Test: `tests/test_general_settings.py`

**Interfaces:**
- Produces: `acquire_sleep_inhibit(reason: str = ...) -> str | None`
- Produces: `release_sleep_inhibit(handle: str | None) -> bool`

- [ ] **Step 1: Write test for sleep inhibit acquire and release**

```python
# In tests/test_general_settings.py
from backend.remote.power import acquire_sleep_inhibit, release_sleep_inhibit

def test_sleep_inhibit_cycle():
    handle = acquire_sleep_inhibit("running agent turn")
    # In test environments without GUI session, handle may be simulated or None
    released = release_sleep_inhibit(handle)
    assert isinstance(released, bool)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_general_settings.py::test_sleep_inhibit_cycle -v`
Expected: FAIL with `ImportError: cannot import name 'acquire_sleep_inhibit'`.

- [ ] **Step 3: Implement `acquire_sleep_inhibit` and `release_sleep_inhibit` in `backend/remote/power.py`**

Implement process-based or lockfile sleep inhibition:
- Track active inhibitor handles in a module dictionary `_ACTIVE_INHIBITORS: dict[str, subprocess.Popen]`.
- On Linux, if `systemd-inhibit` exists, spawn `systemd-inhibit --what=idle:sleep --why=reason sleep infinity`.
- `release_sleep_inhibit` terminates the process and cleans up the handle.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_general_settings.py::test_sleep_inhibit_cycle -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/remote/power.py tests/test_general_settings.py
git commit -m "feat(power): implement acquire and release sleep inhibitor functions"
```

---

### Task 3: Backend Settings Endpoints (Editor, Archive, Compress)

**Files:**
- Modify: `backend/api/main.py`
- Test: `tests/test_general_settings.py`

**Interfaces:**
- Produces: `GET /api/settings` and `PATCH /api/settings` returning general settings keys.
- Produces: `POST /api/desktop/open-in-editor` (`{"path": str, "editor": str | None}`)
- Produces: `POST /api/conversations/archive-inactive` (`{"days": int}`)
- Produces: `POST /api/db/compress` (`-> {"ok": bool, "size_before": int, "size_after": int, "freed_bytes": int}`)

- [ ] **Step 1: Write tests for the settings endpoints**

```python
# In tests/test_general_settings.py
from fastapi.testclient import TestClient
from backend.api.main import app

client = TestClient(app)

def test_api_settings_general_fields():
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "editor_destination" in data
    assert "speed_profile" in data

def test_api_patch_settings_general():
    resp = client.patch("/api/settings", json={"editor_destination": "vscode", "speed_profile": "turbo"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["editor_destination"] == "vscode"
    assert data["speed_profile"] == "turbo"

def test_api_db_compress():
    resp = client.post("/api/db/compress")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "freed_bytes" in resp.json()

def test_api_archive_inactive_validation():
    # days=0 should not archive anything
    resp = client.post("/api/conversations/archive-inactive", json={"days": 0})
    assert resp.status_code == 200
    assert resp.json()["archived_count"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_general_settings.py -k "test_api" -v`
Expected: FAIL.

- [ ] **Step 3: Implement endpoints in `backend/api/main.py`**

- In `get_settings()` and `update_settings()`, include general knobs (`editor_destination`, `speed_profile`, `prevent_sleep`, `auto_archive_days`, `compress_history`, `follow_up_behavior`).
- Implement `POST /api/desktop/open-in-editor` validating path and invoking target editor asynchronously.
- Implement `POST /api/conversations/archive-inactive` executing SQL update for conversations where `updated_at < datetime('now', f'-{days} days')`.
- Implement `POST /api/db/compress` measuring DB file size, running `conn.execute("VACUUM")`, and returning before/after byte metrics.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_general_settings.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py tests/test_general_settings.py
git commit -m "feat(api): add editor launcher, archive inactive, and db compress endpoints"
```

---

### Task 4: Frontend Store Integration for New Preferences

**Files:**
- Modify: `frontend/src/store.jsx`

**Interfaces:**
- Produces: `useApp()` state and setters for:
  - `editorDestination`, `setEditorDestination`
  - `confirmClose`, `setConfirmClose`
  - `fullViewDefault`, `setFullViewDefault`
  - `preventSleep`, `setPreventSleep`
  - `autoArchiveDays`, `setAutoArchiveDays`
  - `compressHistory`, `setCompressHistory`
  - `speedProfile`, `setSpeedProfile`
  - `followUpBehavior`, `setFollowUpBehavior`
  - `plainTextComposer`, `setPlainTextComposer`
  - `showContextUsage`, `setShowContextUsage`
  - `confettiEnabled`, `setConfettiEnabled`
  - `defaultStandaloneChat`, `setDefaultStandaloneChat`

- [ ] **Step 1: Check existing preference initialization in `frontend/src/store.jsx`**

Identify how `sendWith`, `defaultGuard`, `defaultEffort`, and `showUsage` are declared in `loadPrefs` and store provider.

- [ ] **Step 2: Add initial state and setter callbacks in `frontend/src/store.jsx`**

Include fallback defaults:
- `editorDestination`: `'vscode'`
- `confirmClose`: `'shortcut-only'`
- `fullViewDefault`: `false`
- `preventSleep`: `false`
- `autoArchiveDays`: `0`
- `compressHistory`: `true`
- `speedProfile`: `'standard'`
- `followUpBehavior`: `'queue'`
- `plainTextComposer`: `false`
- `showContextUsage`: `false`
- `confettiEnabled`: `false`
- `defaultStandaloneChat`: `false`
Wrap setters with `savePref` to ensure cross-device persistence and local storage cache.

- [ ] **Step 3: Verify build / lint syntax**

Run: `npm --prefix frontend run build` (or test import).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store.jsx
git commit -m "feat(store): add state and synced setters for general preferences"
```

---

### Task 5: Sidebar Restructure & Live Search Filter

**Files:**
- Modify: `frontend/src/views/Settings.jsx:20-50` and `frontend/src/views/Settings.jsx:4750-4820`

**Interfaces:**
- Produces: `SECTIONS` categorized into `Personal`, `Integrations`, and `Coding`.
- Produces: Interactive search input in `<nav className="set-nav">` with real-time filtering across titles and descriptions.
- Produces: Wayn Design System active indicator: `w-1 h-3.5 rounded-[2px] bg-[#873FFF]`, squircle tab items (`rounded-xl`).

- [ ] **Step 1: Update `SECTIONS` array in `frontend/src/views/Settings.jsx`**

Reorganize into:
- Group `Personal`: `general`, `notifications`, `shortcuts`, `appearance`, `profile`, `usage`, `data`.
- Group `Integrations`: `integrations`, `models`, `browser`, `devices`.
- Group `Coding`: `permissions`, `git`, `codereview`, `about`.

- [ ] **Step 2: Implement search filter state and input in `Settings` component**

Add `searchQuery` state, render search input with `Icon name="search"` and clear button. Filter sections and highlight query matches.

- [ ] **Step 3: Apply Wayn Design System squircle styling**

Ensure active indicators use squircle dash `rounded-[2px]`, buttons use `rounded-xl`, zero circular dots.

- [ ] **Step 4: Verify in browser / build**

Run: `npm --prefix frontend run build` to verify JSX compilation.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Settings.jsx
git commit -m "feat(settings): restructure sidebar into 3 groups with live search filter"
```

---

### Task 6: Rebuild General Panel Cards (30 Laws of UX)

**Files:**
- Modify: `frontend/src/views/Settings.jsx:187-719`
- Create: `frontend/src/components/ConfettiCannon.jsx` (optional lightweight helper or inline canvas trigger)

**Interfaces:**
- Produces: 7 distinct squircle cards (`rounded-2xl`, `border-black/[0.06]`):
  1. Workspace & Editor Destination
  2. Window & Lifecycle (including Prevent Sleep)
  3. Chat & History Storage (Auto-Archive & Compact Now)
  4. Runtime & Speed Profile (Standard, Fast, Turbo + Iteration Limit)
  5. Composer Controls (Send Shortcut, Follow-up Queue/Steer, Plain Text, Context Window Usage)
  6. Popout Launcher (Global Hotkey + Presets, Default to Standalone)
  7. Delights & Notices (Confetti Cannon + Open Source Licenses)

- [ ] **Step 1: Build the 7 card sections inside `General()` in `frontend/src/views/Settings.jsx`**

Use `AnimatedSelect`, `Switch`, `HouseInput`, `HouseButton` (`rounded-xl`). Wire to `useApp()` hooks.

- [ ] **Step 2: Add actions for "Compact Now" and "Browse…"**

Connect "Compact Now" button to call `api.post('/api/db/compress')` and show toast with freed bytes.
Connect "Browse…" button to directory picker or prompt.

- [ ] **Step 3: Implement Confetti Cannon effect**

Add canvas-based celebratory particle burst when Confetti switch is toggled or triggered.

- [ ] **Step 4: Compile and test frontend**

Run: `npm --prefix frontend run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Settings.jsx frontend/src/components/ConfettiCannon.jsx
git commit -m "feat(settings): rebuild General panel cards adhering to 30 Laws of UX"
```

---

### Task 7: End-to-End Verification & Gate Proof

**Files:**
- Modify: `docs/dashboard-changelog.md`

- [ ] **Step 1: Run complete backend test suite for touched code**

Run: `pytest tests/test_general_settings.py -v`
Expected: All tests PASS.

- [ ] **Step 2: Run frontend build verification**

Run: `npm --prefix frontend run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Document changes in changelog**

Add one entry to `docs/dashboard-changelog.md`.

- [ ] **Step 4: Final commit**

```bash
git add docs/dashboard-changelog.md
git commit -m "docs: record settings general section and sidebar revamp in changelog"
```
