import { describe, it, expect } from "vitest";
import { searchLibrary } from "./search";
import type { AppState } from "@portiq/core";

const state = (): AppState => ({
  collections: [{
    id: "c1", name: "Users API",
    items: [
      { type: "request", id: "r1", name: "List Users", description: "", tags: ["users"], protocol: "http", method: "GET", url: "https://api.test/users" },
      { type: "folder", id: "f1", name: "Admin", items: [
        { type: "request", id: "r2", name: "Delete User", description: "", tags: [], protocol: "http", method: "DELETE", url: "https://api.test/users/1" },
        { type: "request", id: "r3", name: "User Flow", description: "", tags: [], protocol: "http", method: "GET", url: "https://api.test/flow", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("searchLibrary", () => {
  it("returns [] for null state or empty query", () => {
    expect(searchLibrary(null, "x")).toEqual([]);
    expect(searchLibrary(state(), "  ")).toEqual([]);
  });

  it("matches request names and urls case-insensitively", () => {
    const hits = searchLibrary(state(), "user");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
  });

  it("matches by http method", () => {
    const hits = searchLibrary(state(), "delete");
    expect(hits[0].id).toBe("r2");
  });

  it("classifies dagGraph requests as flow hits", () => {
    const hit = searchLibrary(state(), "User Flow").find((h) => h.id === "r3");
    expect(hit?.type).toBe("flow");
  });

  it("respects the limit", () => {
    expect(searchLibrary(state(), "user", 1)).toHaveLength(1);
  });
});
