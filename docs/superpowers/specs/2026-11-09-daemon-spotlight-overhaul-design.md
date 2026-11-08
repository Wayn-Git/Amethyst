# Design Spec: Amethyst Daemon & Spotlight Overhaul

- **Date:** 2026-11-09
- **Status:** Draft / Ready for Review
- **Target:** Electron desktop shell, Python supervisor daemon, backend launcher & search services, and frontend Damon spotlight components.

---

## 1. Problem Statement

The Amethyst Damon (spotlight launcher) suffers from several integration, usability, and cross-platform issues:
1. **Window Coupling & Minimization**: In Electron, summoning the daemon restores the main 1280x820 app window and draws an overlay inside it, instead of running an independent floating launcher. If the app is minimized to tray, the entire app window pops up.
2. **Global Shortcut Conflicts**: The default hotkeys (`Ctrl+Space`, `Alt+Space`, `Ctrl+K`) conflict with OS Spotlight (macOS), IME/ibus language switching (Linux/Windows), and system window menus. Users cannot easily change the shortcut by pressing keys or detect collisions.
3. **Web Search Zero-Results for Non-Dev Users**: The backend search pipeline depended on developer secrets (`EXA_API_KEY`). The free fallback scrapers (DuckDuckGo Lite & Bing) failed with HTTP 202 bot challenges on datacenter/home IPs, and Wikipedia OpenSearch turned every result into encyclopedia articles.
4. **Calculator Silent Failures**: Expressions with syntax errors or unsupported operators (such as `2+6%6&7` with `&`) silently fail and disappear instead of displaying an informative syntax error.
5. **System Actions Not Working**: Actions such as Shutdown and Restart fail because backend `system.py` only looked for `payload["command_id"]` (ignoring `action_id`), and hardcoded Linux `systemctl`/`loginctl`, which fails on Windows, macOS, and non-systemd setups.
6. **Buried Prefixes & Missing Views**: Typing `yt` or `gh` did not highlight the prefix in the search bar, buried search actions behind scrolling, and failed to render the existing `YouTubeBentoView` and `GitHubResultsView` components.
7. **Initial Layout Density**: The launcher opened by default into an expanded card with tabs, recents, and weather instead of the initial clean search bar design with an expand button.

---

## 2. Architectural Design

```
+---------------------------------------------------------------------------------+
|                                OS & Desktop Layer                               |
|                                                                                 |
|  [ Global Shortcut ] --------->  Alt+Shift+Space (Configurable + Conflict Check)|
|          |                                                                      |
|          v                                                                      |
|  [ Electron Supervisor ]        [ Python Tray Supervisor ]                      |
|    - Independent spotlightWindow   - Dedicated pywebview spotlight window       |
|    - Always-on-top, frameless     - Toggles via API nudges                      |
|    - Auto-hides on blur           - Standalone from minimized main window       |
+---------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------+
|                       Frontend: CommandPalette & Damon UI                       |
|                                                                                 |
|  [ Search Header ]                                                              |
|    - Compact pill by default (~72px)                                            |
|    - Expand / Collapse button (reveals tabs, recents, quick shortcuts)          |
|    - Syntax-highlighted prefix badges (yt, gh, g, wiki, sys, math)              |
|    - Auto-expands into results list on keystroke                                |
|                                                                                 |
|  [ Results & Dedicated Views ]                                                  |
|    - Row 1 & 2: Top Search Suggestions (YouTube / GitHub / Web quick actions)   |
|    - yt mode  -> mounts YouTubeBentoView                                        |
|    - gh mode  -> mounts GitHubResultsView                                        |
|    - Calculator -> displays result or explicit red syntax error badge           |
+---------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------+
|                       Backend Services & Provider Engines                       |
|                                                                                 |
|  [ Launcher Engine ]                                                            |
|    - SystemProvider: Cross-platform shutdown / restart / lock (Win, Mac, Linux) |
|    - Accepts action_id directly from frontend                                   |
|                                                                                 |
|  [ Web Search Service ]                                                         |
|    - Primary: Configured API (Exa / LangSearch / Tavily if keys exist)          |
|    - High-Priority Public Fallback: Robust DuckDuckGo HTML scraping             |
|      (with browser headers, cookies, and lxml parsing, bypassing 202 challenge) |
|    - Secondary Fallback: Wikipedia OpenSearch (distinctly marked as Wiki)       |
+---------------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### 3.1. Independent Windowing & Desktop Hotkey Registration

#### A. Electron (`electron/main.cjs`)
1. Create a dedicated `spotlightWindow`:
   - `width: 820`, `height: 640` (with transparent background).
   - `frame: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`.
   - URL: `http://127.0.0.1:${port}/?spotlight=1`.
