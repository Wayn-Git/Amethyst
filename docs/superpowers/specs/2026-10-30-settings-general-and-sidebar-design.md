# Settings General Section & Sidebar Revamp Specification

**Date:** 2026-10-30  
**Status:** Approved for Implementation Planning  
**Target:** Amethyst Desktop & Web (`frontend/src/views/Settings.jsx`, `backend/api/main.py`, `backend/config.py`, `backend/remote/power.py`, `backend/sync/registry.py`)

---

## 1. Executive Summary

This specification revamps the Amethyst Settings interface, specifically modernizing the **General** section and the **Sidebar navigation**, aligning them with the OpenAI Codex Desktop settings architecture while adhering strictly to the **Wayn Design System** and the **30 Laws of UX**.

All settings are backed by reliable persistence in SQLite (`app_settings`), synchronized across devices via `SYNCED_PREFERENCES` where appropriate, and supported by concrete backend capabilities for external editor execution, OS sleep inhibition, chat archiving, and database compression.

---

## 2. 30 Laws of UX Implementation Matrix

| Law of UX | Implementation in Settings Revamp |
| :--- | :--- |
| **1. Aesthetic-Usability Effect** | Disciplined 12px squircle geometry (`rounded-xl`), `#0E131F` dark obsidian and `#F7F7F5` light canvas, crisp hairline borders (`border-black/[0.06]`), and brand purple accents (`#873FFF`) elevate perceived trust and system stability. |
| **2. Doherty Threshold** | Instant optimistic UI updates on toggle/select changes (<16ms frame dispatch) with non-blocking asynchronous backend syncing. |
| **3. Fitts's Law** | Interactive targets have minimum 44x44px touch targets; toggles and squircle action buttons are generously spaced and positioned on consistent right rails. |
| **4. Hick's Law** | Complex settings are decomposed into digestible, themed cards; sidebar options are structured into three distinct categories with an instant search filter to minimize decision fatigue. |
| **5. Jakob's Law** | Follows standard desktop settings ergonomics (two-column row with title/description on left, interactive control on right; sticky sidebar navigation on left). |
| **6. Law of Common Region** | Unified `rounded-2xl` card containers delineate related setting groups into clear architectural zones. |
| **7. Law of Proximity** | Tightly related controls (e.g. Send shortcut + Follow-up steer/queue) live within identical cards separated by 1px subtle divider lines. |
| **8. Law of Prägnanz** | Clean squircle cards and uniform row heights eliminate visual noise and extraneous adornment. |
| **9. Law of Similarity** | All primary interactive action buttons share `rounded-xl`; all selection dropdowns use `AnimatedSelect`; all switches use squircle track styling. |
| **10. Law of Uniform Connectedness** | Connected controls (e.g. segmented controls for Enter vs Ctrl+↵, Queue vs Steer) are physically joined within a shared squircle container. |
| **11. Miller's Law** | Cards contain 2 to 5 related items, keeping working memory load well within human cognitive limits. |
| **12. Occam's Razor** | Eliminates redundant duplicate controls across panels; provides direct single-click actions with smart defaults. |
| **13. Pareto Principle** | Prioritizes the 20% of settings that govern 80% of daily workflow (Workspace, Editor, Send key, Follow-up behavior) at the top of General. |
| **14. Parkinson's Law** | Quick-click preset buttons for global hotkeys and iteration limits allow instantaneous configuration without manual typing. |
| **15. Peak-End Rule** | Delightful micro-interactions, including optional Confetti Cannon burst on completion and smooth exit/entry motion (`ease: [0.16, 1, 0.3, 1]`). |
| **16. Postel's Law** | Tolerant text input parsers for directory paths and hotkey combinations with clear fallback guidance. |
| **17. Serial Position Effect** | Places high-frequency items (Workspace & Editor) at the very top, and memorable delight items (Confetti) at the very bottom. |
| **18. Tesler's Law (Conservation of Complexity)** | Complex platform-specific sleep inhibition and editor binary discovery are handled transparently on the backend. |
| **19. Von Restorff Effect (Isolation Effect)** | Active sidebar item and highlighted states stand out with brand purple `#873FFF` squircle dashes. |
| **20. Zeigarnik Effect** | Unsaved edits (like workspace path draft) display distinct active save states until committed. |
| **21. Goal-Gradient Effect** | Real-time visual feedback confirms saved changes immediately with concise toast notifications. |
| **22. Selective Attention** | Clear visual hierarchy (14px bold title, 12px dim description, right-aligned controls) guides scanning gaze directly to controls. |
| **23. Sensory Adaptation** | Low-contrast hairline dividers and calm neutral backgrounds prevent visual fatigue during prolonged use. |
| **24. Weber-Fechner Law** | Contrast levels for active vs inactive states are tuned for distinct perceptual thresholds across both light and dark themes. |
| **25. Mental Model** | Matches developer mental models for code editors, terminal hotkeys, and agent turn pacing. |
| **26. Feedback Loop** | Immediate visual hover states, active button press feedback (`scale(0.98)`), and instant toast confirmations. |
| **27. Chunking** | General settings are divided into 7 distinct thematic cards. |
| **28. Cognitive Load Theory** | Suppresses unnecessary technical jargon; descriptions explain user-visible outcomes rather than internal variables. |
| **29. Visual Hierarchy** | Header (20px bold) -> Group Labels (11px uppercase mono) -> Card Row Titles (14px semibold) -> Descriptions (12px neutral-dim). |
| **30. Spacing & Pacing** | Calibrated 16px row gaps, 24px card margins, and 12px internal card padding maintain visual breathing room. |

