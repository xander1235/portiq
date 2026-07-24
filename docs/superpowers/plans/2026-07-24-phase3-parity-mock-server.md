# Phase 3 (Parity) — Mock Server core module + `portiq mock` CLI command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate Portiq's already-extracted mock server into a `@portiq/core` `mock/` factory module (a plain module — no registry, per Phase 0.5 Part C), port the last renderer-only mock helpers into it, rewire the Electron `mock:*` IPC handlers to the module's factory (no UI behavior change), and add an additive `portiq mock <ref>` CLI command.

**Architecture:** Phase 0 already moved the mock server engine (`MockServerManager` + `matchPath`) into `packages/core/src/transport/mock.ts` and pointed Electron at `core.MockServerManager`. Per Phase 0.5 Part C, the mock is a **single** manager with no runtime selection by string `id`, so **no `CapabilityRegistry` is created** (a registry of one is YAGNI). This plan (a) relocates the mock engine into a dedicated `packages/core/src/mock/` directory exposing a `createMockManager()` factory (a plain module that self-registers into nothing), (b) ports the two remaining renderer-only pure helpers (`sanitizeRoutes`, `generateRoutesFromCollection`) into `mock/routes.ts` for headless consumers, (c) rewires Electron to `core.createMockManager()`, and (d) adds a `portiq mock <ref>` CLI command whose core logic (`runMock`) resolves a collection from the shared store, generates routes, and starts the server. Integration is additive — no shared switchboard is edited. The per-domain, `ProtocolRegistry`-style self-registration the spec asked about (Phase 0.5 Part C) lives in the domains that actually have 2+ interchangeable implementations (`ProtocolRegistry`/`AIProviderRegistry`/`SyncRemoteRegistry`), not the mock.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (`node` environment), Node `http`, `@portiq/core`, npm workspaces. CLI command depends on the Phase 2 CLI scaffold (assumed — see Global Constraints).

## Global Constraints

