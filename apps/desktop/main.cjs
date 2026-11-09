const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

let activePort = parseInt(process.env.AMETHYST_PORT || '8000', 10);
const IS_DEV = process.env.ELECTRON_DEV === '1' || !app.isPackaged;

// Hardware acceleration & GPU stability
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
}

let mainWindow = null;
let splashWindow = null;
let spotlightWindow = null;
let currentRegisteredShortcut = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let pingInterval = null;
let trayEnabled = true;

function getLogsDir() {
  const userData = app.getPath('userData');
  const logsDir = path.join(userData, 'logs');
  const fs = require('fs');
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {}
  }
  return logsDir;
}

let logStream = null;
const recentLogs = [];
const MAX_RECENT_LOGS = 30;

function appendBackendLog(chunk) {
  const text = chunk.toString();
  for (const line of text.split('\n')) {
    if (line.trim()) {
      recentLogs.push(line.trim());
      if (recentLogs.length > MAX_RECENT_LOGS) {
        recentLogs.shift();
      }
    }
  }
  try {
    if (!logStream) {
      const fs = require('fs');
      const logFile = path.join(getLogsDir(), 'backend.log');
      logStream = fs.createWriteStream(logFile, { flags: 'a' });
    }
    logStream.write(chunk);
  } catch {}
}

// Enforce single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (splashWindow) {
      splashWindow.focus();
    }
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

function probeApiPing(port = activePort) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: port,
        path: '/api/ping',
        timeout: 1000,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (parsed.status === 'ok') {
              resolve(true);
            } else {
              resolve(false);
            }
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findAvailablePort(startPort = 8000) {
  let port = startPort;
  while (port < startPort + 50) {
    const inUse = await isPortInUse(port);
    if (!inUse) return port;
    port++;
  }
  return startPort;
}

function getBackendCwd() {
  if (app.isPackaged) {
    const userData = app.getPath('userData');
    const fs = require('fs');
    if (!fs.existsSync(userData)) {
      try {
        fs.mkdirSync(userData, { recursive: true });
      } catch {}
    }
    return userData;
  }
  return path.join(__dirname, '..');
}

function resolveBackendExecutable() {
  if (app.isPackaged) {
    const binaryName = process.platform === 'win32' ? 'amethyst-backend.exe' : 'amethyst-backend';
    return path.join(process.resourcesPath, 'bin', binaryName);
  }
  const pythonBin = process.platform === 'win32'
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'python');
  return pythonBin;
}

function spawnBackend(port = activePort) {
  const execPath = resolveBackendExecutable();
  console.log('[Amethyst Supervisor] Spawning backend using:', execPath, 'on port', port);

  // Ensure executable permissions on Linux / macOS for packaged binary
  if (app.isPackaged && process.platform !== 'win32') {
    try {
      const fs = require('fs');
      fs.chmodSync(execPath, 0o755);
    } catch (e) {
      console.warn('[Amethyst Supervisor] Could not chmod backend binary:', e);
    }
  }

  let args = [];
  if (!app.isPackaged) {
    args = ['-m', 'backend.cli', 'serve', '--port', port.toString(), '--host', '127.0.0.1'];
  } else {
    args = ['serve', '--port', port.toString(), '--host', '127.0.0.1'];
  }

  const venvBin = process.platform === 'win32'
    ? path.join(__dirname, '..', '.venv', 'Scripts')
    : path.join(__dirname, '..', '.venv', 'bin');
  const envPath = !app.isPackaged
    ? `${venvBin}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH;

  try {
    backendProcess = spawn(execPath, args, {
      cwd: getBackendCwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: envPath,
        AMETHYST_PORT: port.toString(),
        AMETHYST_HOST: '127.0.0.1',
        AMETHYST_BIND_PORT: port.toString(),
        AMETHYST_BIND_HOST: '127.0.0.1',
        AMETHYST_DESKTOP: '1',
      },
    });

    backendProcess.stdout?.on('data', (d) => {
      console.log(`[Amethyst Backend stdout] ${d.toString().trim()}`);
      appendBackendLog(d);
    });
    backendProcess.stderr?.on('data', (d) => {
      console.warn(`[Amethyst Backend stderr] ${d.toString().trim()}`);
      appendBackendLog(d);
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Amethyst Backend] Process exited with code ${code}, signal ${signal}`);
      appendBackendLog(`[Amethyst Backend] Process exited with code ${code}, signal ${signal}\n`);
      backendProcess = null;
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
        const snippet = recentLogs.slice(-20).join('\n');
        splashWindow?.webContents.executeJavaScript(
          `window.showError && window.showError("Backend process exited unexpectedly (code ${code || signal})", ${JSON.stringify(snippet)});`
        );
      }
    });
  } catch (err) {
    console.error('[Amethyst Supervisor] Failed to spawn backend:', err);
  }
}

function getAppIconPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'assets', 'icon.ico');
  }
  return path.join(__dirname, 'assets', 'icon.png');
}

function killBackendProcess() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (!backendProcess) return;

  const child = backendProcess;
  backendProcess = null;
  const pid = child.pid;
  if (!pid) return;

  console.log(`[Amethyst Supervisor] Terminating backend process (PID ${pid})...`);

  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  } else {
    try {
      const { execSync } = require('child_process');
      execSync(`pkill -P ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
      execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
    } catch {}
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: getAppIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
    if (!mainWindow && !isQuitting) {
      isQuitting = true;
      killBackendProcess();
      app.quit();
    }
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#101114',
    title: 'Amethyst',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('desktop:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('desktop:maximized-change', false);
  });

  let targetUrl = `http://127.0.0.1:${activePort}`;
  if (IS_DEV) {
    const isViteUp = await isPortInUse(5173);
    if (isViteUp) {
      targetUrl = 'http://127.0.0.1:5173';
    } else {
      console.log(`[Amethyst Supervisor] Dev server not on 5173; using backend bundle on ${activePort}`);
    }
  }

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Amethyst Supervisor] Failed to load ${validatedURL} (${errorCode}: ${errorDescription})`);
    if (validatedURL.includes('5173')) {
      console.log(`[Amethyst Supervisor] Falling back to backend server at http://127.0.0.1:${activePort}`);
      mainWindow?.loadURL(`http://127.0.0.1:${activePort}`);
    }
  });

  console.log('[Amethyst Supervisor] Loading Main Window:', targetUrl);
  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
    createSpotlightWindow().catch(() => {});
  });

  mainWindow.on('close', (e) => {
    if (trayEnabled && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    isQuitting = true;
    killBackendProcess();
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isQuitting = true;
    killBackendProcess();
    app.quit();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

let lastSpotlightShowTime = 0;

async function createSpotlightWindow() {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) return;

  spotlightWindow = new BrowserWindow({
    width: 820,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    center: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  try {
    const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
    spotlightWindow.setAlwaysOnTop(true, level, 1);
    spotlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('[Amethyst Supervisor] Could not set always-on-top level:', e.message);
  }

  let targetUrl = `http://127.0.0.1:${activePort}/?spotlight=1&native=1`;
  if (IS_DEV) {
    const isViteUp = await isPortInUse(5173);
    if (isViteUp) {
      targetUrl = 'http://127.0.0.1:5173/?spotlight=1&native=1';
    }
  }

  spotlightWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (validatedURL.includes('5173')) {
      spotlightWindow?.loadURL(`http://127.0.0.1:${activePort}/?spotlight=1&native=1`);
    }
  });

  console.log('[Amethyst Supervisor] Loading Spotlight Window:', targetUrl);
  spotlightWindow.loadURL(targetUrl);

  spotlightWindow.on('blur', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed() && spotlightWindow.isVisible()) {
      // Guard against immediate blur events triggered by window managers during initial show
      if (Date.now() - lastSpotlightShowTime < 350) return;
      spotlightWindow.hide();
    }
  });

  spotlightWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      spotlightWindow.hide();
      return;
    }
  });

  spotlightWindow.on('closed', () => {
    spotlightWindow = null;
  });
}

function initTray() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'tray-icon.png');
  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Command Palette',
        accelerator: 'Alt+Shift+Space',
        click: () => {
          toggleSpotlight();
        },
      },
      {
        label: 'Show Amethyst',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Check for Updates',
        click: () => {
          autoUpdater.checkForUpdatesAndNotify();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          killBackendProcess();
          app.quit();
        },
      },
    ]);
    tray.setToolTip('Amethyst Intelligence');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
        }
      }
    });
  } catch (err) {
    console.warn('[Amethyst Supervisor] Tray initialization bypassed:', err.message);
  }
}