---

## 3. Sidebar Architecture & Taxonomy

### 3.1 Taxonomy Groups
The sidebar navigation is restructured into three primary groups, matching the Codex mental model while retaining Amethyst's views:

1. **Top Search Bar**:
   - Monospace search input (`rounded-xl`, `bg-neutral-100` / `var(--surface-2)`) with search icon and quick clear `x`.
   - Live fuzzy search filtering across all section titles and setting descriptions. When searching, non-matching sections are hidden and matching items are highlighted.

2. **Group: `Personal`**:
   - `general`: General (Sliders / Gear icon) - App lifecycle, workspace, editor, composer.
   - `notifications`: Notifications (Bell icon) - Turn alerts, sound, question pings.
   - `shortcuts`: Keyboard Shortcuts (Command / Keyboard icon) - Global & in-app hotkeys.
   - `appearance`: Appearance (Palette / Sun icon) - Themes, scaling, fonts, materials.
   - `profile`: Profile (User icon) - Identity, email, display name.
   - `usage`: Usage & Billing (Gauge icon) - Token consumption and telemetry.
   - `data`: Storage & Data Controls (Shield / Trash icon) - Backup, cache, reset.

3. **Group: `Integrations`**:
   - `integrations`: Connectors & MCP (Layers icon) - Local/remote servers & tools.
   - `models`: AI Models & Providers (Cpu icon) - API keys, endpoints, reasoning tiers.
   - `browser`: Browser Automation (Globe icon) - Headless / interactive browser settings.
   - `devices`: Connected Devices (Link icon) - Peer-to-peer sync and pairings.

4. **Group: `Coding`**:
   - `permissions`: Security & Guard (Shield icon) - Filesystem & shell confirmation gates.
   - `git`: Git & Worktrees (Git branch icon) - Version control defaults.
   - `codereview`: Code Review (Git merge icon) - Automated PR / branch review configs.
   - `about`: About & Licenses (Info icon) - Version, system info, open-source notices.

### 3.2 Visual Styling Rules
- Active tab indicator: `w-1 h-3.5 rounded-[2px] bg-[#873FFF]` squircle dash positioned at the left of the active item (zero circular dots).
- Tab buttons: `rounded-xl`, subtle hover transition (`bg-black/[0.04]` / `bg-white/[0.04]`).

---

## 4. General Section Components & Cards

The General view (`frontend/src/views/Settings.jsx`) consists of 7 structured cards:

### Card 1: Workspace & Editor Destination
- **Projectless Chat Folder**:
  - Description: Location where chats started outside of specific projects store their data and artifacts.
  - Control: Path input with `Browse…` button (invokes native directory picker or prompt) and `Save` button.
- **Default File Open Destination**:
  - Description: Application used when opening files, diffs, or project folders from Amethyst.
  - Control: `AnimatedSelect` with detected/supported options:
    - `vscode`: "Visual Studio Code"
    - `cursor`: "Cursor"
    - `windsurf`: "Windsurf"
    - `sublime`: "Sublime Text"
    - `system`: "System Default (xdg-open)"

