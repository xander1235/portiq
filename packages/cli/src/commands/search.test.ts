import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { searchCommand } from "./search";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List Users", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/users" },
    { type: "request", id: "r2", name: "Create Order", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/orders" },
  ] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-search-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(seed()); s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [searchCommand]).parseAsync(args, { from: "user" }).then(() => buf);
}

describe("search command", () => {
  it("ranks fuzzy matches for the query", async () => {
    const parsed = JSON.parse(await run(["search", "users", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows[0][0]).toBe("API/List Users");
  });
});