function setupAutoUpdater() {
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] Update available:', info.version);
      mainWindow?.webContents.send('desktop:update-available', info);

      if (Notification.isSupported()) {
        try {
          const notif = new Notification({
            title: 'Amethyst Update Downloading',
            body: `Version ${info.version} is downloading in the background.`,
            silent: false,
          });
          notif.show();
        } catch (e) {
          console.warn('[AutoUpdater] Failed to show update-available notification:', e.message);
        }
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      mainWindow?.webContents.send('desktop:update-downloaded', info);

      if (Notification.isSupported()) {
        try {
          const notif = new Notification({
            title: 'Amethyst Update Ready',
            body: `Version ${info.version} is ready to install. Click to restart.`,
            silent: false,
          });
          notif.on('click', () => {
            autoUpdater.quitAndInstall();
          });
          notif.show();
        } catch (e) {
          console.warn('[AutoUpdater] Failed to show update-downloaded notification:', e.message);
        }
      }
    });

    autoUpdater.on('error', (err) => {
      console.warn('[AutoUpdater] Update error:', err == null ? 'unknown' : (err.stack || err).toString());
    });

    // Initial check after boot
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 5000);

    // Periodic check every 2 hours
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 2 * 60 * 60 * 1000);
  }
}

async function bootSupervisor() {
  createSplashWindow();

  let attempts = 0;
  const maxAttempts = 60; // 30 seconds

  // 1. Check if backend is already running on port 8000, 8001, or custom env port
  const candidatePorts = [
    parseInt(process.env.AMETHYST_PORT || '8000', 10),
    8000,
    8001,
  ];
  const uniqueCandidates = [...new Set(candidatePorts)];

  let backendRunning = false;
  for (const p of uniqueCandidates) {
    if (await probeApiPing(p)) {
      activePort = p;
      backendRunning = true;
      console.log(`[Amethyst Supervisor] Connected to existing backend on port ${activePort}`);
      break;
    }
  }

  // 2. If no backend is running, pick an available port and spawn
  if (!backendRunning) {
    activePort = await findAvailablePort(parseInt(process.env.AMETHYST_PORT || '8000', 10));
    spawnBackend(activePort);
  }

  pingInterval = setInterval(async () => {
    attempts++;
    const isUp = await probeApiPing(activePort);
    if (isUp) {
      clearInterval(pingInterval);
      pingInterval = null;
      createMainWindow();
      createSpotlightWindow().catch(() => {});
      listenToControlStream(activePort);
      syncSavedShortcutOnBoot(activePort);
    } else if (attempts >= maxAttempts) {
      clearInterval(pingInterval);
      pingInterval = null;
      const snippet = recentLogs.slice(-20).join('\n');
      splashWindow?.webContents.executeJavaScript(
        `window.showError && window.showError("Unable to connect to Amethyst backend engine.", ${JSON.stringify(snippet)});`
      );
    }
  }, 500);
}

// IPC Handlers
ipcMain.handle('desktop:get-version', () => app.getVersion());
ipcMain.handle('desktop:check-updates', async () => {
  if (app.isPackaged) {
    return await autoUpdater.checkForUpdates();
  }
  return { status: 'dev-mode' };
});
ipcMain.handle('desktop:quit-and-install', () => {
  autoUpdater.quitAndInstall();
});
ipcMain.handle('desktop:quit', () => {
  isQuitting = true;
  killBackendProcess();
  app.quit();
});
ipcMain.handle('desktop:retry-boot', () => {
  bootSupervisor();
});
ipcMain.handle('desktop:open-external', (_e, url) => {
  return shell.openExternal(url);
});
ipcMain.handle('desktop:set-tray-enabled', (_e, enabled) => {
  trayEnabled = Boolean(enabled);
  return { ok: true, trayEnabled };
});
ipcMain.handle('desktop:open-logs', () => {
  return shell.openPath(getLogsDir());
});
ipcMain.handle('desktop:window-minimize', () => {
  mainWindow?.minimize();
});
ipcMain.handle('desktop:window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle('desktop:window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});
ipcMain.handle('desktop:window-close', () => {
  if (trayEnabled && !isQuitting) {
    mainWindow?.hide();
  } else {
    mainWindow?.close();
  }
});

ipcMain.handle('desktop:hide-spotlight', () => {
  if (spotlightWindow && !spotlightWindow.isDestroyed() && spotlightWindow.isVisible()) {
    spotlightWindow.hide();
  }
});
ipcMain.handle('desktop:toggle-spotlight', () => {
  toggleSpotlight();
});
ipcMain.handle('desktop:open-main', (_e, viewId, prompt) => {
  if (spotlightWindow && !spotlightWindow.isDestroyed() && spotlightWindow.isVisible()) {
    spotlightWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('desktop:navigate', { viewId, prompt });
  }
});
let controlStreamReq = null;

