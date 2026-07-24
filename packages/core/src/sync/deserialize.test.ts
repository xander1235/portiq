import { describe, it, expect } from "vitest";
import { buildWorkspaceFiles } from "./serialize";
import { mergePulledState } from "./deserialize";
import type { AppState } from "../model";

const local = (): AppState => ({
  collections: [{
    id: "c1", name: "My API",
    items: [{ type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x",
      authConfig: { bearer: { token: "LOCAL_SECRET" }, basic: {}, api_key: {} } } as any],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("mergePulledState", () => {
  it("reconstructs collections from the serialized file tree", () => {
    const fileMap = buildWorkspaceFiles(local());
    const { appState } = mergePulledState(local(), fileMap);
    expect(appState.collections).toHaveLength(1);
    expect(appState.collections[0].id).toBe("c1");
    expect((appState.collections[0].items[0] as any).id).toBe("r1");
  });

  it("restores a sanitized secret from local state on pull", () => {
    const fileMap = buildWorkspaceFiles(local()); // bearer token now a placeholder in the tree
    const { appState } = mergePulledState(local(), fileMap);
    expect((appState.collections[0].items[0] as any).authConfig.bearer.token).toBe("LOCAL_SECRET");
  });

  it("returns history sorted by path", () => {
    const fileMap = buildWorkspaceFiles(local());
    fileMap["workspace/history/2026-07-23/x/root/a.json"] = { timestamp: 1, request: {}, response: {} };
    const { history } = mergePulledState(local(), fileMap);
    expect(history).toHaveLength(1);
  });
});
