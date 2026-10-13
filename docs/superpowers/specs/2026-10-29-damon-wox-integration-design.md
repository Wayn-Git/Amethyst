# Amethyst Damon — Wox v2 Integration & Native Launcher Redesign Spec

**Date**: 2026-10-29  
**Status**: Approved for Planning  
**Target Subsystem**: `backend/launcher/`, `backend/desktop.py`, `frontend/src/components/damon/`, `frontend/src/components/CommandPalette.jsx`

---

## 1. Executive Summary & Objective

Transform Amethyst's existing Damon / Command Palette spotlight feature into a keyboard-first, native-performance desktop launcher inspired by Wox v2 and Raycast.

### Architecture Selection
- **Selected Approach**: **Approach C — Native Damon Architecture Enhancement**.
- **Licensing Constraint**: Amethyst is licensed under **MIT**. Wox v2 is licensed under **GPL-3.0**. Direct source compilation or library linking with Wox would infect Amethyst with GPL copyleft obligations. Therefore, Wox's proven architectural patterns (provider pipeline, scheduler, action binding, desktop indexing) are implemented clean-room in Amethyst's native Python backend and React frontend.

---

## 2. System Architecture

```
+--------------------------------------------------------------------------+
|                        Frontend (React 18 / pywebview)                   |
|                                                                          |
|  [ Search Bar (Filter Badges, Keystroke Cache) ]                         |
|  +------------------------------------+--------------------------------+ |
|  | Results List (55% width)           | Adaptive Preview Pane (45%)    | |
|  | - Grouped by Provider              | - App Info / Excerpt / Media   | |
|  | - Keyboard Nav (Arrows, Enter)     | - Metadata & Shortcuts         | |
|  +------------------------------------+--------------------------------+ |
|  [ Footer: Action Hints (Enter: Open, Cmd+K: Actions, Esc: Dismiss)    ] |
|  [ Sliding Action Panel (Cmd+K / Ctrl+K)                               ] |
+--------------------------------------------------------------------------+
                                     │
                     SSE Stream (`/api/launcher/stream`)
                                     ▼
+--------------------------------------------------------------------------+
|                     Backend Daemon (`backend/launcher/`)                 |
|                                                                          |
|  LauncherEngine                                                          |
|  ├── Session & Query Manager (Cancels stale queries on keystroke)        |
|  ├── TaskPool (Concurrent async provider execution)                      |
|  │     ├── AppProvider (Native .desktop / Start Menu / .app)             |
|  │     ├── LibraryProvider (SQLite FTS5 knowledge search)                |
|  │     ├── CommandProvider (Internal commands, themes, settings)         |
|  │     └── AgentProvider ("Ask Amethyst" prompt forwarding)              |
|  └── Result Normalizer & Ranker (Fuzzy score + MRU boost)                |
|                                                                          |
|  Desktop Window Manager (`backend/desktop.py`)                           |
|  ├── Single-Instance Socket Lock (~/.amethyst/desktop.sock)              |
|  ├── Atomic Hotkey Synchronization (<ctrl>+<alt>+<space>)                |
|  └── Auto-hide on Blur & Focus Restoration                               |
+--------------------------------------------------------------------------+
```

---

## 3. Core Subsystems & Interfaces

### 3.1. Provider Contract (`backend/launcher/provider.py`)

All search sources implement `BaseLauncherProvider`:

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, AsyncIterator


@dataclass
class LauncherAction:
    id: str
    title: str
    shortcut: str | None = None
    is_primary: bool = False
    handler_payload: dict[str, Any] | None = None


@dataclass
class LauncherResult:
    id: str
    provider_id: str
    title: str
    subtitle: str | None = None
    icon: str = "search"
    badge: str | None = None
    score: float = 0.0
    preview_type: str = "none"  # "app_info" | "markdown" | "image" | "none"
    preview_data: dict[str, Any] | None = None
    actions: list[LauncherAction] | None = None