function listenToControlStream(port = activePort) {
  if (controlStreamReq) {
    try {
      controlStreamReq.destroy();
    } catch {}
    controlStreamReq = null;
  }

  const req = http.get(
    {
      host: '127.0.0.1',
      port: port,
      path: '/api/control/stream',
      headers: { Accept: 'text/event-stream' },
    },
    (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));
                if (payload.type === 'palette') {
                  toggleSpotlight();
                } else if (payload.type === 'show') {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    if (!mainWindow.isVisible()) mainWindow.show();
                    mainWindow.focus();
                  }
                }
              } catch {}
            }
          }
        }
      });
      res.on('end', () => {
        controlStreamReq = null;
        if (!isQuitting) {
          setTimeout(() => listenToControlStream(port), 2000);
        }
      });
    }
  );

  req.on('error', () => {
    controlStreamReq = null;
    if (!isQuitting) {
      setTimeout(() => listenToControlStream(port), 3000);
    }
  });

  controlStreamReq = req;
}

function getShortcutConfigPath() {
  const fs = require('fs');
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) {
    try {
      fs.mkdirSync(userData, { recursive: true });
    } catch {}
  }
  return path.join(userData, 'shortcut.json');
}

function loadSavedShortcut() {
  const fs = require('fs');
  const file = getShortcutConfigPath();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data.shortcut === 'string' && data.shortcut.trim()) {
        return data.shortcut.trim();
      }
    } catch {}
  }
  return null;
}

function saveRegisteredShortcut(chord) {
  const fs = require('fs');
  try {
    fs.writeFileSync(getShortcutConfigPath(), JSON.stringify({ shortcut: chord }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Amethyst Supervisor] Could not save shortcut to disk:', err.message);
  }
}

function normalizeElectronChord(raw) {
  if (!raw) return 'Alt+Shift+Space';
  let s = raw.trim();
  // Strip < > if present
  s = s.replace(/<ctrl>/gi, 'Ctrl+')
    .replace(/<control>/gi, 'Ctrl+')
    .replace(/<alt>/gi, 'Alt+')
    .replace(/<shift>/gi, 'Shift+')
    .replace(/<super>/gi, 'Super+')
    .replace(/<meta>/gi, 'Super+')
    .replace(/<cmd>/gi, 'Command+')
    .replace(/<space>/gi, 'Space');
  // Clean double pluses
  s = s.replace(/\++/g, '+');
  if (s.endsWith('+')) s = s.slice(0, -1);
  return s;
}

function syncGnomeShortcut(chord) {
  if (process.platform !== 'linux') return;
  const postData = JSON.stringify({ hotkey: chord });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: activePort,
      path: '/api/desktop/shortcut',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 3000,
    },
    (res) => {
      res.resume();
    }
  );
  req.on('error', (err) => {
    console.debug('[Amethyst Supervisor] Could not sync shortcut to backend:', err.message);
  });
  req.write(postData);
  req.end();
}

function syncSavedShortcutOnBoot(port = activePort) {
  const saved = loadSavedShortcut();
  if (saved) {
    registerGlobalShortcut(saved, false);
    syncGnomeShortcut(saved);
    return;
  }

  // Probe backend settings
  const req = http.get(
    {
      host: '127.0.0.1',
      port: port,
      path: '/api/desktop/shortcut',
      timeout: 2000,
    },
    (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.ok && parsed.hotkey) {
            registerGlobalShortcut(parsed.hotkey, true);
          }
        } catch {}
      });
    }
  );
  req.on('error', () => {});
}

ipcMain.handle('desktop:get-shortcut', () => {
  return currentRegisteredShortcut || loadSavedShortcut() || 'Alt+Shift+Space';
});

ipcMain.handle('desktop:set-shortcut', async (_e, chord) => {
  const res = registerGlobalShortcut(chord, true);
  if (res.ok) {
    syncGnomeShortcut(res.shortcut);
  }
  return res;
});