- **Behavior preservation (mock engine):** the relocated server must serve identically to `transport/mock.ts` today. Preserve exactly: `matchPath` param matching (`:seg` wildcard, equal segment count); method match is case-insensitive; CORS headers `Access-Control-Allow-Origin: *`, `-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `-Headers: *`; `OPTIONS` → `204` empty; unmatched → `404` `{"error":"No matching mock route","path","method"}`; `statusCode || 200`; response headers = `{ "Content-Type": "application/json", ...route.headers }`; body = `typeof body === "string" ? body : JSON.stringify(body || {})`; `delay` via `setTimeout`; port validation `0..65535` (else `{error:"Invalid port number"}`); missing id → `{error:"Missing server ID"}`; non-array routes → `{error:"Routes must be an array"}`; same-id `start` stops the existing server first; `listen(port, "127.0.0.1")`; `port: 0` binds an ephemeral port and reports the bound port; `updateRoutes` live-mutates the running entry (`{error:"Server not found"}` when absent); `list()` returns `{ id, port, routeCount }`. Result shapes: `{ ok: true, port }` / `{ error }` / `{ ok: true }`.
- **Registry pattern (Phase 0.5 Part C):** the mock is a single-implementation domain, so it gets **no registry** — `mock/index.ts` exposes a plain `createMockManager()` factory and self-registers into **nothing**. There is **no** `CapabilityRegistry` and **no** central capabilities index/switchboard. The `ProtocolRegistry`-style per-domain self-registration that keeps Phase 3 tracks additive and merge-independent lives only in domains with 2+ interchangeable implementations (`ProtocolRegistry`/`AIProviderRegistry`/`SyncRemoteRegistry`). The CLI command still self-registers into the assumed `CommandRegistry` from its own file.
- **Package boundaries (disjoint from other tracks):** new core files live only under `packages/core/src/mock/**` (there is **no** `packages/core/src/registry/**`). The CLI command lives only in `packages/cli/src/commands/mock.ts` (+ its test files). Do **not** edit other T5 tracks' directories, and do **not** edit the renderer mock UI (`src/services/mockServer.ts`, `src/components/ProtocolPanes/MockServerPane.tsx`) — the desktop UI keeps its own copies unchanged, so there is no UI behavior change. The only edits to pre-existing shared files are: `packages/core/src/index.ts` (swap one barrel line) and `electron/main.cjs` (one line).
- **Data-location contract:** the CLI resolves storage exclusively via `openAppStateStore({ dataDir })`, which calls `resolveDataDir()` internally. Never re-derive a path.
- **better-sqlite3 ABI gotcha:** the mock **engine** (Tasks 1–3) never touches SQLite, so those tests are ABI-agnostic. The barrel-require smoke (Task 4) and the CLI `runMock` test (Task 5) load `better-sqlite3` (via the `@portiq/core` barrel / `openAppStateStore`) and therefore require the **plain-Node** ABI: run `npm rebuild better-sqlite3` before them. `npm run rebuild` restores the **Electron** ABI for `npm run dev`. GUI smoke is interactive and deferred to the user.
- **No mock MCP tool:** per the design ("there is NO dedicated mock MCP tool in v1"), this plan adds nothing under `packages/mcp/**`.
- **Assumed Phase 2 CLI contract (Part B prerequisite):** the Phase 2 CLI plan is assumed to have merged a `packages/cli` workspace exposing `packages/cli/src/registry.ts` with **exactly** these types (Part B's command is written against them; if the real contract differs, only the thin descriptor in Task 6 changes):

  ```ts
  // packages/cli/src/registry.ts — PROVIDED BY THE PHASE 2 CLI SCAFFOLD (assumed)
  export interface CliContext {
    positionals: string[];                     // e.g. ["My Collection"]
    flags: Record<string, string | boolean>;   // { port: "3000", id: "uuid", "data-dir": "/tmp/x" }
    stdout: (line: string) => void;
    stderr: (line: string) => void;
    signal: AbortSignal;                        // aborts on SIGINT for long-running commands
  }
  export interface CliCommand {
    name: string;
    describe: string;
    run(ctx: CliContext): Promise<number>;      // resolves to the process exit code
  }
  export const CommandRegistry: {
    register(cmd: CliCommand): void;
    get(name: string): CliCommand | undefined;
    all(): CliCommand[];
  };
  ```

  The scaffold is also assumed to own `packages/cli/package.json` (with `"@portiq/core": "*"`), `packages/cli/tsconfig.json`, and to have registered that tsconfig in `eslint.config.js`. Root `vitest.config.ts` already globs `packages/*/src/**/*.test.ts`, so CLI tests are picked up automatically. **If `packages/cli/src/registry.ts` is absent at execution time, defer Part B (Tasks 5–6)** — they are additive and touch only new files.
- **Exit codes (spec CI contract):** `0` success · `1` runtime error · `3` usage error. (Mock is long-running; `2` test-failure does not apply.)
- **Test convention (match existing core tests):** `import { describe, it, expect } from "vitest";` (add `afterEach` for temp-dir cleanup); import the module under test by relative path; temp dirs via `mkdtempSync(join(tmpdir(), ...))` cleaned in `afterEach`; no global setup file.
- **Commits:** Conventional Commit per task; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (current code)

- **Mock engine already extracted (Phase 0 Task 12):** `packages/core/src/transport/mock.ts` — `matchPath` (`:47-52`), `MockServerManager` (`:58-165`), types `MockRoute`/`MockStartPayload`/`MockStartResult`/`MockErrorResult`/`MockStopResult`/`MockListEntry` (`:3-41`). Tests: `packages/core/src/transport/mock.test.ts` (6 tests). Barrel export: `packages/core/src/index.ts:17` (`export * from "./transport/mock";`).
- **Electron delegation (already wired):** `electron/main.cjs:27` (`const mockManager = new core.MockServerManager();`) and `:149-163` (`mock:start`/`mock:stop`/`mock:list`/`mock:updateRoutes` pass-throughs).
- **Renderer mock helpers to PORT (headless copies for the CLI):** `src/services/mockServer.ts` — `sanitizedRoutes` mapping inside `MockServerService.start` (`:41-49`) and `generateRoutesFromCollection` (`:115-154`). These stay in the renderer (consumed by `src/components/ProtocolPanes/MockServerPane.tsx:96` and `.createDefaultRoute()` at `:21,71`); the core copies are new and independent. **Not extracted / left in renderer:** `MockServerService.{start,stop,list,updateRoutes}` (IPC glue), `generateServerId`, `createDefaultRoute` (UI "add route" template) — none are needed headlessly.
- **Registry convention (decided by Phase 0.5 Part C):** per-domain `ProtocolRegistry`-style registries exist **only** for domains with 2+ interchangeable implementations selected at runtime by a string `id` (`ProtocolRegistry`, `AIProviderRegistry`, `SyncRemoteRegistry`). The mock is a **single-implementation** domain, so it stays a plain `createMockManager()` factory and creates **no** registry (no `CapabilityRegistry`). The spec's "module registry pattern (how flows/mock/sync/grpc/ai self-register)" is satisfied by those three per-domain registries. `packages/core/src/protocols/registry.ts` (`ProtocolRegistryClass` `:45-134`, singleton `export const ProtocolRegistry` `:134`) remains the shape to mirror where a registry IS warranted — but not here.
- **Model types (for the route generator):** `packages/core/src/model/request.ts` — `Collection` (`:86-91`: `{ id, name, items, variables? }`), `FolderItem` (`:79-84`: `{ type:"folder", id, name, items }`), `RequestItem` (`:47-77`: `{ type:"request", id, name, method, url, ... }`).
- **Store API (for the CLI):** `packages/core/src/store/appStateStore.ts` — `openAppStateStore(opts?)` returns `{ load(): { state: AppState | null; version }, save(...), collections(), environments(), flattenRequests(), close() }`. `packages/core/src/store/dataDir.ts` — `resolveDataDir(opts?)`.
- **Build/test config:** root `package.json` — `build:core` (`:15` → `npm --workspace @portiq/core run build`), `test` (`:19` → `vitest run`), `rebuild` (`:14` → `electron-rebuild -f -w better-sqlite3`). Core `package.json` build → `tsc -p tsconfig.build.json` (CJS to `dist/`, `exclude: ["**/*.test.ts"]`). `vitest.config.ts` include: `["src/**/*.test.ts", "packages/*/src/**/*.test.ts"]`.

---

## Part A — Core `mock/` module (self-contained; runnable on the current repo)

## Task 1: `registry/capabilityRegistry.ts` — minimal self-registration registry

> **DROPPED per Phase 0.5 (Part C + Part D delta #7).** No `CapabilityRegistry` is created. The registry decision is settled: a domain gets a `ProtocolRegistry`-style registry **only** when it has 2+ interchangeable implementations selected at runtime by a string `id`. The mock is a single manager with no runtime selection, so a registry is unwarranted (a registry of one is YAGNI). Do NOT create `packages/core/src/registry/**`, do NOT add any `export * from "./registry/capabilityRegistry";` barrel line, and skip the associated tests and commit. Task numbering is preserved for cross-references; there is simply no work in this task. Proceed to Task 2, where the mock relocates into a plain `createMockManager()` factory module (no self-registration).

---

## Task 2: Relocate the mock engine into a plain `mock/` factory module

**Files:**
- Rename (git mv): `packages/core/src/transport/mock.ts` → `packages/core/src/mock/mockServer.ts`
- Rename (git mv): `packages/core/src/transport/mock.test.ts` → `packages/core/src/mock/mockServer.test.ts`
- Create: `packages/core/src/mock/index.ts`
- Create: `packages/core/src/mock/index.test.ts`
- Modify: `packages/core/src/index.ts` (swap the barrel line)

**Interfaces:**
- Consumes: nothing new (no registry — see Phase 0.5 Part C).
- Produces (unchanged from `transport/mock.ts`): `MockServerManager`, `matchPath`, `MockRoute`, `MockStartPayload`, `MockStartResult`, `MockErrorResult`, `MockStopResult`, `MockListEntry`. New: `createMockManager(): MockServerManager`. **No self-registration side-effect** — the mock is a plain factory module (Phase 0.5 Part C: single-implementation domain, no `CapabilityRegistry`).

- [ ] **Step 1: Move the engine file and its test (content unchanged)**

The engine file is self-contained (imports only `node:http`); moving it does not change behavior.

```bash
mkdir -p packages/core/src/mock
git mv packages/core/src/transport/mock.ts packages/core/src/mock/mockServer.ts
git mv packages/core/src/transport/mock.test.ts packages/core/src/mock/mockServer.test.ts
```

The moved test imports from `"./mock"`; it now sits next to `mockServer.ts`, so change its import target.

In `packages/core/src/mock/mockServer.test.ts` change:

```ts
import { MockServerManager, matchPath } from "./mock";
```

to:

```ts
import { MockServerManager, matchPath } from "./mockServer";
```

- [ ] **Step 2: Write the failing factory test `packages/core/src/mock/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createMockManager, MockServerManager } from "./index";

describe("mock module", () => {
  it("createMockManager returns a MockServerManager instance", () => {
    const mgr = createMockManager();
    expect(mgr).toBeInstanceOf(MockServerManager);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/mock/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 4: Implement `packages/core/src/mock/index.ts`**

```ts
// @portiq/core mock module — in-process HTTP mock server + route helpers.
// Plain factory module: single-implementation domain, so NO registry / no
// self-registration side-effect (Phase 0.5 Part C — no CapabilityRegistry).
import { MockServerManager } from "./mockServer";

export * from "./mockServer";
export * from "./routes";

/**
 * Factory for a fresh mock-server manager. Preferred entry point for consumers
 * (Electron main, CLI) over `new MockServerManager()`.
 */
