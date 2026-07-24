import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createServer, type Server } from "node:http";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { runCommand } from "./run";
import type { CliContext } from "../context";

let dir: string;
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  dir = mkdtempSync(join(tmpdir(), "portiq-run-"));
  const seed: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/ping`, bodyType: "none",
        testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "r2", name: "Fail", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/x`, bodyType: "none",
        testsPostSteps: [{ id: "s2", name: "bad", script: "pm.test('is 500', () => pm.response.to.have.status(500));" }] },
    ] }],
    activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
  };
  const s = openAppStateStore({ dataDir: dir }); s.save(seed); s.close();
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

function run(args: string[]): Promise<{ out: string; code: number | undefined }> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const prev = process.exitCode;
  process.exitCode = undefined;
  return buildProgram(ctx, [runCommand]).parseAsync(args, { from: "user" })
    .then(() => ({ out: buf, code: process.exitCode as number | undefined }))
    .catch((e) => { throw e; })
    .finally(() => { const c = process.exitCode; process.exitCode = prev; void c; });
}

describe("run command", () => {
  it("runs a saved request and reports a passing test", async () => {
    const { out } = await run(["run", "API/Ping", "--data-dir", dir, "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("execution");
    expect(parsed.response.status).toBe(200);
    expect(parsed.tests.passed).toBe(1);
  });

  it("dry-run resolves without sending", async () => {
    const { out } = await run(["run", "API/Ping", "--data-dir", dir, "--dry-run", "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.response).toBeNull();
    expect(parsed.request.method).toBe("GET");
  });

  it("throws a test-failure error with --fail-on-test", async () => {
    await expect(run(["run", "API/Fail", "--data-dir", dir, "--fail-on-test", "--reporter", "json"])).rejects.toThrow(/test/i);
  });
});
