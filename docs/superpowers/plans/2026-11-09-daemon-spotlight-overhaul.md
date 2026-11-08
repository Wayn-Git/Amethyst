# Amethyst Daemon & Spotlight Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Amethyst Damon (spotlight launcher) into an independent, robust, cross-platform floating daemon with DuckDuckGo priority search, calculator error feedback, cross-platform power actions, custom shortcut recording with conflict checks, clean compact-by-default UI, and syntax-highlighted prefix routing (YouTube, GitHub, Web).

**Architecture:** 
- In Electron & desktop supervisor: decouple spotlight from main window with a dedicated frameless transparent `spotlightWindow` summoned by `Alt+Shift+Space` (with conflict checking & fallback).
- In backend: upgrade free web search to resilient DuckDuckGo HTML scraping with browser headers before Wikipedia fallback; normalize system actions to cross-platform commands (Win/Mac/Linux).
- In frontend: adopt clean compact bar by default with expand button, prefix badges, pinned top suggestions, and wire dedicated `YouTubeBentoView` and `GitHubResultsView`.

**Tech Stack:** Electron 30, React 19, Python 3.12 (FastAPI), httpx, lxml, CSS modules/Geist.

**Spec:** [`docs/superpowers/specs/2026-11-09-daemon-spotlight-overhaul-design.md`](file:///home/wayne/Documents/GitHub/amethyst/docs/superpowers/specs/2026-11-09-daemon-spotlight-overhaul-design.md)

## Global Constraints

- Never break or compromise the existing permission gate (`backend/security/confirmation.py`).
- Do not introduce external npm/pip dependencies without justification (`lxml` and `httpx` already in `.venv`).
- Use design tokens (`--bg-surface`, `--accent`, `--border`, etc.) instead of hardcoded hex values in UI.
- All code, comments, and tests must pass existing linters (`ruff` and `npm run test` or node tests).

## Review Focus

1. **DuckDuckGo Rate Limits / Anti-Bot**: When DuckDuckGo throttles or blocks with 202, search must fall back cleanly to secondary Wikipedia/external links without crashing.
2. **Key Combo Recording Collisions**: Key combinations like `Alt+Tab`, `Cmd+Q`, or existing OS shortcuts must be caught and rejected before saving.
3. **Cross-Platform OS Differences**: Windows (`win32`), macOS (`darwin`), and Linux must each execute their respective shutdown/reboot/lock binaries gracefully.
4. **Window Focus deadlocks**: In Electron, hidden/transparent spotlight window must reliably gain focus on summon and release focus without freezing desktop interaction.
5. **Calculator Bad Math**: Expression `2+6%6&7` or malformed parens must return an explicit `math-error` result card, never throwing an unhandled exception or disappearing.

---

### Task 1: DuckDuckGo Priority Web Search Fallback

**Files:**
- Modify: `backend/web/search_service.py:790-890`
- Test: `tests/test_web_search_fallback.py`

**Interfaces:**
- Produces: `async def _search_ddg_html(query: str, limit: int) -> list[dict[str, Any]]` returning list of `{"title": str, "url": str, "snippet": str, "domain": str, "source": "duckduckgo"}`.

- [ ] **Step 1: Write failing unit test for DDG HTML search**

```python
# tests/test_web_search_fallback.py
import pytest
from backend.web.search_service import _search_ddg_html

@pytest.mark.asyncio
async def test_search_ddg_html_returns_results():
    results = await _search_ddg_html("python programming language", limit=5)
    assert len(results) > 0
    first = results[0]
    assert "python" in first["title"].lower() or "python" in first["snippet"].lower()
    assert first["url"].startswith("http")
    assert first["source"] == "duckduckgo"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_web_search_fallback.py -v`
Expected: FAIL (`_search_ddg_html` not defined or missing headers).

- [ ] **Step 3: Implement `_search_ddg_html` in `backend/web/search_service.py`**

Add Chromium browser headers (`Sec-Ch-Ua`, `Sec-Fetch-*`, `Referer`, `Accept`), query `https://html.duckduckgo.com/html/`, parse with `lxml.html`, extract titles, URLs (unquoting `uddg=`), and snippets. Wire into `_build_web_pool` ahead of Wikipedia fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_web_search_fallback.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/web/search_service.py tests/test_web_search_fallback.py
git commit -m "feat(web): add high-priority DuckDuckGo HTML search fallback"
```

---

### Task 2: Calculator Error Reporting

**Files:**
- Modify: `frontend/src/components/damon/calculator.js:1-55`
- Test: `frontend/tests/calculator.test.mjs`

**Interfaces:**
- Produces: `evaluateMath(query: string)` returns either `{ type: 'math', expression: string, result: string, raw: number }` or `{ type: 'math-error', expression: string, error: string }` or `null`.

- [ ] **Step 1: Write failing test for calculator error reporting**

```javascript
// frontend/tests/calculator.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMath } from '../src/components/damon/calculator.js'

test('evaluateMath returns result for valid expressions', () => {
  const res = evaluateMath('2 + 2')
  assert.equal(res?.result, '4')
})

test('evaluateMath returns error for malformed expressions like 2+6%6&7', () => {
  const res = evaluateMath('2+6%6&7')
  assert.ok(res)
  assert.equal(res?.type, 'math-error')
  assert.match(res?.error, /unsupported operator|syntax error/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/tests/calculator.test.mjs`
Expected: FAIL (`2+6%6&7` returns `null`).

- [ ] **Step 3: Implement syntax error detection in `frontend/src/components/damon/calculator.js`**

If query has math characteristics (digits + operators or starts with `=`) but fails `MATH_PATTERN` or `Function()` throws `SyntaxError`, identify invalid tokens (like `&`, `|`, mismatched parentheses) and return `{ type: 'math-error', expression: q, error: 'Syntax error: unexpected ' + token }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/tests/calculator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/damon/calculator.js frontend/tests/calculator.test.mjs
git commit -m "feat(damon): report syntax errors in calculator evaluator"
```

---

### Task 3: Cross-Platform System Actions

**Files:**
- Modify: `backend/launcher/providers/system.py:1-189`
- Modify: `frontend/src/components/CommandPalette.jsx:428-438`
- Test: `tests/test_system_provider.py`

**Interfaces:**
- Consumes: `action_id` ("shutdown", "reboot", "lock", "sleep", "volume_mute") and `payload`
- Produces: `execute(action_id: str, payload: dict[str, Any]) -> dict[str, Any]` with cross-platform handlers.

- [ ] **Step 1: Write failing test for cross-platform system execution**

```python
# tests/test_system_provider.py
import pytest
from backend.launcher.providers.system import SystemProvider

@pytest.mark.asyncio
async def test_system_provider_resolves_action_id_without_command_id():
    provider = SystemProvider()
    res = await provider.execute("shutdown", {})
    # Either succeeds or returns mock/safe dry-run without 'Missing command identifier' error
    assert res.get("error") != "Missing command identifier"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_system_provider.py -v`
Expected: FAIL (`Missing command identifier`).

- [ ] **Step 3: Implement cross-platform dispatch in `backend/launcher/providers/system.py`**

Resolve command from `payload.get("command_id") or payload.get("command") or action_id`.
Add OS checks (`sys.platform == 'win32'`, `'darwin'`, `'linux'`) and map commands:
- Windows: `shutdown /s /t 0`, `shutdown /r /t 0`, `rundll32.exe user32.dll,LockWorkStation`
- macOS: `osascript -e 'tell app "System Events" to shut down'`, `pmset displaysleepnow`
- Linux: `systemctl poweroff` -> `loginctl poweroff` -> `poweroff`
Update `CommandPalette.jsx` line 428 to pass `action_id` and payload properly.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_system_provider.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/launcher/providers/system.py frontend/src/components/CommandPalette.jsx tests/test_system_provider.py
git commit -m "fix(system): support cross-platform shutdown, restart and lock actions"
```

---

### Task 4: Independent Spotlight Window in Electron & Global Shortcut Fallback

**Files:**
- Modify: `electron/main.cjs:600-640`
- Modify: `electron/preload.cjs`

**Interfaces:**
- Produces: `spotlightWindow` instance in Electron main process, IPC handlers `desktop:toggle-spotlight`, `desktop:hide-spotlight`.

- [ ] **Step 1: Create `createSpotlightWindow()` in `electron/main.cjs`**

```javascript
function createSpotlightWindow() {
  spotlightWindow = new BrowserWindow({
    width: 820,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  spotlightWindow.on('blur', () => {
    spotlightWindow.hide();
  });
}
```

- [ ] **Step 2: Wire `toggleSpotlight` to toggle `spotlightWindow` independently**

Summon hotkey (`Alt+Shift+Space`) checks if `spotlightWindow.isVisible()`:
If visible, hide it. If hidden, position in screen center, show, focus, and notify React. Never touches `mainWindow`.

- [ ] **Step 3: Implement shortcut registration cascade with conflict check**

```javascript
const registerWithFallback = (preferred) => {
  const candidates = [preferred, 'Alt+Shift+Space', 'CommandOrControl+Shift+Space', 'Alt+Space'];
  for (const combo of candidates) {
    try {
      if (globalShortcut.register(combo, toggleSpotlight)) {
        console.log(`[Amethyst Supervisor] Registered global shortcut: ${combo}`);
        return combo;
      }
    } catch {}
  }
  return null;
};
```

- [ ] **Step 4: Expose IPC methods in `electron/preload.cjs`**

Add `hideSpotlight: () => ipcRenderer.invoke('desktop:hide-spotlight')`, `registerShortcut: (chord) => ipcRenderer.invoke('desktop:register-shortcut', chord)`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.cjs electron/preload.cjs
git commit -m "feat(electron): add independent floating spotlight window and collision-safe shortcut registration"
```

---

### Task 5: Custom Shortcut Recorder with Conflict Detection

**Files:**
- Create: `frontend/src/components/damon/ShortcutRecorder.jsx`
- Modify: `frontend/src/views/Settings.jsx` (add Daemon Shortcut card under Preferences)

**Interfaces:**
- Produces: `<ShortcutRecorder currentShortcut={shortcut} onSave={handleSave} />`
- Detects modifier keys (`Ctrl`, `Alt`, `Shift`, `Meta`) and displays live key combo pill.
- Validates against forbidden system combinations and verifies with Electron IPC / desktop API.

- [ ] **Step 1: Write ShortcutRecorder component with keyboard listener**

Records keys pressed simultaneously; formats to standard chord string (`Alt+Shift+Space`).
Validates chord has at least one modifier + key.

- [ ] **Step 2: Add conflict validation check**

Calls `window.amethystDesktop?.checkShortcutConflict?.(chord)` or warns on known reserved keys (`Cmd+Q`, `Alt+F4`, `Ctrl+C`).

- [ ] **Step 3: Wire into Settings and CommandPalette settings link**

Persist chosen shortcut to `safeStorage` and notify Electron supervisor via IPC.

- [ ] **Step 4: Verify visually and test key combinations**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/damon/ShortcutRecorder.jsx frontend/src/views/Settings.jsx
git commit -m "feat(settings): add keybinding recorder with collision validation for daemon"
```

---

### Task 6: Clean Search Bar by Default, Expand Button, Prefix Badges & Dedicated Views

**Files:**
- Modify: `frontend/src/components/damon/DamonHeader.jsx`
- Modify: `frontend/src/components/damon/daemon.css`
- Modify: `frontend/src/components/CommandPalette.jsx`
- Modify: `frontend/src/components/damon/DamonUniversalResults.jsx`
- Wire: `frontend/src/components/damon/views/YouTubeBentoView.jsx`
- Wire: `frontend/src/components/damon/views/GitHubResultsView.jsx`

**Interfaces:**
- `isBarOnly`: true when query is empty and `expandedPanel` is false.
- Prefix parsing: extracts `yt`, `gh`, `g`, `wiki` -> renders colored badge pill inside input container.
- Suggestions section: pins direct search actions at top of results list.

- [ ] **Step 1: Update `DamonHeader.jsx` for prefix badge rendering and Expand button**

Extract prefix (e.g. `yt `, `gh `) and render as an optical colored badge pill in the leading section of the input box:
- `yt`: Red badge (`#EF4444`) with play icon.
- `gh`: Purple badge (`#8B5CF6`) with code icon.
- `g`: Blue badge (`#3B82F6`) with globe icon.
- `wiki`: Slate badge (`#64748B`) with book icon.
Provide a clear Expand/Collapse button on trailing side.

- [ ] **Step 2: Update `CommandPalette.jsx` default state and auto-expand interaction**

- Initialize `compactMode = true` by default.
- Query empty & `!expandedPanel`: renders only the compact search bar (~72px height, centered).
- Typing into search input automatically switches view to show results.
- Clearing query collapses back to clean bar.

- [ ] **Step 3: Mount `YouTubeBentoView` and `GitHubResultsView`**

In `CommandPalette.jsx`:
- When active mode is `youtube` (via `yt ` prefix or tab), render `YouTubeBentoView`.
- When active mode is `github` (via `gh ` prefix or tab), render `GitHubResultsView`.

- [ ] **Step 4: Pin top search suggestions in `DamonUniversalResults.jsx`**

When in universal mode, place "Search YouTube for...", "Search GitHub for...", and "Search Web for..." directly at the top under a pinned `Quick Actions` group, eliminating the need to scroll.

- [ ] **Step 5: Render Calculator error state**

When `mathResult.type === 'math-error'`, render an inline warning row with red/amber badge displaying `Syntax error: unexpected 'token'`.

- [ ] **Step 6: Update `daemon.css` for compact pill transitions and prefix badges**

Ensure liquid glass, theme tokens, smooth height animation, and clean typography.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/damon/ frontend/src/components/CommandPalette.jsx
git commit -m "feat(ui): clean compact daemon bar by default, prefix badges, and pinned top suggestions"
```

---

### Task 7: End-to-End Verification & Desktop Build Test

- [ ] **Step 1: Run frontend tests & linter**

Run: `pnpm --filter frontend test` or `node frontend/tests/*.mjs` and `pnpm lint` if available.

- [ ] **Step 2: Run backend tests**

Run: `.venv/bin/pytest tests/test_web_search_fallback.py tests/test_system_provider.py`

- [ ] **Step 3: Verify clean build of frontend**

Run: `pnpm build` in `frontend/`.

- [ ] **Step 4: Commit and finalize**

```bash
git commit --allow-empty -m "chore(daemon): complete verification of daemon overhaul"
```
