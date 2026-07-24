import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { getCommand } from "./get";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
  ] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-get-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(seed()); s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [getCommand]).parseAsync(args, { from: "user" }).then(() => buf);
}

describe("get command", () => {
  it("inspects a request by path", async () => {
    const parsed = JSON.parse(await run(["get", "API/List", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.entity.kind).toBe("request");
    expect(parsed.entity.method).toBe("GET");
    expect(parsed.entity.url).toBe("https://x/list");
  });
});
