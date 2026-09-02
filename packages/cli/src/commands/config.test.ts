import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, openKvStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { configCommand } from "./config";
import type { CliContext } from "../context";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "portiq-config-"));
}

function runConfig(args: string[]): Promise<{ out: string; code: number | undefined }> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const prev = process.exitCode;
  process.exitCode = undefined;
  return buildProgram(ctx, [configCommand])
    .parseAsync(["config", ...args], { from: "user" })
    .then(() => ({ out: buf, code: process.exitCode as number | undefined }))
    .finally(() => {
      process.exitCode = prev;
    });
}

describe("config command", () => {
  it("recompose-legacy-blob rewrites the appState blob from entity rows", async () => {
    const dir = tempDir();
    try {
      const store = openAppStateStore({ dataDir: dir });
      const state: AppState = {
        collections: [{ id: "c1", name: "A", items: [] }],
        activeCollectionId: "c1",
        environments: [],
        activeEnvId: null,
        historyRetentionDays: 30,
      };
      store.save(state);
      store.entities.raw.deleteKey("appState"); // simulate a stale/missing blob
      store.close();

      const { code } = await runConfig(["--recompose-legacy-blob", "--data-dir", dir]);
      expect(code ?? 0).toBe(0);

      const kv = openKvStore({ dataDir: dir });
      expect(JSON.parse(kv.get("appState")!).collections[0].id).toBe("c1");
      kv.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
