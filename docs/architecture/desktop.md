# The desktop application

## The question this document answers

AMETHYST used to be started by typing `amethyst serve` into a terminal and
leaving that terminal open. That makes it a website you host for yourself:
closing the window that runs it is indistinguishable from quitting it, nothing
in the application menu launches it, and the machine has no idea it exists.

This is the layer that makes it an application — a thing you launch from the
launcher, raise with a key, close without stopping, and never accidentally run
twice. It is a *shell around the existing architecture*, not a replacement for
any of it: the same FastAPI process, the same lifespan, the same SQLite file.

## The shape

One process. That is the load-bearing fact, and everything below follows from
it.

```
amethyst desktop  (backend/desktop.py, run_tray)
│
├── uvicorn on a daemon thread ──── backend.api.main:app
│                                   └── _lifespan starts every background
│                                       worker as an asyncio task: automations,
│                                       both job lanes, reminders, journal, the
│                                       relay poll, the bookmark watcher, MCP
│                                       connectors
├── two pywebview windows ───────── the application, and the spotlight bar
├── a pystray icon ──────────────── where one exists
└── the main thread ─────────────── given to GTK, which requires it
```

There is no supervisor, no second server, no IPC bus. The interface is served by
the same process that runs the agent, from `frontend/dist`, on the same port.
"Is AMETHYST running" is answerable by asking whether anything is listening on
its port.

## The lifecycle

| Stage | What implements it |
|---|---|
| Launch from the app menu | `~/.local/share/applications/amethyst.desktop`, written by `_install_xdg_assets` |
| Launch at login | `install_autostart()` → the same command with `--background` |
| Launch from a shortcut | `amethyst-show` → `POST /api/control/show` |
| Second launch | `_already_running()` hands over and exits 0 |
| Backend start | `_serve_in_thread()` |
| Backend ready | `_wait_until_serving()` then `_api_answers()` |
| WebView init | `webview.start(func=_gate)` — overlaps the backend boot |
| Window shown | `_gate` waits for the page's own `ready()`, then `_present()` |
| Close / minimise | `_hide_rather_than_close` — hides; services untouched |
| Background | the process keeps running; no runner notices |
| Restore | tray, `amethyst-show`, or a second launch — all land on `_present()` |
| Exit | tray Quit or SIGTERM → `shutdown()` |
| Backend shutdown | `stop()` → `close_control_streams()` → lifespan teardown → MCP children closed |

The split that matters: **the window's lifecycle is not the service's.** Closing
the window hides it. The agent loop, the schedules and the durable jobs go on,
because they belong to the daemon and never belonged to a window.

## Startup: what is waited for, and what is not

The rule is that nothing is ever shown before it works, and nothing is waited on
that does not have to be. No step sleeps for a fixed time.

```
startup: backend serving    at +0.11s
startup: api answering      at +0.37s
startup: interface loading  at +0.50s
startup: interface mounted  at +1.12s
```

Three real checks, in order:

1. **`server.started`.** uvicorn sets this only after the lifespan's startup has
   returned, so it already means every background runner is up and the database
   is open. It is not a proxy for readiness; it *is* readiness for the backend.
2. **`GET /api/ping` answering with its JSON.** `server.started` is a claim this
   process makes about itself. This is the claim the interface depends on: that
   a request goes in over a socket, through routing, and comes back correct.
   Deliberately the same endpoint the Docker healthcheck and the frontend's
   cold-start wake already use — a third idea of "ready" is a third thing to
   keep true.
3. **The page saying it mounted.** `frontend/src/main.jsx` calls
   `window.pywebview.api.ready()` once React has committed a tree.

Only then is the window shown. Run with `--log-level info` to see the four
stages above.

**Why mount and not paint.** A hidden window is not composited, so WebKit never
runs a `requestAnimationFrame` callback in one. Waiting for a first paint
deadlocked: the window was not shown until it painted, and could not paint until
it was shown. "Has React committed a tree" is the question actually being asked,
and `root.firstChild` answers it in a window that is not on screen.