2. Window management:
   - Pre-created at supervisor boot, hidden until summoned.
   - `toggleSpotlight()` shows/focuses `spotlightWindow` when hidden; hides it when visible.
   - Never calls `mainWindow.show()` or `mainWindow.restore()`. Main window remains minimized in tray.
   - `spotlightWindow.on('blur')` automatically hides the window.
3. IPC Channel:
   - Provide `desktop:get-shortcut`, `desktop:set-shortcut`, and `desktop:check-shortcut-conflict`.

#### B. Global Shortcut & Key Recording
1. Default shortcut: `Alt+Shift+Space` (unassigned on Windows, macOS, and Linux GNOME/KDE).
2. Fallback cascade on register failure:
   - Try preferred -> `Alt+Shift+Space` -> `Ctrl+Shift+Space` -> `Alt+Space`.
3. In-App Keybinding Recorder (in Settings and Damon footer/header):
   - User clicks "Record Shortcut", presses any combination of modifier + key.
   - Checks `globalShortcut.isRegistered(combo)` in Electron, or `check_shortcut_conflicts` on Linux.
   - Saves to `safeStorage` / user preferences.

---

### 3.2. Clean Search Bar & Expand Interaction (Initial Design)

1. **Default State (`compactMode = true`)**:
   - Initial render height: ~72px (only search input container).
   - Clean, focused, no visual clutter.
2. **Expand Toggle Button**:
   - Located at trailing side of header next to hotkey badge.
   - Clicking toggles `expandedPanel` (reveals mode tabs, recents, continue items, and quick commands).
3. **Auto-Expand Behavior**:
   - When user types text (`query.trim().length > 0`), the window smoothly expands its view to show top suggestions and ranked results.
   - When query is backspaced/cleared: collapses back to the clean pill unless explicitly expanded by the toggle button.

---

### 3.3. Prefix Recognition, Syntax Highlighting & Top Suggestions

1. **Prefix Tokens**:
   - Matches: `yt `, `youtube `, `gh `, `github `, `g `, `web `, `wiki `, `sys `.
   - Token rendering:
     - Rendered as an optical colored badge pill directly preceding the query text in the input:
       - `yt` / `youtube`: Background `rgba(239, 68, 68, 0.15)`, text `#EF4444`, icon `play`.
       - `gh` / `github`: Background `rgba(139, 92, 246, 0.15)`, text `#8B5CF6`, icon `code`.
       - `g` / `web`: Background `rgba(59, 130, 246, 0.15)`, text `#3B82F6`, icon `globe`.
       - `wiki`: Background `rgba(100, 116, 139, 0.15)`, text `#64748B`, icon `book`.
     - Hitting Backspace when query is empty removes the prefix pill.
2. **Top Suggestions**:
   - In universal search results, search engine actions ("Search YouTube for ...", "Search GitHub for ...", "Search DuckDuckGo for ...") are pinned at the top under a prominent `Suggestions` section, eliminating the need to scroll.
3. **Dedicated Views**:
   - When mode is `youtube`, mount `YouTubeBentoView` with video previews.
   - When mode is `github`, mount `GitHubResultsView` with repository cards.

---

### 3.4. Robust Public Web Search (DuckDuckGo Priority)

