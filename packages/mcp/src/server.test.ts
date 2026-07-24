import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { connectInProcess } from "./testkit/inProcessClient";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

function serverForEmptyStore() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  return createMcpServer(ctx);
}

describe("createMcpServer", () => {
  it("connects to an in-process client and reports server info", async () => {
    const client = await connectInProcess(serverForEmptyStore());
    const version = client.getServerVersion();
    expect(version?.name).toBe("portiq-mcp");
    await client.close();
  });
});
