# Phase 07 — Desktop: Electron shell over the existing daemon

Depends on: none. Independent track — runs parallel with any other phase,
blocks nothing, and nothing else waits on it.
Reads: `00-INDEX.md` + this file. `backend/desktop.py` is a read-only
reference for this phase (Task 0 decides whether it gets amended or retired —
until that decision, touch nothing in it).

Scope: decide whether the window layer moves from pywebview to Electron, and
if so implement it in tiers *on top of the daemon that already exists*. No
backend rewrite, no web removal, no bundled runtimes until a later tier says
so explicitly.

---

## Why (current state — read this first)

The question this phase came from was "how do I keep the Python backend
alive when I close the app, and will a loading screen work". Both are already
solved in this repository. The desktop exists:

`backend/cli.py:2162` — `amethyst desktop`, help text: *"launch AMETHYST
(this is how it is meant to be run)"*. It is a 1548-line tray daemon:

| Piece | Where | What it does |
| :--- | :--- | :--- |
| Daemon | `desktop.py:1270 run_tray` | uvicorn on a background thread in the same process — one thing to start, one to kill |
| Single instance | `desktop.py:1225 _already_running` | second launch reports the running one instead of double-starting |
| Self-healing start | `desktop.py:65 _launch_desktop_daemon` | palette hotkey path: nothing listening ⇒ spawn `amethyst desktop` detached, retry once |
| Loading screen | `desktop.py:1017 _build_windows` + `:1442 _gate` | both windows created **blank** before `webview.start()`; `_gate` polls until the server answers, then navigates; unrecoverable boot failure is reported *in the window* via `load_html` |
| Readiness probe | `desktop.py:327 _api_answers` | raw-socket `GET /api/ping`, expects `{"status":"ok"}` — deliberately the same probe the Docker healthcheck and the frontend cold-start wake use (`main.py:1378`) |
| Windows | `desktop.py:1017` | pywebview main window (1180×800) + frameless on-top spotlight palette (760×520); both **hide rather than close** (`:960`, `_QUITTING` at `:44`) — closing the window is "put away", not "quit" |
| Tray / hotkey / autostart | `pystray`, `:528 install_shortcut`, `:427 install_autostart` | tray icon says it is on and is where quit lives; `<ctrl>+<alt>+<space>` summons the palette from anywhere |
| Window-agnostic control | `main.py:1454 /api/control/stream`, `main.py:1490 /api/control/{action}` | the daemon nudges *whatever window is listening* — `palette`, `show_main` |
| Browser mode | `cli.py --no-window` / `--background` | same daemon, no pywebview window |

So: **backend lifetime is already decoupled from any window**, and a loading
screen pattern already exists. This phase is not about solving those — it is
about deciding whether the *window renderer* should become Electron, and if
so, what that actually costs.

### What Electron would add (the honest case)

| Electron buys | Electron costs |
| :--- | :--- |
| Chromium renderer instead of WebKitGTK — one less engine to test the interface against | A second runtime in the product: Node alongside Python. Today the desktop is Python-only (`pywebview`, `pystray` in `pyproject.toml:65-71`) |
| `electron-builder` installers + `electron-updater` auto-update | The Python packaging problem (Tier 3) is **unchanged** — freezing the backend is required either way, or the user keeps `uv` installed |
| Richer native surface: real menus, dialogs, notifications, `globalShortcut` | Overlaps the working 1548-line `desktop.py` — two window implementations cannot both be canonical |
| Familiar web-dev tooling for the shell itself | Chromium + Electron download weight (~200 MB vs pywebview using the OS webview) |

The pywebview path is not broken. It is the *reference implementation* of
everything the shell must do. Electron only wins if the renderer or
distribution story justifies the second runtime — that is Task 0's decision,
recorded before any code.

---

## Development loop (does HMR still work? yes)

| Edit | Today (web) | With Electron |
| :--- | :--- | :--- |
| React / CSS | Vite HMR on `127.0.0.1:5173` | **Identical** — the window loads the same URL in dev |
| Python backend | restart the daemon (or `amethyst serve --reload` for pure web work) | **Identical** — same daemon, same port |
| Electron shell itself | — | relaunch the app (`electronmon` if it becomes annoying) |

The plumbing already matches: `frontend/vite.config.js` proxies `/api` (and
`ws: true`) to `http://127.0.0.1:8000` with a keep-alive-disabled agent for
SSE — Electron → Vite → daemon is the same path the browser uses today.

