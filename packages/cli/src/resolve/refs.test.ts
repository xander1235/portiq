import { describe, it, expect } from "vitest";
import { listRequestsWithPaths, resolveRef, resolveVars, isFlow } from "./refs";
import { UsageError } from "../errors";
import type { AppState } from "@portiq/core";

const state = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
      { type: "folder", id: "f1", name: "Users", items: [
        { type: "request", id: "r2", name: "Create", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/users" },
      ] },
      { type: "request", id: "r3", name: "Flow", description: "", tags: [], protocol: "dag", method: "GET", url: "", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("listRequestsWithPaths", () => {
  it("builds Collection/Folder/Request paths", () => {
    const paths = listRequestsWithPaths(state()).map((r) => r.path).sort();
    expect(paths).toEqual(["API/Flow", "API/List", "API/Users/Create"]);
  });
});

describe("resolveRef", () => {
  it("resolves a nested request by path", () => {
    const r = resolveRef(state(), { ref: "API/Users/Create" });
    expect(r.kind).toBe("request");
    expect(r.request?.id).toBe("r2");
  });
  it("classifies a dag request as a flow", () => {
    expect(resolveRef(state(), { ref: "API/Flow" }).kind).toBe("flow");
  });
  it("resolves a collection", () => {
    expect(resolveRef(state(), { ref: "API" }).kind).toBe("collection");
  });
  it("resolves by id", () => {
    expect(resolveRef(state(), { id: "r1" }).request?.name).toBe("List");
  });
  it("throws UsageError on an unknown ref", () => {
    expect(() => resolveRef(state(), { ref: "API/Nope" })).toThrow(UsageError);
  });
});

describe("resolveVars", () => {
  it("uses the active env and overlays --var", () => {
    expect(resolveVars(state(), { var: ["token=abc"] })).toEqual({ baseUrl: "https://x", token: "abc" });
  });
  it("throws on an unknown --env", () => {
    expect(() => resolveVars(state(), { env: "Prod" })).toThrow(UsageError);
  });
  it("throws on a malformed --var", () => {
    expect(() => resolveVars(state(), { var: ["oops"] })).toThrow(UsageError);
  });
});

describe("isFlow", () => {
  it("is true only for protocol dag", () => {
    expect(isFlow({ type: "request", id: "x", name: "n", description: "", tags: [], protocol: "dag", method: "GET", url: "" })).toBe(true);
  });
});
