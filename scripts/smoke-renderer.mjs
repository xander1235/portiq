#!/usr/bin/env node
// Headless-renderer smoke test.
//
// vitest/jsdom unit tests import one module at a time and never execute the
// full Vite/Rollup-bundled entry graph the way a real browser does. That gap
// let a real regression slip past the whole suite (see commit c3fe2371,
// "fix(renderer): isolate Node-only core modules from the Chromium bundle"):
// the "@portiq/core" barrel eagerly re-exported Node-only modules
// (better-sqlite3, node:os, ...), so Vite's browser build threw at MODULE
// INIT time -- before React ever called `.render()` -- producing a blank
// white screen that no unit test could see (nothing "renders" wrong;
// nothing ever mounts). This script instead boots the actual built dist/
// bundle in headless Chromium and fails if the page ever throws or #root
// never gets a child.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../dist", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function serveDist() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = join(ROOT, rel);
        const body = await readFile(filePath);
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const server = await serveDist();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const fail = async (reason) => {
    console.error(`renderer smoke FAILED: ${reason}`);
    console.error(`  page error(s): ${pageErrors.length ? pageErrors.join("; ") : "(none)"}`);
    console.error(`  console error(s): ${consoleErrors.length ? consoleErrors.join("; ") : "(none)"}`);
    await browser.close();
    server.close();
    process.exit(1);
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(
      () => !!document.querySelector("#root") && document.querySelector("#root").childElementCount > 0,
      { timeout: 15000 }
    );
  } catch (err) {
    await fail(`#root never mounted a child within 15s (${err.message})`);
    return;
  }

  if (pageErrors.length > 0) {
    await fail(`${pageErrors.length} uncaught page error(s) during load`);
    return;
  }

  await browser.close();
  server.close();
  console.log(`renderer smoke: OK (root mounted, 0 page errors, ${consoleErrors.length} console.error call(s))`);
}

main().catch((err) => {
  console.error("renderer smoke FAILED with an unexpected error:", err);
  process.exit(1);
});
