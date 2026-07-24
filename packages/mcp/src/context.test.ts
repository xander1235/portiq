import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("buildContext", () => {
  it("opens the store at the configured data dir and reads seeded data", () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    seedStore(dir, sample());

    const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
    expect(ctx.store.collections()[0].name).toBe("API");
    expect(ctx.transport).toBeDefined();
    ctx.close();
  });
});
