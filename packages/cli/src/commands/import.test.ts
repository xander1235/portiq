import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, exportPortable, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { importCommand } from "./import";
import type { CliContext } from "../context";

let dir: string;
const baseState = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-import-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(baseState()); s.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<void> {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [importCommand]).parseAsync(args, { from: "user" }).then(() => undefined);
}

describe("import command", () => {
  it("imports a curl file into a target collection", async () => {
    const file = join(dir, "req.txt");
    writeFileSync(file, "curl -X POST https://x/users -H 'Accept: application/json' -d '{\"a\":1}'");
    await run(["import", file, "--collection", "Imported", "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    const imported = state!.collections.find((c) => c.name === "Imported");
    expect(imported).toBeTruthy();
    expect((imported!.items[0] as { method: string }).method).toBe("POST");
    s.close();
  });

  it("imports a portiq.json portable file (merge by id)", async () => {
    const portable = exportPortable({ ...baseState(), collections: [{ id: "c2", name: "Fromfile", items: [] }] });
    const file = join(dir, "lib.portiq.json");
    writeFileSync(file, JSON.stringify(portable));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    expect(state!.collections.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    s.close();
  });
});
