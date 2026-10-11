const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amethystDesktop', {
  version: () => ipcRenderer.invoke('desktop:get-version'),
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('desktop:quit-and-install'),
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
});
