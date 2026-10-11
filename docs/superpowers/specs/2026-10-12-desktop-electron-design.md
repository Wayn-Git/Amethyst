# Architecture Specification: Amethyst Cross-Platform Desktop Electron Application & Auto-Update

**Date:** 2026-10-12  
**Status:** Approved  
**Scope:** Standalone Electron Desktop App (macOS, Windows, Linux), Native Splash Loading Screen, Bundled Backend Sidecar, Continuous GitHub Actions Release Pipeline, In-App Auto-Updates, and "Install Once" UI.

---

## 1. Problem Statement & User Outcome

### 1.1 Context
Previously, running Amethyst required users to clone the repository, set up a Python virtual environment, install dependencies with `uv` or `pip`, and run terminal CLI commands to start the backend and frontend servers. 

### 1.2 Target Experience
1. **Zero-Command Execution:** Users download a single installer (`.dmg` on macOS, `.exe` on Windows, `.AppImage`/`.deb` on Linux), open the application, and everything starts automatically.
2. **Native Branded Splash Window:** Upon launch, a frameless branded window appears immediately featuring the Amethyst gem emblem, an animated progress indicator, and live progress state (*"Opening your workspace..."*, *"Initializing local engine..."*).
3. **Seamless Transition:** Once the local backend responds to health probes on `127.0.0.1:8000/api/ping`, the splash window smoothly fades into the full Amethyst workspace window.
4. **Automatic Continuous Updates:** When code is pushed to `master` (or release tags), GitHub Actions builds and publishes updated installers to GitHub Releases. Running Electron instances detect new versions via `electron-updater`, download updates in the background, and prompt users to restart.
5. **"Install Once" Web View:** A high-contrast, modern landing/installation view in the web UI (and README) that provides direct downloads for Mac, Windows, Linux, and iPhone/mobile pairing instructions.

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Amethyst Desktop (Electron)                    │
│                                                                        │
│   ┌─────────────────────┐                 ┌────────────────────────┐  │
│   │   Splash Window     │                 │   Main Application     │  │
│   │   (Frameless HTML)  │ ──(Health OK)──>│   (Chromium Renderer)  │  │
│   │  "Opening workspace"│                 │    Full Amethyst UI    │  │
│   └──────────┬──────────┘                 └───────────┬────────────┘  │
│              │                                        │               │
│              │ (Poll /api/ping)                       │ (HTTP/SSE/WS) │
│              ▼                                        ▼               │
│   ┌────────────────────────────────────────────────────────────────┐  │
│   │                 Local Engine (FastAPI Backend)                 │  │
│   │                                                                │  │
│   │  • Production: Bundled `amethyst-backend` Sidecar Executable   │  │
│   │  • Development: Attached `.venv` Python daemon on :8000         │  │
│   │  • Serves API endpoints + Vite production build (`dist/`)      │  │
│   └────────────────────────────────┬───────────────────────────────┘  │
│                                    │                                  │
│   ┌────────────────────────────────┴───────────────────────────────┐  │
│   │  Persistent OS Storage:                                        │  │
│   │  macOS: ~/Library/Application Support/Amethyst                 │  │
│   │  Windows: %APPDATA%\Amethyst                                   │  │
│   │  Linux: ~/.local/share/amethyst                                │  │
│   └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     │ Periodic Check
                                     ▼
                ┌───────────────────────────────────────────┐
                │        GitHub Releases (master)           │
                │                                           │
                │  • latest.yml / latest-mac.yml            │
                │  • Amethyst-Setup-x.y.z.exe               │
                │  • Amethyst-x.y.z.dmg                     │
                │  • Amethyst-x.y.z.AppImage                │
                └───────────────────────────────────────────┘
```

---

## 3. Detailed Component Design

### 3.1 Electron Shell (`electron/`)
The Electron shell acts as a thin, secure supervisor.

- **Files:**
  - `electron/main.cjs`: Main process entry point. Manages single-instance lock, backend child process spawning, splash window creation, main window lifecycle, system tray, and auto-updater.
  - `electron/preload.cjs`: Context-isolated preload script exposing safe desktop APIs (`window.amethystDesktop = { getVersion, checkForUpdates, onUpdateDownloaded, quitAndInstall }`).
  - `electron/splash.html` & `electron/splash.css`: Frameless, high-aesthetic splash screen matching the user's reference mockup:
    - Background: `#111215` with subtle glass border (`rgba(255, 255, 255, 0.08)`).
    - Amethyst glowing faceted gem icon.
    - Title: **Amethyst**.
    - Status message line: dynamic text bound to backend probe events.
    - Interactive window close button (`×`) in upper-right corner.
    - Diagnostics & Retry button if backend startup encounters an unrecoverable error.

- **Process Supervisor Logic:**
  1. Calls `app.requestSingleInstanceLock()`. If locked, focuses the existing instance and terminates.
  2. Resolves backend executable path:
     - In packaged app: `path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'amethyst-backend.exe' : 'amethyst-backend')`.
     - In dev mode (`ELECTRON_DEV=1`): uses active `.venv/bin/python` or existing port 8000 listener.
  3. Displays `splashWindow` immediately.
  4. Probes `http://127.0.0.1:8000/api/ping` via lightweight Node HTTP request every 250ms.
  5. If no response within 1.5 seconds, spawns the backend binary with:
     - Environment: `AMETHYST_PORT=8000`, `AMETHYST_HOST=127.0.0.1`, `AMETHYST_DESKTOP=1`.
     - Data folder set to OS standard user directory.
  6. Once `/api/ping` yields `{"status":"ok"}`:
     - Initializes `mainWindow` with `show: false`.
     - Loads `http://127.0.0.1:8000` (or `http://127.0.0.1:5173` in dev mode).
     - Upon `ready-to-show`: reveals `mainWindow`, gracefully destroys `splashWindow`.
  7. On application quit (`before-quit`):
     - Sends `SIGTERM` / graceful shutdown signal to backend child process.
     - Waits up to 3 seconds for clean DB commit and task state save before `SIGKILL`.