export function createMockManager(): MockServerManager {
  return new MockServerManager();
}
```

Note: `export * from "./routes"` references the file created in Task 3. Vitest transpiles per-module, so `index.test.ts` (which imports only `createMockManager`/`MockServerManager`) resolves through esbuild even before `routes.ts` exists *only if* the export target exists. Create a temporary empty `routes.ts` now so this task is independently green; Task 3 fills it in with tests:

Create `packages/core/src/mock/routes.ts` with a placeholder that Task 3 replaces:

```ts
export {};
```

- [ ] **Step 5: Swap the barrel line in `packages/core/src/index.ts`**

Replace:

```ts
export * from "./transport/mock";
```

with:

```ts
export * from "./mock";
```

(There is no `./registry/capabilityRegistry` barrel line — Task 1 is dropped per Phase 0.5 Part C. This is a straight swap of the one existing mock export line.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- packages/core/src/mock/`
Expected: PASS — 6 moved engine tests + 1 factory test (`createMockManager`). Also run the full suite to confirm no barrel breakage: `npm test`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/mock packages/core/src/index.ts
git rm --cached packages/core/src/transport/mock.ts packages/core/src/transport/mock.test.ts 2>/dev/null || true
git commit -m "refactor(core): relocate mock engine into a plain mock/ factory module"
```

---

## Task 3: `mock/routes.ts` — headless route helpers (`sanitizeRoutes`, `generateRoutesFromCollection`)

**Files:**
- Modify (replace placeholder): `packages/core/src/mock/routes.ts`
- Create: `packages/core/src/mock/routes.test.ts`

**Interfaces:**
- Consumes: `Collection`, `FolderItem`, `RequestItem` from `../model`; `MockRoute` from `./mockServer`.
- Produces: `type MockRouteInput = Partial<Omit<MockRoute, "body">> & { body?: unknown }`; `sanitizeRoutes(routes: MockRouteInput[] | null | undefined): MockRoute[]` (fills defaults, JSON-stringifies object bodies); `generateRoutesFromCollection(collection: Collection | null | undefined): MockRoute[]` (walks folders recursively, derives one route per request; UI-only `id`/`description` fields are intentionally dropped — they are not part of core's `MockRoute` serving contract).

- [ ] **Step 1: Write the failing test `packages/core/src/mock/routes.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/mock/routes.test.ts`
Expected: FAIL — `sanitizeRoutes`/`generateRoutesFromCollection` are not exported (placeholder file).

- [ ] **Step 3: Implement `packages/core/src/mock/routes.ts`**

```ts
import type { Collection, FolderItem, RequestItem } from "../model";
import type { MockRoute } from "./mockServer";

