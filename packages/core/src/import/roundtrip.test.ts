import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePostmanCollection } from "./postmanParser";
import { parseOpenApi } from "./openapiParser";
import { exportPortable, importPortable, mergeIntoAppState } from "../store/portable";
import type { AppState, Collection, FolderItem, RequestItem } from "../model";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const seq = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-${(n += 1)}`;
};
const emptyState = (): AppState => ({
  collections: [],
  activeCollectionId: "",
  environments: [],
  activeEnvId: null,
  historyRetentionDays: 7,
});

// Strip volatile ids so two parses compare structurally.
const strip = (items: (FolderItem | RequestItem)[]): unknown =>
  items.map((i) =>
    i.type === "folder"
      ? { type: "folder", name: i.name, items: strip(i.items) }
      : { type: "request", name: i.name, method: i.method, url: i.url, authType: i.authType, bodyType: i.bodyType }
  );
const shape = (c: Collection) => ({ name: c.name, variables: c.variables, items: strip(c.items) });

describe("round-trip through the portable layer", () => {
  for (const [label, parse, file] of [
    ["postman", parsePostmanCollection, "postman-collection.json"],
    ["openapi", parseOpenApi, "openapi.json"],
  ] as const) {
    it(`${label}: import → export → import preserves the collection`, () => {
      const lib = parse(load(file), { newId: seq() });
      const merged = mergeIntoAppState(emptyState(), lib);
      const portable = exportPortable(merged);
      const reimported = importPortable(JSON.parse(JSON.stringify(portable)));
      expect(reimported.collections.map(shape)).toEqual(lib.collections.map(shape));
    });

    it(`${label}: re-parsing the same input is stable modulo ids`, () => {
      const a = parse(load(file), { newId: seq() }).collections.map(shape);
      const b = parse(load(file), { newId: seq() }).collections.map(shape);
      expect(a).toEqual(b);
    });
  }
});
