import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AppState } from "@portiq/core";
import { withTempDataDir, seedStore } from "./testkit/tempStore";
import { startTestHttpServer } from "./testkit/httpServer";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages/mcp/dist/bin.js");

let http: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  execSync("npm run build:mcp", { cwd: ROOT, stdio: "inherit" });
  http = await startTestHttpServer();
}, 120000);

afterAll(async () => {
  while (cleanups.length) cleanups.pop()!();
  await http.close();
});

const seeded = (): { dir: string } => {
  const { dir, cleanup } = withTempDataDir();
  cleanups.push(cleanup);
  const state: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/ping` },
    ] }],
    activeCollectionId: "c1",
    environments: [{ id: "e1", name: "Local", vars: [] }],
    activeEnvId: "e1",
    historyRetentionDays: 7,
  };
  seedStore(dir, state);
  return { dir };
};

async function spawnClient(args: string[]): Promise<Client> {
  const client = new Client({ name: "e2e", version: "0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, ...args], env: { ...process.env } as Record<string, string> });
  await client.connect(transport);
  cleanups.push(() => { void client.close(); });
  return client;
}

describe("portiq-mcp stdio", () => {
  it("hides write tools by default and lists read/exec tools", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_collections");
    expect(names).toContain("run_request");
    expect(names).not.toContain("create_request");
  });

  it("exposes write tools with --allow-writes", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir, "--allow-writes"]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("create_request");
  });

  it("runs a saved request over stdio against a local server", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir]);
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    expect(out.response.json.path).toBe("/ping");
  });
});
