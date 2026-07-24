import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { openAppStateStore, type AppState } from "@portiq/core";

const BIN = resolve(__dirname, "../../dist/index.js");
let dir: string;
let server: Server;
let port: number;

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile("node", [BIN, ...args], { env: { ...process.env } }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : 0;
      resolvePromise({ code, stdout, stderr });
    });
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  dir = mkdtempSync(join(tmpdir(), "portiq-cli-int-"));
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

describe("portiq CLI (built binary)", () => {
  it("ls requests exits 0 and prints json when piped", async () => {
    const { code, stdout } = await cli(["ls", "requests", "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).kind).toBe("table");
  });

  it("run of a passing request exits 0", async () => {
    const { code, stdout } = await cli(["run", "API/Ping", "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).tests.passed).toBe(1);
  });

  it("run --fail-on-test of a failing request exits 2", async () => {
    const { code } = await cli(["run", "API/Fail", "--data-dir", dir, "--fail-on-test"]);
    expect(code).toBe(2);
  });

  it("unknown command exits 3", async () => {
    const { code } = await cli(["frobnicate"]);
    expect(code).toBe(3);
  });

  it("exec against the mock server exits 0 and reports 200", async () => {
    const { code, stdout } = await cli(["exec", `http://127.0.0.1:${port}/echo`, "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).response.status).toBe(200);
  });

  it("junit reporter emits a testsuites element", async () => {
    const { stdout } = await cli(["run", "API/Ping", "--data-dir", dir, "--reporter", "junit"]);
    expect(stdout).toContain("<testsuites");
  });
});