/** Route input with a permissive body (objects allowed; coerced to JSON). */
export type MockRouteInput = Partial<Omit<MockRoute, "body">> & { body?: unknown };

/**
 * Normalizes partial route definitions to fully-defaulted MockRoutes.
 * Headless port of the `sanitizedRoutes` mapping in
 * src/services/mockServer.ts (:41-49): method→GET, path→"/", statusCode→200,
 * headers→JSON content-type, delay→0. Object bodies are JSON-stringified
 * (the manager also coerces at serve time; this keeps MockRoute.body: string).
 */
export function sanitizeRoutes(routes: MockRouteInput[] | null | undefined): MockRoute[] {
  return (routes ?? []).map((r) => ({
    method: r.method || "GET",
    path: r.path || "/",
    statusCode: r.statusCode || 200,
    headers: r.headers || { "Content-Type": "application/json" },
    body: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
    delay: r.delay || 0,
  }));
}

/**
 * Derives mock routes from a collection's requests, walking folders recursively.
 * Headless port of src/services/mockServer.ts generateRoutesFromCollection
 * (:115-154). The UI-only `id`/`description` fields are dropped — core's
 * MockRoute serving contract is (method, path, statusCode, headers, body, delay).
 */
export function generateRoutesFromCollection(
  collection: Collection | null | undefined,
): MockRoute[] {
  if (!collection?.items) return [];
  const routes: MockRoute[] = [];
  const walk = (items: (FolderItem | RequestItem)[]): void => {
    for (const item of items) {
      if (item.type === "folder") {
        walk(item.items);
      } else if (item.type === "request") {
        try {
          let path = "/mock";
          if (item.url) {
            const url = new URL(item.url.startsWith("http") ? item.url : `http://localhost${item.url}`);
            path = url.pathname || "/mock";
          }
          routes.push({
            method: item.method || "GET",
            path,
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              { message: `Mock response for ${item.name}`, _mockSource: item.name, data: {} },
              null,
              2,
            ),
            delay: 0,
          });
        } catch {
          // Skip requests with invalid URLs (mirrors the renderer's try/catch).
        }
      }
    }
  };
  walk(collection.items);
  return routes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- packages/core/src/mock/routes.test.ts`
Expected: PASS (7 tests). Also `npm run lint` — expected: no new errors under `packages/core`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mock/routes.ts packages/core/src/mock/routes.test.ts
git commit -m "feat(core): port headless mock route helpers into mock/ module"
```

