#!/usr/bin/env node
import { defaultContext } from "./context";
import { runCli } from "./run";

/**
 * Best-effort close of the undici global dispatcher. `HttpTransport` uses the
 * global `fetch` for the "auto" HTTP version; undici keeps pooled keep-alive
 * connections which would otherwise prevent the one-shot CLI process from
 * exiting. Only meaningful for short-lived processes — long-running hosts
 * (desktop/MCP) keep the event loop busy regardless.
 */
async function closeUndici(): Promise<void> {
  try {
    const dispatcher = (globalThis as Record<symbol, unknown>)[Symbol.for("undici.globalDispatcher.1")] as
      | { close?: () => Promise<void> }
      | undefined;
    if (dispatcher && typeof dispatcher.close === "function") {
      await dispatcher.close();
    }
  } catch {
    // ignore — closing the global dispatcher is best-effort
  }
}

async function main(): Promise<number> {
  const code = await runCli(defaultContext());
  await closeUndici();
  return code;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exitCode = 1; });
