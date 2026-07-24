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
});
