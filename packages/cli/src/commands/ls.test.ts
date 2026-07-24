import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { lsCommand } from "./ls";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
    { type: "request", id: "r2", name: "Flow", description: "", tags: [], protocol: "dag", method: "GET", url: "", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
  ] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-ls-"));
  const s = openAppStateStore({ dataDir: dir });
  s.save(seed());
  s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const program = buildProgram(ctx, [lsCommand]);
  return program.parseAsync(args, { from: "user" }).then(() => buf);
}

describe("ls command", () => {
  it("lists requests with paths (json)", async () => {
    const parsed = JSON.parse(await run(["ls", "requests", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows.some((r: string[]) => r[0] === "API/List")).toBe(true);
  });
  it("lists only flows", async () => {
    const parsed = JSON.parse(await run(["ls", "flows", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][0]).toBe("API/Flow");
  });
});