1. Upgrade `_search_ddg_html` in `backend/web/search_service.py`:
   - Send full Chromium/Firefox navigation headers (`Sec-Ch-Ua`, `Sec-Fetch-*`, `Accept`, `Referer`, `Upgrade-Insecure-Requests`).
   - Query `https://html.duckduckgo.com/html/`.
   - Parse results with `lxml.html` (`div.web-result`, title link `h2 a`, snippet `a.result__snippet`, and unquote `uddg=` redirect URLs).
   - Yields 10 genuine search results without HTTP 202 challenge.
2. Fallback cascade:
   - Tier 1: Configured API (Exa / LangSearch / Tavily) if keys exist.
   - Tier 2: DuckDuckGo HTML parser (verified working with genuine results).
   - Tier 3: Wikipedia OpenSearch (only for direct encyclopedic / term queries).
   - Tier 4: Direct browser query action item.

---

### 3.5. Calculator Syntax Error Feedback

1. In `frontend/src/components/damon/calculator.js`:
   - Check if query has math intent (starts with `=`, or contains digits with math operators `+`, `-`, `*`, `/`, `%`, `^`, `&`).
   - If invalid syntax or unexpected operator is encountered:
     - Returns `{ type: 'math-error', expression: q, error: "Syntax error: unsupported operator '&'" }`
2. In `CommandPalette.jsx` / `DamonUniversalResults.jsx`:
   - If `mathResult.type === 'math-error'`:
     - Render result row with warning icon (`alert-circle`), math expression, and error message in red/amber tone.
     - Never silently drop the item.

---

### 3.6. Cross-Platform Power Actions (Shutdown, Restart, Lock)

1. In `frontend/src/components/CommandPalette.jsx`:
   - Pass both `action_id` and `command_id` in `executeItem`:
     `api.executeLauncherAction('system', item.action_id || item.command_id, { action_id: item.action_id, command: item.action_id })`
2. In `backend/launcher/providers/system.py`:
   - Normalize command from `payload.get("action_id") or payload.get("command_id") or action_id`.
   - Execute platform-aware commands:
     - **Windows (`sys.platform == 'win32'`)**:
       - Shutdown: `shutdown.exe /s /t 0`
       - Restart: `shutdown.exe /r /t 0`
       - Lock: `rundll32.exe user32.dll,LockWorkStation`
     - **macOS (`sys.platform == 'darwin'`)**:
       - Shutdown: `osascript -e 'tell app "System Events" to shut down'`
       - Restart: `osascript -e 'tell app "System Events" to restart'`
       - Lock: `pmset displaysleepnow`
     - **Linux (`sys.platform.startswith('linux')`)**:
       - Shutdown: Check `systemctl poweroff` -> fallback `loginctl poweroff` -> fallback `poweroff`
       - Restart: Check `systemctl reboot` -> fallback `loginctl reboot` -> fallback `reboot`
       - Lock: Check `loginctl lock-session` -> fallback `xdg-screensaver lock`

---

## 4. Verification & Testing Strategy

1. **Electron Independent Windowing**:
   - Launch Electron app, minimize main window to tray.
   - Press `Alt+Shift+Space`: verify only the spotlight window appears centered on screen.
   - Press `Esc` or click outside: verify spotlight hides without restoring main window.
2. **Shortcut Recorder**:
   - Open Settings / Damon shortcut config, press a custom combination.
   - Verify conflict check succeeds on free combo, warns on system collisions.
3. **Search Fallback**:
   - Run search without API keys: verify DuckDuckGo returns 8-10 genuine web results (e.g. Python, news, tech).
4. **Calculator Error**:
   - Type `2+6%6&7`: verify calculator result row shows syntax error badge explaining `&`.
5. **Prefixes & Views**:
   - Type `yt test`: verify red `yt` pill appears, top suggestion says "Search YouTube for 'test'", and `YouTubeBentoView` renders.
   - Type `gh amethyst`: verify purple `gh` pill appears, `GitHubResultsView` renders.
6. **System Actions**:
   - Trigger lock/sleep command: verify command executes successfully across platforms without binary missing error.
