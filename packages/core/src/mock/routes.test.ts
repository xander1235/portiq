import { describe, it, expect } from "vitest";
import { sanitizeRoutes, generateRoutesFromCollection } from "./routes";
import type { Collection } from "../model";

describe("sanitizeRoutes", () => {
  it("fills defaults for a bare route", () => {
    const [r] = sanitizeRoutes([{ path: "/x" }]);
    expect(r).toEqual({
      method: "GET",
      path: "/x",
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      delay: 0,
    });
  });

  it("JSON-stringifies an object body", () => {
    const [r] = sanitizeRoutes([{ path: "/y", body: { a: 1 } }]);
    expect(r.body).toBe('{"a":1}');
  });

  it("preserves a string body verbatim", () => {
    const [r] = sanitizeRoutes([{ path: "/z", body: "raw" }]);
    expect(r.body).toBe("raw");
  });

  it("returns [] for nullish input", () => {
    expect(sanitizeRoutes(null)).toEqual([]);
  });
});

describe("generateRoutesFromCollection", () => {
  const collection: Collection = {
    id: "c1",
    name: "API",
    items: [
      {
        type: "request", id: "r1", name: "List Users", description: "", tags: [],
        protocol: "http", method: "GET", url: "https://api.test/users",
      },
      {
        type: "folder", id: "f1", name: "sub",
        items: [
          {
            type: "request", id: "r2", name: "Create", description: "", tags: [],
            protocol: "http", method: "POST", url: "/items?q=1",
          },
        ],
      },
    ],
  };

  it("derives one route per request across folders", () => {
    const routes = generateRoutesFromCollection(collection);
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /users",
      "POST /items",
    ]);
  });

  it("embeds the source request name in the body", () => {
    const [first] = generateRoutesFromCollection(collection);
    expect(first.body).toContain('"_mockSource": "List Users"');
  });

  it("returns [] when the collection has no items", () => {
    expect(generateRoutesFromCollection({ id: "e", name: "empty", items: [] })).toEqual([]);
  });
});