In production the window loads `http://127.0.0.1:8000` directly: the backend
already serves the built interface (`main.py:8293 _mount_frontend`). **No
frontend change is required for any tier of this phase.**

Port note: `8000` is the single writer (`desktop.py:51 DEFAULT_PORT`, CLI
`--port` default, Vite proxy target). A dev daemon and the Electron-attached
daemon are the same process — never run two.

---

## Lifecycle & loading screen (the two questions, answered)

Model — attach first, spawn only when nothing answers:

```
app ready
  ├─ _api_answers(8000)?          ← desktop.py:327 probe, /api/ping
  │    ├─ yes → attach: window loads http://127.0.0.1:8000   (instant, no boot)
  │    └─ no  → spawn `amethyst desktop --background` detached   (start_new_session,
  │              same as desktop.py:65)                           like desktop.py:65
  │              show startup window (blank + spinner: "Starting AMETHYST…")
  │              poll /api/ping until {"status":"ok"}  (~1–2 s)
  │              navigate; on 30 s timeout → failure card with Retry
  └─ main window ready

window closed → daemon keeps running (hide semantics — Electron mirrors
                 desktop.py's hide-not-close; quit lives on the tray / Cmd+Q)

app quit → nothing to kill if attached; if WE spawned the daemon, leave it
           (it is the daemon — same choice `desktop.py` makes) unless the
           user chose "Quit daemon too"
```

Edge cases:

| Situation | Handling |
| :--- | :--- |
| Stale half-dead listener on 8000 | `/api/ping` distinguishes *listening* from *answering correctly* — socket accepts but wrong JSON ⇒ report, offer "restart daemon" (control action), don't hang |
| Second app launch | `app.requestSingleInstanceLock()` → focus existing window (mirrors `_already_running`) |
| Daemon dies while window open | child `exit` / stream close → "backend stopped" overlay with relaunch (same as the browser when the server goes away) |
| Backend edits during dev | restart daemon; the thread-in-process model has no `--reload` path today — do not invent one in this phase |
| Hotkey / tray | stay Python-side in Tier 1–2 (spawn `--background`: tray + `<ctrl>+<alt>+<space>` keep working; the window learns about `palette`/`show_main` by subscribing to `/api/control/stream` like any client). Porting them to Electron is a *later decision*, not a Tier 1 task |

---

## Tiers and estimates

| Tier | Deliverable | Effort | Gate |
| :--- | :--- | :--- | :--- |
| **1** | Dev shell: Electron window loads `:5173` (full HMR), attach-or-spawn daemon, startup window on cold boot | **2–4 h** | Task 0 says go |
| **2** | Local installer: `electron-builder` (Linux first — this is the dev machine), icon, single-instance, window state; requires `uv`/`amethyst` on the user's PATH | 1–2 days | Tier 1 verified daily-usable |
| **3** | Self-contained backend: PyInstaller freeze of the FastAPI app — hidden imports (uvicorn, anyio, sqlite-vec), frozen paths, `freeze_support` | 2–4 days of tail-debugging | Explicitly requested; MCP subprocess caveat below applies |
| **4** | Distribution: auto-update, signing, CI ×3 OS | +1–3 days | Never automatic — its own go/no-go |

**Tier 3 caveat (record it now so nobody is surprised):** MCP servers are
runtime subprocesses (`node`, `uvx`…). Freezing Python does not ship Node.
A frozen app either documents "needs Node + uv on the machine" or bundles
those runtimes (expensive, its own phase). OpenMausBot is Node
all-the-way-down and never faces this; amethyst is Python and must.

Practical milestones: **your machine → Tier 1+2 ≈ 1–3 days total.**
Tier 3+4 only if a public non-Python audience appears.

---

## Task 0 — Decision gate (before any code)

Write the decision at the top of this file under `## Decision (Task 0)`:

1. Audit the pywebview surface you would be replacing — list which of the
   table pieces above the Electron shell must *replicate in Tier 1–2* (window,
   gate/loading, attach/spawn) vs *keep Python-side* (tray, hotkey, autostart,
   control plane). Default: keep Python-side.
2. Answer: does Chromium-renderer + installer story justify a second runtime?
   If no — record "keep pywebview", update the registry, stop. That is a
   successful phase outcome (the audit itself was the deliverable).
3. If go: record which Tier is in scope (must include 1; name 2 explicitly;
   3/4 require a separate approval).

Files: this file (decision section), `00-INDEX.md` (registry).

## Task 1 — Tier 1 dev shell

