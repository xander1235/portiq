const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  ping: () => ipcRenderer.invoke("app:ping"),

  // ── HTTP ──
  sendRequest: (payload) => ipcRenderer.invoke("http:sendRequest", payload),
  cancelRequest: (payload) => ipcRenderer.invoke("http:cancelRequest", payload),

  // ── GraphQL ──
  sendGraphQL: (payload) => ipcRenderer.invoke("graphql:sendRequest", payload),

  // ── WebSocket ──
  wsConnect: (payload) => ipcRenderer.invoke("ws:connect", payload),
  wsSend: (payload) => ipcRenderer.invoke("ws:send", payload),
  wsDisconnect: (payload) => ipcRenderer.invoke("ws:disconnect", payload),
  wsGetMessages: (payload) => ipcRenderer.invoke("ws:getMessages", payload),
  onWsMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ws:message", handler);
    return () => ipcRenderer.removeListener("ws:message", handler);
  },
  onWsClosed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ws:closed", handler);
    return () => ipcRenderer.removeListener("ws:closed", handler);
  },
  onWsError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ws:error", handler);
    return () => ipcRenderer.removeListener("ws:error", handler);
  },

  // ── Mock Server ──
  mockStart: (payload) => ipcRenderer.invoke("mock:start", payload),
  mockStop: (payload) => ipcRenderer.invoke("mock:stop", payload),
  mockList: () => ipcRenderer.invoke("mock:list"),
  mockUpdateRoutes: (payload) => ipcRenderer.invoke("mock:updateRoutes", payload),

  // ── Database / Persistence ──
  saveState: (key, value) => ipcRenderer.invoke("db:saveState", key, value),
  loadState: (key) => ipcRenderer.invoke("db:loadState", key),
  clearAllData: () => ipcRenderer.invoke("db:clearAll"),
  getDataPath: () => ipcRenderer.invoke("db:getDataPath")
});