### Card 2: Window & Lifecycle
- **Confirm Before Closing Window**:
  - Description: Warn when closing a window or active session tab.
  - Control: `AnimatedSelect` with options:
    - `shortcut-only`: "Close shortcut only (Ctrl+W)"
    - `always`: "Always confirm"
    - `never`: "Never confirm"
- **Full View by Default**:
  - Description: Start new chats with chat and content in a single consolidated tab strip.
  - Control: `Switch` toggle.
- **Restore Open Tabs on Restart**:
  - Description: Restore active conversation and panel arrangement when relaunching.
  - Control: `Switch` toggle.
- **Prevent Sleep While Running**:
  - Description: Keep computer awake while Amethyst is executing an autonomous agent task or long-running turn.
  - Control: `Switch` toggle.

### Card 3: Chat & History Storage
- **Automatically Archive Inactive Chats**:
  - Description: Automatically archive local chats after a period of inactivity to keep sidebar clean.
  - Control: `AnimatedSelect` with options:
    - `0`: "Never"
    - `7`: "After 7 days"
    - `30`: "After 30 days"
    - `90`: "After 90 days"
- **Compress Local Chat History**:
  - Description: Save disk space by compacting older conversation logs and running SQLite VACUUM.
  - Control: `Switch` toggle + "Compact Now" action button that triggers `/api/db/compress`.
- **Confirm Destructive Actions**:
  - Description: Display safety confirmation modals before deleting conversations or clearing memory.
  - Control: `Switch` toggle.

### Card 4: Runtime & Speed Profile
- **Execution Speed**:
  - Description: Choose execution pacing across chats, tool dispatch, and reasoning compaction.
  - Control: `AnimatedSelect` with options:
    - `standard`: "Standard (Balanced reasoning and iteration budget)"
    - `fast`: "Fast (Reduced reasoning tokens, expedited tool dispatch)"
    - `turbo`: "Turbo (Minimal reasoning overhead, parallel tool execution)"
- **Autonomous Iteration Limit**:
  - Description: Maximum tool calls and model round-trips allowed in a single agent turn.
  - Control: Range slider (4 to 200 turns) with monospace value badge.

### Card 5: Composer
- **Send Shortcut**:
  - Description: Choose when Enter sends a prompt or inserts a new line.
  - Control: Segmented squircle buttons (`Enter` vs `Ctrl+↵`).
- **Follow-up Behavior**:
  - Description: Action taken when sending a prompt while an agent run is already executing.
  - Control: Segmented squircle control:
    - `queue`: "Queue (Run message sequentially after turn finishes)"
    - `steer`: "Steer (Interrupt and guide current running turn immediately)"
  - Subtext: "Press Ctrl+↵ while sending to invert behavior for a single prompt."
- **Plain Text Composer**:
  - Description: Keep code, Markdown, and URLs as raw literal text while typing.
  - Control: `Switch` toggle.
- **Show Context Window Usage**:
  - Description: Display token consumption meter and remaining context in the prompt composer.
  - Control: `Switch` toggle.

### Card 6: Popout Launcher
- **Global Summon Hotkey**:
  - Description: System-wide chord to summon or dismiss Amethyst floating launcher from anywhere.
  - Control: Monospace key chord input + "Save" button + preset squircle pills (`Ctrl+Alt+Space`, `Ctrl+Space`, `Super+Space`, `Alt+Space`).
- **Default to Standalone Chat**:
  - Description: Open new chats in standalone popout window outside of the main project frame.
  - Control: `Switch` toggle.

### Card 7: Delights & Notices
- **Confetti Cannon**:
  - Description: Show celebration confetti in the app when goals are completed or upon request.
  - Control: `Switch` toggle.
- **Open Source Licenses**:
  - Description: Third-party notices and bundled open-source package licenses.
  - Control: `HouseButton` (`rounded-xl`, "View Notices") opening the About modal.

---

## 5. Backend Architecture & Endpoints

