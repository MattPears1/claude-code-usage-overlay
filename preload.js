const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getPosition: () => ipcRenderer.invoke('get-position'),
  setPosition: (x, y) => ipcRenderer.send('set-position', x, y),
  refreshUsage: () => ipcRenderer.send('refresh-usage'),
  setOpacity: (val) => ipcRenderer.send('set-opacity', val),
  onUsageData: (callback) => ipcRenderer.on('usage-data', (_, data) => callback(data)),
  onUsageStatus: (callback) => ipcRenderer.on('usage-status', (_, status) => callback(status)),
});
