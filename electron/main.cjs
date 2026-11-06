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

function initTray() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'tray-icon.png');
  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
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

  // Register global shortcuts for spotlight summoning
  const toggleSpotlight = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('palette:toggle', true);
      } else {
        mainWindow.webContents.send('palette:toggle');
      }
    }
  };

  try {
    globalShortcut.register('CommandOrControl+Space', toggleSpotlight);
    globalShortcut.register('Alt+Space', toggleSpotlight);
    globalShortcut.register('CommandOrControl+K', toggleSpotlight);
  } catch (e) {
    console.warn('[Amethyst Supervisor] Could not register global shortcuts:', e);
  }

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
