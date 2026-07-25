import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectImportFormat, importLibrary } from "./collectionImport";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const seq = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-${(n += 1)}`;
};

describe("detectImportFormat", () => {
  it("classifies each supported shape", () => {
    expect(detectImportFormat({ portiq: 1, collections: [], environments: [] })).toBe("portiq");
    expect(detectImportFormat(load("postman-collection.json"))).toBe("postman");
    expect(detectImportFormat(load("openapi.json"))).toBe("openapi");
    expect(detectImportFormat({ hello: "world" })).toBe("unknown");
    expect(detectImportFormat(null)).toBe("unknown");
  });
});

describe("importLibrary", () => {
  it("dispatches portiq portable files through importPortable", () => {
    const lib = importLibrary({ portiq: 1, collections: [{ id: "c1", name: "A", items: [] }], environments: [] });
    expect(lib.collections.map((c) => c.id)).toEqual(["c1"]);
  });

  it("dispatches Postman collections", () => {
    const lib = importLibrary(load("postman-collection.json"), { newId: seq() });
    expect(lib.collections[0].name).toBe("Sample API");
  });

  it("dispatches OpenAPI documents", () => {
    const lib = importLibrary(load("openapi.json"), { newId: seq() });
    expect(lib.collections[0].name).toBe("Petstore");
  });

  it("throws on an unrecognized format", () => {
    expect(() => importLibrary({ nope: true })).toThrow(/Unrecognized import format/);
  });
});
