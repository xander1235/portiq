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

  it("imports a Postman v2.1 collection file", async () => {
    const pm = {
      info: { name: "PM Import", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [{ name: "Ping", request: { method: "GET", url: "https://x/ping" } }],
    };
    const file = join(dir, "collection.postman.json");
    writeFileSync(file, JSON.stringify(pm));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    const imported = state!.collections.find((c) => c.name === "PM Import");
    expect(imported).toBeTruthy();
    expect((imported!.items[0] as { method: string }).method).toBe("GET");
    s.close();
  });

  it("imports an OpenAPI 3.x document file", async () => {
    const oas = {
      openapi: "3.0.0",
      info: { title: "OAS Import", version: "1.0.0" },
      servers: [{ url: "https://x" }],
      paths: { "/ping": { get: { summary: "Ping", tags: ["health"] } } },
    };
    const file = join(dir, "openapi.json");
    writeFileSync(file, JSON.stringify(oas));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    expect(state!.collections.some((c) => c.name === "OAS Import")).toBe(true);
    s.close();
  });
});
