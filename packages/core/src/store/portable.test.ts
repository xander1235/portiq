import { describe, it, expect } from "vitest";
import { exportPortable, importPortable, mergeIntoAppState } from "./portable";
import type { AppState } from "../model";

const base = (): AppState => ({
  collections: [{ id: "c1", name: "A", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("portable files", () => {
  it("exports collections and environments with a version marker", () => {
    const file = exportPortable(base(), { exportedAt: "2026-07-23T00:00:00Z" });
    expect(file.portiq).toBe(1);
    expect(file.collections[0].id).toBe("c1");
    expect(file.environments[0].id).toBe("e1");
    expect(file.exportedAt).toBe("2026-07-23T00:00:00Z");
  });

  it("imports a valid portable file", () => {
    const file = exportPortable(base());
    const imported = importPortable(JSON.parse(JSON.stringify(file)));
    expect(imported.collections).toHaveLength(1);
    expect(imported.environments).toHaveLength(1);
  });

  it("rejects a file without the portiq marker", () => {
    expect(() => importPortable({ collections: [] })).toThrow(/portiq/i);
  });

  it("merges incoming collections, overwriting by id", () => {
    const merged = mergeIntoAppState(base(), {
      collections: [{ id: "c1", name: "A-updated", items: [] }, { id: "c2", name: "B", items: [] }],
      environments: [{ id: "e2", name: "Prod", vars: [] }],
    });
    expect(merged.collections.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(merged.collections.find((c) => c.id === "c1")?.name).toBe("A-updated");
    expect(merged.environments.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });
});
