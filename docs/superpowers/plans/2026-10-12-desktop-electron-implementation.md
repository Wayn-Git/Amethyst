# Amethyst Desktop Electron Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Amethyst into a standalone cross-platform Electron desktop application (macOS, Windows, Linux) featuring an OpenMaus-styled native splash loading screen, bundled backend sidecar supervision, GitHub Actions automated release pipeline on pushes to `master`, in-app auto-updates, and an "Install Once" onboarding view matching the provided design.

**Architecture:** Electron acts as a secure process supervisor that immediately presents a frameless splash window, verifies/spawns the local FastAPI engine (`amethyst-backend`), transitions seamlessly to the main window once `/api/ping` answers, checks for updates in the background via `electron-updater`, and integrates with system tray and global hotkeys.

**Tech Stack:** Electron 35+, electron-builder, electron-updater, Python 3.12 (PyInstaller), React 19, Vite 8, Tailwind/Vanilla CSS.

**Spec:** `docs/superpowers/specs/2026-10-12-desktop-electron-design.md`

## Global Constraints
- Must not require user terminal commands to start or operate in production.
- Production package must embed the local backend sidecar with persistent user data in OS standard app data paths.
- Single-instance lock enforced: second launch focuses the running window.
- Window close hides to tray; quit from tray/Cmd+Q cleanly shuts down the backend child process.
- Context isolation enabled, node integration disabled, safe IPC bridge in `preload.cjs`.
- Preserves 100% existing functionality, web app compatibility, and pytest suite passes.

## Review Focus
- Port 8000 already occupied by an unrelated or stale process -> Display diagnostic error card with retry button in splash screen instead of hanging indefinitely.
- Backend child process termination on app exit -> Graceful SIGTERM with 3s timeout before SIGKILL to avoid orphaned background processes.
- Offline boot -> App boots local engine and loads interface cleanly without failing on update checks.
- macOS/Windows permission prompts on first launch -> Copy in installer cards clearly explains confirmation steps.
- Auto-update downloaded while user is actively working -> Do not force restart; display subtle status toast offering "Restart to update".

---

