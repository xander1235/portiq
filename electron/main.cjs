const { app, BrowserWindow, ipcMain, shell, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const isDev = !app.isPackaged;
let db = null;

function initDb() {
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.join(dir, "appdata.sqlite");
  db = new Database(dbPath);
  db.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)").run();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "AI API Client",
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
    win.loadURL("app://index.html");
  }
}


app.whenReady().then(() => {
  protocol.registerFileProtocol('app', (request, callback) => {
    let requestUrl = request.url.replace('app://', '');
    requestUrl = decodeURIComponent(requestUrl.split('?')[0].split('#')[0]);

    if (requestUrl === '' || requestUrl === '/' || requestUrl === 'index.html') {
      return callback({ path: path.join(__dirname, '../dist/index.html') });
    }

    return callback({ path: path.join(__dirname, '../dist', requestUrl) });
  });

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
ipcMain.handle("http:sendRequest", async (_event, payload) => {
  const { method, url, headers, body } = payload || {};
  const startedAt = Date.now();

  if (!url) {
    return { error: "Missing URL" };
  }

  try {
    const response = await fetch(url, {
      method: method || "GET",
      headers: headers || {},
      body: ["GET", "HEAD"].includes((method || "GET").toUpperCase()) ? undefined : body
    });

    const text = await response.text();
    const duration = Date.now() - startedAt;

    const headersObj = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      duration,
      headers: headersObj,
      body: text,
      json
    };
  } catch (err) {
    let errorMsg = err.message || String(err);
    if (err.name === 'AggregateError' && err.errors) {
      errorMsg += `: ${err.errors.map(e => e.message || String(e)).join(', ')}`;
    } else if (err.cause) {
      if (err.cause.name === 'AggregateError' && err.cause.errors) {
        errorMsg += `: ${err.cause.errors.map(e => e.message || String(e)).join(', ')}`;
      } else {
        errorMsg += `: ${err.cause.message || String(err.cause)}`;
      }
    }
    return { error: errorMsg };
  }
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
