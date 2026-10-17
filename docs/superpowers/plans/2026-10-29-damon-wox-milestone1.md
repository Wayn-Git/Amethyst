# Damon Launcher Redesign (Milestone 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Milestone 1 vertical slice of Amethyst Damon launcher overhaul: single-instance window lifecycle, backend streaming provider engine, native application search, library search, split-pane UI, and `Cmd+K` action panel.

**Architecture:** Clean-room native enhancement of Amethyst (MIT-compatible). Python backend runs an asynchronous `LauncherEngine` that executes concurrent local providers and streams ranked results over SSE to React 18 / pywebview frontend. `desktop.py` manages a single-instance socket lock and window visibility synchronization.

**Tech Stack:** Python 3.11+, FastAPI, asyncio, SQLite FTS5, React 18, Vite, pywebview (WebKitGTK/WebView2/WebKit), Vanilla CSS (Amethyst design tokens).

**Spec:** [docs/superpowers/specs/2026-10-29-damon-wox-integration-design.md](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-10-29-damon-wox-integration-design.md)

## Global Constraints
- Preserve 100% MIT compatibility: do not copy, link, or compile GPL-3.0 code from Wox.
- Maintain existing Amethyst capabilities: never break existing Damon routes or features (`/search/web`, `/search/youtube`, etc.).
- Use Amethyst design tokens only: no hardcoded ad-hoc CSS colors or generic visuals.
- Native performance budget: App search to first result < 15ms; hotkey summon toggle < 30ms.
- Edit in place: no unnecessary re-architecting of unaffected files.

## Review Focus
1. Rapid keystrokes: Outdated queries must cancel immediately and not overwrite newer results.
2. Missing or broken `.desktop` files: Malformed INI or non-executable lines must be silently skipped without crashing app indexer.
3. Multiple launcher summons: Concurrently launching `amethyst-palette` or hitting the hotkey must toggle the single existing window rather than spawning orphan processes.
4. Window blur: Clicking outside the launcher card must reliably hide the window and release keyboard focus.
5. Escape key: Esc must close the open Action Panel if active, clear input if non-empty, and hide launcher when input is blank.

---

### Task 1: Desktop Window Lifecycle & Single-Instance Socket Lock

**Files:**
- Modify: `backend/desktop.py`
- Create: `tests/test_desktop_socket.py`

**Steps:**
- [x] Write failing test in `tests/test_desktop_socket.py` verifying single-instance lock acquisition and summon signaling over domain socket.
- [x] Run test using pytest to ensure it fails.
- [x] Implement `_acquire_single_instance_lock()` and IPC socket listener in `backend/desktop.py`.
- [x] Wire blur event on pywebview window to trigger `hide()` and sync `_spotlight_up.clear()`.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "fix(desktop): implement single-instance socket lock and blur auto-hide"`

---

### Task 2: LauncherEngine & Base Provider Contract

**Files:**
- Create: `backend/launcher/__init__.py`
- Create: `backend/launcher/provider.py`
- Create: `backend/launcher/engine.py`
- Create: `tests/test_launcher_engine.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_engine.py` verifying `BaseLauncherProvider`, async query cancellation, concurrency, and score sorting in `LauncherEngine`.
- [x] Run test to confirm it fails.
- [x] Implement data models (`LauncherAction`, `LauncherResult`) and `BaseLauncherProvider` in `backend/launcher/provider.py`.
- [x] Implement `LauncherEngine` in `backend/launcher/engine.py` with provider registration, session task tracking, cancellation, and deduplication.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add LauncherEngine and base provider contract"`

---

### Task 3: Native Application Search Provider

**Files:**
- Create: `backend/launcher/providers/__init__.py`
- Create: `backend/launcher/providers/apps.py`
- Create: `tests/test_app_provider.py`

**Steps:**
- [x] Write failing test in `tests/test_app_provider.py` testing Linux `.desktop` parsing, icon resolution, fuzzy matching, and subprocess launch invocation.
- [x] Run test to confirm it fails.
- [x] Implement `AppProvider` in `backend/launcher/providers/apps.py` scanning XDG directories (`/usr/share/applications`, `~/.local/share/applications`, Flatpak), caching results in-memory, and launching apps safely.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add native desktop application search provider"`

---

### Task 4: Library & Command Search Providers

**Files:**
- Create: `backend/launcher/providers/library.py`
- Create: `backend/launcher/providers/commands.py`
- Create: `tests/test_launcher_library.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_library.py` testing SQLite FTS5 search over saved items/notes and command matching.
- [x] Run test to confirm it fails.
- [x] Implement `LibraryProvider` querying existing Amethyst database for saved links, notes, and facts with rich markdown snippet previews.
- [x] Implement `CommandProvider` for navigation and system/theme commands.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(launcher): add library and command search providers"`

---

### Task 5: FastAPI Streaming & Action Endpoints

**Files:**
- Modify: `backend/api/main.py`
- Create: `tests/test_launcher_endpoints.py`

**Steps:**
- [x] Write failing test in `tests/test_launcher_endpoints.py` testing `GET /api/launcher/stream` SSE output and `POST /api/launcher/action` execution.
- [x] Run test to confirm it fails.
- [x] Mount `LauncherEngine` in `backend/api/main.py` and register `AppProvider`, `LibraryProvider`, and `CommandProvider`.
- [x] Implement `/api/launcher/stream` using `EventSourceResponse` (or async streaming generator) and `/api/launcher/action`.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(api): add launcher streaming and action endpoints"`

---

### Task 6: Frontend Split-Pane Layout & Previews

**Files:**
- Create: `frontend/src/components/damon/DamonSplitPane.jsx`
- Create: `frontend/src/components/damon/DamonPreview.jsx`
- Modify: `frontend/src/components/CommandPalette.jsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/tests/launcher-splitpane.test.mjs`

**Steps:**
- [x] Write failing node test in `frontend/tests/launcher-splitpane.test.mjs` verifying split-pane layout rendering, 55/45 width ratio, and preview content binding.
- [x] Run test with `node --test frontend/tests/launcher-splitpane.test.mjs` to confirm it fails.
- [x] Implement `DamonPreview.jsx` to render app details, library snippets, or collapse smoothly.
- [x] Implement `DamonSplitPane.jsx` and integrate into `CommandPalette.jsx`.
- [x] Update `frontend/src/index.css` with clean Amethyst tokenized styles for the split pane.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(damon): add split-pane layout and adaptive preview pane"`

---

### Task 7: Action Panel (`Cmd+K`) & Keyboard Navigation

**Files:**
- Create: `frontend/src/components/damon/ActionPanel.jsx`
- Modify: `frontend/src/components/CommandPalette.jsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/tests/launcher-actionpanel.test.mjs`

**Steps:**
- [x] Write failing test in `frontend/tests/launcher-actionpanel.test.mjs` verifying `Cmd+K` toggles action panel, keyboard selection, Esc hierarchy, and action execution.
- [x] Run test to confirm it fails.
- [x] Implement `ActionPanel.jsx` showing contextual primary/secondary actions with keyboard shortcuts.
- [x] Wire Esc key handler in `CommandPalette.jsx` according to spec hierarchy (close panel -> clear query -> close palette).
- [x] Wire "Ask Amethyst" action forwarding to chat.
- [x] Run test to verify it passes.
- [x] Commit: `git commit -m "feat(damon): add keyboard action panel and complete Milestone 1 vertical slice"`
