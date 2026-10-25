const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('amethystDesktop', {
  version: () => ipcRenderer.invoke('desktop:get-version'),
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('desktop:quit-and-install'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('desktop:update-available', handler);
    return () => ipcRenderer.removeListener('desktop:update-available', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('desktop:update-downloaded', handler);
    return () => ipcRenderer.removeListener('desktop:update-downloaded', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  setTrayEnabled: (enabled) => ipcRenderer.invoke('desktop:set-tray-enabled', enabled),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  minimize: () => ipcRenderer.invoke('desktop:window-minimize'),
  maximize: () => ipcRenderer.invoke('desktop:window-maximize'),
  isMaximized: () => ipcRenderer.invoke('desktop:window-is-maximized'),
  close: () => ipcRenderer.invoke('desktop:window-close'),
  onMaximizedChange: (callback) => {
    const handler = (_event, isMax) => callback(isMax);
    ipcRenderer.on('desktop:maximized-change', handler);
    return () => ipcRenderer.removeListener('desktop:maximized-change', handler);
  },
  setZoomFactor: (factor) => {
    try {
      if (typeof factor === 'number' && Number.isFinite(factor) && factor > 0) {
        webFrame.setZoomFactor(factor);
      }
    } catch (e) {
      console.warn('Failed to set zoom factor:', e);
    }
  },
  getZoomFactor: () => {
    try {
      return webFrame.getZoomFactor();
    } catch {
      return 1;
    }
  },
});

contextBridge.exposeInMainWorld('electronSplash', {
  close: () => ipcRenderer.invoke('desktop:quit'),
  retry: () => ipcRenderer.invoke('desktop:retry-boot'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
});
