const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ourtubeDesktop", {
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  inspect: (url) => ipcRenderer.invoke("desktop:inspect", { url }),
  download: (payload) => ipcRenderer.invoke("desktop:download", payload),
  cancel: () => ipcRenderer.invoke("desktop:cancel"),
  openFolder: () => ipcRenderer.invoke("desktop:open-folder"),
  checkForUpdates: (interactive = false) => ipcRenderer.invoke("desktop:check-update", {
    interactive: interactive === true,
  }),
  onProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:progress", listener);
    return () => ipcRenderer.removeListener("desktop:progress", listener);
  },
  onUpdateStatus(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
  onOpenUrl(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:open-url", listener);
    return () => ipcRenderer.removeListener("desktop:open-url", listener);
  },
});
