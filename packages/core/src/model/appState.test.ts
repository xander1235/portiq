import { describe, it, expect } from "vitest";
import type { AppState, Collection, Environment } from "./index";

describe("AppState model", () => {
  it("round-trips a minimal app state through JSON", () => {
    const collection: Collection = { id: "c1", name: "API", items: [] };
    const environment: Environment = { id: "e1", name: "Local", vars: [] };
    const state: AppState = {
      collections: [collection],
      activeCollectionId: "c1",
      environments: [environment],
      activeEnvId: "e1",
      historyRetentionDays: 7,
    };
    const parsed = JSON.parse(JSON.stringify(state)) as AppState;
    expect(parsed.collections[0].name).toBe("API");
    expect(parsed.environments[0].id).toBe("e1");
    expect(parsed.historyRetentionDays).toBe(7);
  });
});