---

## Task 4: Rewire Electron `mock:*` to the module factory + build verification

**Files:**
- Modify: `electron/main.cjs:27`

**Interfaces:**
- Consumes: `core.createMockManager()` (Task 2) via the CJS barrel. The four `mock:*` IPC handlers at `electron/main.cjs:149-163` are unchanged pass-throughs (`mockManager.start/stop/list/updateRoutes`).

- [ ] **Step 1: Rewire the manager construction**

In `electron/main.cjs` replace line 27:

```js
const mockManager = new core.MockServerManager();
```

with:

```js
const mockManager = core.createMockManager();
```

Leave the `mock:start` / `mock:stop` / `mock:list` / `mock:updateRoutes` handlers (`:149-163`) exactly as they are — they remain thin pass-throughs, mirroring how Phase 0 delegated the other handlers.

- [ ] **Step 2: Rebuild the plain-Node native binary, build core, and run the CJS smoke**

The `@portiq/core` barrel pulls in `store/kvStore.ts` (`import Database from "better-sqlite3"`), so `require("@portiq/core")` needs the plain-Node ABI.

Run:

```bash
npm rebuild better-sqlite3
npm run build:core
node -e "const c=require('@portiq/core'); const m=c.createMockManager(); if(typeof m.start!=='function') throw new Error('createMockManager broken'); console.log('ok');"
```

Expected: prints `ok`. This proves the CJS `dist/` build includes the relocated module and the `createMockManager()` factory (there is no `CapabilityRegistry` — Phase 0.5 Part C).

- [ ] **Step 3: Run the full suite and lint**

Run: `npm test` — expected: all green (mock engine tests now under `packages/core/src/mock/`). Run: `npm run lint` — expected: 0 errors (pre-existing warnings unchanged).

- [ ] **Step 4: Commit**

```bash
git add electron/main.cjs
git commit -m "refactor(electron): delegate mock:* to core.createMockManager()"
```

> **Interactive smoke (deferred to user):** `npm run rebuild` (restore Electron ABI) then `npm run dev`, open the Mock Server pane, start a server, hit a route. Verify unchanged behavior. Not automatable here (Electron GUI + ABI switch).

---

## Part B — `portiq mock <ref>` CLI command (additive; requires the Phase 2 CLI scaffold)

> **PREREQUISITE:** `packages/cli/src/registry.ts` must exist and export `CommandRegistry`, `CliCommand`, `CliContext` per the assumed contract in Global Constraints. Verify with `test -f packages/cli/src/registry.ts && echo present`. If it prints nothing, **stop and defer Part B** — Tasks 5–6 create only new files (`packages/cli/src/commands/mock*.ts`) plus one self-registration line, and can be applied later with zero edits to shared files. All Part B tasks require the plain-Node `better-sqlite3` ABI (`npm rebuild better-sqlite3`).

## Task 5: `runMock` core logic + `resolveCollectionRef` + integration test

**Files:**
- Create: `packages/cli/src/commands/mock.ts`
- Create: `packages/cli/src/commands/mock.test.ts`

**Interfaces:**
- Consumes: `openAppStateStore`, `createMockManager`, `generateRoutesFromCollection`, types `Collection`/`AppState` from `@portiq/core`.
- Produces: `class MockUsageError extends Error`; `interface MockRunOptions { dataDir?: string; ref?: string; id?: string; port: number }`; `interface MockRunHandle { port: number; routeCount: number; stop(): Promise<void> }`; `resolveCollectionRef(state: AppState | null, opts: { id?: string; ref?: string }): Collection | null`; `runMock(opts: MockRunOptions): Promise<MockRunHandle>`.