- `package.json`: add `dev:desktop` script + `electron` devDependency.
- `electron/main.mjs`: single-instance lock → attach-or-spawn (Task 3's
  order) → startup window until ping → BrowserWindow.
  - Dev URL: `http://127.0.0.1:5173` (Vite must be running; document the
    two-terminal workflow).
  - `dev:desktop` may start Vite as a child if that is less friction — one
    less terminal — but never the daemon implicitly; spawn rules live in one
    module.
- Keep the shell thin: no business logic, no API calls beyond the ping probe
  and the control-stream subscription.

Files: `electron/main.mjs`, `package.json`. No `backend/` changes.

## Task 2 — URL policy

- `ELECTRON_DEV=1` (set by `dev:desktop`) → `:5173`; otherwise → `:8000`.
- Startup window content: plain HTML + spinner, no framework, no build step.
- Failure card after timeout: show the probe's actual result (connection
  refused / wrong JSON / timeout) — the `main.py:1378 /api/ping` docstring
  already explains why this probe and not `/api/health` (health surveys every
  provider over the network; ping touches nothing).

Files: `electron/*`.

## Task 3 — Lifecycle wiring

- Implement the attach-first flow above, reusing `desktop.py`'s contracts by
  calling them, not re-implementing: probe shape = `_api_answers`, spawn argv
  = `_launch_desktop_daemon`'s (`amethyst desktop --background --port …`,
  `start_new_session=True`).
- Subscribe `/api/control/stream`; on `show_main` / `palette` actions focus
  the window / show the palette overlay as appropriate — parity with
  `_toggle_spotlight` / `_show_main` (`desktop.py:1411,1421`).
- Quit semantics: window close hides (restore from tray/`show_main`); real
  quit from tray or Cmd+Q. If this session spawned the daemon, offer quit of
  the daemon as an explicit menu item — never silently kill a daemon the
  user may be using from the browser.

Files: `electron/main.mjs`. No `backend/` changes expected; if a control
action is missing for Electron to consume, record it as a finding rather
than adding backend routes ad hoc.

## Task 4 — Tier 2 packaging (gate: Task 1 used daily first)

- `electron-builder.yml`: Linux (AppImage/deb) first — mirrors
  `directories.buildResources` conventions; add other OS later.
- PATH detection: packaged app must find `amethyst` or `uv`; missing ⇒
  first-run card with the install command, not a silent crash.
- Icon: reuse assets installed by `_install_xdg_assets` (`desktop.py:797`).

Files: `electron-builder.yml`, `build/`, `package.json`.

---

## Non-goals

- **Removing or amending `backend/desktop.py`** until Task 0 explicitly
  retires it. Test before decommission (index hard rule 2) applies to the
  pywebview window the same way it applies to connectors.
- Removing the web version — Electron is a wrapper; the browser keeps working.
- Rewriting the backend, or moving tray/hotkey/autostart to Electron
  (revisit only after Tier 2 is the daily driver).
- Tiers 3–4 (PyInstaller, auto-update, signing, CI) without a separate
  approval — see gates in the estimates table.
- Bundling Node/MCP runtimes.
- macOS/Windows support in Tier 2 (Linux first; the other two are Tier 4
  territory).
- Backend `--reload` in the thread-in-process daemon.

## Verify

```bash
# web untouched by anything in this phase
uv run pytest tests/ -x -q
cd frontend && npm run lint

# Tier 1 shell (two terminals: Vite, then Electron)
cd frontend && npm run dev
npm run dev:desktop
#   - window shows the spinner, then the app
#   - edit src/App.jsx → window updates without relaunch (HMR)
#   - quit the app, relaunch → attaches instantly (no spinner on warm daemon)
#   - kill the daemon → window shows the stopped overlay, relaunch recovers

# no orphans after quit
pgrep -af "electron|amethyst desktop"   # after quit: expected empty (or daemon only, if left running deliberately)
```

## Done when

- [ ] `## Decision (Task 0)` written in this file: go/no-go, and if go, the
      Tier scope. Registry row updated either way.
- [ ] Tier 1: cold boot shows the loading window until `/api/ping` answers;
      warm attach skips it.
- [ ] HMR works through the Electron window (edit → visible, no relaunch).
- [ ] Quit leaves the process table in the agreed state (documented in the
      decision: daemon stays / daemon dies with last window).
- [ ] Web version, `amethyst desktop` (pywebview) and `amethyst serve` all
      still work — nothing removed.
- [ ] `uv run pytest tests/ -x -q` and `cd frontend && npm run lint` green
      (this phase should not touch either; green proves it).
