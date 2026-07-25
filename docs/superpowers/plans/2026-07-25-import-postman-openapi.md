# Postman & OpenAPI Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add framework-free core importers for Postman Collection v2.1 and OpenAPI 3.x that map faithfully into the Portiq collection model (folders/requests/auth/headers/params/body/variables), then surface both through the `portiq import` CLI command and the renderer's JSON-collection import path, mirroring how curl import is surfaced.

**Architecture:** Two pure parsers (`postmanParser.ts`, `openapiParser.ts`) plus a shared id factory and a small `collectionImport.ts` dispatcher land in `@portiq/core`'s existing `src/import/` directory. Each parser returns the same `{ collections, environments }` shape `store/portable.ts` already produces, so it flows through the existing `mergeIntoAppState` merge path with zero new merge logic. The CLI `import` command's JSON branch swaps `importPortable` for the format-detecting `importLibrary` dispatcher; the renderer's `parseImportData` delegates its inline Postman branch to core and gains an OpenAPI branch — exactly the "renderer delegates parsing to core, keeps its UI wiring" move used for curl import.

**Tech Stack:** TypeScript (framework-free ESM in `@portiq/core`), Vitest (Node env for core/cli), Commander@12 (CLI), React + Vite (renderer). No new runtime dependencies — parsers use only built-in string/JSON handling and the global `crypto.randomUUID` (guarded).

## Global Constraints

