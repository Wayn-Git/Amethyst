# Desktop Shells

How AMETHYST is launched as an application rather than a terminal server: the
Electron supervisor, the Python tray/webview shell, packaging, autostart, the
global hotkey and updates.

**Verified 2026-10-31 · commit `3c363b7` · dirty working tree.**

Related: [FRONTEND.md](../FRONTEND.md), [sections/install.md](../sections/install.md),
[DEVELOPMENT-GUIDE.md](../DEVELOPMENT-GUIDE.md).

## Two shells

Two independent desktop implementations exist. Their release relationship is
not documented in the repository; treat them as alternatives, not layers.

| Shell | Entry | Technology | Backend |
|---|---|---|---|
| Electron | `electron/main.cjs` via `package.json` | Electron 35, electron-builder, electron-updater | Spawns a Python backend child |
| Python tray | `amethyst desktop` → `backend/desktop.py` | pywebview + pystray + pynput | Runs uvicorn in-process on a thread |

Both serve the same FastAPI application and the same built frontend. The
interface detects pywebview through `window.pywebview?.api` and uses native
window controls when present.

## Electron supervisor

`package.json`:

```json
"main": "electron/main.cjs",
"dev:desktop": "cross-env ELECTRON_DEV=1 electron .",
"package:desktop": "electron-builder"
```

`electron/main.cjs` is a supervisor, not the application:

- Single-instance lock. A second launch focuses the existing window.
- Probes `/api/ping` on `AMETHYST_PORT`, then 8000 and 8001.
- If nothing answers, finds a free port and spawns the backend.
- Shows a splash window while the backend boots; 60 attempts at 500ms.
- Opens the main window at `http://127.0.0.1:<port>`.
- Keeps a tray icon and menu.
- Forwards backend stdout/stderr to `userData/logs/backend.log`.
- Kills the backend child on quit.

Backend resolution:

| Mode | Executable | Args |
|---|---|---|
| Dev (`!app.isPackaged`) | `.venv/bin/python` or `.venv/Scripts/python.exe` | `-m backend.cli serve --port … --host 127.0.0.1` |
| Packaged | `resources/bin/amethyst-backend[.exe]` | `serve --port … --host 127.0.0.1` |

The child environment sets `AMETHYST_PORT`, `AMETHYST_HOST`,
`AMETHYST_BIND_PORT`, `AMETHYST_BIND_HOST` and `AMETHYST_DESKTOP=1`.

IPC handlers: version, check updates, quit-and-install, quit, retry boot, open
external URL, set tray enabled, open logs.

GPU switches: ozone platform hint, ignore blocklist, rasterization, zero-copy,
accelerated 2D canvas and video decode. Linux disables the GPU sandbox and the
crash limit.

### Packaging

`electron-builder.yml`:

```text
appId: ai.amethyst.desktop
productName: Amethyst
output: dist-desktop
files: electron/**, frontend/dist/**, package.json
extraResources: resources/bin -> bin
publish: github (wayn-wayn/amethyst)
```

Targets:

- macOS: dmg and zip, arm64 + x64, hardened runtime.
- Windows: NSIS x64, non-one-click, choose install directory.
- Linux: AppImage and deb x64.

`electron-updater` checks GitHub releases after a delay, downloads in the
background and installs on quit. `desktop:check-updates` and
`desktop:quit-and-install` expose it to the renderer.

## Python tray shell

`backend/desktop.py` is the smaller shell. It is deliberately not a desktop
framework.

`amethyst desktop` options:

```text
--host           default 0.0.0.0 (LAN phone companion)
--port           default 8000
--hotkey         default <ctrl>+<alt>+<space>
--open           open a browser once up
--log-level      default warning
--no-window      do not open a native window
--background     start hidden (what login uses)
--install-autostart / --uninstall-autostart
--install-shortcut / --uninstall-shortcut
```

Behavior:

- Single-instance check before starting anything.
- uvicorn runs on a daemon thread in the same process.
- pywebview creates a main window and a hidden spotlight window before
  `webview.start()`; GTK only honors `hidden=True` at creation.
- pystray owns the tray icon and menu.
- A global hotkey (pynput) summons the palette. The daemon does not open the
  palette itself; it posts `/api/control/palette` and the interface decides.
  If no window is listening, it opens one.
- Closing the window hides it; Quit is the real exit.
- Autostart writes a LaunchAgent (macOS), an `HKCU\...\Run` value (Windows), or
  an XDG autostart `.desktop` entry (Linux).
- `install_shortcut` binds the chord in GNOME's own settings where possible,
  because a compositor may reserve the global grab.

The desktop command sets `AMETHYST_BIND_HOST`/`AMETHYST_BIND_PORT` before
importing the API, so `RemoteCallerGuard` sees the real bind address. Without
that, `--host 0.0.0.0` would publish the API while the guard read the loopback
default.

`pyproject.toml` exposes:

```text
amethyst-palette = backend.desktop:main_palette
amethyst-show    = backend.desktop:main_show
```

Both are thin, fast entry points for a desktop environment's own shortcut
settings.

## Choosing a shell

| Need | Shell |
|---|---|
| Packaged installer, auto-update, tray, splash | Electron |
| Single Python process, global hotkey, autostart, no Node | Python tray |
| Development with hot reload | `npm run dev` + `amethyst serve` |
| Headless server | `amethyst serve` |

Do not assume one shell starts the other. They both start the backend
themselves.

## Modification guide

| Change | Touch |
|---|---|
| Change Electron window/tray behavior | `electron/main.cjs` |
| Change packaged files or targets | `electron-builder.yml` |
| Change backend spawn | `spawnBackend`, `resolveBackendExecutable` |
| Change update flow | `electron/main.cjs`, `electron-builder.yml` publish block |
| Change tray/hotkey/autostart | `backend/desktop.py`, `backend/cli.py` |
| Change native window bridge | `backend/desktop.py` JS API, `AppTitleBar.jsx`, `CommandPalette.jsx` |
| Change desktop detection | `AMETHYST_DESKTOP`, `document.documentElement.dataset.native` |

Rules:

- Keep the backend bind on loopback in Electron.
- Keep the Python shell's bind env in sync with `RemoteCallerGuard`.
- Do not import heavy modules on the `amethyst-palette` path.
- Kill the backend child on quit; do not orphan uvicorn.
- Keep the frontend build before packaging; the backend mounts `frontend/dist`.
- Do not add a third shell without deciding which one ships.

## Known issues

- The release relationship between the Electron app and `amethyst desktop` is
  undocumented. Both can start a backend on the same port; the single-instance
  checks are per shell, not shared.
- Electron dev mode requires a populated `.venv`; a packaged build requires
  `resources/bin/amethyst-backend`.
- The Python shell defaults to `0.0.0.0`, which exposes the API to the LAN. The
  remote guard limits what an unpaired caller can do, but this is a wider
  default than `amethyst serve`.
- Autostart and global shortcuts are platform-specific and best-effort. Wayland
  may refuse a global grab; the GNOME shortcut path is the fallback.
- `electron-updater` publishes to GitHub; a fork must change `publish.owner` and
  `repo`.
- The Electron splash error screen shows only the last 20 backend log lines.

_Last verified: 2026-10-31 · commit `3c363b7` · dirty working tree._
