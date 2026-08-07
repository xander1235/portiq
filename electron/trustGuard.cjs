"use strict";

// Trust-gating for IPC senders, extracted from main.cjs so it can be unit
// tested without an Electron runtime. `fromWebContents` maps a webContents to
// its owning BrowserWindow (injected by main.cjs as
// `BrowserWindow.fromWebContents`).
//
// A sender is trusted only when the invocation comes from the top-level frame
// of one of our own windows serving our own app content. Anything else (a
// stray webContents, a subframe, or a window that has navigated to remote
// content) is rejected so privileged IPC can never be reached by untrusted
// code.
function createTrustGuard({ isDev, fromWebContents }) {
  function isTrustedIpcSender(event) {
    try {
      if (!event || !event.sender) return false;
      const win = fromWebContents(event.sender);
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

  return { isTrustedIpcSender, requireTrustedSender };
}

module.exports = { createTrustGuard };
