import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const { createTrustGuard } = await import("../../electron/trustGuard.cjs");

function frame() {
  return { isMainFrame: true };
}

function event(url, { subframe = false } = {}) {
  const mainFrame = frame();
  const senderFrame = subframe ? frame() : mainFrame;
  const sender = { mainFrame, getURL: () => url };
  return { sender, senderFrame };
}

function makeGuard(isDev = false) {
  let windowAvailable = true;
  const g = createTrustGuard({
    isDev,
    fromWebContents: () => (windowAvailable ? { ok: true } : null),
  });
  return { ...g, setWindowAvailable: (v) => (windowAvailable = v) };
}

describe("createTrustGuard (packaged mode)", () => {
  it("trusts a top-level file:// frame from our own window", () => {
    const { isTrustedIpcSender } = makeGuard(false);
    expect(isTrustedIpcSender(event("file:///app/index.html"))).toBe(true);
    expect(isTrustedIpcSender(event("file:///app/index.html?x=1#y"))).toBe(true);
  });

  it("rejects a missing or empty event", () => {
    const { isTrustedIpcSender } = makeGuard(false);
    expect(isTrustedIpcSender(undefined)).toBe(false);
    expect(isTrustedIpcSender(null)).toBe(false);
    expect(isTrustedIpcSender({})).toBe(false);
  });

  it("rejects a sender with no owning BrowserWindow", () => {
    const g = makeGuard(false);
    g.setWindowAvailable(false);
    expect(g.isTrustedIpcSender(event("file:///app/index.html"))).toBe(false);
  });

  it("rejects a subframe sender even when the window is ours", () => {
    const { isTrustedIpcSender } = makeGuard(false);
    expect(isTrustedIpcSender(event("file:///app/index.html", { subframe: true }))).toBe(false);
  });

  it("rejects windows that navigated to remote content", () => {
    const { isTrustedIpcSender } = makeGuard(false);
    expect(isTrustedIpcSender(event("https://evil.example.com/x"))).toBe(false);
    expect(isTrustedIpcSender(event("http://localhost:5173/"))).toBe(false);
    expect(isTrustedIpcSender(event("javascript:alert(1)"))).toBe(false);
  });

  it("returns false (not throw) when getURL throws", () => {
    const { isTrustedIpcSender } = makeGuard(false);
    const mainFrame = frame();
    const sender = {
      mainFrame,
      getURL: () => {
        throw new Error("gone");
      },
    };
    expect(isTrustedIpcSender({ sender, senderFrame: mainFrame })).toBe(false);
  });
});

describe("createTrustGuard (dev mode)", () => {
  it("trusts only the dev server origin", () => {
    const { isTrustedIpcSender } = makeGuard(true);
    expect(isTrustedIpcSender(event("http://localhost:5173/"))).toBe(true);
    expect(isTrustedIpcSender(event("http://localhost:5173/#/x"))).toBe(true);
  });

  it("rejects other origins, file://, and remote content in dev", () => {
    const { isTrustedIpcSender } = makeGuard(true);
    expect(isTrustedIpcSender(event("http://localhost:9999/"))).toBe(false);
    expect(isTrustedIpcSender(event("file:///app/index.html"))).toBe(false);
    expect(isTrustedIpcSender(event("https://evil.example.com/"))).toBe(false);
    expect(isTrustedIpcSender(event("http://127.0.0.1:5173/"))).toBe(false);
  });
});

describe("requireTrustedSender", () => {
  it("passes through for a trusted sender", () => {
    const { requireTrustedSender } = makeGuard(false);
    expect(() => requireTrustedSender(event("file:///app/index.html"))).not.toThrow();
  });

  it("throws for an untrusted sender", () => {
    const { requireTrustedSender } = makeGuard(false);
    expect(() => requireTrustedSender(event("https://evil.example.com/"))).toThrow(/Untrusted IPC sender/);
  });
});

describe("main.cjs wiring (every IPC handler is gated)", () => {
  const mainSrc = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");

  it("each ipcMain.handle handler calls requireTrustedSender", () => {
    const chunks = mainSrc.split("ipcMain.handle(");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(1)) {
      expect(chunk).toMatch(/requireTrustedSender\(event\)/);
    }
  });

  it("has the same number of gated handlers as ipcMain.handle calls", () => {
    const handles = (mainSrc.match(/ipcMain\.handle\(/g) || []).length;
    const gates = (mainSrc.match(/requireTrustedSender\(event\)/g) || []).length;
    expect(gates).toBe(handles);
    expect(handles).toBeGreaterThan(0);
  });

  it("does not use unguarded ipcMain.on handlers", () => {
    expect(mainSrc.match(/ipcMain\.on\(/g)).toBeNull();
  });
});