Steps 1 and 2 are unrecoverable if they fail, and say so in the window itself
via `_ERROR_HTML` — the person who sees it launched from an icon and has no
terminal to read. Step 3 is soft: after eight seconds the window is shown
anyway, because by then the interface owns the problem and has its own "the
backend is down" state, which is a better thing to show than a window that never
appears.

**What is not waited for:** the icon and `.desktop` install, the hotkey grab, the
tray icon, and the MCP connectors (already a background task in the lifespan).
These run on a setup thread while uvicorn boots.

## Single instance

The listening socket is the lock. Binding the port is already an atomic,
kernel-held mutex, released on crash, never stale — and it is the actual
contended resource, because two servers on one SQLite file is the thing that
must never happen. A lock file would guard something else and still could not
raise a window.

What a port alone cannot say is *who* holds it. `POST /api/control/show` answers
that, and `_already_running()` reads the reply:

| Probe result | Meaning | What happens |
|---|---|---|
| connection refused | the port is free | this launch boots |
| `{"native": ≥1}` | a desktop shell with windows | it raised them; exit 0 |
| `{"native": 0}` | a bare `amethyst serve` | nothing to raise; open a browser |
| non-JSON reply | somebody else's server | a readable error; exit 1 |

If `_wait_until_serving` later fails, the probe runs again before calling it a
failure — losing a race to another launch looks exactly like failing to start,
because the symptom is the same.

## The control channel

`POST /api/control/{action}`, with an allowlist of exactly `palette` and `show`.
It is reachable by anything that can open a loopback socket, so "whatever the
caller typed" is not a set worth dispatching on.

Each action fans out two ways:

- to every open **browser tab**, over the SSE stream at `/api/control/stream`;
- to every in-process **native window**, through `on_control(action, callback)`.

A tab can only be told; a window this process owns can be raised. The reply
distinguishes them — `delivered` counts everything, `native` counts only real
windows — and that distinction is the whole single-instance mechanism.

The body may carry `token`, the compositor's activation token, forwarded from
the process the shortcut actually launched. GNOME grants focus to the window
whose token it issued, and that token belongs to `amethyst-show`, not to the
daemon. Without it a summoned window comes up *behind* what you were looking at.

## The two windows

Both are created before `webview.start()`, and that is not stylistic:
pywebview's GTK backend only honours `hidden=True` while the GTK loop is not yet
running, so a window created later appears on screen whatever the flag says.
Creating the spotlight lazily is therefore off the table.

Both are created blank and navigated by `_gate` once the server answers. GTK and
WebKit initialise while the backend is still importing, and a window that exists
before there is anything to put in it is also the window a startup failure can
be *reported* in.

### The JavaScript bridge

`_SpotlightBridge` is the only thing the page may ask of the process that owns
its window: `hide`, `open_main`, `open_external`, `ready`. Everything the
palette actually *does* it does over the API like any other client.

**Every attribute on it is underscore-prefixed, and that is load-bearing.**
pywebview builds the JS API by walking `dir()` of the object and *recursing into
any public attribute that is a non-callable object* (`webview/util.py`,
`get_functions`). A plain `self.main = <Window>` therefore exposed the entire
Window API — `destroy`, `load_url`, `evaluate_js` — and the GTK widget beneath
it, to any script the page loads. It also produced a 300KB `_createApi` call
that crashed the bridge outright. `tests/test_desktop.py` pins the surface.

## Closing

`_hide_rather_than_close` is wired to every window's `closing` event.

**Returning `False` is what cancels the close.** That reads backwards and is
worth stating once: pywebview's `Event.set` collects every handler's return
value and cancels if any is exactly `False` (`webview/event.py`), so `False`
means "no, do not close" rather than "no, do not cancel".

Cancelling is only half of it. The handler must also hide the window — a
cancelled destroy with nothing else done leaves the window exactly where it was,
which is a close button that appears dead.

Quitting sets `_QUITTING` first, which is how the one real close gets through.

## The global shortcut

Two console scripts, both stdlib-only and both measured: `backend.cli` imports
the director, the tool registry and the database layer at module scope, about a
quarter of a second, and these run on a keystroke whose whole job takes two
milliseconds.

