const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const core = require("@portiq/core");
const aiCore = require("@portiq/core/ai");
const { createSafeStorageEncryptor } = require("./keystore.cjs");
// gRPC is deliberately NOT part of the "@portiq/core" barrel (it pulls in
// @grpc/grpc-js / @grpc/proto-loader, which must never reach the renderer bundle
// — see packages/core/src/index.ts). Import it from the Node-only subpath instead.
const { GrpcTransport } = require("@portiq/core/grpc");

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

let kvStore = null;
let appStore = null;
let stateDetector = null;
let stateWatchHandle = null;

// Lazily constructed: `safeStorage.isEncryptionAvailable()` is only reliable
// after `app.whenReady()`, so the encryptor is built on first use rather than
// at module load time.
let aiEncryptor = null;
function getAiEncryptor() {
  if (!aiEncryptor) aiEncryptor = createSafeStorageEncryptor();
  return aiEncryptor;
}

// `app.getVersion()` isn't reliable until Electron signals `ready`, so the
// HttpTransport (which stamps the User-Agent header with it) is constructed
// lazily inside `app.whenReady()` below rather than at module load time.
let httpTransport = null;

const wsManager = new core.WsManager();
const mockManager = core.createMockManager();
const grpcTransport = new GrpcTransport();

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
  // Copy atomically (tmp + rename in the same directory) so a crash mid-copy
  // can never leave a partially-written appdata.sqlite behind.
  const legacyDir = path.join(path.dirname(dir), "portiq");
  const legacyDb = path.join(legacyDir, "appdata.sqlite");
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
    const tmpDb = dbPath + ".migrate.tmp";
    fs.copyFileSync(legacyDb, tmpDb);
    fs.renameSync(tmpDb, dbPath);
  }

  kvStore = core.openKvStore({ dataDir: dir });
  // Normalized per-entity store; shares the same kv handle so the migration and
  // dual-written legacy blob stay consistent within the process.
  appStore = core.openAppStateStore({ dataDir: dir }, kvStore);
}

// ── IPC sender trust ──
// Every handler is gated on the invocation coming from the top-level frame of
// one of our own windows, serving our own app content. Anything else (a stray
// webContents, a subframe, a navigation to remote content) is rejected so
// privileged IPC can never be reached by untrusted code.
function isTrustedIpcSender(event) {
  try {
    if (!event || !event.sender) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return false;
    const url = event.sender.getURL();
    if (isDev) return url.startsWith("http://localhost:5173");
    return url.startsWith("file://");
  } catch {
    return false;
  }
}

function requireTrustedSender(event) {
  if (!isTrustedIpcSender(event)) {
    throw new Error("Untrusted IPC sender");
  }
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

  // Prevent the app window itself from ever navigating away from our own
  // content (a link click, location change, or drive-by redirect to a remote
  // or unexpected file:// target). The only navigation allowed is the initial
  // load below.
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? url.startsWith("http://localhost:5173") : url.startsWith("file://");
    if (!allowed) event.preventDefault();
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

  // One-time, idempotent: encrypt any plaintext AI credentials left over from
  // before this encryptor was wired up. A migration failure must not block
  // app startup — log and continue with plaintext (still functional).
  try {
    aiCore.migrateAiKeystore({ encryptor: getAiEncryptor() });
  } catch (err) {
    console.error("AI keystore migration failed:", err);
  }

  createWindow();

  // Watch appdata.sqlite for writes made by OTHER processes (CLI/MCP or a
  // second app instance) and live-reload the renderer. External-vs-self is
  // decided by the kvStore's global write counter, which bumps on EVERY
  // mutating kv op (set/setIfVersion/deleteKey) — including in-place edits of
  // an existing collection/environment/etc. — unlike the "ent:index" row,
  // which only changes when a collection/environment is added or removed.
  // Self-writes are suppressed via noteLocalWrite in db:saveState below.
  const dbPath = path.join(app.getPath("userData"), "appdata.sqlite");
  stateDetector = new core.StateChangeDetector({
    readVersion: () => kvStore.globalWriteVersion(),
    onExternalChange: (version) => {
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("state:externalChange", { version })
      );
    },
  });
  stateWatchHandle = core.watchStateFile({ dbPath, detector: stateDetector });

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

