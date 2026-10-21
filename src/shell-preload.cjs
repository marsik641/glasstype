const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glassType', Object.freeze({
  action: (name) => ipcRenderer.invoke('glass:action', name),
  ready: () => ipcRenderer.invoke('glass:state'),
  resize: (phase, point) => ipcRenderer.send('glass:resize', phase, point),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('glass:state', listener);
    return () => ipcRenderer.removeListener('glass:state', listener);
  }
}));
