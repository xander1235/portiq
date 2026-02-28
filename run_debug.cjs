const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  
  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error(`Page failed to load: ${desc} (${code}) at ${url}`);
  });
  
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    console.log(`[DOM Console] ${msg} (${src}:${line})`);
  });

  win.loadFile(path.join(__dirname, "dist/index.html"));
});
