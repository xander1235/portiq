const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  ping: () => ipcRenderer.invoke("app:ping"),
  sendRequest: (payload) => ipcRenderer.invoke("http:sendRequest", payload),
  saveState: (key, value) => ipcRenderer.invoke("db:saveState", key, value),
  loadState: (key) => ipcRenderer.invoke("db:loadState", key)
});
