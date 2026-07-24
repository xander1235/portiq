import { describe, it, expect } from "vitest";
import { searchRequestsContext, flattenCollections, buildResponseContext, buildCollectionContext } from "./context";

const collections = () => [
  {
    id: "c1",
    name: "API",
    items: [
      { type: "request", id: "r1", name: "List Users", method: "GET", url: "https://x/users" },
      { type: "folder", id: "f1", name: "Auth", items: [
        { type: "request", id: "r2", name: "Login", method: "POST", url: "https://x/login" },
      ] },
    ],
  },
];

describe("flattenCollections", () => {
  it("flattens nested folders into a single request list", () => {
    expect(flattenCollections(collections()).map((r: any) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("searchRequestsContext", () => {
  it("returns fuzzy matches for a prompt", () => {
    const results = searchRequestsContext("find the login request", collections());
    expect(results.some((r: any) => r.id === "r2")).toBe(true);
  });

  it("returns an empty array for an empty library", () => {
    expect(searchRequestsContext("anything", [])).toEqual([]);
  });
});

describe("buildResponseContext", () => {
  it("reports no data when responseData is null", () => {
    expect(buildResponseContext(null)).toBe("No response data available yet.");
  });

  it("compresses an array-of-objects body and includes a Status line", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, name: "Alice", role: "admin" }));
    const ctx = buildResponseContext({ status: 200, statusText: "OK", headers: {}, body: JSON.stringify(rows) });
    expect(ctx).toContain("Status: 200 OK");
    expect(ctx).toContain("__schema");
  });

  it("truncates very long bodies with a marker", () => {
    const big = "x".repeat(30000);
    const ctx = buildResponseContext({ status: 200, statusText: "OK", headers: {}, body: big });
    expect(ctx).toContain("[TRUNCATED: showing 25000 of");
  });
});

describe("buildCollectionContext", () => {
  it("summarizes folders and request counts", () => {
    const summary = buildCollectionContext(collections());
    expect(summary[0]).toMatchObject({ id: "c1", name: "API", requestCount: 1 });
    expect(summary[0].folders).toEqual([{ id: "f1", name: "Auth" }]);
  });
});