class BaseLauncherProvider(ABC):
    id: str
    name: str
    priority: int  # Higher priority searched and ranked first

    @abstractmethod
    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        """Yield results matching query incrementally."""
        ...

    @abstractmethod
    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a selected action."""
        ...
```

### 3.2. Native Desktop Application Provider (`backend/launcher/providers/apps.py`)
- **Linux (XDG)**:
  - Scans `/usr/share/applications`, `~/.local/share/applications`, and Flatpak paths.
  - Parses `.desktop` files using standard INI parsing (extracts `Name`, `Exec`, `Icon`, `NoDisplay`, `Keywords`, `Categories`).
  - Resolves icon files or theme icon names to SVG/PNG paths or built-in icon tokens.
  - Launches application detached via `gio launch <file>` or `subprocess.Popen` with clean session detachment (`start_new_session=True`).
- **In-Memory Cache**: Indexed on startup with background `inotify`/file watcher updates. Application searches return in < 10ms.

### 3.3. Library & Knowledge Provider (`backend/launcher/providers/library.py`)
- Searches SQLite FTS5 index over existing Amethyst saved articles, notes, and memory facts.
- Returns markdown snippet preview and direct action to view or ask agent about the content.

### 3.4. Single-Instance & Desktop Window Controller (`backend/desktop.py`)
- **Socket Lock**:
  - Unix Domain Socket (`~/.amethyst/desktop.sock`) / Windows Named Pipe (`\\.\pipe\amethyst_desktop`).
  - On daemon startup, binds the socket. If already bound, sends `{"action": "summon"}` to existing process and exits immediately.
- **Window Blur Handling**:
  - WebKitGTK / pywebview blur event triggers window hide and cleans up transient state.
- **Escape Key & Dismissal**:
  - Action menu open -> close action menu.
  - Query non-empty -> clear query.
  - Query empty -> hide window and restore prior active window focus.

---

## 4. UI Layout & Action Panel

### 4.1. Split-Pane Layout
- Left Pane (55% width): Result list grouped by provider (Applications, Library, Commands).
- Right Pane (45% width): Contextual preview pane:
  - Application: App icon, binary path, categories, launch action.
  - Library: Title, domain, summary, tags.
  - Agent prompt: Formatted question card with streaming answer indicator.
  - Collapses smoothly when current selection has no preview data.

### 4.2. Action Panel Drawer (`ActionPanel.jsx`)
- Triggered by `Cmd+K` / `Ctrl+K`.
- Slides over or into the preview area.
- Displays keyboard-navigable list of secondary actions (Copy Path, Reveal in File Manager, Send to Agent, Save to Library).

---

## 5. Incremental Milestones

### Milestone 1 (Vertical Slice — Current Task)
1. Window & instance lifecycle fixes (Single-instance socket lock, auto-hide on blur, Esc hierarchy).
2. Backend `LauncherEngine` and provider abstraction with SSE streaming endpoint.
3. Native Application Search provider (Linux XDG `.desktop` indexing and launch).
4. Library Search provider (Amethyst SQLite FTS5).
5. Split-Pane UI layout with preview container in `CommandPalette.jsx`.
6. Keyboard-driven Action Panel (`Cmd+K`).
7. "Ask Amethyst" agent invocation action.

### Milestone 2 (Native Utilities & Expanded Providers)
1. Window switcher (search, focus, bring-to-front).
2. System clipboard history with SQLite local store.
3. System power & volume commands.
4. Fast file indexing / content search.

### Milestone 3 (Media Bento Polish & Mobile Relay)
1. YouTube bento, Web, and Image view integration into unified provider model.
2. Cross-device continuity via existing Cloudflare relay.

---

## 6. Verification & Test Plan

- **Backend**:
  - `tests/test_launcher_engine.py`: Test query concurrency, cancellation, and score sorting.
  - `tests/test_app_provider.py`: Test `.desktop` file parsing, icon resolution, and execution without shell injection.
  - `tests/test_desktop_socket.py`: Test single-instance lock and IPC signaling.
- **Frontend**:
  - `frontend/tests/launcher-navigation.test.mjs`: Test split-pane render, arrow key navigation, Esc hierarchy, and `Cmd+K` action panel toggle.
- **Performance Budget**:
  - Cold summon < 80ms.
  - Warm hotkey toggle < 30ms.
  - App search query time to first local result < 15ms.