### 5.1 Synced Preferences Allowlist (`backend/sync/registry.py`)
Add the new settings keys to `SYNCED_PREFERENCES`:
```python
SYNCED_PREFERENCES = (
    # existing keys...
    "theme", "accentColor", "defaultGuard", "defaultEffort", "sendWith",
    "archiveChats", "confirmDestructive", "shellConfirm", "fileConfirm",
    "netConfirm", "showUsage", "notifyOnDone", "draftProvider", "draftModel",
    # new keys:
    "editorDestination",
    "confirmClose",
    "fullViewDefault",
    "restoreTabs",
    "preventSleep",
    "autoArchiveDays",
    "compressHistory",
    "speedProfile",
    "followUpBehavior",
    "plainTextComposer",
    "showContextUsage",
    "confettiEnabled",
    "defaultStandaloneChat",
)
```

### 5.2 Settings API Extensions (`backend/api/main.py`)
1. **`GET /api/settings` & `PATCH /api/settings`**:
   Support `editor_destination`, `speed_profile`, `prevent_sleep`, `auto_archive_days`, `compress_history`, and `follow_up_behavior` in the server-side settings payload and persistence logic.

2. **`POST /api/desktop/open-in-editor`**:
   - Request Body: `{"path": "/absolute/path/to/file_or_dir", "editor": "vscode" | "cursor" | "windsurf" | "sublime" | "system" | null}`
   - Behavior:
     - If `editor` is null, reads `editor_destination` from `app_settings` (defaults to system default or `code`).
     - Maps editor slug to executable:
       - `vscode` -> `code`
       - `cursor` -> `cursor`
       - `windsurf` -> `windsurf`
       - `sublime` -> `subl`
       - `system` -> `xdg-open` (Linux), `open` (macOS), or `os.startfile` (Windows).
     - Validates that target path exists.
     - Spawns process asynchronously without blocking API thread.
     - Returns `{"ok": True, "editor": slug, "path": path}`.

3. **`POST /api/conversations/archive-inactive`**:
   - Query / Body: `{"days": int}`
   - Behavior:
     - Scans `conversations` where `updated_at < datetime('now', '-{days} days')` and `archived = 0`.
     - Updates matching rows to `archived = 1`.
     - Returns `{"ok": True, "archived_count": count}`.

4. **`POST /api/db/compress`**:
   - Behavior:
     - Runs SQLite `PRAGMA incremental_vacuum` or `VACUUM`.
     - Emits updated database size statistics.
     - Returns `{"ok": True, "size_before": int, "size_after": int, "freed_bytes": int}`.

5. **Sleep Inhibitor Integration (`backend/remote/power.py` & `backend/agent/runner.py`)**:
   - Adds `acquire_sleep_inhibit(reason: str) -> InhibitHandle | None` and `release_sleep_inhibit(handle: InhibitHandle) -> None`.
   - On Linux, uses `systemd-inhibit` or DBus `org.freedesktop.ScreenSaver` cookie. On macOS, uses `caffeinate` process. On Windows, uses `ctypes.windll.kernel32.SetThreadExecutionState`.
   - In `Director` / agent runner: when a run starts, if `prevent_sleep` is True, lock is held; on turn termination or idle, lock is released cleanly.

---

## 6. Implementation Stages & Decomposition

1. **Stage 1: Backend Settings & Capabilities**
   - Update `backend/sync/registry.py` with new preference keys.
   - Update `backend/api/main.py` with `/api/desktop/open-in-editor`, `/api/conversations/archive-inactive`, and `/api/db/compress`.
   - Implement power sleep inhibitor in `backend/remote/power.py`.
   - Write pytest test suite `tests/test_general_settings.py`.

2. **Stage 2: Sidebar Restructure & Live Search**
   - Update `SECTIONS` in `frontend/src/views/Settings.jsx` to reflect the 3 groups (`Personal`, `Integrations`, `Coding`).
   - Implement live search filter input in sidebar header with search icon and reset button.
   - Style active indicators with `w-1 h-3.5 rounded-[2px] bg-[#873FFF]`.

3. **Stage 3: General Panel Cards & Components**
   - Rebuild `General` component with the 7 squircle cards (`rounded-2xl`).
   - Wire all controls to `useApp()` store methods with automatic persistence.
   - Add Confetti Cannon celebration effect using lightweight canvas particle trigger.
   - Verify all button geometries adhere to `rounded-xl` squircle rules.

4. **Stage 4: End-to-End Verification**
   - Run backend test suite.
   - Verify responsive display, keyboard navigation, and theme switches.