### Task 1: Electron Root Configuration & Dependencies

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`
- Test: `tests/test_desktop_packaging.py`

**Interfaces:**
- Produces: `package.json` scripts (`dev:desktop`, `package:desktop`, `build:all`) and root devDependencies for Electron, electron-builder, and electron-updater.

- [ ] **Step 1: Write the test verifying package.json and electron-builder configuration**

```python
def test_electron_package_json_configuration():
    import json
    from pathlib import Path

    pkg_path = Path("package.json")
    assert pkg_path.exists()
    pkg = json.loads(pkg_path.read_text())
    assert "electron" in pkg.get("devDependencies", {}) or "electron" in pkg.get("dependencies", {})
    assert "electron-builder" in pkg.get("devDependencies", {})
    assert "electron-updater" in pkg.get("dependencies", {})
    assert "dev:desktop" in pkg.get("scripts", {})
    assert "package:desktop" in pkg.get("scripts", {})

    builder_cfg = Path("electron-builder.yml")
    assert builder_cfg.exists()
    content = builder_cfg.read_text()
    assert "appId: ai.amethyst.desktop" in content
    assert "publish:" in content
    assert "provider: github" in content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_desktop_packaging.py -v`  
Expected: FAIL (file or scripts missing)

- [ ] **Step 3: Update `package.json` and create `electron-builder.yml`**

Add `electron`, `electron-builder`, `electron-updater`, and `cross-env` to root `package.json`. Configure `electron-builder.yml` targeting macOS (dmg/zip), Windows (nsis), and Linux (AppImage/deb) with `extraResources` mapping `resources/bin/**`.

- [ ] **Step 4: Install npm dependencies and run test**

Run: `npm install --save-dev electron electron-builder cross-env && npm install --save electron-updater && .venv/bin/pytest tests/test_desktop_packaging.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json electron-builder.yml tests/test_desktop_packaging.py
git commit -m "feat(desktop): configure electron, electron-builder, and packaging scripts"
```

---

### Task 2: Frameless Splash Loading Screen

**Files:**
- Create: `electron/splash.html`
- Create: `electron/splash.css`
- Create: `electron/assets/amethyst-gem.svg`
- Test: `tests/test_splash_assets.py`

**Interfaces:**
- Produces: Standalone, zero-dependency HTML/CSS splash window matching the OpenMaus reference mockup with glowing Amethyst emblem, animated spinner, status progress text, close button, and error state card.

- [ ] **Step 1: Write the test for splash screen structure and assets**

```python
def test_splash_screen_structure():
    from pathlib import Path

    splash_html = Path("electron/splash.html")
    assert splash_html.exists()
    content = splash_html.read_text()
    assert 'class="splash-card"' in content
    assert 'id="splash-status"' in content
    assert 'id="splash-close"' in content
    assert 'id="splash-retry"' in content
    assert "Opening your workspace..." in content

    splash_css = Path("electron/splash.css")
    assert splash_css.exists()
    css_content = splash_css.read_text()
    assert "--gem-glow" in css_content or "box-shadow" in css_content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_splash_assets.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement `splash.html`, `splash.css`, and gem SVG**

Create high-fidelity dark splash screen in `electron/` featuring the faceted Amethyst gem, subtle pulsing glow, rounded card boundary, interactive close button, and status text updater (`window.updateStatus(text)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_splash_assets.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/splash.html electron/splash.css electron/assets/ tests/test_splash_assets.py
git commit -m "feat(desktop): add native dark splash loading screen and assets"
```

---

### Task 3: Electron Main Supervisor, Preload Bridge, and Lifecycle

**Files:**
- Create: `electron/main.cjs`
- Create: `electron/preload.cjs`
- Modify: `tests/test_desktop_packaging.py`
- Test: `tests/test_desktop_supervisor.py`

**Interfaces:**
- Produces: Electron main process managing single-instance lock, backend probing/spawning, splash-to-main window transition, tray icon, and graceful child process shutdown. Exposes `window.amethystDesktop` via contextBridge.

- [ ] **Step 1: Write test verifying main process lifecycle logic**

```python
def test_main_process_logic_and_preload():
    from pathlib import Path

    main_cjs = Path("electron/main.cjs")
    assert main_cjs.exists()
    content = main_cjs.read_text()
    assert "requestSingleInstanceLock" in content
    assert "/api/ping" in content
    assert "amethyst-backend" in content
    assert "before-quit" in content
    assert "autoUpdater" in content

    preload_cjs = Path("electron/preload.cjs")
    assert preload_cjs.exists()
    preload_content = preload_cjs.read_text()
    assert "contextBridge.exposeInMainWorld('amethystDesktop'" in preload_content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_desktop_supervisor.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement `electron/main.cjs` and `electron/preload.cjs`**

Implement complete supervisor:
- Single-instance handling: refocuses active window on duplicate launch.
- Splash window initialization and `/api/ping` polling loop.
- Sidecar spawn: resolves binary in `process.resourcesPath/bin` (or launches `.venv/bin/python -m backend.cli serve` in dev).
- Main window creation (1280x820, `show: false`, contextIsolation: true).
- Clean transition on healthy `/api/ping`.
- System tray with "Show Amethyst", "Check for Updates", and "Quit".
- Graceful backend termination on app exit.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_desktop_supervisor.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main.cjs electron/preload.cjs tests/test_desktop_supervisor.py
git commit -m "feat(desktop): implement electron main supervisor, lifecycle, and preload bridge"
```

---

### Task 4: PyInstaller Standalone Sidecar Packaging

**Files:**
- Create: `packaging/freeze_entry.py`
- Create: `packaging/amethyst-backend.spec`
- Create: `scripts/build_backend_binary.py`
- Test: `tests/test_freeze_configuration.py`

**Interfaces:**
- Consumes: `backend/cli.py` and `backend/api/main.py`.
- Produces: Standalone binary `amethyst-backend` ready for placement into `resources/bin/`.

- [ ] **Step 1: Write test for PyInstaller spec and freeze entrypoint**

```python
def test_freeze_configuration():
    from pathlib import Path

    entry = Path("packaging/freeze_entry.py")
    assert entry.exists()
    content = entry.read_text()
    assert "uvicorn" in content
    assert "backend.api.main" in content

    spec = Path("packaging/amethyst-backend.spec")
    assert spec.exists()
    spec_content = spec.read_text()
    assert "Analysis(" in spec_content
    assert "hiddenimports" in spec_content
    assert "uvicorn.logging" in spec_content
    assert "sqlite_vec" in spec_content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_freeze_configuration.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement `freeze_entry.py`, `amethyst-backend.spec`, and build script**

Implement dedicated freeze entrypoint that sets up multiprocessing support, binds to `AMETHYST_HOST` / `AMETHYST_PORT`, configures static frontend mounts from bundled paths, and initializes SQLite vector extensions.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_freeze_configuration.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packaging/ scripts/build_backend_binary.py tests/test_freeze_configuration.py
git commit -m "feat(packaging): add pyinstaller spec, freeze entrypoint, and binary build script"
```

---

### Task 5: GitHub Actions Automated Release CI Workflow

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Test: `tests/test_ci_workflow.py`

**Interfaces:**
- Produces: Continuous automated release pipeline triggered on push to `master` (or tags `v*`) that compiles binaries across macOS, Windows, and Linux, packages installers with electron-builder, and publishes them to GitHub Releases.

- [ ] **Step 1: Write test verifying GitHub Actions workflow configuration**

```python
def test_desktop_release_workflow():
    from pathlib import Path
    import yaml

    wf_path = Path(".github/workflows/desktop-release.yml")
    assert wf_path.exists()
    wf = yaml.safe_load(wf_path.read_text())
    assert "push" in wf["on"]
    assert "master" in wf["on"]["push"]["branches"]
    assert "matrix" in wf["jobs"]["release"]["strategy"]
    os_list = wf["jobs"]["release"]["strategy"]["matrix"]["os"]
    assert any("macos" in o for o in os_list)
    assert any("windows" in o for o in os_list)
    assert any("ubuntu" in o for o in os_list)
    assert "electron-builder --publish always" in str(wf)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_ci_workflow.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement `.github/workflows/desktop-release.yml`**

Define multi-OS matrix release workflow with steps for dependency caching, frontend building (`npm run build --prefix frontend`), PyInstaller compilation, and electron-builder packaging with release publishing.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_ci_workflow.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/desktop-release.yml tests/test_ci_workflow.py
git commit -m "ci: add cross-platform desktop release workflow on push to master"
```

---

### Task 6: "Install Once" Presentation View & Mobile Pairing

**Files:**
- Create: `frontend/src/views/Install.jsx`
- Create: `frontend/src/styles/install.css`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/views/registry.js`
- Test: `tests/test_install_view.py`

**Interfaces:**
- Produces: Dedicated `/install` route in the web UI matching the user's reference mockup with high-contrast dark cards for Mac, Windows, Linux, and iPhone/Mobile pairing, automated GitHub Releases download resolution, and copy-to-clipboard commands.

- [ ] **Step 1: Write test verifying Install view exists and is registered**

```python
def test_install_view_registered():
    from pathlib import Path

    install_jsx = Path("frontend/src/views/Install.jsx")
    assert install_jsx.exists()
    content = install_jsx.read_text()
    assert "Install once." in content
    assert "Download for Mac" in content
    assert "Download for PC" in content
    assert "codyinc-host" in content or "amethyst-host" in content or "Linux and servers" in content
    assert "Pair iPhone" in content or "Download on the App Store" in content

    registry_js = Path("frontend/src/views/registry.js")
    assert "install" in registry_js.read_text().lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_install_view.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement `Install.jsx`, `install.css`, and register route**

Implement the Install page with rich dark aesthetics, platform cards, copyable install commands (`brew install --cask amethyst`, `curl -fsSL https://amethyst.sh/install.sh`), dynamic GitHub release download links, and mobile QR pairing instructions. Register in `registry.js` and `App.jsx`.

- [ ] **Step 4: Verify frontend build and run test**

Run: `npm run build --prefix frontend && .venv/bin/pytest tests/test_install_view.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Install.jsx frontend/src/styles/install.css frontend/src/App.jsx frontend/src/views/registry.js tests/test_install_view.py
git commit -m "feat(ui): add install once download cards and mobile pairing view"
```

---

### Task 7: Full System Integration, Verification & Test Suite

**Files:**
- Modify: `README.md`
- Run: Full pytest suite & frontend build

**Interfaces:**
- Validates: Zero regressions across existing features, clean build of all assets, and full documentation for running and packaging desktop Amethyst.

- [ ] **Step 1: Run comprehensive backend test suite**

Run: `.venv/bin/pytest tests/`  
Expected: All tests pass.

- [ ] **Step 2: Run frontend production build**

Run: `npm run build --prefix frontend`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Update README with Desktop App instructions and screenshots**

Update README with desktop installation options (Mac, Windows, Linux) and developer instructions (`npm run dev:desktop`).

- [ ] **Step 4: Final commit and push to master**

```bash
git add README.md
git commit -m "docs: document cross-platform electron desktop installation and usage"
git push origin dev
git checkout master && git merge dev -m "feat(desktop): complete cross-platform electron app and auto-update release system"
git push origin master
git checkout dev
```
