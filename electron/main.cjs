const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const core = require("@portiq/core");
const aiCore = require("@portiq/core/ai");

const isDev = !app.isPackaged;

// Pin the app name and userData dir so packaged/dev builds share the same
// canonical data directory regardless of Electron's default productName
// resolution, and migrate the legacy lowercase "portiq" dir below.
app.setName("Portiq");
try {
  app.setPath("userData", core.resolveDataDir());
} catch {
  // fall back to Electron's default userData path
}

let db = null;

// `app.getVersion()` isn't reliable until Electron signals `ready`, so the
// HttpTransport (which stamps the User-Agent header with it) is constructed
// lazily inside `app.whenReady()` below rather than at module load time.
let httpTransport = null;

const wsManager = new core.WsManager();
const mockManager = new core.MockServerManager();

// Forward WsManager events to every renderer window, mirroring the
// `BrowserWindow.webContents.send` push the old inline WS code performed.
wsManager.on("message", (evt) => {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("ws:message", evt));
});
wsManager.on("closed", (evt) => {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("ws:closed", evt));
});
// Mandatory: Node's EventEmitter throws if an "error" event has no listener.
wsManager.on("error", (evt) => {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("ws:error", evt));
});

function initDb() {
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.join(dir, "appdata.sqlite");

  // One-time migration: older dev builds used a lowercase "portiq" userData dir.
  const legacyDir = path.join(path.dirname(dir), "portiq");
  const legacyDb = path.join(legacyDir, "appdata.sqlite");
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
    fs.copyFileSync(legacyDb, dbPath);
  }

  db = new Database(dbPath);
  db.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)").run();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Portiq",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  httpTransport = new core.HttpTransport({ appVersion: app.getVersion() });
  initDb();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:ping", async () => "pong");

ipcMain.handle("app:getVersion", async () => {
  try { return app.getVersion(); } catch { return ""; }
});

ipcMain.handle("http:sendRequest", async (_event, payload) => {
  return httpTransport.send(payload);
});

ipcMain.handle("http:cancelRequest", async (_event, payload) => {
  try {
    return httpTransport.cancel(payload?.requestId);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
});

// ── GraphQL request handler (HTTP POST with GraphQL payload) ──
ipcMain.handle("graphql:sendRequest", async (_event, payload) => {
  return core.sendGraphQL(payload);
});

// ── WebSocket connection manager ──
ipcMain.handle("ws:connect", async (_event, payload) => {
  return wsManager.connect(payload);
});

ipcMain.handle("ws:send", async (_event, payload) => {
  return wsManager.sendMessage(payload);
});

ipcMain.handle("ws:disconnect", async (_event, payload) => {
  return wsManager.disconnect(payload);
});

ipcMain.handle("ws:getMessages", async (_event, payload) => {
  return wsManager.getMessages(payload);
});

// ── Mock Server Manager ──
ipcMain.handle("mock:start", async (_event, payload) => {
  return mockManager.start(payload);
});

ipcMain.handle("mock:stop", async (_event, payload) => {
  return mockManager.stop(payload);
});

ipcMain.handle("mock:list", async () => {
  return mockManager.list();
});

ipcMain.handle("mock:updateRoutes", async (_event, payload) => {
  return mockManager.updateRoutes(payload);
});

ipcMain.handle("db:saveState", async (_event, key, value) => {
  if (!db) initDb();
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
  return { ok: true };
});

ipcMain.handle("db:loadState", async (_event, key) => {
  if (!db) initDb();
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? row.value : null;
});

ipcMain.handle("db:clearAll", async () => {
  const dir = app.getPath("userData");
  const dbPath = path.join(dir, "appdata.sqlite");
  try {
    if (db) {
      db.close();
      db = null;
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    // Also remove WAL/SHM files if they exist
    if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
    if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
    initDb();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("db:getDataPath", async () => {
  return app.getPath("userData");
});

ipcMain.handle("ai:saveConfig", (_event, config) => {
  try {
    aiCore.saveAiConfig(config || {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
