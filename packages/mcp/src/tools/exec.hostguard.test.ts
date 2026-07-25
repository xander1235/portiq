import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AppState } from "@portiq/core";
import type { ServerConfig } from "../config";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let echo: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void> = [];

beforeAll(async () => { echo = await startTestHttpServer(); });
afterAll(async () => { while (cleanups.length) cleanups.pop()!(); await echo.close(); });

function serverWith(overrides: Partial<ServerConfig>) {
  const { dir, cleanup } = withTempDataDir();
  cleanups.push(cleanup);
  const state: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${echo.url}/ping` },
    ] }],
    activeCollectionId: "c1",
    environments: [{ id: "e1", name: "Local", vars: [] }],
    activeEnvId: "e1",
    historyRetentionDays: 7,
  };
  seedStore(dir, state);
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test", ...overrides });
  cleanups.push(() => ctx.close());
  return createMcpServer(ctx);
}

describe("exec tools honor the host policy", () => {
  it("blocks run_request to a denied host", async () => {
    const client = await connectInProcess(serverWith({ execDeny: ["127.0.0.1"] }));
    const res = await client.callTool({ name: "run_request", arguments: { id: "r1" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text as string).toMatch(/deny-list/i);
    await client.close();
  });

  it("permits run_request to an allow-listed host", async () => {
    const client = await connectInProcess(serverWith({ execAllow: ["127.0.0.1"] }));
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    await client.close();
  });

  it("blocks hosts outside a non-empty allow-list", async () => {
    const client = await connectInProcess(serverWith({ execAllow: ["example.com"] }));
    const res = await client.callTool({ name: "run_request", arguments: { id: "r1" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text as string).toMatch(/allow-list/i);
    await client.close();
  });
});