### 3.2 Backend Sidecar Packaging (`packaging/`)
To ensure zero host dependencies:
- **PyInstaller Bundler (`packaging/amethyst-backend.spec`):**
  - Targets `backend/cli.py` or entrypoint `packaging/freeze_entry.py`.
  - Packages FastAPI, uvicorn (with standard loops and protocols), `sqlite-vec` binary extensions, anyio, starlette, pydantic, and embedded static assets.
  - Generates binary `amethyst-backend` placed into `extraResources: ["resources/bin/**"]`.
  - Python dependencies are frozen without requiring a host Python or uv installation.

### 3.3 Auto-Updates & CI/CD Release Pipeline
- **Auto-Updater Integration (`electron-updater`):**
  - Configured with `autoUpdater.setFeedURL({ provider: 'github', owner: 'wayn-wayn', repo: 'amethyst' })`.
  - Automatically runs `autoUpdater.checkForUpdatesAndNotify()` 5 seconds after application boot, and on a recurring 4-hour schedule.
  - When an update is downloaded:
    - Broadcasts IPC message to the frontend renderer.
    - Displays a non-intrusive banner in the Amethyst status bar: *"New Amethyst version ready. Click to restart."*
    - Calls `autoUpdater.quitAndInstall()` when user approves.
- **GitHub Actions Matrix Workflow (`.github/workflows/desktop-release.yml`):**
  - **Triggers:** Push to `master` branch (or release tags `v*`).
  - **Matrix:**
    - `macos-latest` -> Builds `.dmg` and `.zip` for macOS (Apple Silicon + Intel universal).
    - `windows-latest` -> Builds NSIS `.exe` installer for Windows 64-bit.
    - `ubuntu-latest` -> Builds `.AppImage` and `.deb` for Linux x64.
  - **Steps:**
    1. Check out code & setup Python 3.12 + Node 20.
    2. Install dependencies (`uv` / `npm ci`).
    3. Build frontend bundle: `npm run build --prefix frontend`.
    4. Compile PyInstaller standalone binary `amethyst-backend`.
    5. Copy compiled binary into `resources/bin/`.
    6. Run `electron-builder --publish always` using `GITHUB_TOKEN`.
    7. Creates GitHub Release containing executable installers and release metadata (`latest.yml`, etc.).

### 3.4 "Install Once" Presentation & User Onboarding
- **View (`frontend/src/views/Install.jsx`):**
  - Path: accessible via `/install` route and through the Amethyst Settings/About menu.
  - Theme: Matches user screenshot with dark glass cards:
    1. **Mac Card:** Apple icon, instructions (*"Open Amethyst and it starts the host itself. Or install with Homebrew"*), Homebrew command copy snippet, and *"Download for Mac"* button linking to latest `.dmg`.
    2. **Windows Card:** Windows icon, instructions (*"Run the Installer and Amethyst starts the host itself. The Installer isn't signed yet, so Windows asks you to confirm it once."*), and *"Download for PC"* button linking to latest `.exe`.
    3. **Linux and servers Card:** Terminal icon, instructions (*"The host, plus the desktop app when there is a display"*), `curl -fsSL https://...` install script copy snippet, and `.AppImage`/`.deb` download links.
    4. **Mobile & Pairing Card:** Smartphone icon, instructions (*"Pair iPhone or Android: scan the code from Pair Phone in the menu bar"*), with a quick QR code link for local relay pairing.
  - Dynamic Version Query: Queries GitHub API (`/repos/wayn-wayn/amethyst/releases/latest`) to always point download buttons to the latest version artifacts.

---

## 4. Security & Isolation

1. **Context Isolation:** `contextIsolation: true` and `nodeIntegration: false` enforced in all `BrowserWindow` renderers.
2. **Safe IPC:** Only whitelisted messages (updater notifications, app version, window minimize/close) are passed across the preload bridge.
3. **Localhost Restriction:** FastAPI backend listens exclusively on `127.0.0.1` and authenticates local tokens when remote relay is disabled.
4. **Sandboxed Webview:** External links clicked in markdown or chat are routed to the user's default system browser via `shell.openExternal`.

---

## 5. Verification & Acceptance Criteria

1. **Local Dev Run:**
   - `npm run dev:desktop` opens the native splash screen, detects the local backend, displays animated status messages, and loads the live Vite frontend with hot reload.
2. **Clean Packaging:**
   - Running `npm run package:desktop` generates packaged distributables.
3. **Cold Boot & Loading Screen:**
   - Launching the app cold opens the splash window, starts the backend daemon, shows progress text, and transitions smoothly into Amethyst once `/api/ping` returns 200 OK.
4. **Auto-Update Readiness:**
   - `electron-updater` logs indicate successful feed configuration against `wayn-wayn/amethyst`.
5. **No Regressions:**
   - Existing pytest suite (`pytest tests/`) passes 100%.
   - Frontend web build (`npm run build --prefix frontend`) builds without errors.
   - The web app mode (`amethyst serve`) continues to function as before.
