import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore, type AppState } from "@portiq/core";

export function withTempDataDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "portiq-mcp-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function seedStore(dir: string, state: AppState): void {
  const store = openAppStateStore({ dataDir: dir });
  store.save(state);
  store.close();
}
