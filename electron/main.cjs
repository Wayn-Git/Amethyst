const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const PORT = parseInt(process.env.AMETHYST_PORT || '8000', 10);
const IS_DEV = process.env.ELECTRON_DEV === '1' || !app.isPackaged;

let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let pingInterval = null;

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

function probeApiPing() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: PORT,
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

function spawnBackend() {
  const execPath = resolveBackendExecutable();
  console.log('[Amethyst Supervisor] Spawning backend using:', execPath);

  let args = [];
  if (!app.isPackaged) {
    args = ['-m', 'backend.cli', 'serve', '--port', PORT.toString()];
  } else {
    args = ['serve', '--port', PORT.toString()];
  }

  try {
    backendProcess = spawn(execPath, args, {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AMETHYST_PORT: PORT.toString(),
        AMETHYST_HOST: '127.0.0.1',
        AMETHYST_DESKTOP: '1',
      },
    });

    backendProcess.stdout?.on('data', (d) => {
      console.log(`[Amethyst Backend stdout] ${d.toString().trim()}`);
    });
    backendProcess.stderr?.on('data', (d) => {
      console.warn(`[Amethyst Backend stderr] ${d.toString().trim()}`);
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Amethyst Backend] Process exited with code ${code}, signal ${signal}`);
      backendProcess = null;
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#101114',
    title: 'Amethyst',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = IS_DEV ? 'http://127.0.0.1:5173' : `http://127.0.0.1:${PORT}`;
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

  mainWindow.on('close', () => {
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
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      mainWindow?.webContents.send('desktop:update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      console.warn('[AutoUpdater] Update error:', err == null ? 'unknown' : (err.stack || err).toString());
    });

    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 5000);
  }
}

async function bootSupervisor() {
  createSplashWindow();

  let attempts = 0;
  const maxAttempts = 60; // 30 seconds

  // Check if backend already running
  const alreadyUp = await probeApiPing();
  if (!alreadyUp) {
    spawnBackend();
  }

  pingInterval = setInterval(async () => {
    attempts++;
    const isUp = await probeApiPing();
    if (isUp) {
      clearInterval(pingInterval);
      pingInterval = null;
      createMainWindow();
    } else if (attempts >= maxAttempts) {
      clearInterval(pingInterval);
      pingInterval = null;
      splashWindow?.webContents.executeJavaScript(
        "window.showError && window.showError('Unable to connect to Amethyst backend engine.');"
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
