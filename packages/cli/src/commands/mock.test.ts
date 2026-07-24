import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { mockCommand, type MockDeps } from "./mock";
import type { CliContext } from "../context";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-mock-"));
  const seed: AppState = {
    collections: [
      {
        id: "c1",
        name: "API",
        items: [
          {
            type: "request",
            id: "r1",
            name: "Ping",
            description: "",
            tags: [],
            protocol: "http",
            method: "GET",
            url: "http://localhost/ping",
            bodyType: "none",
          },
          {
            type: "request",
            id: "r2",
            name: "Pong",
            description: "",
            tags: [],
            protocol: "http",
            method: "POST",
            url: "http://localhost/pong",
            bodyType: "none",
          },
        ],
      },
    ],
    activeCollectionId: "c1",
    environments: [],
    activeEnvId: null,
    historyRetentionDays: 7,
  };
  const s = openAppStateStore({ dataDir: dir });
  s.save(seed);
  s.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runMock(
  args: string[],
  deps: MockDeps = {}
): { out: () => string; done: Promise<void> } {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const done = buildProgram(ctx, [mockCommand(deps)]).parseAsync(args, { from: "user" });
  return { out: () => buf, done };
}

describe("mock command", () => {
  it("starts a mock server, serves a route, and stops on shutdown", async () => {
    let observedPort = -1;
    const waitForShutdown = async (port: number): Promise<void> => {
      observedPort = port;
      const res = await fetch(`http://localhost:${port}/ping`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    };
    const { out, done } = runMock(["mock", "API", "--data-dir", dir, "--port", "0", "--reporter", "json"], {
      waitForShutdown,
    });
    await done;

    expect(observedPort).toBeGreaterThan(0);
    const text = out();
    expect(text).toMatch(new RegExp(`Mock server "API" listening on http://localhost:${observedPort} \\(2 routes\\)`));
    expect(text).toMatch(/Stopped mock server "API"/);

    const stoppedIdx = text.indexOf("Stopped mock server");
    const beforeStopped = text.slice(0, stoppedIdx);
    const jsonStart = beforeStopped.indexOf("{");
    const jsonText = beforeStopped.slice(jsonStart).trim();
    const parsed = JSON.parse(jsonText);
    expect(parsed.kind).toBe("table");
    expect(parsed.columns).toEqual(["Method", "Path", "Status"]);
    expect(parsed.rows).toHaveLength(2);
  });

  it("rejects a non-collection ref with a UsageError", async () => {
    const { done } = runMock(["mock", "API/Ping", "--data-dir", dir, "--port", "0"], {
      waitForShutdown: async () => {},
    });
    await expect(done).rejects.toThrow(/collection/i);
  });

  it("rejects a malformed --port with a UsageError", async () => {
    const { done } = runMock(["mock", "API", "--data-dir", dir, "--port", "abc"], {
      waitForShutdown: async () => {},
    });
    await expect(done).rejects.toThrow(/port/i);
  });
});
