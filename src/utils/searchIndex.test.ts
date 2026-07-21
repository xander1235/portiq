import { describe, it, expect } from "vitest";
import { buildSearchEntities, searchEntities, findAncestorFolderIds } from "./searchIndex";

const collections = [
  {
    id: "c1",
    name: "Payments API",
    items: [
      { type: "request", id: "r1", name: "Create charge", method: "POST", url: "https://api/charges", tags: ["billing"], description: "make a charge" },
      {
        type: "folder", id: "f1", name: "Refunds", items: [
          { type: "request", id: "r2", name: "Issue refund", method: "POST", url: "https://api/refunds" },
        ],
      },
    ],
  },
];
const environments = [{ id: "e1", name: "Production" }];

describe("buildSearchEntities", () => {
  it("flattens collections, folders, requests, and environments", () => {
    const ents = buildSearchEntities(collections, environments);
    const types = ents.map((e) => `${e.type}:${e.id}`);
    expect(types).toEqual([
      "collection:c1",
      "request:r1",
      "folder:f1",
      "request:r2",
      "environment:e1",
    ]);
  });
  it("attaches collectionId to requests and folders", () => {
    const ents = buildSearchEntities(collections, environments);
    expect(ents.find((e) => e.id === "r2")?.collectionId).toBe("c1");
    expect(ents.find((e) => e.id === "f1")?.collectionId).toBe("c1");
  });
  it("tolerates empty / missing input", () => {
    expect(buildSearchEntities([], [])).toEqual([]);
    expect(buildSearchEntities(undefined as any, undefined as any)).toEqual([]);
  });
});

describe("searchEntities", () => {
  const ents = buildSearchEntities(collections, environments);
  it("returns [] for an empty query", () => {
    expect(searchEntities(ents, "   ")).toEqual([]);
  });
  it("matches a request by name", () => {
    const hits = searchEntities(ents, "refund");
    expect(hits.some((h) => h.id === "r2")).toBe(true);
  });
  it("matches a request by url and by tag/description keywords", () => {
    expect(searchEntities(ents, "charges").some((h) => h.id === "r1")).toBe(true);
    expect(searchEntities(ents, "billing").some((h) => h.id === "r1")).toBe(true);
  });
  it("matches an environment by name", () => {
    expect(searchEntities(ents, "Production").some((h) => h.type === "environment")).toBe(true);
  });
  it("respects the limit", () => {
    expect(searchEntities(ents, "a", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("findAncestorFolderIds", () => {
  it("returns [] for a top-level item", () => {
    expect(findAncestorFolderIds(collections[0].items, "r1")).toEqual([]);
  });
  it("returns the folder chain for a nested request", () => {
    expect(findAncestorFolderIds(collections[0].items, "r2")).toEqual(["f1"]);
  });
  it("returns null when not found", () => {
    expect(findAncestorFolderIds(collections[0].items, "nope")).toBeNull();
  });
});
