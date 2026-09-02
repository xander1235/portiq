import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { openAppStateStore } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const WRITE_TOOLS = ["create_request", "update_request", "delete_request", "create_collection", "set_environment_variable", "save_ad_hoc_as_request"];

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client(allowWrites: boolean) {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return { c, dir };
}

describe("write gating", () => {
  it("hides all write tools when writes are disabled", async () => {
    const { c } = await client(false);
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of WRITE_TOOLS) expect(names).not.toContain(n);
  });

  it("exposes write tools with destructive/readOnly hints when enabled", async () => {
    const { c } = await client(true);
    const tools = (await c.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of WRITE_TOOLS) expect(names).toContain(n);
    expect(tools.find((t) => t.name === "delete_request")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "create_request")?.annotations?.readOnlyHint).toBe(false);
  });

  it("rejects a disabled write tool call with a clear message", async () => {
    const { c } = await client(false);
    // SDK 1.29.0 surfaces a disabled-tool call as an isError tool result
    // (not a rejected client promise) — the McpError text still says "disabled".
    const res = await c.callTool({ name: "create_collection", arguments: { name: "X" } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/disabled/i);
  });
});

describe("write mutation", () => {
  it("create_collection persists through the optimistic store", async () => {
    const { c, dir } = await client(true);
    const out = JSON.parse((await c.callTool({ name: "create_collection", arguments: { name: "Fresh" } })).content[0].text as string);
    expect(out.id).toBeTruthy();
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.collections().some((col) => col.name === "Fresh")).toBe(true);
    verify.close();
  });

  it("create_request adds a request to a collection", async () => {
    const { c, dir } = await client(true);
    const out = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "New", method: "GET", url: "https://x" } })).content[0].text as string);
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.flattenRequests().some((r) => r.id === out.id)).toBe(true);
    verify.close();
  });

  it("set_environment_variable upserts a variable", async () => {
    const { c, dir } = await client(true);
    await c.callTool({ name: "set_environment_variable", arguments: { envId: "e1", key: "token", value: "abc" } });
    const verify = openAppStateStore({ dataDir: dir });
    const env = verify.environments().find((e) => e.id === "e1");
    expect(env?.vars.find((v) => v.key === "token")?.value).toBe("abc");
    verify.close();
  });

  it("update_request patches whitelisted fields only", async () => {
    const { c, dir } = await client(true);
    await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Old", method: "GET", url: "https://x" } });
    const id = openAppStateStore({ dataDir: dir }).flattenRequests()[0].id;
    const out = JSON.parse((await c.callTool({
      name: "update_request",
      arguments: { id, patch: { name: "New", url: "https://y" } },
    })).content[0].text as string);
    expect(out.name).toBe("New");
    expect(out.url).toBe("https://y");
    expect(out.id).toBe(id);
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.flattenRequests()[0].name).toBe("New");
    verify.close();
  });

  it("update_request neutralizes prototype-pollution keys", async () => {
    const { c, dir } = await client(true);
    await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Old", method: "GET", url: "https://x" } });
    const id = openAppStateStore({ dataDir: dir }).flattenRequests()[0].id;
    // JSON.parse makes "__proto__" an own property, as an MCP wire payload would.
    const patch = JSON.parse('{"__proto__": {"polluted": true}}');
    await c.callTool({ name: "update_request", arguments: { id, patch } });
    const verify = openAppStateStore({ dataDir: dir });
    const item: any = verify.flattenRequests()[0];
    expect(item.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
    expect(item.name).toBe("Old"); // the hostile key was not applied
    verify.close();
  });
});

