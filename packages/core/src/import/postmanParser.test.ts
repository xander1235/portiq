import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { looksLikePostman, parsePostmanCollection } from "./postmanParser";
import type { FolderItem, RequestItem } from "../model";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(readFileSync(join(here, "fixtures", "postman-collection.json"), "utf8"));

// Deterministic id factory so assertions are stable.
const seq = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-${(n += 1)}`;
};

describe("looksLikePostman", () => {
  it("detects a v2.1 schema", () => {
    expect(looksLikePostman(fixture())).toBe(true);
  });
  it("rejects non-Postman input", () => {
    expect(looksLikePostman({ openapi: "3.0.0" })).toBe(false);
    expect(looksLikePostman({ portiq: 1 })).toBe(false);
    expect(looksLikePostman(null)).toBe(false);
    expect(looksLikePostman("curl x")).toBe(false);
  });
});

describe("parsePostmanCollection", () => {
  it("throws on non-Postman input", () => {
    expect(() => parsePostmanCollection({ openapi: "3.0.0" })).toThrow();
  });

  it("maps info name and collection variables", () => {
    const { collections } = parsePostmanCollection(fixture(), { newId: seq() });
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("Sample API");
    expect(collections[0].variables).toEqual({ baseUrl: "https://api.example.com" });
  });

  it("nests folders and requests", () => {
    const col = parsePostmanCollection(fixture(), { newId: seq() }).collections[0];
    const users = col.items.find((i) => i.type === "folder" && i.name === "Users") as FolderItem;
    expect(users).toBeTruthy();
    expect(users.items.map((i) => (i as RequestItem).name)).toEqual(["List users", "Create user"]);
    // top-level request sits beside the folder
    expect(col.items.some((i) => i.type === "request" && (i as RequestItem).name === "Login")).toBe(true);
  });

  it("maps method (uppercased), headers with disabled flag, and query params", () => {
    const col = parsePostmanCollection(fixture(), { newId: seq() }).collections[0];
    const users = col.items.find((i) => i.type === "folder") as FolderItem;
    const list = users.items[0] as RequestItem;
    expect(list.method).toBe("GET");
    expect(list.url).toBe("{{baseUrl}}/users?page=1");
    expect(list.headersRows!.find((h) => h.key === "Accept")?.value).toBe("application/json");
    expect(list.headersRows!.find((h) => h.key === "X-Debug")?.enabled).toBe(false);
    expect(list.paramsRows!.map((r) => [r.key, r.value])).toEqual([["page", "1"]]);
    const create = users.items[1] as RequestItem;
    expect(create.method).toBe("POST");
  });

  it("maps bearer auth into authConfig", () => {
    const col = parsePostmanCollection(fixture(), { newId: seq() }).collections[0];
    const list = (col.items[0] as FolderItem).items[0] as RequestItem;
    expect(list.authType).toBe("bearer");
    expect(list.authConfig!.bearer.token).toBe("{{token}}");
  });

  it("maps basic auth and urlencoded body with a disabled row", () => {
    const col = parsePostmanCollection(fixture(), { newId: seq() }).collections[0];
    const login = col.items.find((i) => i.type === "request") as RequestItem;
    expect(login.authType).toBe("basic");
    expect(login.authConfig!.basic).toEqual({ username: "admin", password: "s3cret" });
    expect(login.bodyType).toBe("form");
    expect(login.bodyRows!.map((r) => [r.key, r.value, r.enabled])).toEqual([
      ["grant_type", "password", true],
      ["scope", "read", false],
    ]);
  });

  it("maps a raw json body", () => {
    const col = parsePostmanCollection(fixture(), { newId: seq() }).collections[0];
    const create = (col.items[0] as FolderItem).items[1] as RequestItem;
    expect(create.bodyType).toBe("json");
    expect(create.bodyText).toBe('{"name":"ada"}');
  });
});
