import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let http: { url: string; close: () => Promise<void> };
beforeAll(async () => { http = await startTestHttpServer(); });
afterAll(async () => { await http.close(); });

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/ping`,
        testsPostSteps: [{ id: "s1", name: "ok", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "fl1", name: "Flow", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/f`,
        dagGraph: { version: 2, nodes: [{ id: "n1", type: "request", name: "step1", label: "S1", status: "idle",
          data: { overrides: {}, inlineConfig: { method: "GET", url: `${http.url}/f`, headers: "", body: "", params: "", pathVars: "" } } }], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return c;
}

const call = async (c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown>) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text as string);

describe("exec tools", () => {
  it("run_request returns a normalized response and test results", async () => {
    const c = await client();
    const out = await call(c, "run_request", { id: "r1" });
    expect(out.response.status).toBe(200);
    expect(out.tests.passed).toBe(1);
  });

  it("run_ad_hoc_request sends an inline request", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", { method: "GET", url: `${http.url}/adhoc` });
    expect(out.response.json.path).toBe("/adhoc");
  });

  it("run_collection aggregates test totals", async () => {
    const c = await client();
    const out = await call(c, "run_collection", { collectionId: "c1" });
    expect(out.totals.passed).toBe(1);
    expect(out.requests.length).toBeGreaterThanOrEqual(1);
  });

  it("run_flow executes a saved flow", async () => {
    const c = await client();
    const out = await call(c, "run_flow", { id: "fl1" });
    expect(out.step1.response.status).toBe(200);
  });

  it("run_request errors on an unknown id", async () => {
    const c = await client();
    const res = await c.callTool({ name: "run_request", arguments: { id: "nope" } });
    expect(res.isError).toBe(true);
  });
});
