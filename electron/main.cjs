const { app, BrowserWindow, ipcMain, shell } = require("electron");
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
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
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

// ── Input Validation Helpers ──────────────────────────────────────────────
const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const MAX_URL_LENGTH = 8192;
const MAX_BODY_LENGTH = 50 * 1024 * 1024; // 50 MB
const MAX_HEADER_COUNT = 100;
const MAX_KEY_LENGTH = 1024;
const MAX_VALUE_LENGTH = 10 * 1024 * 1024; // 10 MB per value

function validateString(val, maxLen, label) {
  if (val !== undefined && val !== null && typeof val !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (typeof val === "string" && val.length > maxLen) {
    throw new Error(`${label} exceeds maximum length of ${maxLen}`);
  }
}

function validateHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const keys = Object.keys(headers);
  if (keys.length > MAX_HEADER_COUNT) {
    throw new Error(`Too many headers (max ${MAX_HEADER_COUNT})`);
  }
  const sanitized = {};
  for (const key of keys) {
    validateString(key, MAX_KEY_LENGTH, "Header key");
    validateString(headers[key], MAX_KEY_LENGTH, `Header value for "${key}"`);
    sanitized[key] = String(headers[key]);
  }
  return sanitized;
}

ipcMain.handle("app:ping", async () => "pong");

