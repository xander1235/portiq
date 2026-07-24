import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/users" },
      { type: "folder", id: "f1", name: "sub", items: [
        { type: "request", id: "r2", name: "Create", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/users" },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "k", value: "v", comment: "", enabled: true }] }],
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

const call = async (c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text as string);

describe("read tools", () => {
  it("exposes all read tools with readOnlyHint", async () => {
    const c = await client();
    const tools = (await c.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of ["list_collections", "list_requests", "get_request", "search", "list_environments", "get_environment", "import_curl"]) {
      expect(names).toContain(n);
    }
    expect(tools.find((t) => t.name === "get_request")?.annotations?.readOnlyHint).toBe(true);
  });

  it("list_requests flattens folders and filters by collection", async () => {
    const c = await client();
    const all = await call(c, "list_requests");
    expect(all.map((r: { id: string }) => r.id).sort()).toEqual(["r1", "r2"]);
    const filtered = await call(c, "list_requests", { collectionId: "c1" });
    expect(filtered).toHaveLength(2);
  });

  it("get_request returns an error result for a missing id", async () => {
    const c = await client();
    const res = await c.callTool({ name: "get_request", arguments: { id: "nope" } });
    expect(res.isError).toBe(true);
  });

  it("search finds by name", async () => {
    const c = await client();
    const hits = await call(c, "search", { query: "create" });
    expect(hits[0].id).toBe("r2");
  });

  it("import_curl parses a command into a request object", async () => {
    const c = await client();
    const parsed = await call(c, "import_curl", { command: "curl -X POST https://x/y -H 'Accept: application/json'" });
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://x/y");
  });
});