app.on("before-quit", () => {
  if (stateWatchHandle) {
    stateWatchHandle.close();
    stateWatchHandle = null;
  }
});

ipcMain.handle("app:ping", async (event) => {
  requireTrustedSender(event);
  return "pong";
});

ipcMain.handle("app:getVersion", async (event) => {
  requireTrustedSender(event);
  try { return app.getVersion(); } catch { return ""; }
});

ipcMain.handle("http:sendRequest", async (event, payload) => {
  requireTrustedSender(event);
  return httpTransport.send(payload);
});

ipcMain.handle("http:cancelRequest", async (event, payload) => {
  requireTrustedSender(event);
  try {
    return httpTransport.cancel(payload?.requestId);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
});

// ── GraphQL request handler (HTTP POST with GraphQL payload) ──
ipcMain.handle("graphql:sendRequest", async (event, payload) => {
  requireTrustedSender(event);
  return core.sendGraphQL(payload);
});

// ── gRPC request handler (native transport via @grpc/grpc-js) ──
ipcMain.handle("grpc:sendRequest", async (event, payload) => {
  requireTrustedSender(event);
  try {
    return await grpcTransport.send(payload);
  } catch (err) {
    return {
      statusCode: 2,
      statusMessage: "UNKNOWN",
      duration: 0,
      metadata: {},
      trailers: {},
      body: "",
      json: null,
      error: err && err.message ? err.message : String(err),
      messages: []
    };
  }
});

ipcMain.handle("grpc:cancelRequest", async (event, payload) => {
  requireTrustedSender(event);
  try {
    return grpcTransport.cancel(payload && payload.requestId);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
});

// ── WebSocket connection manager ──
ipcMain.handle("ws:connect", async (event, payload) => {
  requireTrustedSender(event);
  return wsManager.connect(payload);
});

ipcMain.handle("ws:send", async (event, payload) => {
  requireTrustedSender(event);
  return wsManager.sendMessage(payload);
});

ipcMain.handle("ws:disconnect", async (event, payload) => {
  requireTrustedSender(event);
  return wsManager.disconnect(payload);
});

ipcMain.handle("ws:getMessages", async (event, payload) => {
  requireTrustedSender(event);
  return wsManager.getMessages(payload);
});

// ── Mock Server Manager ──
ipcMain.handle("mock:start", async (event, payload) => {
  requireTrustedSender(event);
  return mockManager.start(payload);
});

ipcMain.handle("mock:stop", async (event, payload) => {
  requireTrustedSender(event);
  return mockManager.stop(payload);
});

ipcMain.handle("mock:list", async (event) => {
  requireTrustedSender(event);
  return mockManager.list();
});

ipcMain.handle("mock:updateRoutes", async (event, payload) => {
  requireTrustedSender(event);
  return mockManager.updateRoutes(payload);
});

ipcMain.handle("db:saveState", async (event, key, value) => {
  requireTrustedSender(event);
  if (!kvStore) initDb();
  if (key === "appState") {
    // Decompose into per-entity rows; the legacy blob is dual-written inside save()
    // so external/old readers keep working. Renderer contract (blob in) is unchanged.
    appStore.save(JSON.parse(value));
    // Record the app's own write so the watcher (which reads the kvStore's
    // global write counter) never re-broadcasts it as an external change.
    if (stateDetector) stateDetector.noteLocalWrite(kvStore.globalWriteVersion());
  } else {
    kvStore.set(key, value);
    if (stateDetector) stateDetector.noteLocalWrite(kvStore.globalWriteVersion());
  }
  return { ok: true };
});

ipcMain.handle("db:loadState", async (event, key) => {
  requireTrustedSender(event);
  if (!kvStore) initDb();
  if (key === "appState") {
    const { state } = appStore.load();
    return state ? JSON.stringify(state) : null;
  }
  return kvStore.get(key);
});

ipcMain.handle("db:clearAll", async (event) => {
  requireTrustedSender(event);
  try {
    if (!kvStore) initDb();
    kvStore.clear();
    // clear() resets kv_version (and therefore ent:index) to 0; re-sync so
    // the detector doesn't misread the reset as an external change.
    if (stateDetector) stateDetector.reset(0);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("db:getDataPath", async (event) => {
  requireTrustedSender(event);
  return app.getPath("userData");
});

ipcMain.handle("ai:saveConfig", (event, config) => {
  requireTrustedSender(event);
  try {
    aiCore.saveAiConfig(config || {}, { encryptor: getAiEncryptor() });
    // saveAiConfig writes the AI settings row through its own kv handle on the
    // same database; record the write so the file watcher does not treat it as
    // an external change and reload the renderer.
    if (stateDetector) stateDetector.noteLocalWrite(kvStore.globalWriteVersion());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ── Install/uninstall the `portiq` / `portiq-mcp` commands on PATH ──
// Symlinks the app's Resources/bin launchers into /usr/local/bin (macOS/Linux).
// Windows PATH is handled by the NSIS installer, so this is a no-op there.
const PATH_TARGET_DIR = "/usr/local/bin";
function shimSourceDir() {
  // process.resourcesPath = .../Contents/Resources (mac) or .../resources (linux/win)
  return path.join(process.resourcesPath, "bin");
}
// Guards against clobbering/deleting a file that isn't ours: true only if
// `targetPath` is a symlink whose DIRECT target (readlink, not the resolved
// chain) points into our own Resources/bin (`shimSrcDir`). Any other file,
// symlink, or symlink-to-symlink there is left alone.
function isOwnPortiqShim(targetPath, shimSrcDir) {
  try {
    const st = fs.lstatSync(targetPath);
    if (!st.isSymbolicLink()) return false;
    const dest = fs.readlinkSync(targetPath);
    const resolved = path.resolve(path.dirname(targetPath), dest);
    return resolved.startsWith(shimSrcDir + path.sep);
  } catch {
    return false;
  }
}
ipcMain.handle("cli:installShims", async (event) => {
  requireTrustedSender(event);
  if (process.platform === "win32") {
    return { error: "On Windows the installer manages PATH automatically." };
  }
  try {
    const src = shimSourceDir();
    const made = [];
    for (const name of ["portiq", "portiq-mcp"]) {
      const from = path.join(src, name);
      const to = path.join(PATH_TARGET_DIR, name);
      // Use lstat (not existsSync) so a broken symlink — which existsSync
      // reports as absent but which still occupies the path — is detected.
      let alreadyExists = false;
      try {
        fs.lstatSync(to);
        alreadyExists = true;
      } catch {
        alreadyExists = false;
      }
      if (alreadyExists && !isOwnPortiqShim(to, src)) {
        return {
          error: `${to} already exists and is not a Portiq shim; refusing to overwrite`,
          made
        };
      }
      if (alreadyExists) {
        try { fs.unlinkSync(to); } catch { /* not present */ }
      }
      fs.symlinkSync(from, to);
      made.push(to);
    }
    return { ok: true, paths: made };
  } catch (err) {
    // EACCES on /usr/local/bin is expected without admin rights.
    return { error: err && err.message ? err.message : String(err) };
  }
});
ipcMain.handle("cli:uninstallShims", async (event) => {
  requireTrustedSender(event);
  if (process.platform === "win32") return { ok: true };
  const src = shimSourceDir();
  for (const name of ["portiq", "portiq-mcp"]) {
    const to = path.join(PATH_TARGET_DIR, name);
    if (isOwnPortiqShim(to, src)) {
      try { fs.unlinkSync(to); } catch { /* absent */ }
    }
    // else: absent, or not ours — leave it alone.
  }
  return { ok: true };
});
