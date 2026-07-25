import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { looksLikeOpenApi, parseOpenApi } from "./openapiParser";
import { assembleRequest } from "../exec/assembleRequest";
import type { FolderItem, RequestItem, Environment } from "../model";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(here, "fixtures", "openapi.json"), "utf8"));
const seq = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-${(n += 1)}`;
};

const flatten = (items: (FolderItem | RequestItem)[]): RequestItem[] =>
  items.flatMap((i) => (i.type === "folder" ? flatten(i.items) : [i]));

describe("looksLikeOpenApi", () => {
  it("detects a 3.x document", () => {
    expect(looksLikeOpenApi(fixture())).toBe(true);
    expect(looksLikeOpenApi({ openapi: "3.1.0" })).toBe(true);
  });
  it("rejects non-3.x / non-OpenAPI input", () => {
    expect(looksLikeOpenApi({ swagger: "2.0" })).toBe(false);
    expect(looksLikeOpenApi({ info: { schema: "postman" } })).toBe(false);
    expect(looksLikeOpenApi(null)).toBe(false);
  });
});

describe("parseOpenApi", () => {
  it("throws on non-OpenAPI input", () => {
    expect(() => parseOpenApi({ portiq: 1 })).toThrow();
  });

  it("names the collection from info.title and exposes a flat, resolved baseUrl variable", () => {
    const col = parseOpenApi(fixture(), { newId: seq() }).collections[0];
    expect(col.name).toBe("Petstore");
    expect(col.variables?.baseUrl).toBe("https://api.petstore.io/v1");
    expect(col.variables?.host).toBe("api.petstore.io");
  });

  it("groups operations into folders by first tag, untagged at root", () => {
    const col = parseOpenApi(fixture(), { newId: seq() }).collections[0];
    const pets = col.items.find((i) => i.type === "folder" && i.name === "pets") as FolderItem;
    expect(pets).toBeTruthy();
    expect(flatten(pets.items).map((r) => r.method).sort()).toEqual(["GET", "GET", "POST"]);
    // untagged /health sits at the collection root
    expect(col.items.some((i) => i.type === "request" && (i as RequestItem).name === "Health check")).toBe(true);
  });

  it("builds urls from {{baseUrl}} + templated path", () => {
    const reqs = flatten(parseOpenApi(fixture(), { newId: seq() }).collections[0].items);
    const getPet = reqs.find((r) => r.name === "Get a pet")!;
    expect(getPet.url).toBe("{{baseUrl}}/pets/{{petId}}");
  });

  it("resolves a $ref query parameter and a header parameter", () => {
    const reqs = flatten(parseOpenApi(fixture(), { newId: seq() }).collections[0].items);
    const list = reqs.find((r) => r.name === "List pets")!;
    expect(list.paramsRows!.map((r) => [r.key, r.value])).toEqual([["page", "1"]]);
    expect(list.headersRows!.some((h) => h.key === "X-Trace")).toBe(true);
  });

  it("uses the document-level bearer security by default and per-op apiKey override", () => {
    const reqs = flatten(parseOpenApi(fixture(), { newId: seq() }).collections[0].items);
    expect(reqs.find((r) => r.name === "List pets")!.authType).toBe("bearer");
    const getPet = reqs.find((r) => r.name === "Get a pet")!;
    expect(getPet.authType).toBe("api_key");
    expect(getPet.authConfig!.api_key).toEqual({ key: "X-Api-Key", value: "", add_to: "header" });
  });

  it("resolves a $ref json requestBody into a json body example", () => {
    const reqs = flatten(parseOpenApi(fixture(), { newId: seq() }).collections[0].items);
    const create = reqs.find((r) => r.name === "createPet")!;
    expect(create.method).toBe("POST");
    expect(create.bodyType).toBe("json");
    expect(JSON.parse(create.bodyText!)).toEqual({ name: "Rex", age: 0 });
  });

  it("resolves the imported baseUrl end-to-end through assembleRequest (no leftover braces)", () => {
    const col = parseOpenApi(fixture(), { newId: seq() }).collections[0];
    const list = flatten(col.items).find((r) => r.name === "List pets")!;
    // baseUrl is baked to a flat literal at import time, so it resolves
    // correctly even though interpolate() only expands {{...}} tokens once
    // per call — no manual pre-flattening of the collection vars needed.
    const env: Environment = {
      id: "env-1",
      name: "Imported",
      vars: Object.entries(col.variables ?? {}).map(([key, value]) => ({
        key,
        value,
        comment: "",
        enabled: true,
      })),
    };
    const payload = assembleRequest(list, { env });
    expect(payload.url).toBe("https://api.petstore.io/v1/pets");
    expect(payload.url).not.toMatch(/[{}]/);
  });

  it("falls back to a {{var}} token when a server variable has no default (spec-violating input)", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "NoDefault", version: "1.0.0" },
      servers: [
        {
          url: "https://{host}/v1",
          variables: { host: {} },
        },
      ],
      paths: {},
    };
    const col = parseOpenApi(doc, { newId: seq() }).collections[0];
    expect(col.variables?.baseUrl).toBe("https://{{host}}/v1");
    expect(col.variables?.host).toBeUndefined();
  });

  it("terminates on a cyclic $ref instead of hanging (self-referencing schema)", () => {
    const cyclicDoc = {
      openapi: "3.0.3",
      info: { title: "Cyclic", version: "1.0.0" },
      paths: {
        "/nodes": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Node" } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: { $ref: "#/components/schemas/Node" },
        },
      },
    };
    let result: ReturnType<typeof parseOpenApi>;
    expect(() => {
      result = parseOpenApi(cyclicDoc, { newId: seq() });
    }).not.toThrow();
    const reqs = flatten(result!.collections[0].items);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].bodyType).toBe("json");
    expect(reqs[0].bodyText).toBe("");
  });
});