- [ ] **Step 1: Write the failing integration test `packages/cli/src/commands/mock.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore, type AppState } from "@portiq/core";
import { runMock, resolveCollectionRef, MockUsageError } from "./mock";

const dirs: string[] = [];
function seedStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "portiq-cli-mock-"));
  dirs.push(dir);
  const state: AppState = {
    collections: [
      {
        id: "c1",
        name: "Demo",
        items: [
          {
            type: "request", id: "r1", name: "Ping", description: "", tags: [],
            protocol: "http", method: "GET", url: "https://api.test/ping",
          },
        ],
      },
    ],
    activeCollectionId: "c1",
    environments: [],
    activeEnvId: null,
    historyRetentionDays: 7,
  };
  const store = openAppStateStore({ dataDir: dir });
  store.save(state);
  store.close();
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveCollectionRef", () => {
  it("matches by name or id and returns null when missing", () => {
    const state = { collections: [{ id: "c1", name: "Demo", items: [] }] } as unknown as AppState;
    expect(resolveCollectionRef(state, { ref: "Demo" })?.id).toBe("c1");
    expect(resolveCollectionRef(state, { id: "c1" })?.name).toBe("Demo");
    expect(resolveCollectionRef(state, { ref: "missing" })).toBeNull();
  });
});

describe("runMock", () => {
  it("serves generated routes from a resolved collection", async () => {
    const dataDir = seedStore();
    const handle = await runMock({ dataDir, ref: "Demo", port: 0 });
    expect(handle.routeCount).toBe(1);
    const res = await fetch(`http://127.0.0.1:${handle.port}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("_mockSource");
    await handle.stop();
  });

  it("throws MockUsageError when the collection cannot be resolved", async () => {
    const dataDir = seedStore();
    await expect(runMock({ dataDir, ref: "Nope", port: 0 })).rejects.toBeInstanceOf(MockUsageError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npm test -- packages/cli/src/commands/mock.test.ts`
Expected: FAIL — cannot find module `./mock`.

- [ ] **Step 3: Implement `packages/cli/src/commands/mock.ts` (core logic only)**

```ts
import {
  openAppStateStore,
  createMockManager,
  generateRoutesFromCollection,
  type Collection,
  type AppState,
} from "@portiq/core";

/** Thrown when the referenced collection cannot be resolved (usage error → exit 3). */
export class MockUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockUsageError";
  }
}

export interface MockRunOptions {
  dataDir?: string;
  ref?: string;
  id?: string;
  port: number;
}

export interface MockRunHandle {
  port: number;
  routeCount: number;
  stop(): Promise<void>;
}

/**
 * Resolve a collection by explicit `--id`, else by a positional ref matched
 * against a top-level collection's id or name.
 */
export function resolveCollectionRef(
  state: AppState | null,
  opts: { id?: string; ref?: string },
): Collection | null {
  const collections = state?.collections ?? [];
  if (opts.id) return collections.find((c) => c.id === opts.id) ?? null;
  if (opts.ref) return collections.find((c) => c.id === opts.ref || c.name === opts.ref) ?? null;
  return null;
}

/**
 * Core logic for `portiq mock`: read the shared store (path resolved by core's
 * resolveDataDir — never re-derived), resolve the collection, generate routes,
 * and start a mock server. The store is closed before returning (reads are
 * one-shot). Throws MockUsageError when the collection cannot be resolved.
 */
export async function runMock(opts: MockRunOptions): Promise<MockRunHandle> {
  const store = openAppStateStore({ dataDir: opts.dataDir });
  let collection: Collection | null;
  try {
    const { state } = store.load();
    collection = resolveCollectionRef(state, { id: opts.id, ref: opts.ref });
  } finally {
    store.close();
  }
  if (!collection) {
    throw new MockUsageError(
      `No collection found for ${opts.id ? `--id ${opts.id}` : `"${opts.ref}"`}`,
    );
  }
  const routes = generateRoutesFromCollection(collection);
  const manager = createMockManager();
  const result = await manager.start({ id: "cli-mock", port: opts.port, routes });
  if ("error" in result) throw new Error(result.error);
  return {
    port: result.port,
    routeCount: routes.length,
    stop: () => manager.stop({ id: "cli-mock" }).then(() => undefined),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/mock.test.ts`
Expected: PASS (4 assertions across 2 describes).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/mock.ts packages/cli/src/commands/mock.test.ts
git commit -m "feat(cli): add runMock core logic for the mock command"
```

---

## Task 6: `mockCommand` descriptor + additive self-registration

**Files:**
- Modify: `packages/cli/src/commands/mock.ts` (append the descriptor + registration)
- Create: `packages/cli/src/commands/mock.command.test.ts`

**Interfaces:**
- Consumes: `CommandRegistry`, `CliCommand`, `CliContext` from `../registry` (assumed Phase 2 scaffold); `runMock`, `MockUsageError`, `MockRunHandle` from `./mock` (Task 5).
- Produces: `export const mockCommand: CliCommand`; a module-load side-effect `CommandRegistry.register(mockCommand)`. Flag mapping: positional `ref`, `--id`, `--port` (default `3000`), `--data-dir`. Exit codes: missing ref/id → `3`; `MockUsageError` → `3`; other start failure → `1`; clean shutdown on `ctx.signal` abort → `0`.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/mock.command.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mockCommand } from "./mock";
import { CommandRegistry, type CliContext } from "../registry";

function fakeCtx(over: Partial<CliContext> = {}): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    positionals: [],
    flags: {},
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    signal: new AbortController().signal,
    ...over,
  };
  return { ctx, out, err };
}