- **Framework-free core.** `@portiq/core` must never import Electron/DOM/React. Node-only modules
  (better-sqlite3, node:os/http/child_process, @grpc/*, @octokit/rest) must stay OFF the browser barrels
  (`src/index.browser.ts`, `src/ai/index.browser.ts`) and behind Node-only subpath exports
  (`./flows`, `./grpc`, `./sync`). The Vite renderer resolves core via `vite.config.js` array/RegExp
  `resolve.alias` → browser barrels (rolldown-vite ignores the `browser` export condition; the alias is
  the working mechanism). Any new Node-only capability follows this same pattern or the renderer white-screens.
- **better-sqlite3 native ABI toggle.** One hoisted binary serves EITHER Node (vitest/CLI/MCP) OR
  Electron (`npm run rebuild`), not both. Tests run on the Node ABI; the GUI smoke needs `npm run rebuild` first.
- **ESM-octokit / CJS-sync boundary.** `@octokit/rest` is ESM-only; the CLI is CommonJS. `./sync` is
  esbuild-bundled to `dist/sync/index.cjs` (octokit inlined, native/runtime deps `--external`), exposed
  behind the `require` export condition. octokit must stay OUT of the Electron `.` dist. Any new sync/ESM
  dep follows this bundling approach.
- **Classic-resolution type wiring.** CLI/MCP builds use classic `moduleResolution:"Node"`, which IGNORES
  core's `exports` map. Subpath TYPES are supplied via `baseUrl`+`paths`→`../../node_modules/@portiq/core/src/...`
  in each package's `tsconfig.build.json` (NOT via `types` conditions in core's exports map — that would
  redirect vitest/renderer to stale dist). Follow this if a task adds a new core subpath the CLI/MCP consume.
- **Shared storage + concurrency.** All surfaces share one `<userData>/appdata.sqlite`; core's
  `resolveDataDir()` reproduces Electron's userData path (app name pinned to `"Portiq"`). Writes go through
  core's optimistic-concurrency path (`openKvStore().setIfVersion(key, value, expectedVersion)` → throws
  `ConflictError`). `assembleRequest()` on the top `@portiq/core` barrel is the CANONICAL rows→payload
  builder — never reintroduce a parallel copy.
- **Testing.** vitest (Node env for core/cli/mcp; jsdom where a renderer unit exists). TDD: write the
  failing test first, run it red, implement minimally, run it green, commit. The root `pretest` hook builds
  core/cli/mcp dists before the suite; CLI integration tests spawn the built binary. Keep the full suite green.
- **Commits.** Conventional Commits, appropriate scope, each ending with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Frequent, one deliverable each.
  NEVER stage the untracked junk dirs (`.claude/skills/ui-ux-pro-max/scripts/__pycache__/`,
  `ux-review-visuals/`). Stage only files your task changed.
- DRY, YAGNI, TDD, frequent commits. No placeholders in the plan (see format rules).

### Subsystem-specific constraints

- **No new import subpath.** These parsers are pure (no `node:` builtins, no native addons), so they ship on
  BOTH the full barrel (`src/index.ts`) and the renderer barrel (`src/index.browser.ts`) — the renderer
  consumes `parsePostmanCollection`/`parseOpenApi` directly. Do NOT put them behind a Node-only subpath.
- **Reuse the portable merge path.** Every parser returns the exact `{ collections: Collection[]; environments: Environment[] }`
  shape that `store/portable.ts` `importPortable` already returns, so `mergeIntoAppState` (merge-by-id) is
  reused verbatim — no new merge/collision logic in this plan.
- **Injectable id factory.** Parsers accept `opts.newId?: (prefix: string) => string`. Default = `createIdFactory()`
  (`crypto.randomUUID` with a counter fallback). The renderer injects its existing `genId` so imported ids keep
  the renderer's `col-`/`fld-`/`req-` convention; tests inject a deterministic sequential factory.
- **Template syntax is Portiq-native.** Postman `{{var}}` tokens already match Portiq's `{{ }}` interpolation and
  are preserved byte-for-byte. OpenAPI path templates `{id}` are converted to `{{id}}`.
- **v1 scope limits (call out, do not silently omit):** JSON input only (YAML OpenAPI is deferred — the renderer
  and CLI both `JSON.parse` before dispatch); OpenAPI `$ref` resolution is limited to local `#/...` pointers within
  the same document (cycle-guarded); Swagger 2.0 and remote `$ref` are out of scope.
- Run a single core test: `npx vitest run packages/core/src/import/<file>.test.ts`.
  Run a single CLI test: `npm rebuild better-sqlite3 && npx vitest run packages/cli/src/commands/import.test.ts`
  (the store open needs the Node ABI). Run renderer lint/build: `npm run lint` / `npm run build`.

---

## Verified `@portiq/core` public API this plan builds on (do NOT invent names)

Grounded in the real source (cited):

- **model** (`packages/core/src/model/request.ts`, `environment.ts`, `appState.ts`):
  - `RequestRow { key; value; comment; enabled; kind?: "text"|"file"; fileName?; mimeType?; fileBase64? }`
  - `AuthConfig { bearer:{token}; basic:{username;password}; api_key:{key;value;add_to:"header"|"query"} }`
  - `RequestItem { type:"request"; id; name; description; tags:string[]; protocol; method; url; headersRows?: RequestRow[]; paramsRows?: RequestRow[]; authType?; authConfig?: AuthConfig; bodyType?; bodyText?; bodyRows?: RequestRow[]; ... }`
  - `FolderItem { type:"folder"; id; name; items:(FolderItem|RequestItem)[] }`
  - `Collection { id; name; items:(FolderItem|RequestItem)[]; variables?: Record<string,string> }`
  - `Environment { id; name; vars: EnvVar[] }`, `AppState { collections: Collection[]; environments: Environment[]; ... }`
- **store/portable** (`packages/core/src/store/portable.ts`):
  - `importPortable(file: unknown): { collections: Collection[]; environments: Environment[] }` — throws unless `file.portiq === 1`.
  - `exportPortable(state: AppState, opts?): PortableFile` where `PortableFile { portiq: 1; exportedAt?; collections; environments }`.
  - `mergeIntoAppState(state, incoming: { collections; environments }): AppState` — merge-by-id.
- **import/curlParser** (`packages/core/src/import/curlParser.ts`): existing sibling; `parseCurl`, `looksLikeCurl`, `inferRequestNameFromUrl`, `ParsedCurl`. Its `.test.ts` is the style reference.
- **CLI** (`packages/cli/src/commands/import.ts`): `applyImport(state, contents, collectionName)` detects curl via `looksLikeCurl`, else `JSON.parse` → `importPortable` → `mergeIntoAppState`. Registered in `packages/cli/src/commands/index.ts`. Test harness in `import.test.ts` (`openAppStateStore({ dataDir })`, `buildProgram(ctx, [importCommand]).parseAsync(...)`).
- **Renderer** (`src/hooks/useRequestState.ts`): `parseImportData(imported: any): Collection | null | false` with branches for HTTPie (`imported.meta.format==="httpie"`), Postman v2.1 (`imported.info.schema.includes("postman.com/json/collection/v2.1.0")`, lines ~761–859), and native portiq (`imported.id`). Local `genId(prefix)` = `` `${prefix}-${crypto.randomUUID()...}` `` (lines 15–18). Callers: `importCollection` (file), `handleImportTextSubmit`, `handleImportApiSubmit` in `src/App.tsx` — all route JSON through `parseImportData`, so delegating inside it covers file/paste/URL import at once.

---

## File Structure

**Created (core):**
- `packages/core/src/import/types.ts` — `ImportedLibrary { collections: Collection[]; environments: Environment[] }` shared return type.
- `packages/core/src/import/ids.ts` — `IdFactory` type + `createIdFactory()` default id generator.
- `packages/core/src/import/ids.test.ts` — id-factory unit tests.
- `packages/core/src/import/postmanParser.ts` — `looksLikePostman`, `parsePostmanCollection`.
- `packages/core/src/import/postmanParser.test.ts` — Postman parser unit tests.
- `packages/core/src/import/openapiParser.ts` — `looksLikeOpenApi`, `parseOpenApi`.
- `packages/core/src/import/openapiParser.test.ts` — OpenAPI parser unit tests.
- `packages/core/src/import/collectionImport.ts` — `ImportFormat`, `detectImportFormat`, `importLibrary` dispatcher.
- `packages/core/src/import/collectionImport.test.ts` — dispatcher unit tests.
- `packages/core/src/import/roundtrip.test.ts` — portable-layer round-trip stability tests.
- `packages/core/src/import/fixtures/postman-collection.json` — realistic Postman v2.1 fixture.
- `packages/core/src/import/fixtures/openapi.json` — realistic OpenAPI 3.0 fixture.

**Modified (core barrels):**
- `packages/core/src/index.ts` — re-export the four new modules (after the `./import/curlParser` line).
- `packages/core/src/index.browser.ts` — same re-exports (renderer-safe).

**Modified (CLI):**
- `packages/cli/src/commands/import.ts` — JSON branch calls `importLibrary` (format detection) instead of `importPortable`; description updated.
- `packages/cli/src/commands/import.test.ts` — add Postman + OpenAPI fixture-file cases.

**Modified (renderer):**
- `src/hooks/useRequestState.ts` — `parseImportData` delegates the Postman branch to `parsePostmanCollection` and adds a `looksLikeOpenApi` → `parseOpenApi` branch, injecting `genId`.

---

## Task 1: Shared import types + injectable id factory

**Files:**
- Create: `packages/core/src/import/types.ts`
- Create: `packages/core/src/import/ids.ts`
- Test: `packages/core/src/import/ids.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Environment` from `../model`.
- Produces:
  - `interface ImportedLibrary { collections: Collection[]; environments: Environment[] }`
  - `type IdFactory = (prefix: string) => string`
  - `function createIdFactory(): IdFactory`

- [ ] **Step 1: Write the failing id-factory test**

Create `packages/core/src/import/ids.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createIdFactory } from "./ids";

describe("createIdFactory", () => {
  it("prefixes generated ids", () => {
    const newId = createIdFactory();
    expect(newId("col")).toMatch(/^col-/);
    expect(newId("req")).toMatch(/^req-/);
  });

  it("returns unique ids across calls", () => {
    const newId = createIdFactory();
    const ids = new Set([newId("x"), newId("x"), newId("x"), newId("x")]);
    expect(ids.size).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npx vitest run packages/core/src/import/ids.test.ts`
Expected: FAIL — `Cannot find module './ids'`.

- [ ] **Step 3: Create the two modules**

Create `packages/core/src/import/types.ts`:

```ts
import type { Collection, Environment } from "../model";

/** The normalized result every importer produces — identical to the shape
 *  `store/portable.ts` `importPortable` returns, so it flows straight through
 *  `mergeIntoAppState` (merge-by-id) with no new merge logic. */
export interface ImportedLibrary {
  collections: Collection[];
  environments: Environment[];
}
```

Create `packages/core/src/import/ids.ts`:

```ts
export type IdFactory = (prefix: string) => string;

let fallbackCounter = 0;

/** Default id generator: `crypto.randomUUID` when available (browser + Node 19+),
 *  otherwise a monotonic time+counter fallback. Callers that need determinism
 *  (tests, the renderer's `genId`) inject their own factory instead. */
export function createIdFactory(): IdFactory {
  return (prefix: string) => {
    const g = typeof crypto !== "undefined" ? (crypto as { randomUUID?: () => string }) : undefined;
    if (g && typeof g.randomUUID === "function") return `${prefix}-${g.randomUUID()}`;
    fallbackCounter += 1;
    return `${prefix}-${Date.now()}-${fallbackCounter}`;
  };
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run packages/core/src/import/ids.test.ts`
Expected: PASS (2 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/types.ts packages/core/src/import/ids.ts packages/core/src/import/ids.test.ts
git commit -m "feat(import): shared ImportedLibrary type + injectable id factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Postman Collection v2.1 parser

**Files:**
- Create: `packages/core/src/import/postmanParser.ts`
- Create: `packages/core/src/import/fixtures/postman-collection.json`
- Test: `packages/core/src/import/postmanParser.test.ts`

**Interfaces:**
- Consumes: `Collection`, `FolderItem`, `RequestItem`, `RequestRow`, `AuthConfig` from `../model`; `ImportedLibrary` from `./types`; `IdFactory`, `createIdFactory` from `./ids`.
- Produces:
  - `function looksLikePostman(data: unknown): boolean`
  - `function parsePostmanCollection(data: unknown, opts?: { newId?: IdFactory }): ImportedLibrary` — throws if not a Postman v2.x collection.

- [ ] **Step 1: Create the fixture**

Create `packages/core/src/import/fixtures/postman-collection.json`:

```json
{
  "info": {
    "name": "Sample API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "https://api.example.com" }
  ],
  "item": [
    {
      "name": "Users",
      "item": [
        {
          "name": "List users",
          "request": {
            "method": "GET",
            "header": [
              { "key": "Accept", "value": "application/json" },
              { "key": "X-Debug", "value": "1", "disabled": true }
            ],
            "url": {
              "raw": "{{baseUrl}}/users?page=1",
              "query": [{ "key": "page", "value": "1" }]
            },
            "auth": {
              "type": "bearer",
              "bearer": [{ "key": "token", "value": "{{token}}" }]
            }
          }
        },
        {
          "name": "Create user",
          "request": {
            "method": "post",
            "header": [{ "key": "Content-Type", "value": "application/json" }],
            "url": "{{baseUrl}}/users",
            "body": {
              "mode": "raw",
              "raw": "{\"name\":\"ada\"}",
              "options": { "raw": { "language": "json" } }
            }
          }
        }
      ]
    },
    {
      "name": "Login",
      "request": {
        "method": "POST",
        "url": { "raw": "{{baseUrl}}/login" },
        "auth": {
          "type": "basic",
          "basic": [
            { "key": "username", "value": "admin" },
            { "key": "password", "value": "s3cret" }
          ]
        },
        "body": {
          "mode": "urlencoded",
          "urlencoded": [
            { "key": "grant_type", "value": "password" },
            { "key": "scope", "value": "read", "disabled": true }
          ]
        }
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/import/postmanParser.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests, expect FAIL**

Run: `npx vitest run packages/core/src/import/postmanParser.test.ts`
Expected: FAIL — `Cannot find module './postmanParser'`.

- [ ] **Step 4: Implement the parser**

Create `packages/core/src/import/postmanParser.ts`:

```ts
import type { Collection, FolderItem, RequestItem, RequestRow, AuthConfig } from "../model";
import type { ImportedLibrary } from "./types";
import { createIdFactory, type IdFactory } from "./ids";

const blankRow = (): RequestRow[] => [{ key: "", value: "", comment: "", enabled: true }];

function defaultAuthConfig(): AuthConfig {
  return {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" },
  };
}

export function looksLikePostman(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const info = (data as { info?: { schema?: unknown } }).info;
  const schema = info && typeof info.schema === "string" ? info.schema : "";
  return /(schema\.getpostman\.com|postman\.com)\/json\/collection\/v2\./.test(schema);
}

function kvValue(entries: unknown, key: string): string {
  if (!Array.isArray(entries)) return "";
  const found = entries.find((e) => e && typeof e === "object" && (e as { key?: unknown }).key === key) as
    | { value?: unknown }
    | undefined;
  return found && found.value != null ? String(found.value) : "";
}

function authToConfig(pmAuth: unknown): { authType: string; authConfig: AuthConfig } {
  const authConfig = defaultAuthConfig();
  const a = pmAuth as { type?: unknown; bearer?: unknown; basic?: unknown; apikey?: unknown } | null;
  if (!a || typeof a.type !== "string") return { authType: "none", authConfig };
  switch (a.type) {
    case "bearer":
      authConfig.bearer.token = kvValue(a.bearer, "token");
      return { authType: "bearer", authConfig };
    case "basic":
      authConfig.basic = { username: kvValue(a.basic, "username"), password: kvValue(a.basic, "password") };
      return { authType: "basic", authConfig };
    case "apikey":
      authConfig.api_key = {
        key: kvValue(a.apikey, "key"),
        value: kvValue(a.apikey, "value"),
        add_to: kvValue(a.apikey, "in") === "query" ? "query" : "header",
      };
      return { authType: "api_key", authConfig };
    default:
      return { authType: "none", authConfig };
  }
}

function readUrl(url: unknown): { raw: string; query: RequestRow[] } {
  if (typeof url === "string") return { raw: url, query: blankRow() };
  if (url && typeof url === "object") {
    const u = url as { raw?: unknown; query?: unknown };
    const raw = typeof u.raw === "string" ? u.raw : "";
    const rows = Array.isArray(u.query)
      ? u.query
          .filter((q) => q && typeof q === "object" && (q as { key?: unknown }).key != null)
          .map((q) => {
            const r = q as { key: unknown; value?: unknown; disabled?: unknown };
            return { key: String(r.key), value: r.value != null ? String(r.value) : "", comment: "", enabled: r.disabled !== true };
          })
      : [];
    return { raw, query: rows.length ? rows : blankRow() };
  }
  return { raw: "", query: blankRow() };
}

function kvRows(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((p) => {
    const r = p as { key?: unknown; value?: unknown; disabled?: unknown };
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true };
  });
}

function formDataRows(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((p) => {
    const r = p as { key?: unknown; value?: unknown; type?: unknown; src?: unknown; disabled?: unknown };
    if (r?.type === "file") {
      const src = typeof r.src === "string" ? r.src : "";
      const fileName = src.split(/[/\\]/).pop() || "upload.bin";
      return { key: String(r?.key ?? ""), value: "", comment: "", enabled: r?.disabled !== true, kind: "file" as const, fileName, mimeType: "application/octet-stream" };
    }
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true, kind: "text" as const };
  });
}

function readBody(body: unknown): { bodyType: string; bodyText: string; bodyRows: RequestRow[] } {
  const b = body as { mode?: unknown; raw?: unknown; urlencoded?: unknown; formdata?: unknown; options?: { raw?: { language?: unknown } } } | null;
  if (!b || typeof b !== "object") return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  switch (b.mode) {
    case "raw": {
      const lang = b.options?.raw?.language;
      const isText = typeof lang === "string" && lang !== "json";
      return { bodyType: isText ? "raw" : "json", bodyText: typeof b.raw === "string" ? b.raw : "", bodyRows: blankRow() };
    }
    case "urlencoded":
      return { bodyType: "form", bodyText: "", bodyRows: kvRows(b.urlencoded) };
    case "formdata":
      return { bodyType: "multipart", bodyText: "", bodyRows: formDataRows(b.formdata) };
    default:
      return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  }
}

function readHeaders(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((h) => {
    const r = h as { key?: unknown; value?: unknown; disabled?: unknown };
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true };
  });
}

export function parsePostmanCollection(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  if (!looksLikePostman(data)) throw new Error("Not a Postman v2.1 collection");
  const newId = opts.newId ?? createIdFactory();
  const root = data as { info?: { name?: unknown }; variable?: unknown; item?: unknown };

  const parseItem = (pmItem: unknown): FolderItem | RequestItem | null => {
    if (!pmItem || typeof pmItem !== "object") return null;
    const item = pmItem as { name?: unknown; item?: unknown; request?: any };
    if (Array.isArray(item.item)) {
      return {
        type: "folder",
        id: newId("fld"),
        name: typeof item.name === "string" ? item.name : "Imported Folder",
        items: item.item.map(parseItem).filter(Boolean) as (FolderItem | RequestItem)[],
      };
    }
    if (item.request) {
      const req = item.request;
      const { raw, query } = readUrl(req.url);
      const { authType, authConfig } = authToConfig(req.auth);
      const { bodyType, bodyText, bodyRows } = readBody(req.body);
      return {
        type: "request",
        id: newId("req"),
        name: typeof item.name === "string" ? item.name : "Imported Request",
        description: typeof req.description === "string" ? req.description : "",
        tags: [],
        protocol: "http",
        method: typeof req.method === "string" ? req.method.toUpperCase() : "GET",
        url: raw,
        headersRows: readHeaders(req.header),
        paramsRows: query,
        authType,
        authConfig,
        bodyType,
        bodyText,
        bodyRows,
      };
    }
    return null;
  };

  const variables: Record<string, string> = {};
  if (Array.isArray(root.variable)) {
    for (const v of root.variable) {
      const r = v as { key?: unknown; value?: unknown };
      if (r && r.key != null) variables[String(r.key)] = r.value != null ? String(r.value) : "";
    }
  }

  const collection: Collection = {
    id: newId("col"),
    name: root.info?.name != null ? String(root.info.name) : "Postman Import",
    items: (Array.isArray(root.item) ? root.item : []).map(parseItem).filter(Boolean) as (FolderItem | RequestItem)[],
    ...(Object.keys(variables).length ? { variables } : {}),
  };

  return { collections: [collection], environments: [] };
}
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `npx vitest run packages/core/src/import/postmanParser.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import/postmanParser.ts packages/core/src/import/postmanParser.test.ts packages/core/src/import/fixtures/postman-collection.json
git commit -m "feat(import): framework-free Postman v2.1 collection parser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: OpenAPI 3.x parser

**Files:**
- Create: `packages/core/src/import/openapiParser.ts`
- Create: `packages/core/src/import/fixtures/openapi.json`
- Test: `packages/core/src/import/openapiParser.test.ts`

**Interfaces:**
- Consumes: `Collection`, `FolderItem`, `RequestItem`, `RequestRow`, `AuthConfig` from `../model`; `ImportedLibrary` from `./types`; `IdFactory`, `createIdFactory` from `./ids`.
- Produces:
  - `function looksLikeOpenApi(data: unknown): boolean`
  - `function parseOpenApi(data: unknown, opts?: { newId?: IdFactory }): ImportedLibrary` — throws if `openapi` is not a `3.x` string. Operations are grouped into folders by first tag; base URL from `servers[0]` becomes a `{{baseUrl}}` collection variable; path templates `{id}` → `{{id}}`; local `$ref` (`#/...`) resolved (cycle-guarded).

- [ ] **Step 1: Create the fixture**

Create `packages/core/src/import/fixtures/openapi.json`:

```json
{
  "openapi": "3.0.3",
  "info": { "title": "Petstore", "version": "1.0.0" },
  "servers": [
    {
      "url": "https://{host}/v1",
      "variables": { "host": { "default": "api.petstore.io" } }
    }
  ],
  "security": [{ "bearerAuth": [] }],
  "components": {
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" },
      "apiKeyAuth": { "type": "apiKey", "in": "header", "name": "X-Api-Key" }
    },
    "parameters": {
      "PageParam": { "name": "page", "in": "query", "required": false, "schema": { "type": "integer", "default": 1 } }
    },
    "requestBodies": {
      "PetBody": {
        "content": {
          "application/json": {
            "schema": { "type": "object", "properties": { "name": { "type": "string", "example": "Rex" }, "age": { "type": "integer" } } }
          }
        }
      }
    }
  },
  "paths": {
    "/pets": {
      "get": {
        "tags": ["pets"],
        "summary": "List pets",
        "parameters": [
          { "$ref": "#/components/parameters/PageParam" },
          { "name": "X-Trace", "in": "header", "schema": { "type": "string" } }
        ]
      },
      "post": {
        "tags": ["pets"],
        "operationId": "createPet",
        "requestBody": { "$ref": "#/components/requestBodies/PetBody" }
      }
    },
    "/pets/{petId}": {
      "get": {
        "tags": ["pets"],
        "summary": "Get a pet",
        "security": [{ "apiKeyAuth": [] }],
        "parameters": [{ "name": "petId", "in": "path", "required": true, "schema": { "type": "string" } }]
      }
    },
    "/health": {
      "get": { "summary": "Health check" }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/import/openapiParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { looksLikeOpenApi, parseOpenApi } from "./openapiParser";
import type { FolderItem, RequestItem } from "../model";

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

  it("names the collection from info.title and exposes a baseUrl variable", () => {
    const col = parseOpenApi(fixture(), { newId: seq() }).collections[0];
    expect(col.name).toBe("Petstore");
    expect(col.variables?.baseUrl).toBe("https://{host}/v1");
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
});
```

- [ ] **Step 3: Run the tests, expect FAIL**

Run: `npx vitest run packages/core/src/import/openapiParser.test.ts`
Expected: FAIL — `Cannot find module './openapiParser'`.

- [ ] **Step 4: Implement the parser**

Create `packages/core/src/import/openapiParser.ts`:

```ts
import type { Collection, FolderItem, RequestItem, RequestRow, AuthConfig } from "../model";
import type { ImportedLibrary } from "./types";
import { createIdFactory, type IdFactory } from "./ids";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
const blankRow = (): RequestRow[] => [{ key: "", value: "", comment: "", enabled: true }];

function defaultAuthConfig(): AuthConfig {
  return {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" },
  };
}

export function looksLikeOpenApi(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const v = (data as { openapi?: unknown }).openapi;
  return typeof v === "string" && v.startsWith("3.");
}

/** Resolve a local `#/...` JSON pointer within `doc`; returns `node` unchanged
 *  when it is not a `$ref`. Cycle-guarded; unresolvable pointers yield `{}`. */
function resolveRef(doc: any, node: any, seen: Set<string> = new Set()): any {
  if (node && typeof node === "object" && typeof node.$ref === "string") {
    if (seen.has(node.$ref) || !node.$ref.startsWith("#/")) return {};
    seen.add(node.$ref);
    let cur: any = doc;
    for (const seg of node.$ref.slice(2).split("/")) {
      const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
      cur = cur?.[key];
      if (cur == null) return {};
    }
    return resolveRef(doc, cur, seen);
  }
  return node;
}

function pathToTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function sampleForType(t: unknown): unknown {
  switch (t) {
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}

function schemaExample(schema: any): string {
  if (!schema || typeof schema !== "object") return "";
  if (schema.example !== undefined) return JSON.stringify(schema.example, null, 2);
  if (schema.default !== undefined) return JSON.stringify(schema.default, null, 2);
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries<any>(schema.properties)) {
      const v = raw ?? {};
      obj[k] = v.example !== undefined ? v.example : v.default !== undefined ? v.default : sampleForType(v.type);
    }
    return JSON.stringify(obj, null, 2);
  }
  return "";
}

function paramRows(doc: any, params: any[], where: string): RequestRow[] {
  const rows = (Array.isArray(params) ? params : [])
    .map((p) => resolveRef(doc, p))
    .filter((p) => p && p.in === where && p.name != null)
    .map((p) => ({
      key: String(p.name),
      value:
        p.example != null ? String(p.example) : p.schema && p.schema.default != null ? String(p.schema.default) : "",
      comment: typeof p.description === "string" ? p.description : "",
      enabled: p.required !== false,
    }));
  return rows.length ? rows : blankRow();
}

function propRows(schema: any): RequestRow[] {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return blankRow();
  const rows = Object.keys(props).map((k) => ({ key: k, value: "", comment: "", enabled: true }));
  return rows.length ? rows : blankRow();
}

function readRequestBody(doc: any, requestBody: any): { bodyType: string; bodyText: string; bodyRows: RequestRow[] } {
  const rb = resolveRef(doc, requestBody);
  const content = rb?.content;
  if (!content || typeof content !== "object") return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  if (content["application/json"]) {
    const media = content["application/json"];
    const text =
      media.example !== undefined ? JSON.stringify(media.example, null, 2) : schemaExample(resolveRef(doc, media.schema));
    return { bodyType: "json", bodyText: text, bodyRows: blankRow() };
  }
  if (content["application/x-www-form-urlencoded"]) {
    return { bodyType: "form", bodyText: "", bodyRows: propRows(resolveRef(doc, content["application/x-www-form-urlencoded"].schema)) };
  }
  if (content["multipart/form-data"]) {
    return { bodyType: "multipart", bodyText: "", bodyRows: propRows(resolveRef(doc, content["multipart/form-data"].schema)) };
  }
  return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
}

function securityToAuth(doc: any, security: any): { authType: string; authConfig: AuthConfig } {
  const authConfig = defaultAuthConfig();
  const schemes = doc?.components?.securitySchemes ?? {};
  const reqs: any[] = Array.isArray(security) ? security : [];
  for (const entry of reqs) {
    const name = entry && typeof entry === "object" ? Object.keys(entry)[0] : undefined;
    if (!name) continue;
    const scheme = resolveRef(doc, schemes[name]);
    if (!scheme || typeof scheme !== "object") continue;
    const kind = String(scheme.scheme ?? "").toLowerCase();
    if (scheme.type === "http" && kind === "bearer") return { authType: "bearer", authConfig };
    if (scheme.type === "http" && kind === "basic") return { authType: "basic", authConfig };
    if (scheme.type === "apiKey") {
      authConfig.api_key = { key: typeof scheme.name === "string" ? scheme.name : "", value: "", add_to: scheme.in === "query" ? "query" : "header" };
      return { authType: "api_key", authConfig };
    }
  }
  return { authType: "none", authConfig };
}

export function parseOpenApi(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  if (!looksLikeOpenApi(data)) throw new Error("Not an OpenAPI 3.x document");
  const newId = opts.newId ?? createIdFactory();
  const doc = data as any;

  const server = Array.isArray(doc.servers) && doc.servers[0] ? doc.servers[0] : undefined;
  const variables: Record<string, string> = {};
  if (server && typeof server.url === "string") variables.baseUrl = server.url;
  if (server && server.variables && typeof server.variables === "object") {
    for (const [k, raw] of Object.entries<any>(server.variables)) {
      if (raw && raw.default != null) variables[k] = String(raw.default);
    }
  }

  const foldersByTag = new Map<string, FolderItem>();
  const rootItems: (FolderItem | RequestItem)[] = [];
  const bucketFor = (tag: string): (FolderItem | RequestItem)[] => {
    if (!tag) return rootItems;
    let folder = foldersByTag.get(tag);
    if (!folder) {
      folder = { type: "folder", id: newId("fld"), name: tag, items: [] };
      foldersByTag.set(tag, folder);
      rootItems.push(folder);
    }
    return folder.items;
  };

  const paths = doc.paths && typeof doc.paths === "object" ? doc.paths : {};
  for (const [rawPath, rawPathItem] of Object.entries<any>(paths)) {
    const pathItem = resolveRef(doc, rawPathItem);
    const sharedParams = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const op = pathItem?.[method];
      if (!op || typeof op !== "object") continue;
      const params = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const security = op.security !== undefined ? op.security : doc.security;
      const { authType, authConfig } = securityToAuth(doc, security);
      const { bodyType, bodyText, bodyRows } = readRequestBody(doc, op.requestBody);
      const req: RequestItem = {
        type: "request",
        id: newId("req"),
        name:
          typeof op.summary === "string" && op.summary
            ? op.summary
            : typeof op.operationId === "string" && op.operationId
            ? op.operationId
            : `${method.toUpperCase()} ${rawPath}`,
        description: typeof op.description === "string" ? op.description : "",
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        protocol: "http",
        method: method.toUpperCase(),
        url: (variables.baseUrl ? "{{baseUrl}}" : "") + pathToTemplate(rawPath),
        headersRows: paramRows(doc, params, "header"),
        paramsRows: paramRows(doc, params, "query"),
        authType,
        authConfig,
        bodyType,
        bodyText,
        bodyRows,
      };
      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : "";
      bucketFor(tag).push(req);
    }
  }

  const collection: Collection = {
    id: newId("col"),
    name: doc.info?.title != null ? String(doc.info.title) : "OpenAPI Import",
    items: rootItems,
    ...(Object.keys(variables).length ? { variables } : {}),
  };
  return { collections: [collection], environments: [] };
}
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `npx vitest run packages/core/src/import/openapiParser.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import/openapiParser.ts packages/core/src/import/openapiParser.test.ts packages/core/src/import/fixtures/openapi.json
git commit -m "feat(import): framework-free OpenAPI 3.x parser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Format-detecting dispatcher + barrel exports

**Files:**
- Create: `packages/core/src/import/collectionImport.ts`
- Test: `packages/core/src/import/collectionImport.test.ts`
- Modify: `packages/core/src/index.ts` (after the `export * from "./import/curlParser";` line)
- Modify: `packages/core/src/index.browser.ts` (after the `export * from "./import/curlParser";` line)

**Interfaces:**
- Consumes: `importPortable` from `../store/portable`; `looksLikePostman`, `parsePostmanCollection` from `./postmanParser`; `looksLikeOpenApi`, `parseOpenApi` from `./openapiParser`; `ImportedLibrary` from `./types`; `IdFactory` from `./ids`.
- Produces:
  - `type ImportFormat = "portiq" | "postman" | "openapi" | "unknown"`
  - `function detectImportFormat(data: unknown): ImportFormat`
  - `function importLibrary(data: unknown, opts?: { newId?: IdFactory }): ImportedLibrary` — throws on `"unknown"`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/import/collectionImport.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests, expect FAIL**

Run: `npx vitest run packages/core/src/import/collectionImport.test.ts`
Expected: FAIL — `Cannot find module './collectionImport'`.

- [ ] **Step 3: Implement the dispatcher**

Create `packages/core/src/import/collectionImport.ts`:

```ts
import { importPortable } from "../store/portable";
import type { ImportedLibrary } from "./types";
import type { IdFactory } from "./ids";
import { looksLikePostman, parsePostmanCollection } from "./postmanParser";
import { looksLikeOpenApi, parseOpenApi } from "./openapiParser";

export type ImportFormat = "portiq" | "postman" | "openapi" | "unknown";

export function detectImportFormat(data: unknown): ImportFormat {
  if (data && typeof data === "object") {
    if ((data as { portiq?: unknown }).portiq === 1) return "portiq";
    if (looksLikePostman(data)) return "postman";
    if (looksLikeOpenApi(data)) return "openapi";
  }
  return "unknown";
}

/** Detect and parse any supported JSON collection file into the normalized
 *  `{ collections, environments }` shape consumed by `mergeIntoAppState`. */
export function importLibrary(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  switch (detectImportFormat(data)) {
    case "portiq":
      return importPortable(data);
    case "postman":
      return parsePostmanCollection(data, opts);
    case "openapi":
      return parseOpenApi(data, opts);
    default:
      throw new Error("Unrecognized import format (expected Portiq portable, Postman v2.1, or OpenAPI 3.x)");
  }
}
```

- [ ] **Step 4: Run the tests, expect PASS**

Run: `npx vitest run packages/core/src/import/collectionImport.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Add barrel exports**

In `packages/core/src/index.ts`, immediately after the line `export * from "./import/curlParser";`, add:

```ts
export * from "./import/types";
export * from "./import/ids";
export * from "./import/postmanParser";
export * from "./import/openapiParser";
export * from "./import/collectionImport";
```

In `packages/core/src/index.browser.ts`, immediately after the line `export * from "./import/curlParser";`, add the identical five lines (all five modules are pure — no `node:` builtins — so they are renderer-safe).

- [ ] **Step 6: Verify the full core suite is green and barrels resolve**

Run: `npx vitest run packages/core/src/import`
Expected: PASS (ids, postman, openapi, collectionImport, curlParser all green).

Run: `npm run build:core`
Expected: PASS (tsc + esbuild complete; the new exports compile in both barrels).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/import/collectionImport.ts packages/core/src/import/collectionImport.test.ts packages/core/src/index.ts packages/core/src/index.browser.ts
git commit -m "feat(import): format-detecting importLibrary dispatcher + barrel exports

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Round-trip stability through the portable layer

**Files:**
- Test: `packages/core/src/import/roundtrip.test.ts`

**Interfaces:**
- Consumes: `parsePostmanCollection`, `parseOpenApi` from their modules; `exportPortable`, `importPortable`, `mergeIntoAppState` from `../store/portable`; `AppState` from `../model`.
- Produces: no new source — a test-only deliverable proving that a parsed library survives a full trip through the existing portable serialize/merge path (JSON stringify → parse → `importPortable` → `mergeIntoAppState`) with no structural loss, and that re-parsing the same input is stable modulo ids.

- [ ] **Step 1: Write the failing round-trip tests**

Create `packages/core/src/import/roundtrip.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests, expect FAIL then PASS**

Run: `npx vitest run packages/core/src/import/roundtrip.test.ts`
Expected: initially FAIL if the file has a typo; otherwise these exercise already-implemented code and should PASS on first correct run. If any assertion fails, it reveals a real mapping/serialization loss — fix the parser (Task 2/3), not the test.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/import/roundtrip.test.ts
git commit -m "test(import): portable-layer round-trip stability for Postman + OpenAPI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire Postman/OpenAPI into the `portiq import` CLI command

**Files:**
- Modify: `packages/cli/src/commands/import.ts` (`applyImport`, ~line 42–53; imports, line 2–5; `.description`, line 59)
- Modify: `packages/cli/src/commands/import.test.ts` (add fixture-file cases)

**Interfaces:**
- Consumes: `importLibrary` from `@portiq/core` (added in Task 4).
- Produces: no signature change to `importCommand`; the JSON branch now accepts Postman v2.1 and OpenAPI 3.x in addition to `portiq.json`.

- [ ] **Step 1: Write the failing CLI tests**

In `packages/cli/src/commands/import.test.ts`, add these two cases inside the existing `describe("import command", ...)` block (after the portable-file test at line 51). They copy the core fixtures into the temp store dir and import them:

```ts
  it("imports a Postman v2.1 collection file", async () => {
    const pm = {
      info: { name: "PM Import", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [{ name: "Ping", request: { method: "GET", url: "https://x/ping" } }],
    };
    const file = join(dir, "collection.postman.json");
    writeFileSync(file, JSON.stringify(pm));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    const imported = state!.collections.find((c) => c.name === "PM Import");
    expect(imported).toBeTruthy();
    expect((imported!.items[0] as { method: string }).method).toBe("GET");
    s.close();
  });

  it("imports an OpenAPI 3.x document file", async () => {
    const oas = {
      openapi: "3.0.0",
      info: { title: "OAS Import", version: "1.0.0" },
      servers: [{ url: "https://x" }],
      paths: { "/ping": { get: { summary: "Ping", tags: ["health"] } } },
    };
    const file = join(dir, "openapi.json");
    writeFileSync(file, JSON.stringify(oas));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    expect(state!.collections.some((c) => c.name === "OAS Import")).toBe(true);
    s.close();
  });
```

- [ ] **Step 2: Run the tests, expect FAIL**

Run: `npm rebuild better-sqlite3 && npx vitest run packages/cli/src/commands/import.test.ts`
Expected: FAIL — the OpenAPI/Postman JSON currently falls into the `importPortable` branch, which throws `Not a valid Portiq portable file`, so the imports do not land (collections not found).

- [ ] **Step 3: Update the import command's JSON branch**

In `packages/cli/src/commands/import.ts`, change the import on lines 2–5 to bring in `importLibrary` and drop the now-unused `importPortable`:

```ts
import {
  ConflictError, importLibrary, inferRequestNameFromUrl, looksLikeCurl, mergeIntoAppState, parseCurl,
  type AppState, type ParsedCurl, type RequestItem,
} from "@portiq/core";
```

Replace the JSON portion of `applyImport` (currently lines 42–53) with:

```ts
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new UsageError("File is neither a curl command nor valid JSON");
  }
  let incoming: { collections: unknown[]; environments: unknown[] };
  try {
    incoming = importLibrary(parsed) as { collections: unknown[]; environments: unknown[] };
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : "Unrecognized import format");
  }
  return {
    state: mergeIntoAppState(state, incoming as any),
    summary: `merged ${incoming.collections.length} collection(s), ${incoming.environments.length} environment(s)`,
  };
```

Update the command `.description` (line 59) to:

```ts
      .description("import a curl command, a portiq.json file, a Postman v2.1 collection, or an OpenAPI 3.x document")
```

- [ ] **Step 4: Run the tests, expect PASS**

Run: `npm rebuild better-sqlite3 && npx vitest run packages/cli/src/commands/import.test.ts`
Expected: PASS (existing curl + portable cases and the two new cases green).

- [ ] **Step 5: Verify the CLI build**

Run: `npm run build:core && npm run build --workspace @portiq/cli`
Expected: PASS (the built CJS CLI's `require("@portiq/core")` resolves `importLibrary` from the `require`→dist export).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/import.ts packages/cli/src/commands/import.test.ts
git commit -m "feat(cli): import Postman v2.1 and OpenAPI 3.x via portiq import

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Delegate the renderer's collection import to core (Postman + OpenAPI)

**Files:**
- Modify: `src/hooks/useRequestState.ts` — imports (top of file); `parseImportData` Postman branch (~lines 761–859) and a new OpenAPI branch (before the `imported.id` branch at line 861).

**Interfaces:**
- Consumes: `parsePostmanCollection`, `looksLikePostman`, `parseOpenApi`, `looksLikeOpenApi` from `@portiq/core` (renderer resolves the browser barrel via the `vite.config.js` alias).
- Produces: no signature change to `parseImportData` (still `Collection | null | false`); the inline ~100-line Postman parser is replaced by a core call, and OpenAPI 3.x JSON now imports. HTTPie and native-portiq branches are unchanged.

- [ ] **Step 1: Add the core imports**

Near the other `@portiq/core` imports at the top of `src/hooks/useRequestState.ts`, add:

```ts
import { parsePostmanCollection, looksLikePostman, parseOpenApi, looksLikeOpenApi } from "@portiq/core";
```

(If the file has no existing `@portiq/core` import line, add this as a new import alongside the other top-of-file imports.)

- [ ] **Step 2: Replace the inline Postman branch with a core call**

In `parseImportData`, delete the entire Postman branch — from `} else if (imported.info && imported.info.schema && imported.info.schema.includes("postman.com/json/collection/v2.1.0")) {` (line 761) through its closing `}` at line 859 (just before `} else if (imported.id) {`) — and replace it with:

```ts
        } else if (looksLikePostman(imported)) {
            const lib = parsePostmanCollection(imported, { newId: genId });
            collection = lib.collections[0] ?? null;
        } else if (looksLikeOpenApi(imported)) {
            const lib = parseOpenApi(imported, { newId: genId });
            collection = lib.collections[0] ?? null;
```

The local `genId` (declared at line 15, `(prefix: string) => string`) matches the `IdFactory` signature, so imported ids keep the renderer's `col-`/`fld-`/`req-` convention. The trailing `} else if (imported.id) {` native-portiq branch and the final `if (!collection) return null; return collection;` are left intact.

- [ ] **Step 3: Verify lint & build pass**

Run: `npm run lint`
Expected: PASS — no unused-symbol errors; the removed inline `parsePostmanItem` no longer exists and nothing else referenced it (verified: it was a local closure inside `parseImportData`).

Run: `npm run build`
Expected: PASS (Vite build completes; the browser barrel exports resolve through the alias; TypeScript clean).

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: PASS across core, cli, mcp, and renderer units.

- [ ] **Step 5: Manual verification**

Run: `npm run rebuild && npm run dev` (rebuild restores the Electron ABI for the GUI).
- Use the collection-import UI (file / paste-text / from-URL) with `packages/core/src/import/fixtures/postman-collection.json` → a "Sample API" collection appears with a "Users" folder (List users / Create user) and a top-level "Login" request; bearer token `{{token}}`, basic auth on Login, JSON + form bodies present.
- Import `packages/core/src/import/fixtures/openapi.json` → a "Petstore" collection with a "pets" folder (List pets / createPet / Get a pet), a root-level "Health check", URLs like `{{baseUrl}}/pets/{{petId}}`, and a `baseUrl` collection variable.
- Import an existing `portiq.json` and an HTTPie export → still work unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useRequestState.ts
git commit -m "refactor(import): delegate renderer Postman import to core; add OpenAPI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage.** Core importers for Postman Collection v2.1 (Task 2) and OpenAPI 3.x (Task 3) map folders/requests/method/url/headers/params/auth/body/variables into the real `Collection`/`FolderItem`/`RequestItem` model from `packages/core/src/model/request.ts`. Both are surfaced through the CLI `portiq import` command (Task 6) and the renderer import path (Task 7), mirroring the curl-import extraction pattern (renderer delegates parsing to core, keeps UI wiring). Realistic fixtures (`postman-collection.json`, `openapi.json`) and round-trip tests (Task 5) are included. The design spec's line-218 "Postman/OpenAPI import formats (curl + portiq.json first)" out-of-scope note is the exact gap this plan closes.
- **Framework-free core.** The parsers use only string/JSON handling and guarded global `crypto` — no Electron/DOM/React, no `node:` builtins, no native addons — so they ship on both `index.ts` and `index.browser.ts` (Task 4) and the renderer imports them directly without a Node-only subpath. Consistent with the Global Constraints block.
- **No placeholders.** Every task shows real, compilable test + implementation code, exact run commands with expected FAIL/PASS, and exact `git add`/`git commit`. Every referenced symbol is either defined in an earlier task (`ImportedLibrary`, `IdFactory`, `createIdFactory`, `looksLikePostman`, `parsePostmanCollection`, `looksLikeOpenApi`, `parseOpenApi`, `detectImportFormat`, `importLibrary`) or already exists in the codebase and is cited (`Collection`/`FolderItem`/`RequestItem`/`RequestRow`/`AuthConfig` in `model/request.ts`; `importPortable`/`exportPortable`/`mergeIntoAppState` in `store/portable.ts`; `applyImport`/`importCommand` in `cli/.../import.ts`; `parseImportData`/`genId` in `useRequestState.ts`).
- **Type consistency.** All parsers return the single `ImportedLibrary { collections; environments }` shape, identical to `importPortable`'s return, so `mergeIntoAppState` is reused verbatim with no new merge logic. The renderer's `genId` satisfies `IdFactory` exactly, and `parseImportData`'s `Collection | null | false` contract is preserved.
- **Scope limits flagged (not omitted).** JSON input only (YAML OpenAPI deferred — both surfaces `JSON.parse` before dispatch); OpenAPI `$ref` limited to local `#/...` pointers (cycle-guarded); Swagger 2.0 and remote refs out of scope. Repeated Postman/OpenAPI imports append fresh-id collections (matching curl-import behavior) rather than merging — acceptable and consistent.
