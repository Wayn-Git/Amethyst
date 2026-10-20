# Damon Launcher Redesign (Milestone 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Milestone 2 of Amethyst Damon launcher overhaul: native utilities and expanded search providers (system power/volume controls, window switcher via `wmctrl`, clipboard history with SQLite storage, and local file search).

**Architecture:** Provider-based extension within `backend/launcher/providers/`. All providers implement `BaseLauncherProvider`, return `LauncherResult` instances, and register with `LauncherEngine`. Execution of privileged actions goes through `LauncherAction` execution handlers.

**Tech Stack:** Python 3.11+, SQLite FTS5, `wmctrl`, `pactl`, `loginctl`, `gio`, React 18, Amethyst theme tokens.

**Spec:** [docs/superpowers/specs/2026-10-29-damon-wox-integration-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-29-damon-wox-integration-design.md)

---

### Task 1: System Power & Volume Provider

**Files:**
- Create: `backend/launcher/providers/system.py`
- Create: `tests/test_launcher_system.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_system.py` testing matching system commands (lock, suspend, reboot, poweroff, volume up/down/mute) and action dispatch.
- [x] Implement `SystemProvider` in `backend/launcher/providers/system.py` with safe execution using `subprocess.run` (mockable / non-blocking).
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add system power and audio volume provider"`

---

### Task 2: Window Switcher Provider

**Files:**
- Create: `backend/launcher/providers/windows.py`
- Create: `tests/test_launcher_windows.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_windows.py` testing `wmctrl -l -x` output parsing, fuzzy window title/class matching, and `wmctrl -i -a <win_id>` window raising.
- [x] Implement `WindowProvider` in `backend/launcher/providers/windows.py`.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add native window switcher provider"`

---

### Task 3: Clipboard History Store & Provider

**Files:**
- Create: `backend/launcher/providers/clipboard.py`
- Create: `tests/test_launcher_clipboard.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_clipboard.py` testing clipboard history insertion, deduplication, search, and copy-back action.
- [x] Implement `ClipboardHistoryStore` and `ClipboardProvider` in `backend/launcher/providers/clipboard.py`.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add clipboard history store and provider"`

---

### Task 4: Fast File Search Provider

**Files:**
- Create: `backend/launcher/providers/files.py`
- Create: `tests/test_launcher_files.py`

**Steps:**
- [ ] Write failing test in `tests/test_launcher_files.py` testing user directory scanning, extension/name filtering, score ranking, and file open action via `gio open` / `xdg-open`.
- [ ] Implement `FileProvider` in `backend/launcher/providers/files.py` with bounded depth and path caching.
- [ ] Run test to verify it passes.
- [ ] Commit: `git commit -m "feat(launcher): add fast local file search provider"`

---

### Task 5: Register Milestone 2 Providers in Backend Engine

**Files:**
- Modify: `backend/api/main.py`
- Modify: `tests/test_launcher_endpoints.py`

**Steps:**
- [ ] Update `tests/test_launcher_endpoints.py` to verify all providers stream results.
- [ ] Register `SystemProvider`, `WindowProvider`, `ClipboardProvider`, and `FileProvider` in `backend/api/main.py`.
- [ ] Run tests to verify all endpoints handle new providers and actions.
- [ ] Commit: `git commit -m "feat(api): register window, system, clipboard, and file providers in launcher engine"`

---

### Task 6: Frontend Polish, Full Suite Verification & Changelog

**Files:**
- Modify: `frontend/src/components/CommandPalette.jsx`
- Modify: `docs/dashboard-changelog.md`

**Steps:**
- [ ] Verify icons and preview rendering for window, system, clipboard, and file items.
- [ ] Run all launcher backend and frontend test suites.
- [ ] Update `docs/dashboard-changelog.md` and tick all plan checkboxes.
- [ ] Commit: `git commit -m "feat(damon): complete Milestone 2 native utilities and providers"`
