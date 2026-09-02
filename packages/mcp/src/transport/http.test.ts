import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AppState } from "@portiq/core";
import type { ServerConfig } from "../config";
import { buildContext } from "../context";
import { startHttpServer } from "./http";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let echo: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void | Promise<void>> = [];

beforeAll(async () => { echo = await startTestHttpServer(); });
afterAll(async () => { for (const c of cleanups.reverse()) await c(); await echo.close(); });

function seededDir(): string {
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
  return dir;
}

async function startServer(overrides: Partial<ServerConfig> = {}): Promise<string> {
  const config: ServerConfig = {
    dataDir: seededDir(), allowWrites: false, appVersion: "test",
    transport: "http", httpHost: "127.0.0.1", httpPort: 0, execAllow: [], execDeny: [], ...overrides,
  };
  const ctx = buildContext(config);
  const handle = await startHttpServer(ctx, {
    host: config.httpHost ?? "127.0.0.1", port: config.httpPort ?? 0, authToken: config.authToken,
  });
  cleanups.push(async () => { await handle.close(); ctx.close(); });
  return handle.url;
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: "e2e-http", version: "0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

describe("portiq-mcp streamable HTTP", () => {
  it("lists read/exec tools and hides write tools over HTTP", async () => {
    const client = await connect(await startServer());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_collections");
    expect(names).toContain("run_request");
    expect(names).not.toContain("create_request");
  });

  it("runs a saved request over HTTP against a local server", async () => {
    const client = await connect(await startServer());
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    expect(out.response.json.path).toBe("/ping");
  });

  it("rejects a connection without the bearer token", async () => {
    const url = await startServer({ authToken: "s3cret" });
    const client = new Client({ name: "e2e-http", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(url)); // no Authorization header
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it("accepts a connection with the correct bearer token", async () => {
    const client = await connect(await startServer({ authToken: "s3cret" }), "s3cret");
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });
});