- **`amethyst-show`** — raise the application window.
- **`amethyst-palette`** — open the spotlight bar.

Either starts the daemon if nothing is running, and neither can create a second
instance.

**On X11, Windows and macOS** the in-process grab works: `_start_hotkey` uses
`pynput`, default `<ctrl>+<alt>+<space>`.

**On Wayland it cannot.** The compositor refuses application key-grabs by
design, and pynput does not fail honestly there — its X11 backend attaches to
XWayland, sees only what X clients type, and the grab appears to succeed and
then never fires. `_hotkey_unavailable_reason` refuses up front, because
promising a hotkey that silently does nothing is worse than saying there is not
one.

The route there is the desktop environment's own shortcut settings:

```
amethyst desktop --install-shortcut                           # GNOME, via gsettings
amethyst desktop --hotkey '<ctrl>+<alt>+a' --install-shortcut # and save the choice
amethyst desktop --uninstall-shortcut
```

This is deliberately an explicit command and not something a launch does by
itself: it writes into the user's own keybinding list, it can collide with a
chord they already use, and doing it on every start would silently restore one
they had removed. Outside GNOME it prints the command to bind by hand.

The chord is stored in `app_settings` under `desktop.hotkey`
(`load_hotkey`/`save_hotkey` in `backend/config.py`), so it survives a restart.

## The icon

`_ICON_CANDIDATES` picks the best available file from `frontend/public`, best
first: `icon.png`, `logo.png`, `logo.svg`, `favicon.svg`.

`icon.png` is the real one — a purpose-made 512×512 app icon drawn to be read at
dock size. `favicon.svg` is last and was once first, which meant the desktop
application wore a mark that appears nowhere else in the product.

On GNOME Wayland, `set_icon_from_file` is ignored for the dock and the alt-tab
switcher. The compositor resolves the icon by matching the window's `app_id`
(GTK derives it from `argv[0]`, so `amethyst`) against a `.desktop` file and
reading its `Icon=` field. `_install_xdg_assets` therefore writes both: a
256×256 PNG into the hicolor theme, and an entry with `Icon=amethyst` and
`StartupWMClass=amethyst`.

**`Exec=` must be absolute.** A desktop entry is run by the session with an
arbitrary working directory, so `Exec=.venv/bin/amethyst desktop` — which is
what `sys.argv[0]` gives from a checkout — is a launcher icon that silently does
nothing. `_launcher_command()` prefers the console script on PATH and
absolutises otherwise.

## Development versus launching

| | Command | For |
|---|---|---|
| **Application** | `amethyst desktop` | how it is meant to be run |
| | `amethyst-show` / `amethyst-palette` | raise it |
| **Development** | `amethyst serve` | the server alone, with the log in front of you |
| | `./run.sh --dev` | Vite on :5173 with hot reload, API on :8000 |

`amethyst serve` remains, and now refuses to start a second server against a
running instance rather than failing to bind. It is a development command; it is
not how the application is launched.

## The phone companion

Nothing here changes it, and that is the point. The relay poller is
`_instagram.start()` in the same lifespan, so `amethyst desktop` runs it exactly
as `amethyst serve` did. Pairing, the QR code and the mobile shell are unchanged
— see [ADR-0024](decisions/0024-multi-device-sync.md).

The relay itself is a Cloudflare Worker and is deployed separately; the desktop
application does not start it and never did.

## What is deliberately not here

- **No supervisor or process manager.** One process is the architecture; a
  second worker would duplicate every in-process runner against one SQLite file.
- **No reconnect machinery for "backend restarts".** The backend is *in* this
  process and cannot restart without the shell restarting. `frontend/src/api.js`
  already handles the case that genuinely exists — a browser tab against a
  stopped server.
- **No WebView state serialisation.** `hide()`/`show()` on a GTK window does not
  touch the WebKit view; state survives for free.
- **No splash screen.** The windows are hidden until ready, so there is nothing
  to put one on, and it would cost a second WebKit load.
- **No `/api/ready`.** `server.started` and `/api/ping` already answer it.