ipcMain.handle("http:sendRequest", async (_event, payload) => {
  const { method, url, headers, body } = payload || {};
  const startedAt = Date.now();

  // ── Validate inputs ──
  if (!url || typeof url !== "string") {
    return { error: "Missing or invalid URL" };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { error: `URL exceeds maximum length of ${MAX_URL_LENGTH}` };
  }
  const upperMethod = (method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.includes(upperMethod)) {
    return { error: `Invalid HTTP method: ${method}` };
  }
  let sanitizedHeaders;
  try {
    sanitizedHeaders = validateHeaders(headers);
  } catch (err) {
    return { error: err.message };
  }
  if (body !== undefined && body !== null) {
    validateString(body, MAX_BODY_LENGTH, "Request body");
  }

  try {
    const response = await fetch(url, {
      method: upperMethod,
      headers: sanitizedHeaders,
      body: ["GET", "HEAD"].includes(upperMethod) ? undefined : body
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
      time: duration,
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

// ── GraphQL request handler (HTTP POST with GraphQL payload) ──
ipcMain.handle("graphql:sendRequest", async (_event, payload) => {
  const { url, headers, query, variables, operationName } = payload || {};
  const startedAt = Date.now();

  if (!url || typeof url !== "string") {
    return { error: "Missing or invalid URL" };
  }
  if (!query || typeof query !== "string") {
    return { error: "Missing GraphQL query" };
  }

  let sanitizedHeaders;
  try {
    sanitizedHeaders = validateHeaders(headers);
  } catch (err) {
    return { error: err.message };
  }
  sanitizedHeaders["Content-Type"] = "application/json";

  let parsedVariables = variables;
  if (typeof variables === "string" && variables.trim()) {
    try {
      parsedVariables = JSON.parse(variables);
    } catch (err) {
      return { error: "GraphQL variables must be valid JSON" };
    }
  }

  const graphqlBody = JSON.stringify({
    query,
    variables: parsedVariables || undefined,
    operationName: operationName || undefined
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: sanitizedHeaders,
      body: graphqlBody
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
      time: duration,
      duration,
      headers: headersObj,
      body: text,
      json
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

// ── WebSocket connection manager ──
const wsConnections = new Map();

ipcMain.handle("ws:connect", async (_event, payload) => {
  const { id, url, headers, protocols, timeoutMs } = payload || {};
  if (!url || typeof url !== "string") return { error: "Missing or invalid URL" };
  if (!id) return { error: "Missing connection ID" };

  // Close existing connection with same ID
  if (wsConnections.has(id)) {
    try { wsConnections.get(id).close(); } catch (e) { /* ignore */ }
    wsConnections.delete(id);
  }

  return new Promise((resolve) => {
    try {
      const WebSocket = require("ws");
      const ws = new WebSocket(url, protocols || [], {
        headers: headers || {}
      });

      const connectionData = { ws, messages: [], status: "connecting", connectedAt: null, cancelled: false };
      wsConnections.set(id, connectionData);
      let settled = false;
      let timeoutHandle = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        resolve(result);
      };

      ws.on("open", () => {
        connectionData.status = "connected";
        connectionData.connectedAt = Date.now();
        finish({ status: "connected", connectedAt: connectionData.connectedAt });
      });

      ws.on("message", (data, isBinary) => {
        const normalized = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = {
          timestamp: Date.now(),
          direction: "incoming",
          data: isBinary ? normalized.toString("base64") : normalized.toString(),
          size: normalized.length,
          encoding: isBinary ? "base64" : "text"
        };
        connectionData.messages.push(msg);
        // Keep last 1000 messages only
        if (connectionData.messages.length > 1000) {
          connectionData.messages = connectionData.messages.slice(-1000);
        }
        // Notify the renderer
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          win.webContents.send("ws:message", { id, message: msg });
        });
      });

      ws.on("close", (code, reason) => {
        connectionData.status = "disconnected";
        connectionData.connectedAt = null;
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          win.webContents.send("ws:closed", { id, code, reason: reason?.toString() });
        });
        wsConnections.delete(id);
        if (!settled) {
          finish(connectionData.cancelled
            ? { cancelled: true, error: "Connection cancelled" }
            : { error: "Connection closed" });
        }
      });

      ws.on("error", (err) => {
        connectionData.status = "error";
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          win.webContents.send("ws:error", { id, error: err.message });
        });
        finish({ error: err.message });
      });

      // Timeout for connection
      timeoutHandle = setTimeout(() => {
        if (connectionData.status === "connecting") {
          connectionData.cancelled = false;
          ws.close();
          finish({ error: "Connection timeout" });
        }
      }, Number(timeoutMs) > 0 ? Number(timeoutMs) : 10000);
    } catch (err) {
      resolve({ error: err.message || String(err) });
    }
  });
});

ipcMain.handle("ws:send", async (_event, payload) => {
  const { id, data, encoding } = payload || {};
  const conn = wsConnections.get(id);
  if (!conn || !conn.ws) return { error: "No active WebSocket connection" };
  if (conn.ws.readyState !== 1) return { error: "WebSocket is not open" };

  try {
    const payloadData = encoding === "base64" ? Buffer.from(data || "", "base64") : data;
    conn.ws.send(payloadData);
    const normalized = Buffer.isBuffer(payloadData) ? payloadData : Buffer.from(String(payloadData ?? ""));
    const msg = {
      timestamp: Date.now(),
      direction: "outgoing",
      data: encoding === "base64" ? normalized.toString("base64") : normalized.toString(),
      size: normalized.length,
      encoding: encoding === "base64" ? "base64" : "text"
    };
    conn.messages.push(msg);
    return { ok: true, message: msg };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("ws:disconnect", async (_event, payload) => {
  const { id } = payload || {};
  const conn = wsConnections.get(id);
  if (!conn || !conn.ws) return { ok: true };

  try {
    conn.cancelled = conn.status === "connecting";
    conn.ws.close();
    wsConnections.delete(id);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("ws:getMessages", async (_event, payload) => {
  const { id } = payload || {};
  const conn = wsConnections.get(id);
  if (!conn) return { messages: [], status: "disconnected", connectedAt: null };
  return { messages: conn.messages, status: conn.status, connectedAt: conn.connectedAt || null };
});

// ── Mock Server Manager ──
let mockServers = new Map();
const http = require("http");

ipcMain.handle("mock:start", async (_event, payload) => {
  const { id, port, routes } = payload || {};
  if (!id) return { error: "Missing server ID" };
  if (!port || port < 1 || port > 65535) return { error: "Invalid port number" };
  if (!Array.isArray(routes)) return { error: "Routes must be an array" };

  // Stop existing server with same ID
  if (mockServers.has(id)) {
    try { mockServers.get(id).server.close(); } catch (e) { /* ignore */ }
    mockServers.delete(id);
  }

  return new Promise((resolve) => {
    try {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        const matchedRoute = routes.find(r =>
          r.method.toUpperCase() === req.method.toUpperCase() &&
          matchPath(r.path, url.pathname)
        );

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (!matchedRoute) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No matching mock route", path: url.pathname, method: req.method }));
          return;
        }

        const statusCode = matchedRoute.statusCode || 200;
        const responseHeaders = { "Content-Type": "application/json", ...(matchedRoute.headers || {}) };
        const responseBody = typeof matchedRoute.body === "string"
          ? matchedRoute.body
          : JSON.stringify(matchedRoute.body || {});

        // Simulate delay if configured
        const delay = matchedRoute.delay || 0;
        setTimeout(() => {
          res.writeHead(statusCode, responseHeaders);
          res.end(responseBody);
        }, delay);
      });

      server.listen(port, "127.0.0.1", () => {
        mockServers.set(id, { server, port, routes });
        resolve({ ok: true, port });
      });

      server.on("error", (err) => {
        resolve({ error: err.message });
      });
    } catch (err) {
      resolve({ error: err.message });
    }
  });
});

ipcMain.handle("mock:stop", async (_event, payload) => {
  const { id } = payload || {};
  const entry = mockServers.get(id);
  if (!entry) return { ok: true };

  return new Promise((resolve) => {
    entry.server.close(() => {
      mockServers.delete(id);
      resolve({ ok: true });
    });
  });
});

ipcMain.handle("mock:list", async () => {
  const servers = [];
  mockServers.forEach((value, key) => {
    servers.push({ id: key, port: value.port, routeCount: value.routes.length });
  });
  return servers;
});

ipcMain.handle("mock:updateRoutes", async (_event, payload) => {
  const { id, routes } = payload || {};
  const entry = mockServers.get(id);
  if (!entry) return { error: "Server not found" };
  if (!Array.isArray(routes)) return { error: "Routes must be an array" };
  entry.routes = routes;
  mockServers.set(id, entry);
  return { ok: true };
});

function matchPath(pattern, pathname) {
  // Support path parameters like /users/:id
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) => part.startsWith(":") || part === pathParts[i]);
}

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
