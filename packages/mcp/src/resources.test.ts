import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { connectInProcess } from "./testkit/inProcessClient";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/1" },
      { type: "request", id: "fl1", name: "Flow", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/f", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
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

const readJson = async (c: Awaited<ReturnType<typeof client>>, uri: string) =>
  JSON.parse((await c.readResource({ uri })).contents[0].text as string);

describe("resources", () => {
  it("lists the static resources", async () => {
    const c = await client();
    const uris = (await c.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("portiq://collections");
    expect(uris).toContain("portiq://environments");
    expect(uris).toContain("portiq://flows");
    expect(uris).toContain("portiq://history");
  });

  it("reads a collection by id", async () => {
    const c = await client();
    const data = await readJson(c, "portiq://collection/c1");
    expect(data.name).toBe("API");
  });

  it("reads a request by id", async () => {
    const c = await client();
    const data = await readJson(c, "portiq://request/r1");
    expect(data.method).toBe("GET");
  });

  it("lists only dagGraph requests under flows", async () => {
    const c = await client();
    const flows = await readJson(c, "portiq://flows");
    expect(flows.map((f: { id: string }) => f.id)).toEqual(["fl1"]);
  });

  it("returns an empty history array", async () => {
    const c = await client();
    expect(await readJson(c, "portiq://history")).toEqual([]);
  });
});
