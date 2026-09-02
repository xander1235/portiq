import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore, type AppState } from "@portiq/core";

export function withTempDataDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "portiq-mcp-"));
  // maxRetries/retryDelay ride out Windows EBUSY: a spawned MCP child may still
  // hold the sqlite file open for a beat after the client closes.
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

export function seedStore(dir: string, state: AppState): void {
  const store = openAppStateStore({ dataDir: dir });
  store.save(state);
  store.close();
}