ipcMain.handle('desktop:check-shortcut-conflict', async (_e, chord) => {
  if (!chord) return { conflict: true, reason: 'Empty shortcut' };
  const normalized = normalizeElectronChord(chord);

  // Check critical system edit keys
  const forbidden = ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+A', 'Alt+F4', 'Alt+Tab'];
  if (forbidden.includes(normalized)) {
    return { conflict: true, reason: `Shortcut '${normalized}' conflicts with standard system edit actions.` };
  }

  // Check if electron already registered it on another handler
  try {
    const isRegistered = globalShortcut.isRegistered(normalized);
    if (isRegistered && normalized !== currentRegisteredShortcut) {
      return { conflict: true, reason: `Shortcut '${normalized}' is already in use.` };
    }
  } catch (err) {
    return { conflict: true, reason: err.message };
  }

  // On Linux, query backend conflict checker for GNOME & IBus
  if (process.platform === 'linux') {
    try {
      const conflictRes = await new Promise((resolve) => {
        const postData = JSON.stringify({ hotkey: chord });
        const req = http.request(
          {
            host: '127.0.0.1',
            port: activePort,
            path: '/api/desktop/shortcut/check',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 2500,
          },
          (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve({ conflict: false });
              }
            });
          }
        );
        req.on('error', () => resolve({ conflict: false }));
        req.write(postData);
        req.end();
      });
      if (conflictRes && conflictRes.conflict) {
        return conflictRes;
      }
    } catch {}
  }

  return { conflict: false };
});

function toggleSpotlight() {
  if (!spotlightWindow || spotlightWindow.isDestroyed()) {
    createSpotlightWindow().then(() => {
      if (spotlightWindow && !spotlightWindow.isDestroyed()) {
        spotlightWindow.center();
        try {
          const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
          spotlightWindow.setAlwaysOnTop(true, level, 1);
          spotlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch {}
        lastSpotlightShowTime = Date.now();
        spotlightWindow.show();
        spotlightWindow.focus();
        if (typeof spotlightWindow.moveTop === 'function') {
          spotlightWindow.moveTop();
        }
        spotlightWindow.webContents.send('palette:toggle', true);
      }
    });
    return;
  }

  if (spotlightWindow.isVisible()) {
    spotlightWindow.hide();
  } else {
    spotlightWindow.center();
    try {
      const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
      spotlightWindow.setAlwaysOnTop(true, level, 1);
      spotlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
    lastSpotlightShowTime = Date.now();
    spotlightWindow.show();
    spotlightWindow.focus();
    if (typeof spotlightWindow.moveTop === 'function') {
      spotlightWindow.moveTop();
    }
    spotlightWindow.webContents.send('palette:toggle', true);
  }
}

function registerGlobalShortcut(preferred, persist = true) {
  if (currentRegisteredShortcut) {
    try {
      globalShortcut.unregister(currentRegisteredShortcut);
    } catch {}
    currentRegisteredShortcut = null;
  }

  const normalized = normalizeElectronChord(preferred);

  try {
    const success = globalShortcut.register(normalized, toggleSpotlight);
    if (success) {
      currentRegisteredShortcut = normalized;
      if (persist) {
        saveRegisteredShortcut(normalized);
      }
      console.log(`[Amethyst Supervisor] Registered global shortcut: ${normalized}`);
      return { ok: true, shortcut: normalized };
    }
  } catch (e) {
    console.warn(`[Amethyst Supervisor] Could not register ${normalized}:`, e.message);
  }

  // If registering failed and preferred was not default, try Alt+Shift+Space as fallback
  if (normalized !== 'Alt+Shift+Space') {
    try {
      if (globalShortcut.register('Alt+Shift+Space', toggleSpotlight)) {
        currentRegisteredShortcut = 'Alt+Shift+Space';
        return {
          ok: false,
          error: `Could not register '${normalized}'. System may require a different modifier combination.`,
          fallback: 'Alt+Shift+Space',
        };
      }
    } catch {}
  }

  return { ok: false, error: `Could not register shortcut '${normalized}' with operating system` };
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
    } catch (e) {
      console.warn('[Amethyst Supervisor] Could not set dock icon:', e);
    }
  }
  initTray();
  setupAutoUpdater();

  const saved = loadSavedShortcut();
  registerGlobalShortcut(saved || 'Alt+Shift+Space', false);

  bootSupervisor();
});

app.on('window-all-closed', () => {
  isQuitting = true;
  killBackendProcess();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (!splashWindow) {
    bootSupervisor();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  killBackendProcess();
});

app.on('will-quit', () => {
  isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch {}
  killBackendProcess();
});

process.on('exit', () => {
  killBackendProcess();
});

process.on('SIGINT', () => {
  killBackendProcess();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killBackendProcess();
  process.exit(0);
});