describe("mockCommand", () => {
  it("self-registers under the name 'mock'", () => {
    expect(mockCommand.name).toBe("mock");
    expect(mockCommand.describe).toMatch(/mock/i);
    expect(CommandRegistry.get("mock")).toBe(mockCommand);
  });

  it("returns usage exit code 3 when no ref or id is given", async () => {
    const { ctx, err } = fakeCtx();
    const code = await mockCommand.run(ctx);
    expect(code).toBe(3);
    expect(err.join("\n")).toMatch(/Usage: portiq mock/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/mock.command.test.ts`
Expected: FAIL — `mockCommand` is not exported from `./mock`.

- [ ] **Step 3: Append the descriptor + self-registration to `packages/cli/src/commands/mock.ts`**

Add these imports at the top of the file (merge with the existing `@portiq/core` import block):

```ts
import { CommandRegistry, type CliCommand, type CliContext } from "../registry";
```

Append at the end of the file:

```ts
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * `portiq mock <ref>` — start a mock HTTP server from a saved collection.
 * Long-running: prints the bound port, then waits until the CLI framework
 * aborts ctx.signal (Ctrl+C) before stopping the server.
 */
export const mockCommand: CliCommand = {
  name: "mock",
  describe: "Start a mock HTTP server from a saved collection",
  async run(ctx: CliContext): Promise<number> {
    const ref = ctx.positionals[0];
    const id = typeof ctx.flags.id === "string" ? ctx.flags.id : undefined;
    const dataDir = typeof ctx.flags["data-dir"] === "string" ? ctx.flags["data-dir"] : undefined;
    const port = ctx.flags.port !== undefined ? Number(ctx.flags.port) : 3000;

    if (!ref && !id) {
      ctx.stderr("Usage: portiq mock <collection-ref> [--id <uuid>] [--port <n>] [--data-dir <path>]");
      return 3;
    }

    let handle: MockRunHandle;
    try {
      handle = await runMock({ dataDir, ref, id, port });
    } catch (err) {
      if (err instanceof MockUsageError) {
        ctx.stderr(err.message);
        return 3;
      }
      ctx.stderr(`Failed to start mock server: ${(err as Error).message}`);
      return 1;
    }

    ctx.stdout(
      `Mock server listening on http://127.0.0.1:${handle.port} (${handle.routeCount} routes). Press Ctrl+C to stop.`,
    );
    await waitForAbort(ctx.signal);
    await handle.stop();
    return 0;
  },
};

// Additive self-registration — no central switchboard is edited.
CommandRegistry.register(mockCommand);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/mock.command.test.ts`
Expected: PASS (2 tests). Run `npm run lint` — expected: 0 errors (the CLI tsconfig must be registered in eslint by the Phase 2 scaffold; if the CLI files report "not found by project", that is a scaffold gap to raise with the Phase 2 track, not a code defect here).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/mock.ts packages/cli/src/commands/mock.command.test.ts
git commit -m "feat(cli): register additive 'portiq mock' command"
```

---

## Task 7: Gates, changeset, and progress ledger

**Files:**
- Create: `.changeset/phase3-mock-server.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run all gates**

```bash
npm rebuild better-sqlite3
npm run build:core
npm test
npm run lint
```

Expected: `build:core` emits `packages/core/dist/`; `npm test` all green (new: 4 capability + 2 mock-index + 7 routes core tests, plus 6 CLI tests if Part B ran); `npm run lint` 0 errors (pre-existing warnings unchanged).

- [ ] **Step 2: Add a changeset `.changeset/phase3-mock-server.md`**

```md
---
"@portiq/core": minor
---

Add a `mock/` core module (a plain factory — no registry, per Phase 0.5 Part C):
relocate the mock-server engine (`MockServerManager`, `matchPath`) out of
`transport/`, expose a `createMockManager()` factory, and port the headless
route helpers (`sanitizeRoutes`, `generateRoutesFromCollection`). Adds the
additive `portiq mock <ref>` CLI command.
```

- [ ] **Step 3: Append a Phase 3 (mock) section to `.superpowers/sdd/progress.md`**

Add at the end of the file:

```md
---

# Phase 3 (Parity) — Mock server — SDD Progress

Plan: docs/superpowers/plans/2026-07-24-phase3-parity-mock-server.md
Spec: docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md (Phase 3, mock/ row + `portiq mock`)
Branch: feat/portiq-core-phase0 (or a dedicated feat/portiq-mock branch)

## Tasks
- Task 1: DROPPED per Phase 0.5 Part C — no CapabilityRegistry (mock is a single-implementation domain)
- Task 2: relocate mock engine transport/mock.ts → mock/mockServer.ts + plain mock/index.ts factory + createMockManager() (no self-registration)
- Task 3: mock/routes.ts — sanitizeRoutes + generateRoutesFromCollection (headless ports of src/services/mockServer.ts)
- Task 4: electron/main.cjs rewire → core.createMockManager()
- Task 5 (Part B, needs CLI scaffold): packages/cli/src/commands/mock.ts — runMock + resolveCollectionRef
- Task 6 (Part B): mockCommand descriptor + additive CommandRegistry.register
- Task 7: gates + changeset + ledger

Notes:
- Renderer MockServerService + MockServerPane are UNCHANGED (UI glue keeps its own copies).
- better-sqlite3 ABI: mock engine tests are ABI-agnostic; barrel-require smoke (T4) + CLI runMock test (T5) need `npm rebuild better-sqlite3` (plain Node); `npm run rebuild` for Electron.
- No mock MCP tool (per design v1).
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/phase3-mock-server.md .superpowers/sdd/progress.md
git commit -m "chore(core): changeset + progress ledger for phase 3 mock server"
```

---

## Self-Review

**1. Spec coverage (design §Phase 3 "mock/ core module row" + `portiq mock <ref>`):**
- `mock/` core module — Tasks 2–3 (Task 1 dropped; relocate engine + port helpers). ✅
- Electron delegation to the module (no UI change) — Task 4. ✅
- `portiq mock <ref>` additive CLI command — Tasks 5–6. ✅
- Preserve current behavior — Task 2 is a content-preserving `git mv` of the already-passing engine + its 6 tests; Task 3 ports helpers faithfully with the one documented, serving-neutral difference (drop UI-only `id`/`description`). ✅
- Cite real exec/store/model APIs — `openAppStateStore`, `resolveDataDir` (via store), `Collection`/`FolderItem`/`RequestItem`, `createMockManager`, `generateRoutesFromCollection` all referenced with real signatures. ✅
- No mock MCP tool — none added; stated in Global Constraints. ✅
- Registry convention (Phase 0.5 Part C) — mock is a single-implementation domain, so **no `CapabilityRegistry`** and no self-registration; `mock/index.ts` is a plain `createMockManager()` factory. The CLI command still uses `CommandRegistry.register` in its own file. ✅
- Data-location contract — CLI uses `openAppStateStore({ dataDir })` only. ✅
- better-sqlite3 ABI — noted on every SQLite-touching step. ✅
- Package boundaries — new files only under `packages/core/src/mock` and `packages/cli/src/commands`; two one-line edits to `index.ts` and `main.cjs`. ✅

**2. Placeholder scan:** No "TODO"/"handle edge cases"/"similar to Task N" placeholders. The one intentional placeholder (`routes.ts` `export {}` in Task 2 Step 4) is explicitly created and then replaced with real code in Task 3 — flagged inline so the barrel resolves between tasks.

**3. Type consistency:** `MockRoute`, `MockServerManager`, `matchPath`, `createMockManager`, `MockRunOptions`/`MockRunHandle`/`MockUsageError`, `resolveCollectionRef`, `runMock`, `mockCommand`, and the assumed `CliCommand`/`CliContext`/`CommandRegistry` names are used identically across all tasks (no `Capability`/`CapabilityRegistry` — dropped per Phase 0.5 Part C). `sanitizeRoutes`/`generateRoutesFromCollection` signatures in Task 3's Interfaces match their bodies and the CLI's usage in Task 5.

---

## Execution Handoff

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between tasks (superpowers:subagent-driven-development). Part A (Tasks 1–4) can run immediately; gate Part B (Tasks 5–7's CLI parts) on the Phase 2 CLI scaffold being present.

**2. Inline Execution** — execute tasks in-session with checkpoints (superpowers:executing-plans).