describe("dagGraph authoring via MCP", () => {
  const graph = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 2,
    nodes: [
      { id: "n1", type: "request", name: "step1", label: "S1", status: "idle", data: { linkedRequestId: "r1", overrides: {} } },
      { id: "n2", type: "condition", name: "check", label: "C", status: "idle", data: { expression: "true" } },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2" }],
    positions: { n1: { x: 0, y: 0 }, n2: { x: 100, y: 0 } },
    ...overrides,
  });

  it("create_request with dagGraph persists a validated flow and sets protocol=dag", async () => {
    const { c, dir } = await client(true);
    const out = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "My Flow", method: "GET", url: "", dagGraph: graph() } })).content[0].text as string);
    expect(out.protocol).toBe("dag");
    expect(out.dagGraph.nodes).toHaveLength(2);
    const verify = openAppStateStore({ dataDir: dir });
    const saved = verify.flattenRequests().find((r) => r.id === out.id);
    expect(saved?.protocol).toBe("dag");
    expect(saved?.dagGraph?.edges).toHaveLength(1);
    expect(saved?.dagGraph?.lastRun).toBeUndefined(); // forged run history stripped
    verify.close();
  });

  it("create_request strips a client-supplied lastRun from the graph", async () => {
    const { c, dir } = await client(true);
    const withHistory = graph({ lastRun: { steps: { step1: { response: { status: 200 } } }, statuses: {}, skipReasons: {}, ranAt: "2020-01-01T00:00:00Z" } });
    const out = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "F", method: "GET", url: "", dagGraph: withHistory } })).content[0].text as string);
    expect(out.dagGraph.lastRun).toBeUndefined();
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.flattenRequests()[0].dagGraph?.lastRun).toBeUndefined();
    verify.close();
  });

  it("create_request rejects a graph with an edge to an unknown node", async () => {
    const { c } = await client(true);
    const bad = graph({ edges: [{ id: "e1", from: "n1", to: "ghost" }] });
    const res = await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Bad", method: "GET", url: "", dagGraph: bad } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/unknown node 'ghost'/);
  });

  it("create_request rejects duplicate node names (steps context is keyed by name)", async () => {
    const { c } = await client(true);
    const dup = graph({ nodes: [
      { id: "a", type: "request", name: "same", label: "A", status: "idle", data: { overrides: {} } },
      { id: "b", type: "request", name: "same", label: "B", status: "idle", data: { overrides: {} } },
    ] });
    const res = await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Dup", method: "GET", url: "", dagGraph: dup } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/duplicate node name 'same'/);
  });

  it("create_request rejects a graph with wrong version", async () => {
    const { c } = await client(true);
    const res = await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "V", method: "GET", url: "", dagGraph: graph({ version: 1 }) } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/version/);
  });

  it("create_request neutralizes prototype keys nested inside dagGraph", async () => {
    const { c, dir } = await client(true);
    const hostile = JSON.parse(`{
      "version": 2,
      "nodes": [{ "id": "n1", "type": "request", "name": "s", "label": "S", "status": "idle",
        "data": { "overrides": {}, "__proto__": { "polluted": true } } }],
      "edges": [], "positions": {}
    }`);
    const res = await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "H", method: "GET", url: "", dagGraph: hostile } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/__proto__/);
    const verify = openAppStateStore({ dataDir: dir });
    const item: any = verify.flattenRequests()[0];
    expect(item).toBeFalsy(); // nothing persisted
    verify.close();
  });

  it("update_request patch with dagGraph converts an existing request into a flow", async () => {
    const { c, dir } = await client(true);
    const created = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Plain", method: "GET", url: "https://x" } })).content[0].text as string);
    const res = await c.callTool({ name: "update_request", arguments: { id: created.id, patch: { dagGraph: graph() } } });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text as string);
    expect(out.protocol).toBe("dag");
    expect(out.dagGraph.nodes).toHaveLength(2);
    const verify = openAppStateStore({ dataDir: dir });
    const saved = verify.flattenRequests().find((r) => r.id === created.id);
    expect(saved?.protocol).toBe("dag");
    expect(saved?.dagGraph?.nodes).toHaveLength(2);
    verify.close();
  });

  it("update_request with dagGraph:null clears the flow", async () => {
    const { c, dir } = await client(true);
    const created = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Flow", method: "GET", url: "", dagGraph: graph() } })).content[0].text as string);
    expect(created.protocol).toBe("dag");
    await c.callTool({ name: "update_request", arguments: { id: created.id, patch: { dagGraph: null } } });
    const verify = openAppStateStore({ dataDir: dir });
    const saved: any = verify.flattenRequests().find((r) => r.id === created.id);
    expect(saved.protocol).toBe("dag"); // protocol unchanged by clear; graph gone
    expect(saved.dagGraph).toBeUndefined();
    verify.close();
  });

  it("update_request rejects an invalid dagGraph patch without mutating the item", async () => {
    const { c, dir } = await client(true);
    const created = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "Keep", method: "GET", url: "https://x" } })).content[0].text as string);
    const res = await c.callTool({ name: "update_request", arguments: { id: created.id, patch: { dagGraph: { version: 2, nodes: [], edges: [] } } } });
    expect(res.isError).toBe(true); // empty nodes rejected
    const verify = openAppStateStore({ dataDir: dir });
    const saved: any = verify.flattenRequests().find((r) => r.id === created.id);
    expect(saved.name).toBe("Keep");
    expect(saved.dagGraph).toBeUndefined();
    verify.close();
  });
});
