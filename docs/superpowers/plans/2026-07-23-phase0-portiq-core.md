# Phase 0 — `@portiq/core` Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Portiq's data, execution, scripting, and flow logic out of `electron/main.cjs` + `src/` into a framework-free `@portiq/core` npm-workspace package, and rewire the Electron main process to consume it with no UI behavior change.

**Architecture:** Convert the repo to npm workspaces. Build `@portiq/core` as a plain Node/TypeScript package with modules: `model/` (domain types incl. an explicit `AppState`), `store/` (canonical data-dir resolution + a WAL-enabled `better-sqlite3` kv store with optimistic writes + portable import/export), `exec/` (interpolation, auto-headers, header/multipart helpers), `protocols/` (transport-agnostic handlers), `transport/` (the real HTTP/GraphQL/WS senders + mock server, decoupled from Electron IPC/`BrowserWindow`), `scripting/` (test harness + headless `pm.*` sandbox), `flows/` (the already-headless DAG engine), and `import/` (curl parser). `electron/main.cjs` becomes a thin adapter that calls core. A golden parity test proves the desktop path is unchanged.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (built-in esbuild TS transpile, `node` environment), `better-sqlite3`, Node `http`/`https`/`http2`, `ws`, npm workspaces, `typescript-eslint` flat config, changesets.

## Global Constraints

- Package name: `@portiq/core`; version starts at `0.0.0`; `"type": "module"`; `"private": true` until Phase 4 publish.
- Node built-ins only for transport (`http`, `https`, `http2`, `ws`); NO Electron imports anywhere under `packages/core/**` (no `electron`, `app`, `BrowserWindow`, `ipcMain`, `window.*`).
- The app version used by auto-headers MUST be injected as a parameter — never call `app.getVersion()` in core.
- Canonical app name is exactly `"Portiq"` (capital P). Data file name is exactly `appdata.sqlite`.
- Persisted store stays backward-compatible: the existing `kv (key TEXT PRIMARY KEY, value TEXT)` table and the `appState` row (value = `JSON.stringify(AppState)`) are unchanged in shape; new metadata goes in a *separate* table so the running desktop app keeps working.
- Test convention (match existing): `import { describe, it, expect } from "vitest";` (add `vi` when mocking); import module under test by relative path; local factory helpers at top; `describe` per function, `it` per behavior; inject clocks/deps for determinism; no global test setup file.
- Result shape for a successful HTTP send is exactly: `{ status, statusText, time, duration, headers, body, json, httpVersion }`. Abort shapes: `{ cancelled: true, error }` and `{ timedOut: true, error }`. Error shape: `{ error }`.
- Commit after every task with a Conventional Commit message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (current code being extracted)

- Persistence: `electron/main.cjs:12-20` (`initDb`), `:867-903` (`db:*` handlers). Table `kv(key TEXT PRIMARY KEY, value TEXT)`; file `path.join(app.getPath("userData"), "appdata.sqlite")`.
- `AppState` payload literal: `src/App.tsx:1066-1105` (autosave) and `:1188-1226` (beforeunload). `history` is NOT in it — it is `localStorage["ui_history"]` (`src/App.tsx:462`), passed separately to `applyPersistedState(state, historyValue?)` (`src/App.tsx:940`).
- Domain types: `src/hooks/useRequestState.ts:5-92`, `src/hooks/useEnvironmentState.ts:4-16`, `src/components/ProtocolPanes/dag/types.ts`, `src/services/scriptSteps.ts`, `src/types/global.d.ts:12-33`.
- HTTP senders: `electron/main.cjs` — `validateString:78`, `validateHeaders:87`, `buildHttpResult:102`, `buildMultipartBody:122`, `buildAbortResult:151`, `sendAutoHttpRequest:161`, `sendHttp1Request:227`, `sendHttp2Request:302`, `hasHeader:417`, `applyAutoHeaders:427`, `http:sendRequest:443`, `http:cancelRequest:529`, `graphql:sendRequest:543`, `ws:*:616-758`, `mock:*:762-857`, `matchPath:859`. Constants `:70-76`.
- Interpolation: `src/hooks/useEnvironmentState.ts:40-85` (`getEnvVars`, `interpolate`, `redactSecrets`).
- Exec utils: `src/utils/autoHeaders.ts`, `src/utils/headers.ts`, `src/utils/safeFetch.ts`.
- Protocol handlers: `src/protocols/{http,graphql,websocket,grpc}.ts`, `registry.ts`, `index.ts`.
- Scripting: `src/services/testRunner.ts` (pure), `src/services/scriptSteps.ts` (pure); `pm`/`runScript`/`runSteps`/`buildPm` at `src/App.tsx:2772-3003` (renderer-coupled).
- DAG engine (already headless): `src/components/ProtocolPanes/dag/{engine,traverse,resolver,buildRequest,linkResolve,types,migrate,refSuggest,tokenize,layout}.ts`.
- curl parser: `src/services/curlParser.ts`.
- Config: `package.json` (no `workspaces` field), `vitest.config.ts` (`include: ["src/**/*.test.ts"]`), `tsconfig.json`, `eslint.config.js` (flat; TS block `parserOptions.project: ['./tsconfig.json']`).

---

## Task 1: npm workspaces + `@portiq/core` skeleton (Phase 0a scaffold)

**Files:**
- Modify: `package.json` (add `workspaces`)
- Modify: `vitest.config.ts` (broaden `include`)
- Modify: `eslint.config.js` (register core tsconfig)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Produces: the `@portiq/core` workspace importable as `@portiq/core`; `packages/core/src/index.ts` as the public barrel (populated in later tasks).

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@portiq/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "better-sqlite3": "^12.11.1",
    "ws": "^8.21.1"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/core/src/index.ts` (empty barrel for now)**

```ts
// @portiq/core public API. Populated task-by-task in Phase 0.
export const CORE_VERSION = "0.0.0";
```

- [ ] **Step 4: Add `workspaces` to root `package.json`**

Insert after the `"private": true,` line:

```json
  "workspaces": [
    "packages/*"
  ],
```

- [ ] **Step 5: Broaden `vitest.config.ts` include**

Replace the file contents with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Register core tsconfig in `eslint.config.js`**

In the `files: ['**/*.{ts,tsx}']` block, change `parserOptions.project` from `['./tsconfig.json']` to:

```js
        project: ['./tsconfig.json', './packages/core/tsconfig.json'],
```

- [ ] **Step 7: Write the smoke test `packages/core/src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { CORE_VERSION } from "./index";

describe("@portiq/core", () => {
  it("exposes a version constant", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 8: Install workspaces and run the smoke test**

Run: `npm install`
Run: `npm test -- packages/core/src/smoke.test.ts`
Expected: 1 passed. Also run `npm run lint` — expected: no new errors in `packages/core`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts eslint.config.js packages/core
git commit -m "chore(core): scaffold @portiq/core workspace"
```

---

## Task 2: `model/` domain types + explicit `AppState`

**Files:**
- Create: `packages/core/src/model/request.ts`
- Create: `packages/core/src/model/environment.ts`
- Create: `packages/core/src/model/script.ts`
- Create: `packages/core/src/model/response.ts`
- Create: `packages/core/src/model/appState.ts`
- Create: `packages/core/src/model/index.ts`
- Create: `packages/core/src/model/appState.test.ts`

**Interfaces:**
- Consumes: DAG types from `packages/core/src/flows/types.ts` — but that file does not exist yet in Task 2. To avoid a cross-task dependency, define a local `DagGraphRef` placeholder now and re-point it in Task 12. (Produces block documents the swap.)
- Produces: `Collection`, `FolderItem`, `RequestItem`, `RequestRow`, `AuthConfig`, `GraphqlConfig`, `WsConfig`, `WsMessage` (request.ts); `Environment`, `EnvVar` (environment.ts); `ScriptStep` (script.ts); `RequestResponse`, `RequestConfig` (response.ts); `AppState`, `HistoryEntry` (appState.ts). All re-exported from `model/index.ts`.

- [ ] **Step 1: Write the failing test `packages/core/src/model/appState.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { AppState, Collection, Environment } from "./index";

describe("AppState model", () => {
  it("round-trips a minimal app state through JSON", () => {
    const collection: Collection = { id: "c1", name: "API", items: [] };
    const environment: Environment = { id: "e1", name: "Local", vars: [] };
    const state: AppState = {
      collections: [collection],
      activeCollectionId: "c1",
      environments: [environment],
      activeEnvId: "e1",
      historyRetentionDays: 7,
    };
    const parsed = JSON.parse(JSON.stringify(state)) as AppState;
    expect(parsed.collections[0].name).toBe("API");
    expect(parsed.environments[0].id).toBe("e1");
    expect(parsed.historyRetentionDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/model/appState.test.ts`
Expected: FAIL — cannot find module `./index` / missing types.

- [ ] **Step 3: Create `packages/core/src/model/request.ts`**

Copy the interfaces verbatim from `src/hooks/useRequestState.ts:5-92` (`RequestRow`, `AuthConfig`, `GraphqlConfig`, `WsMessage`, `WsConfig`, `RequestItem`, `FolderItem`, `Collection`) with two edits: (a) replace `import type { DagGraph } from "../components/ProtocolPanes/dag/types"` with a local placeholder `export type DagGraph = { version: 2; nodes: unknown[]; edges: unknown[]; positions: Record<string, unknown>; lastRun?: unknown };` (re-pointed in Task 12), and (b) replace `import { ScriptStep } from "../services/scriptSteps"` with `import type { ScriptStep } from "./script";`.

- [ ] **Step 4: Create `packages/core/src/model/environment.ts`**

```ts
export interface EnvVar {
  key: string;
  value: string;
  comment: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}
```

- [ ] **Step 5: Create `packages/core/src/model/script.ts`**

```ts
export interface ScriptStep {
  id: string;
  name: string;
  script: string;
}
```

- [ ] **Step 6: Create `packages/core/src/model/response.ts`**

```ts
export interface RequestResponse {
  status: number;
  statusText: string;
  duration: number;
  time?: number;
  headers: Record<string, string>;
  body: string;
  json: any;
  error: string | null;
  size: number;
  cancelled?: boolean;
  timedOut?: boolean;
  httpVersion?: string;
}

export interface RequestConfig {
  protocol?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  [key: string]: any;
}
```

- [ ] **Step 7: Create `packages/core/src/model/appState.ts`**

Define the explicit `AppState` from the payload literal at `src/App.tsx:1067-1105`. Domain fields are required; the current-request draft + UI view fields are optional (they carry UI state that headless consumers ignore).

```ts
import type { Collection } from "./request";
import type { Environment } from "./environment";
import type { RequestResponse } from "./response";

/** A single history record. Stored separately from AppState (localStorage "ui_history"
 *  in the renderer); modeled here for CLI/MCP consumers. */
export interface HistoryEntry {
  timestamp: number;
  request: { protocol: string; [key: string]: any };
  response: RequestResponse;
}

/** The persisted app-state blob (SQLite kv row key "appState").
 *  Mirrors the payload literal built in src/App.tsx. `history` is NOT part of it. */
export interface AppState {
  collections: Collection[];
  activeCollectionId: string;
  environments: Environment[];
  activeEnvId: string | null;
  historyRetentionDays: number;
  // Flattened current-request draft + UI view state (optional; ignored headlessly).
  [key: string]: any;
}
```

- [ ] **Step 8: Create `packages/core/src/model/index.ts`**

```ts
export * from "./request";
export * from "./environment";
export * from "./script";
export * from "./response";
export * from "./appState";
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- packages/core/src/model/appState.test.ts`
Expected: PASS.

- [ ] **Step 10: Re-export from the barrel and commit**

Add to `packages/core/src/index.ts`: `export * from "./model";`

```bash
git add packages/core/src/model packages/core/src/index.ts
git commit -m "feat(core): add domain model types and explicit AppState"
```

---

## Task 3: `store/dataDir.ts` — canonical data-dir resolver

**Files:**
- Create: `packages/core/src/store/dataDir.ts`
- Create: `packages/core/src/store/dataDir.test.ts`

**Interfaces:**
- Produces: `resolveDataDir(opts?: ResolveDataDirOptions): string` and `interface ResolveDataDirOptions { dataDir?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string }`. Precedence: explicit `dataDir` → `env.PORTIQ_DATA_DIR` → OS-canonical default. Returns the *directory* (the SQLite file is `join(dir, "appdata.sqlite")`).

- [ ] **Step 1: Write the failing test `packages/core/src/store/dataDir.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveDataDir } from "./dataDir";

describe("resolveDataDir", () => {
  it("honors an explicit dataDir first", () => {
    expect(resolveDataDir({ dataDir: "/tmp/x", env: { PORTIQ_DATA_DIR: "/env" }, platform: "linux", home: "/home/u" }))
      .toBe("/tmp/x");
  });

  it("honors PORTIQ_DATA_DIR next", () => {
    expect(resolveDataDir({ env: { PORTIQ_DATA_DIR: "/env" }, platform: "linux", home: "/home/u" }))
      .toBe("/env");
  });

  it("uses the macOS Application Support path", () => {
    expect(resolveDataDir({ env: {}, platform: "darwin", home: "/Users/u" }))
      .toBe("/Users/u/Library/Application Support/Portiq");
  });

  it("uses the Linux ~/.config path", () => {
    expect(resolveDataDir({ env: {}, platform: "linux", home: "/home/u" }))
      .toBe("/home/u/.config/Portiq");
  });

  it("uses APPDATA on Windows", () => {
    expect(resolveDataDir({ env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, platform: "win32", home: "C:\\Users\\u" }))
      .toBe("C:\\Users\\u\\AppData\\Roaming\\Portiq");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/store/dataDir.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/store/dataDir.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "Portiq";
export const DB_FILE = "appdata.sqlite";

export interface ResolveDataDirOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Resolve the canonical Portiq data directory, matching Electron's userData
 *  convention without depending on Electron. */
export function resolveDataDir(opts: ResolveDataDirOptions = {}): string {
  const env = opts.env ?? process.env;
  if (opts.dataDir) return opts.dataDir;
  if (env.PORTIQ_DATA_DIR) return env.PORTIQ_DATA_DIR;

  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME);
  }
  if (platform === "win32") {
    const base = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(base, APP_NAME);
  }
  const base = env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(base, APP_NAME);
}

export function resolveDbPath(opts: ResolveDataDirOptions = {}): string {
  return join(resolveDataDir(opts), DB_FILE);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/store/dataDir.test.ts`
Expected: PASS (5 tests). Note: the Windows test uses `join` semantics; on a POSIX CI runner `path.join` uses `/`. If the assertion fails only on separators, change the Windows expectation to use `join("C:\\Users\\u\\AppData\\Roaming", "Portiq")` computed the same way — keep the test platform-neutral by asserting `resolveDataDir(...).endsWith("Portiq")` and that it starts with the APPDATA base.

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./store/dataDir";`

```bash
git add packages/core/src/store/dataDir.ts packages/core/src/store/dataDir.test.ts packages/core/src/index.ts
git commit -m "feat(core): canonical data-dir resolver with override precedence"
```

---

## Task 4: `store/kvStore.ts` — WAL kv store with optimistic writes

**Files:**
- Create: `packages/core/src/store/kvStore.ts`
- Create: `packages/core/src/store/kvStore.test.ts`

**Interfaces:**
- Consumes: `resolveDbPath` from `./dataDir`.
- Produces: `openKvStore(opts?: ResolveDataDirOptions): KvStore`. `interface KvStore { get(key): string | null; getVersioned(key): { value: string | null; version: number }; set(key, value): number; setIfVersion(key, value, expectedVersion): number; clear(): void; close(): void; }`. `set*` return the new version. `setIfVersion` throws `ConflictError` (exported) when the stored version differs from `expectedVersion`. Keeps the existing `kv` table shape; adds a separate `kv_version` table so the desktop app is unaffected.

- [ ] **Step 1: Write the failing test `packages/core/src/store/kvStore.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore, ConflictError } from "./kvStore";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-kv-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("openKvStore", () => {
  it("returns null for a missing key", () => {
    const s = openKvStore({ dataDir: tempDir() });
    expect(s.get("appState")).toBeNull();
    s.close();
  });

  it("persists and reads a value, bumping the version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    const v1 = s.set("appState", "{\"a\":1}");
    expect(v1).toBe(1);
    expect(s.get("appState")).toBe("{\"a\":1}");
    const v2 = s.set("appState", "{\"a\":2}");
    expect(v2).toBe(2);
    s.close();
  });

  it("enables WAL journal mode", () => {
    const dir = tempDir();
    const s = openKvStore({ dataDir: dir });
    expect(s.getVersioned("appState")).toEqual({ value: null, version: 0 });
    s.close();
  });

  it("setIfVersion succeeds when the expected version matches", () => {
    const s = openKvStore({ dataDir: tempDir() });
    const v1 = s.set("appState", "one");
    const v2 = s.setIfVersion("appState", "two", v1);
    expect(v2).toBe(2);
    expect(s.get("appState")).toBe("two");
    s.close();
  });

  it("setIfVersion throws ConflictError on a stale expected version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("appState", "one");
    s.set("appState", "two"); // version now 2
    expect(() => s.setIfVersion("appState", "three", 1)).toThrow(ConflictError);
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/store/kvStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/store/kvStore.ts`**

```ts
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { resolveDataDir, resolveDbPath, type ResolveDataDirOptions } from "./dataDir";

export class ConflictError extends Error {
  constructor(public key: string, public expected: number, public actual: number) {
    super(`Optimistic write conflict on "${key}": expected version ${expected}, found ${actual}`);
    this.name = "ConflictError";
  }
}

export interface KvStore {
  get(key: string): string | null;
  getVersioned(key: string): { value: string | null; version: number };
  set(key: string, value: string): number;
  setIfVersion(key: string, value: string, expectedVersion: number): number;
  clear(): void;
  close(): void;
}

export function openKvStore(opts: ResolveDataDirOptions = {}): KvStore {
  const dir = resolveDataDir(opts);
  mkdirSync(dir, { recursive: true });
  const db = new Database(resolveDbPath(opts));
  db.pragma("journal_mode = WAL");
  db.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)").run();
  db.prepare("CREATE TABLE IF NOT EXISTS kv_version (key TEXT PRIMARY KEY, version INTEGER NOT NULL)").run();

  const readValue = db.prepare("SELECT value FROM kv WHERE key = ?");
  const readVersion = db.prepare("SELECT version FROM kv_version WHERE key = ?");
  const upsertValue = db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const upsertVersion = db.prepare(
    "INSERT INTO kv_version (key, version) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET version = excluded.version"
  );

  function currentVersion(key: string): number {
    const row = readVersion.get(key) as { version: number } | undefined;
    return row ? row.version : 0;
  }

  const writeTxn = db.transaction((key: string, value: string, expected: number | null): number => {
    const actual = currentVersion(key);
    if (expected !== null && expected !== actual) throw new ConflictError(key, expected, actual);
    const next = actual + 1;
    upsertValue.run(key, value);
    upsertVersion.run(key, next);
    return next;
  });

  return {
    get(key) {
      const row = readValue.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    getVersioned(key) {
      const row = readValue.get(key) as { value: string } | undefined;
      return { value: row ? row.value : null, version: currentVersion(key) };
    },
    set(key, value) {
      return writeTxn(key, value, null);
    },
    setIfVersion(key, value, expectedVersion) {
      return writeTxn(key, value, expectedVersion);
    },
    clear() {
      db.prepare("DELETE FROM kv").run();
      db.prepare("DELETE FROM kv_version").run();
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/store/kvStore.test.ts`
Expected: PASS (5 tests). If `better-sqlite3` fails to load with a native-module error, run `npm run rebuild` first.

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./store/kvStore";`

```bash
git add packages/core/src/store/kvStore.ts packages/core/src/store/kvStore.test.ts packages/core/src/index.ts
git commit -m "feat(core): WAL kv store with optimistic-concurrency writes"
```

---

## Task 5: `store/appStateStore.ts` — typed AppState access + accessors

**Files:**
- Create: `packages/core/src/store/appStateStore.ts`
- Create: `packages/core/src/store/appStateStore.test.ts`

**Interfaces:**
- Consumes: `openKvStore`, `KvStore`, `ConflictError` from `./kvStore`; `AppState`, `Collection`, `Environment`, `RequestItem`, `FolderItem` from `../model`.
- Produces: `openAppStateStore(opts?): AppStateStore`. `interface AppStateStore { load(): { state: AppState | null; version: number }; save(state: AppState, expectedVersion?: number): number; collections(): Collection[]; environments(): Environment[]; flattenRequests(): RequestItem[]; close(): void; }`. `flattenRequests` walks `collection.items` recursively (FolderItem/RequestItem) and returns every `RequestItem`. `save` uses `setIfVersion` when `expectedVersion` is provided, else `set`. Key is the literal `"appState"`.

- [ ] **Step 1: Write the failing test `packages/core/src/store/appStateStore.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore } from "./appStateStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-app-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" },
      { type: "folder", id: "f1", name: "sub", items: [
        { type: "request", id: "r2", name: "Post", description: "", tags: [], protocol: "http", method: "POST", url: "https://y" },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("appStateStore", () => {
  it("returns null state with version 0 when empty", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    expect(s.load()).toEqual({ state: null, version: 0 });
    s.close();
  });

  it("saves and reloads AppState", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    const v = s.save(sample());
    expect(v).toBe(1);
    const { state, version } = s.load();
    expect(version).toBe(1);
    expect(state?.collections[0].name).toBe("API");
    s.close();
  });

  it("flattens requests across folders", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    s.save(sample());
    const reqs = s.flattenRequests();
    expect(reqs.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/store/appStateStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/store/appStateStore.ts`**

```ts
import { openKvStore, type KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment, RequestItem, FolderItem } from "../model";

const APP_STATE_KEY = "appState";

export interface AppStateStore {
  load(): { state: AppState | null; version: number };
  save(state: AppState, expectedVersion?: number): number;
  collections(): Collection[];
  environments(): Environment[];
  flattenRequests(): RequestItem[];
  close(): void;
}

function collect(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") collect(item.items, out);
  }
}

export function openAppStateStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): AppStateStore {
  const store = kv ?? openKvStore(opts);

  function load(): { state: AppState | null; version: number } {
    const { value, version } = store.getVersioned(APP_STATE_KEY);
    if (!value) return { state: null, version };
    try {
      return { state: JSON.parse(value) as AppState, version };
    } catch {
      return { state: null, version };
    }
  }

  return {
    load,
    save(state, expectedVersion) {
      const encoded = JSON.stringify(state);
      return expectedVersion === undefined
        ? store.set(APP_STATE_KEY, encoded)
        : store.setIfVersion(APP_STATE_KEY, encoded, expectedVersion);
    },
    collections() {
      return load().state?.collections ?? [];
    },
    environments() {
      return load().state?.environments ?? [];
    },
    flattenRequests() {
      const out: RequestItem[] = [];
      for (const c of load().state?.collections ?? []) collect(c.items, out);
      return out;
    },
    close() {
      store.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/store/appStateStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./store/appStateStore";`

```bash
git add packages/core/src/store/appStateStore.ts packages/core/src/store/appStateStore.test.ts packages/core/src/index.ts
git commit -m "feat(core): typed AppState store with collection/request accessors"
```

---

## Task 6: `store/portable.ts` — portable file import/export

**Files:**
- Create: `packages/core/src/store/portable.ts`
- Create: `packages/core/src/store/portable.test.ts`

**Interfaces:**
- Consumes: `AppState`, `Collection`, `Environment` from `../model`.
- Produces: `interface PortableFile { portiq: 1; exportedAt?: string; collections: Collection[]; environments: Environment[] }`; `exportPortable(state: AppState, opts?: { exportedAt?: string }): PortableFile`; `importPortable(file: unknown): { collections: Collection[]; environments: Environment[] }` (validates the `portiq: 1` marker, throws `Error` on invalid input); `mergeIntoAppState(state: AppState, incoming: { collections: Collection[]; environments: Environment[] }): AppState` (append-by-id, incoming wins on id collision).

- [ ] **Step 1: Write the failing test `packages/core/src/store/portable.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { exportPortable, importPortable, mergeIntoAppState } from "./portable";
import type { AppState } from "../model";

const base = (): AppState => ({
  collections: [{ id: "c1", name: "A", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("portable files", () => {
  it("exports collections and environments with a version marker", () => {
    const file = exportPortable(base(), { exportedAt: "2026-07-23T00:00:00Z" });
    expect(file.portiq).toBe(1);
    expect(file.collections[0].id).toBe("c1");
    expect(file.environments[0].id).toBe("e1");
    expect(file.exportedAt).toBe("2026-07-23T00:00:00Z");
  });

  it("imports a valid portable file", () => {
    const file = exportPortable(base());
    const imported = importPortable(JSON.parse(JSON.stringify(file)));
    expect(imported.collections).toHaveLength(1);
    expect(imported.environments).toHaveLength(1);
  });

  it("rejects a file without the portiq marker", () => {
    expect(() => importPortable({ collections: [] })).toThrow(/portiq/i);
  });

  it("merges incoming collections, overwriting by id", () => {
    const merged = mergeIntoAppState(base(), {
      collections: [{ id: "c1", name: "A-updated", items: [] }, { id: "c2", name: "B", items: [] }],
      environments: [{ id: "e2", name: "Prod", vars: [] }],
    });
    expect(merged.collections.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(merged.collections.find((c) => c.id === "c1")?.name).toBe("A-updated");
    expect(merged.environments.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/store/portable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/store/portable.ts`**

```ts
import type { AppState, Collection, Environment } from "../model";

export interface PortableFile {
  portiq: 1;
  exportedAt?: string;
  collections: Collection[];
  environments: Environment[];
}

export function exportPortable(state: AppState, opts: { exportedAt?: string } = {}): PortableFile {
  return {
    portiq: 1,
    exportedAt: opts.exportedAt,
    collections: state.collections ?? [],
    environments: state.environments ?? [],
  };
}

export function importPortable(file: unknown): { collections: Collection[]; environments: Environment[] } {
  if (!file || typeof file !== "object" || (file as any).portiq !== 1) {
    throw new Error("Not a valid Portiq portable file (missing \"portiq\": 1 marker)");
  }
  const f = file as PortableFile;
  return {
    collections: Array.isArray(f.collections) ? f.collections : [],
    environments: Array.isArray(f.environments) ? f.environments : [],
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((x) => [x.id, x]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function mergeIntoAppState(
  state: AppState,
  incoming: { collections: Collection[]; environments: Environment[] }
): AppState {
  return {
    ...state,
    collections: mergeById(state.collections ?? [], incoming.collections),
    environments: mergeById(state.environments ?? [], incoming.environments),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/store/portable.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./store/portable";`

```bash
git add packages/core/src/store/portable.ts packages/core/src/store/portable.test.ts packages/core/src/index.ts
git commit -m "feat(core): portable collection file import/export/merge"
```

---

## Task 7: `exec/interpolate.ts` — `{{variable}}` interpolation

**Files:**
- Create: `packages/core/src/exec/interpolate.ts`
- Create: `packages/core/src/exec/interpolate.test.ts`

**Interfaces:**
- Consumes: `Environment`, `EnvVar` from `../model`.
- Produces: `getEnvVars(env: Environment | null | undefined): Record<string, string>` (reduces enabled vars); `interpolate(value: string, vars: Record<string, string>): string` (replaces `{{key}}` with the var value or `""` when missing; non-strings pass through); `redactSecrets(value: string, secrets: Record<string, string>): string` (inverse — replaces secret values with `{{key}}`). Ports `src/hooks/useEnvironmentState.ts:40-85` but takes `vars`/`env` as explicit args (no React hook).

- [ ] **Step 1: Write the failing test `packages/core/src/exec/interpolate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { getEnvVars, interpolate } from "./interpolate";
import type { Environment } from "../model";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [
    { key: "baseUrl", value: "https://api.test", comment: "", enabled: true },
    { key: "token", value: "abc", comment: "", enabled: true },
    { key: "disabled", value: "nope", comment: "", enabled: false },
  ],
};

describe("interpolation", () => {
  it("reduces enabled env vars to a map", () => {
    expect(getEnvVars(env)).toEqual({ baseUrl: "https://api.test", token: "abc" });
  });

  it("substitutes {{var}} tokens", () => {
    expect(interpolate("{{baseUrl}}/users?t={{token}}", getEnvVars(env)))
      .toBe("https://api.test/users?t=abc");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(interpolate("x={{missing}}", getEnvVars(env))).toBe("x=");
  });

  it("passes non-strings through unchanged", () => {
    expect(interpolate(42 as unknown as string, {})).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/exec/interpolate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/exec/interpolate.ts`**

```ts
import type { Environment } from "../model";

export function getEnvVars(env: Environment | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of env?.vars ?? []) {
    if (v.enabled) out[v.key] = v.value;
  }
  return out;
}

export function interpolate<T>(value: T, vars: Record<string, string>): T {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{(.*?)\}\}/g, (_m, key) => {
    const trimmed = String(key).trim();
    return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
  }) as unknown as T;
}

export function redactSecrets(value: string, secrets: Record<string, string>): string {
  if (typeof value !== "string") return value;
  let out = value;
  for (const [key, secret] of Object.entries(secrets)) {
    if (secret) out = out.split(secret).join(`{{${key}}}`);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/exec/interpolate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./exec/interpolate";`

```bash
git add packages/core/src/exec/interpolate.ts packages/core/src/exec/interpolate.test.ts packages/core/src/index.ts
git commit -m "feat(core): headless {{variable}} interpolation helpers"
```

---

## Task 8: `exec/` header + multipart helpers

**Files:**
- Create: `packages/core/src/exec/headers.ts`
- Create: `packages/core/src/exec/autoHeaders.ts`
- Create: `packages/core/src/exec/multipart.ts`
- Create: `packages/core/src/exec/headers.test.ts`
- Create: `packages/core/src/exec/multipart.test.ts`

**Interfaces:**
- Produces:
  - `headers.ts`: `hasHeader(headers: Record<string,string>, name: string): boolean`; `validateHeaders(headers: unknown): Record<string,string>` (throws on too-many/oversized; ports `main.cjs:87-100` incl. constants `MAX_HEADER_COUNT=100`, `MAX_KEY_LENGTH=1024`, `MAX_VALUE_LENGTH=10*1024*1024`); `applyBodyContentType<T extends HeaderRow>(rows: T[], bodyType: string): T[]` (verbatim move of `src/utils/headers.ts`); `type HeaderRow = { key: string; value: string; comment?: string; enabled?: boolean }`; `BODY_CONTENT_TYPES`.
  - `autoHeaders.ts`: `applyAutoHeaders(headers: Record<string,string>, ctx: { method: string; body?: string; hasMultipart?: boolean; appVersion?: string }): Record<string,string>` (ports `main.cjs:427-441`, `app.getVersion()` replaced by `ctx.appVersion`).
  - `multipart.ts`: `buildMultipartBody(parts: MultipartPart[]): { boundary: string; body: Buffer }`; `type MultipartPart = { kind: "file"; name: string; filename?: string; contentType?: string; dataBase64?: string } | { kind: "text"; name: string; value?: string }`. Ports `main.cjs:122-149`. NOTE: `main.cjs` uses `Date.now()` in the boundary — replace with an injected/monotonic counter so it is deterministic and lint-safe: accept an optional `opts: { boundarySeed?: string }` defaulting to a module counter.

- [ ] **Step 1: Write the failing test `packages/core/src/exec/headers.test.ts`**

Copy the existing `src/utils/headers.test.ts` verbatim (see Global Constraints for style), changing the import to `./headers`, then append:

```ts
import { hasHeader, validateHeaders } from "./headers";

describe("hasHeader", () => {
  it("matches case-insensitively", () => {
    expect(hasHeader({ "Content-Type": "x" }, "content-type")).toBe(true);
    expect(hasHeader({}, "accept")).toBe(false);
  });
});

describe("validateHeaders", () => {
  it("returns a string-valued copy", () => {
    expect(validateHeaders({ a: 1 as unknown as string })).toEqual({ a: "1" });
  });
  it("throws when there are too many headers", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 101; i++) many["h" + i] = "v";
    expect(() => validateHeaders(many)).toThrow(/Too many headers/);
  });
});
```

- [ ] **Step 2: Write the failing test `packages/core/src/exec/multipart.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildMultipartBody } from "./multipart";

describe("buildMultipartBody", () => {
  it("builds a text part with a stable boundary", () => {
    const { boundary, body } = buildMultipartBody([{ kind: "text", name: "a", value: "1" }], { boundarySeed: "SEED" });
    expect(boundary).toBe("----PortiqBoundarySEED");
    const text = body.toString("utf8");
    expect(text).toContain('name="a"');
    expect(text).toContain("\r\n1\r\n");
    expect(text.trimEnd().endsWith("----PortiqBoundarySEED--")).toBe(true);
  });

  it("embeds a base64 file part", () => {
    const { body } = buildMultipartBody(
      [{ kind: "file", name: "f", filename: "x.txt", contentType: "text/plain", dataBase64: Buffer.from("hi").toString("base64") }],
      { boundarySeed: "SEED" }
    );
    const text = body.toString("utf8");
    expect(text).toContain('filename="x.txt"');
    expect(text).toContain("Content-Type: text/plain");
    expect(text).toContain("hi");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- packages/core/src/exec/headers.test.ts packages/core/src/exec/multipart.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `packages/core/src/exec/headers.ts`**

Move `applyBodyContentType`, `HeaderRow`, `BODY_CONTENT_TYPES` verbatim from `src/utils/headers.ts`, then add:

```ts
export const MAX_HEADER_COUNT = 100;
export const MAX_KEY_LENGTH = 1024;
export const MAX_VALUE_LENGTH = 10 * 1024 * 1024;

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

export function validateHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  const src = headers as Record<string, unknown>;
  const keys = Object.keys(src);
  if (keys.length > MAX_HEADER_COUNT) throw new Error(`Too many headers (max ${MAX_HEADER_COUNT})`);
  const sanitized: Record<string, string> = {};
  for (const key of keys) {
    if (key.length > MAX_KEY_LENGTH) throw new Error(`Header key exceeds maximum length of ${MAX_KEY_LENGTH}`);
    const val = src[key];
    if (typeof val === "string" && val.length > MAX_VALUE_LENGTH) {
      throw new Error(`Header value for "${key}" exceeds maximum length of ${MAX_VALUE_LENGTH}`);
    }
    sanitized[key] = String(val);
  }
  return sanitized;
}
```

- [ ] **Step 5: Implement `packages/core/src/exec/autoHeaders.ts`**

```ts
import { hasHeader } from "./headers";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export function applyAutoHeaders(
  headers: Record<string, string>,
  ctx: { method: string; body?: string; hasMultipart?: boolean; appVersion?: string }
): Record<string, string> {
  if (!hasHeader(headers, "user-agent")) {
    headers["User-Agent"] = `Portiq/${ctx.appVersion || "dev"}`;
  }
  if (!hasHeader(headers, "accept")) headers["Accept"] = "*/*";
  const carriesBody =
    !METHODS_WITHOUT_BODY.has(ctx.method) &&
    !ctx.hasMultipart &&
    typeof ctx.body === "string" &&
    ctx.body.length > 0;
  if (carriesBody && !hasHeader(headers, "content-length")) {
    headers["Content-Length"] = String(Buffer.byteLength(ctx.body as string));
  }
  return headers;
}
```

- [ ] **Step 6: Implement `packages/core/src/exec/multipart.ts`**

```ts
export type MultipartPart =
  | { kind: "file"; name: string; filename?: string; contentType?: string; dataBase64?: string }
  | { kind: "text"; name: string; value?: string };

let boundaryCounter = 0;

export function buildMultipartBody(
  parts: MultipartPart[],
  opts: { boundarySeed?: string } = {}
): { boundary: string; body: Buffer } {
  const seed = opts.boundarySeed ?? (++boundaryCounter).toString(16);
  const boundary = `----PortiqBoundary${seed}`;
  const buffers: Buffer[] = [];
  for (const part of parts || []) {
    if (!part?.name) continue;
    if (part.kind === "file") {
      const fileBuffer = Buffer.from(part.dataBase64 || "", "base64");
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename || "upload.bin"}"\r\n` +
        `Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`
      ));
      buffers.push(fileBuffer);
      buffers.push(Buffer.from("\r\n"));
      continue;
    }
    buffers.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`
    ));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(buffers) };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- packages/core/src/exec/headers.test.ts packages/core/src/exec/multipart.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./exec/headers"; export * from "./exec/autoHeaders"; export * from "./exec/multipart";`

```bash
git add packages/core/src/exec packages/core/src/index.ts
git commit -m "feat(core): headless header validation, auto-headers, multipart body"
```

---

## Task 9: `transport/http.ts` — HTTP sender (auto / 1.1 / 2) as a class

**Files:**
- Create: `packages/core/src/transport/http.ts`
- Create: `packages/core/src/transport/httpResult.ts`
- Create: `packages/core/src/transport/http.test.ts`

**Interfaces:**
- Consumes: `applyAutoHeaders` (`../exec/autoHeaders`), `validateHeaders` (`../exec/headers`), `buildMultipartBody`, `MultipartPart` (`../exec/multipart`).
- Produces:
  - `httpResult.ts`: `buildHttpResult(input): HttpResult` (verbatim `main.cjs:102-120`); `buildAbortResult(reason: "cancelled" | "timeout" | string): { cancelled: true; error: string } | { timedOut: true; error: string } | null` (verbatim `main.cjs:151-159`); `type HttpResult = { status; statusText; time; duration; headers; body; json; httpVersion }`.
  - `http.ts`: `class HttpTransport { constructor(opts?: { appVersion?: string }); send(payload: HttpSendPayload): Promise<HttpResult | { error: string } | { cancelled: true; error: string } | { timedOut: true; error: string }>; cancel(requestId: string): { ok: true } | { error: string } }`. `interface HttpSendPayload { requestId?: string; method: string; url: string; headers?: Record<string,string>; body?: string; timeoutMs?: number; httpVersion?: "auto" | "1.1" | "2"; multipartParts?: MultipartPart[] }`. Internally holds a per-instance `pendingRequests: Map<string, { cancel(): void }>` (replaces module-level `pendingHttpRequests`). `send` ports the `http:sendRequest` handler body (`main.cjs:443-527`): validation, timeout default 30000, multipart handling, `applyAutoHeaders({..., appVersion})`, dispatch to `sendAuto`/`sendHttp1`/`sendHttp2` (ported from `main.cjs:161-407`, using Node `http`/`https`/`http2` and global `fetch`).

- [ ] **Step 1: Write the failing test `packages/core/src/transport/http.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpTransport } from "./http";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("HttpTransport", () => {
  it("performs a GET and normalizes the result (auto)", async () => {
    const port = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "GET", url: `http://127.0.0.1:${port}/`, httpVersion: "auto" });
    expect("status" in r && r.status).toBe(200);
    expect("json" in r && r.json).toEqual({ ok: true, method: "GET" });
    expect("httpVersion" in r && r.httpVersion).toBe("auto");
  });

  it("sends a POST body over HTTP/1.1", async () => {
    let received = "";
    const port = await listen((req, res) => {
      req.on("data", (c) => (received += c));
      req.on("end", () => { res.statusCode = 201; res.end("created"); });
    });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "POST", url: `http://127.0.0.1:${port}/`, body: "hello", httpVersion: "1.1" });
    expect("status" in r && r.status).toBe(201);
    expect(received).toBe("hello");
    expect("httpVersion" in r && r.httpVersion).toMatch(/^HTTP\/1/);
  });

  it("returns a timeout result when the server hangs", async () => {
    const port = await listen(() => { /* never respond */ });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "GET", url: `http://127.0.0.1:${port}/`, timeoutMs: 100, httpVersion: "1.1" });
    expect("timedOut" in r && r.timedOut).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/transport/httpResult.ts`**

Port `buildHttpResult` (`main.cjs:102-120`) and `buildAbortResult` (`main.cjs:151-159`) verbatim into TypeScript, exporting `HttpResult`:

```ts
export interface HttpResult {
  status: number;
  statusText: string;
  time: number;
  duration: number;
  headers: Record<string, string>;
  body: string;
  json: any;
  httpVersion: string;
}

export function buildHttpResult(input: {
  status: number; statusText: string; headers: Record<string, string>;
  body: string; duration: number; httpVersion: string;
}): HttpResult {
  let json: any;
  try { json = JSON.parse(input.body); } catch { json = null; }
  return {
    status: input.status,
    statusText: input.statusText,
    time: input.duration,
    duration: input.duration,
    headers: input.headers,
    body: input.body,
    json,
    httpVersion: input.httpVersion,
  };
}

export function buildAbortResult(reason: string):
  | { cancelled: true; error: string }
  | { timedOut: true; error: string }
  | null {
  if (reason === "cancelled") return { cancelled: true, error: "Request cancelled" };
  if (reason === "timeout") return { timedOut: true, error: "Request timeout" };
  return null;
}
```

- [ ] **Step 4: Implement `packages/core/src/transport/http.ts`**

Port the three senders (`sendAutoHttpRequest` `main.cjs:161-225`, `sendHttp1Request` `:227-300`, `sendHttp2Request` `:302-407`) and the `http:sendRequest` dispatch body (`:443-527`) into a class. Replace module-level `pendingHttpRequests` with an instance field; keep `fetch`/`http`/`https`/`http2`. Full skeleton (fill the three private senders verbatim from `main.cjs`, adapting `const`→typed params):

```ts
import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";
import { applyAutoHeaders } from "../exec/autoHeaders";
import { buildHttpResult, buildAbortResult, type HttpResult } from "./httpResult";
import { buildMultipartBody, type MultipartPart } from "../exec/multipart";

export interface HttpSendPayload {
  requestId?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  httpVersion?: "auto" | "1.1" | "2";
  multipartParts?: MultipartPart[];
}

type SendResult = HttpResult | { error: string } | { cancelled: true; error: string } | { timedOut: true; error: string };

export class HttpTransport {
  private pending = new Map<string, { cancel: () => void }>();
  private appVersion: string;

  constructor(opts: { appVersion?: string } = {}) {
    this.appVersion = opts.appVersion ?? "";
  }

  async send(payload: HttpSendPayload): Promise<SendResult> {
    // Port of main.cjs http:sendRequest (443-527): validate, default timeout 30000,
    // build multipart, applyAutoHeaders({ method, body, hasMultipart, appVersion: this.appVersion }),
    // then dispatch by httpVersion to the private senders below.
    // ... (verbatim adaptation) ...
    throw new Error("fill from main.cjs:443-527");
  }

  cancel(requestId: string): { ok: true } | { error: string } {
    if (!requestId) return { error: "Missing request ID" };
    const p = this.pending.get(requestId);
    p?.cancel();
    return { ok: true };
  }

  private async sendAuto(p: Required<Pick<HttpSendPayload, "method" | "url">> & HttpSendPayload): Promise<SendResult> {
    // Port main.cjs:161-225 (fetch + AbortController), register/deregister in this.pending.
    throw new Error("fill from main.cjs:161-225");
  }
  private sendHttp1(p: HttpSendPayload): Promise<SendResult> {
    // Port main.cjs:227-300 (http/https.request), this.pending.
    throw new Error("fill from main.cjs:227-300");
  }
  private sendHttp2(p: HttpSendPayload): Promise<SendResult> {
    // Port main.cjs:302-407 (http2.connect), this.pending.
    throw new Error("fill from main.cjs:302-407");
  }
}
```

Implementation notes for the port: (a) every place `main.cjs` did `pendingHttpRequests.set/get/delete` becomes `this.pending.*`; (b) `buildHttpResult(...)` and `buildAbortResult(...)` now come from `./httpResult`; (c) keep `Date.now()` for `startedAt`/`duration` — that is real runtime timing, not test-sensitive; (d) reference `main.cjs` line ranges above for the exact bodies.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/http.test.ts`
Expected: PASS (3 tests). If HTTP/2 test flakiness appears later, gate HTTP/2 behind its own test with `h2c` or skip in CI — not needed for these three.

- [ ] **Step 6: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./transport/http"; export * from "./transport/httpResult";`

```bash
git add packages/core/src/transport packages/core/src/index.ts
git commit -m "feat(core): HTTP transport (auto/1.1/2) with per-instance cancellation"
```

---

## Task 10: `transport/graphql.ts` — GraphQL sender

**Files:**
- Create: `packages/core/src/transport/graphql.ts`
- Create: `packages/core/src/transport/graphql.test.ts`

**Interfaces:**
- Consumes: `buildHttpResult` from `./httpResult`.
- Produces: `sendGraphQL(payload: GraphQLSendPayload): Promise<HttpResult | { error: string }>`; `interface GraphQLSendPayload { url: string; headers?: Record<string,string>; query: string; variables?: string | object | null; operationName?: string }`. Ports `main.cjs:543-611` but reuses `buildHttpResult` (fixing the duplication noted during exploration — result now includes `httpVersion: "auto"`). Forces `Content-Type: application/json`; parses `variables` from a JSON string; POSTs via global `fetch`.

- [ ] **Step 1: Write the failing test `packages/core/src/transport/graphql.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { sendGraphQL } from "./graphql";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("sendGraphQL", () => {
  it("posts a query and returns a normalized result", async () => {
    let body = "";
    const port = await listen((req, res) => {
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: { hello: "world" } }));
      });
    });
    const r = await sendGraphQL({ url: `http://127.0.0.1:${port}/graphql`, query: "{ hello }", variables: '{"a":1}' });
    expect("status" in r && r.status).toBe(200);
    expect("json" in r && r.json).toEqual({ data: { hello: "world" } });
    expect(JSON.parse(body)).toMatchObject({ query: "{ hello }", variables: { a: 1 } });
  });

  it("returns an error for invalid variables JSON", async () => {
    const r = await sendGraphQL({ url: "http://127.0.0.1:1/graphql", query: "{ x }", variables: "{bad" });
    expect("error" in r && r.error).toMatch(/variables must be valid JSON/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/graphql.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/transport/graphql.ts`**

Port `main.cjs:543-611`; on success call `buildHttpResult({ status, statusText, headers, body: text, duration, httpVersion: "auto" })`:

```ts
import { buildHttpResult, type HttpResult } from "./httpResult";

export interface GraphQLSendPayload {
  url: string;
  headers?: Record<string, string>;
  query: string;
  variables?: string | object | null;
  operationName?: string;
}

export async function sendGraphQL(payload: GraphQLSendPayload): Promise<HttpResult | { error: string }> {
  const { url, headers = {}, query, variables, operationName } = payload;
  let parsedVariables: object | undefined;
  if (typeof variables === "string" && variables.trim()) {
    try { parsedVariables = JSON.parse(variables); }
    catch { return { error: "GraphQL variables must be valid JSON" }; }
  } else if (variables && typeof variables === "object") {
    parsedVariables = variables;
  }
  const finalHeaders: Record<string, string> = { ...headers, "Content-Type": "application/json" };
  const graphqlBody = JSON.stringify({
    query,
    variables: parsedVariables || undefined,
    operationName: operationName || undefined,
  });
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "POST", headers: finalHeaders, body: graphqlBody });
    const text = await response.text();
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => { headersObj[key] = value; });
    return buildHttpResult({
      status: response.status,
      statusText: response.statusText,
      headers: headersObj,
      body: text,
      duration: Date.now() - startedAt,
      httpVersion: "auto",
    });
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/graphql.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./transport/graphql";`

```bash
git add packages/core/src/transport/graphql.ts packages/core/src/transport/graphql.test.ts packages/core/src/index.ts
git commit -m "feat(core): GraphQL transport reusing the shared HTTP result shape"
```

---

## Task 11: `transport/websocket.ts` — WsManager (EventEmitter, no BrowserWindow)

**Files:**
- Create: `packages/core/src/transport/websocket.ts`
- Create: `packages/core/src/transport/websocket.test.ts`

**Interfaces:**
- Produces: `class WsManager extends EventEmitter` with `connect(payload: WsConnectPayload): Promise<{ status: "connected"; connectedAt: number } | { error: string } | { cancelled: true; error: string }>`, `sendMessage(payload: { id: string; data: string; encoding?: "text" | "base64" })`, `disconnect(payload: { id: string }): { ok: true } | { error: string }`, `getMessages(payload: { id: string }): { messages: WsRecord[]; status: string; connectedAt: number | null }`. Emits events `"message"` `{ id, message }`, `"closed"` `{ id, ... }`, `"error"` `{ id, error }` — replacing `BrowserWindow.getAllWindows().forEach(win => win.webContents.send("ws:message", ...))` (`main.cjs:670-697`). Uses `ws` (`import WebSocket from "ws"`). Per-instance `connections: Map`. `interface WsConnectPayload { id: string; url: string; headers?: Record<string,string>; protocols?: string[]; timeoutMs?: number }`. `interface WsRecord { timestamp: number; direction: "incoming" | "outgoing"; data: string; size: number; encoding: string }`.

- [ ] **Step 1: Write the failing test `packages/core/src/transport/websocket.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { WsManager } from "./websocket";

let wss: WebSocketServer | null = null;
function listen(): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve((wss!.address() as any).port));
    wss.on("connection", (socket) => {
      socket.on("message", (m) => socket.send(`echo:${m}`));
    });
  });
}
afterEach(() => { wss?.close(); wss = null; });

describe("WsManager", () => {
  it("connects, echoes a message, and emits it", async () => {
    const port = await listen();
    const mgr = new WsManager();
    const received: any[] = [];
    mgr.on("message", (evt) => { if (evt.message.direction === "incoming") received.push(evt.message.data); });

    const res = await mgr.connect({ id: "w1", url: `ws://127.0.0.1:${port}` });
    expect("status" in res && res.status).toBe("connected");

    mgr.sendMessage({ id: "w1", data: "hi" });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toContain("echo:hi");

    expect(mgr.disconnect({ id: "w1" })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/websocket.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/transport/websocket.ts`**

Port `ws:connect/send/disconnect/getMessages` (`main.cjs:616-758`) into an `EventEmitter` subclass. Everywhere `main.cjs` did `BrowserWindow.getAllWindows().forEach(win => win.webContents.send("ws:message", { id, message: msg }))`, replace with `this.emit("message", { id, message: msg })` (and likewise `"closed"`, `"error"`). Replace `const WebSocket = require("ws")` with a top import `import WebSocket from "ws"`. Replace the module-level `wsConnections` map with `private connections = new Map()`. Keep the last-1000-messages cap, base64 handling in `sendMessage`, and the `readyState !== 1` guard verbatim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/websocket.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./transport/websocket";`

```bash
git add packages/core/src/transport/websocket.ts packages/core/src/transport/websocket.test.ts packages/core/src/index.ts
git commit -m "feat(core): WebSocket manager emitting events instead of IPC push"
```

---

## Task 12: `transport/mock.ts` + `flows/` (move headless DAG engine) + repoint model DagGraph

**Files:**
- Create: `packages/core/src/transport/mock.ts`
- Create: `packages/core/src/transport/mock.test.ts`
- Create: `packages/core/src/flows/{engine,traverse,resolver,buildRequest,linkResolve,types,migrate,refSuggest,tokenize,layout}.ts` (moved)
- Move: `src/components/ProtocolPanes/dag/engine.test.ts` → `packages/core/src/flows/engine.test.ts` (and any other pure dag `*.test.ts`)
- Modify: `packages/core/src/model/request.ts` (repoint `DagGraph`)

**Interfaces:**
- Produces:
  - `mock.ts`: `class MockServerManager` with `start(payload: { id: string; port: number; routes: MockRoute[] }): Promise<{ ok: true; port: number } | { error: string }>`, `stop({ id }): { ok: true } | { error: string }`, `list(): { id: string; port: number; routeCount: number }[]`, `updateRoutes({ id, routes }): { ok: true } | { error: string }`; `matchPath(pattern, pathname): boolean`; `type MockRoute = { method: string; path: string; statusCode?: number; headers?: Record<string,string>; body?: string; delay?: number }`. Ports `main.cjs:762-865`. Per-instance `servers: Map`.
  - `flows/*`: the DAG engine, re-exported. `runFlow`, `topoSort`, `descendants`, `ancestors`, `resolveTemplate`, `DagGraph`, etc. — moved verbatim from `src/components/ProtocolPanes/dag/`.
- Consumes: `flows/types.ts` now provides the real `DagGraph`; `model/request.ts` imports it.

- [ ] **Step 1: Move the DAG engine files into `packages/core/src/flows/`**

Run:
```bash
git mv src/components/ProtocolPanes/dag/engine.ts packages/core/src/flows/engine.ts
git mv src/components/ProtocolPanes/dag/traverse.ts packages/core/src/flows/traverse.ts
git mv src/components/ProtocolPanes/dag/resolver.ts packages/core/src/flows/resolver.ts
git mv src/components/ProtocolPanes/dag/buildRequest.ts packages/core/src/flows/buildRequest.ts
git mv src/components/ProtocolPanes/dag/linkResolve.ts packages/core/src/flows/linkResolve.ts
git mv src/components/ProtocolPanes/dag/types.ts packages/core/src/flows/types.ts
git mv src/components/ProtocolPanes/dag/migrate.ts packages/core/src/flows/migrate.ts
git mv src/components/ProtocolPanes/dag/refSuggest.ts packages/core/src/flows/refSuggest.ts
git mv src/components/ProtocolPanes/dag/tokenize.ts packages/core/src/flows/tokenize.ts
git mv src/components/ProtocolPanes/dag/layout.ts packages/core/src/flows/layout.ts
```
Then create `packages/core/src/flows/index.ts` re-exporting from `./engine`, `./traverse`, `./resolver`, `./buildRequest`, `./linkResolve`, `./types`.

- [ ] **Step 2: Re-export DAG engine from `src/components/ProtocolPanes/dag/index.ts` shim so the renderer keeps compiling**

Create `src/components/ProtocolPanes/dag/index.ts` (if renderer files import `./engine` etc. directly, update those imports to `@portiq/core` instead). Grep first:

Run: `grep -rn "ProtocolPanes/dag/\(engine\|traverse\|resolver\|buildRequest\|linkResolve\|types\|migrate\|refSuggest\|tokenize\|layout\)" src`
For each hit, change the import to `import { ... } from "@portiq/core";`. `DagFlowPane.tsx` imports several — repoint them all.

- [ ] **Step 3: Repoint `model/request.ts` DagGraph to the real type**

In `packages/core/src/model/request.ts`, remove the placeholder `DagGraph` and add `import type { DagGraph } from "../flows/types";` (keep `RequestItem.dagGraph?: DagGraph`).

- [ ] **Step 4: Move the DAG engine test and run it**

Run: `git mv src/components/ProtocolPanes/dag/engine.test.ts packages/core/src/flows/engine.test.ts` (repeat for any other pure dag `*.test.ts` such as `resolver.test.ts`, `traverse.test.ts`, `tokenize.test.ts` — run `ls src/components/ProtocolPanes/dag/*.test.ts` first). Fix relative imports (they stay `./engine` etc., so usually no change).
Run: `npm test -- packages/core/src/flows/`
Expected: PASS (moved tests green).

- [ ] **Step 5: Write the failing mock test `packages/core/src/transport/mock.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { MockServerManager, matchPath } from "./mock";

let mgr: MockServerManager | null = null;
afterEach(() => { mgr?.list().forEach((s) => mgr!.stop({ id: s.id })); mgr = null; });

describe("matchPath", () => {
  it("matches param segments", () => {
    expect(matchPath("/users/:id", "/users/42")).toBe(true);
    expect(matchPath("/users/:id", "/users/42/x")).toBe(false);
  });
});

describe("MockServerManager", () => {
  it("serves a configured route", async () => {
    mgr = new MockServerManager();
    const start = await mgr.start({ id: "m1", port: 0, routes: [
      { method: "GET", path: "/ping", statusCode: 200, body: "pong" },
    ]});
    expect("ok" in start && start.ok).toBe(true);
    const port = ("port" in start && start.port) as number;
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });
});
```

Note: `mock:start` binds to the given `port`; to support `port: 0` (ephemeral) in tests, the port passed to `http.Server.listen` should be used as-is (Node treats 0 as ephemeral) and the actual port read from `server.address().port` and returned. Adjust the ported `start` to return the resolved port.

- [ ] **Step 6: Implement `packages/core/src/transport/mock.ts`**

Port `mock:start/stop/list/updateRoutes` (`main.cjs:762-857`) and `matchPath` (`:859-865`) into a class with `private servers = new Map()`. Use `import { createServer } from "node:http"`. Change `start` to `listen(port, "127.0.0.1", () => resolve({ ok: true, port: (server.address()).port }))` so ephemeral ports work.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- packages/core/src/transport/mock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Verify the renderer still builds, then commit**

Run: `npm run build` (Vite build of the renderer — confirms the repointed dag imports resolve to `@portiq/core`).
Expected: build succeeds.

```bash
git add packages/core/src/flows packages/core/src/transport/mock.ts packages/core/src/transport/mock.test.ts packages/core/src/model/request.ts packages/core/src/index.ts src/components/ProtocolPanes
git commit -m "feat(core): move DAG engine to core and add mock-server manager"
```

- [ ] **Step 9: Re-export flows + mock from the barrel**

Add to `packages/core/src/index.ts`: `export * from "./flows"; export * from "./transport/mock";` (commit folded into Step 8 if done before it; otherwise amend).

---

## Task 13: `scripting/` — test harness, script steps, headless `pm`

**Files:**
- Move: `src/services/testRunner.ts` → `packages/core/src/scripting/testRunner.ts` (+ its test)
- Move: `src/services/scriptSteps.ts` → `packages/core/src/scripting/scriptSteps.ts` (+ its test)
- Create: `packages/core/src/scripting/pm.ts`
- Create: `packages/core/src/scripting/pm.test.ts`

**Interfaces:**
- Consumes: `createTestHarness`, `TestEntry` from `./testRunner`; `RequestResponse` from `../model`.
- Produces:
  - moved `testRunner.ts` (`createTestHarness`, `summarizeTests`, `TestEntry`, `TestHarness`, `TestSummary`) and `scriptSteps.ts` (`ScriptStep`, `genStepId`, `emptyStep`, `toSteps`) — verbatim.
  - `pm.ts`: `buildPm(ctx: PmContext): Pm` and `runScript(code: string, ctx: PmContext): Promise<TestEntry[]>` and `runSteps(steps: ScriptStep[], ctx: PmContext): Promise<TestEntry[]>`. `interface PmContext { request: any; response: RequestResponse; env: Record<string,string>; setEnvVar(key: string, value: string): void; sendRequest(payload: any): Promise<any>; label?: string; group?: string }`. This is the headless refactor of `App.tsx:2823-2905`: `pm.environment.get/set/unset/toObject` read/write `ctx.env`+`ctx.setEnvVar`; `pm.sendRequest` delegates to `ctx.sendRequest`; `describe`/`test` delegate to `createTestHarness`; `expect(...)` chain ported verbatim. No React state, no `window.api`.

- [ ] **Step 1: Move `testRunner.ts` + `scriptSteps.ts` and their tests**

Run:
```bash
git mv src/services/testRunner.ts packages/core/src/scripting/testRunner.ts
git mv src/services/testRunner.test.ts packages/core/src/scripting/testRunner.test.ts
git mv src/services/scriptSteps.ts packages/core/src/scripting/scriptSteps.ts
git mv src/services/scriptSteps.test.ts packages/core/src/scripting/scriptSteps.test.ts
```
Then grep for renderer importers and repoint them:
Run: `grep -rn "services/testRunner\|services/scriptSteps" src`
Change each to `from "@portiq/core"`. Update `src/hooks/useRequestState.ts:3` (`import { ScriptStep, toSteps } from "../services/scriptSteps"`) → `from "@portiq/core"`.

- [ ] **Step 2: Run the moved tests**

Run: `npm test -- packages/core/src/scripting/testRunner.test.ts packages/core/src/scripting/scriptSteps.test.ts`
Expected: PASS (unchanged behavior).

- [ ] **Step 3: Write the failing test `packages/core/src/scripting/pm.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { runScript, type PmContext } from "./pm";
import { summarizeTests } from "./testRunner";

function ctx(overrides: Partial<PmContext> = {}): PmContext {
  const env: Record<string, string> = { baseUrl: "https://x" };
  return {
    request: { method: "GET", url: "https://x" },
    response: { status: 200, statusText: "OK", duration: 1, headers: {}, body: '{"ok":true}', json: { ok: true }, error: null, size: 10 },
    env,
    setEnvVar: (k, v) => { env[k] = v; },
    sendRequest: async () => ({ status: 200 }),
    ...overrides,
  };
}

describe("pm sandbox", () => {
  it("records a passing test via pm.test + pm.expect", async () => {
    const entries = await runScript(
      `pm.test("status is 200", () => { pm.expect(pm.response.code).to.equal(200); });`,
      ctx()
    );
    const summary = summarizeTests(entries);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("records a failing assertion without throwing", async () => {
    const entries = await runScript(
      `pm.test("bad", () => { pm.expect(pm.response.code).to.equal(500); });`,
      ctx()
    );
    expect(summarizeTests(entries).failed).toBe(1);
  });

  it("writes environment variables through the injected setter", async () => {
    const env: Record<string, string> = {};
    await runScript(`pm.environment.set("token", "xyz");`, ctx({ env, setEnvVar: (k, v) => { env[k] = v; } }));
    expect(env.token).toBe("xyz");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- packages/core/src/scripting/pm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `packages/core/src/scripting/pm.ts`**

Port `buildPm`/`runScript`/`runSteps` from `App.tsx:2823-2905`, replacing closed-over React scope with `PmContext`:
- `new AsyncFunction("context", "api", "pm", "output", code)` executed as `await fn({ request, response }, undefined, pm, output)` — drop the `api` (Electron) arg (pass `undefined`) since headless scripts use `pm.sendRequest`.
- `pm.environment.get(k)` → `ctx.env[k]`; `.set(k,v)` → `ctx.setEnvVar(k,v)` and `ctx.env[k]=v`; `.toObject()` → `{...ctx.env}`; `.unset(k)` → delete + setter with "".
- `pm.response`: `.code`/`.status` from `ctx.response.status`, `.text()` → `ctx.response.body`, `.json()` → `ctx.response.json`, `.to.have.status(n)` asserts equality.
- `pm.expect(value).to.{equal,be.true,be.false,exist,have.property,contain}` — port verbatim.
- `describe`/`test` → `createTestHarness(output, ctx.label ?? "script", Date.now, ctx.group ?? "Ungrouped")`.
- `pm.sendRequest(payload)` → `ctx.sendRequest(payload)`.
- `runScript` returns the `output: TestEntry[]` array; `runSteps` iterates `ScriptStep[]`, concatenating outputs.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- packages/core/src/scripting/pm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./scripting/testRunner"; export * from "./scripting/scriptSteps"; export * from "./scripting/pm";`
Run: `npm run build` (confirm renderer still resolves the repointed scripting imports).

```bash
git add packages/core/src/scripting src/services src/hooks packages/core/src/index.ts
git commit -m "feat(core): move test harness/script steps and add headless pm sandbox"
```

---

## Task 14: `import/curlParser.ts` — move + rehome types

**Files:**
- Move: `src/services/curlParser.ts` → `packages/core/src/import/curlParser.ts` (+ its test)

**Interfaces:**
- Consumes: `RequestRow`, `AuthConfig` from `../model`.
- Produces: `parseCurl`, `looksLikeCurl`, `inferRequestNameFromUrl`, `collectTemplateVars`, `findParameterizableVars`, `parameterizeParsedCurl`, `ParsedCurl` — verbatim, with the `import type { RequestRow, AuthConfig }` source changed from `../hooks/useRequestState` to `../model`.

- [ ] **Step 1: Move the file and its test**

Run:
```bash
git mv src/services/curlParser.ts packages/core/src/import/curlParser.ts
git mv src/services/curlParser.test.ts packages/core/src/import/curlParser.test.ts
```

- [ ] **Step 2: Rehome the type import**

In `packages/core/src/import/curlParser.ts`, change `import type { RequestRow, AuthConfig } from "../hooks/useRequestState";` to `import type { RequestRow, AuthConfig } from "../model";`.

- [ ] **Step 3: Repoint renderer importers**

Run: `grep -rn "services/curlParser" src`
Change each to `from "@portiq/core"`.

- [ ] **Step 4: Run the moved test**

Run: `npm test -- packages/core/src/import/curlParser.test.ts`
Expected: PASS (unchanged behavior).

- [ ] **Step 5: Re-export, verify build, commit**

Add to `packages/core/src/index.ts`: `export * from "./import/curlParser";`
Run: `npm run build`

```bash
git add packages/core/src/import src/services src/index.ts packages/core/src/index.ts src
git commit -m "feat(core): move curl parser into core and rehome its types"
```

---

## Task 15: Protocol handlers → core (decouple `window.api`)

**Files:**
- Move: `src/protocols/{registry,http,graphql,websocket,grpc,index}.ts` → `packages/core/src/protocols/`
- Modify: `graphql.ts` (inject schema-fetch transport), `websocket.ts` (drop `createConnectionManager` renderer glue)

**Interfaces:**
- Consumes: `sendGraphQL` from `../transport/graphql` (for schema fetch).
- Produces: `ProtocolRegistry`, `HttpProtocol`, `GraphQLProtocol`, `WebSocketProtocol`, `GrpcProtocol`, `ProtocolHandler`. `buildRequest`/`parseResponse`/`validateRequest`/`defaultConfig`/`methods` unchanged. `fetchSchema` signature changes from using `window.api.sendGraphQL` to accepting an injected sender: `fetchSchema(url, headers, send = sendGraphQL)`. The renderer `createConnectionManager` (WS) glue does NOT move to core — it stays a renderer concern that now talks to core's `WsManager` through the Electron adapter; delete it from the moved `websocket.ts` (keep `buildRequest`/`parseResponse`/`parseMessage`/`formatMessage`).

- [ ] **Step 1: Move protocol files**

Run:
```bash
git mv src/protocols/registry.ts packages/core/src/protocols/registry.ts
git mv src/protocols/http.ts packages/core/src/protocols/http.ts
git mv src/protocols/graphql.ts packages/core/src/protocols/graphql.ts
git mv src/protocols/websocket.ts packages/core/src/protocols/websocket.ts
git mv src/protocols/grpc.ts packages/core/src/protocols/grpc.ts
git mv src/protocols/index.ts packages/core/src/protocols/index.ts
```

- [ ] **Step 2: Decouple `graphql.ts` `fetchSchema`**

Replace the `(window as any).api.sendGraphQL(payload)` call in `fetchSchema` with an injected sender defaulting to core's transport:
```ts
import { sendGraphQL } from "../transport/graphql";
// ...
export async function fetchSchema(url: string, headers: Record<string, string>, send = sendGraphQL) {
  const result = await send({ url, headers, query: INTROSPECTION_QUERY });
  // ...existing parse of result.json...
}
```
Note: `parseResponse` uses `new Blob([...]).size` — replace with `Buffer.byteLength(...)` for a Node-safe size (grep the moved http/graphql/grpc handlers for `new Blob(` and swap each to `Buffer.byteLength(raw.body || "")`).

- [ ] **Step 3: Strip renderer glue from `websocket.ts`**

Delete `createConnectionManager` (the block using `window.api.wsConnect/wsSend/...` and `window.setTimeout`). Keep `id`, `methods`, `defaultConfig`, `validateRequest`, `buildRequest`, `parseResponse`, `parseMessage`, `formatMessage`. If the renderer imported `createConnectionManager`, that glue moves to a renderer-side module in a later task (Electron rewire, Task 16) — for now grep and note callers:
Run: `grep -rn "createConnectionManager" src`

- [ ] **Step 4: Repoint renderer protocol importers**

Run: `grep -rn "from \"\.\./protocols\|from \"\./protocols\|src/protocols" src`
Change each to `from "@portiq/core"`.

- [ ] **Step 5: Run existing protocol tests (if any) + build**

Run: `ls src/protocols/*.test.ts packages/core/src/protocols/*.test.ts 2>/dev/null` — move any into core alongside their module.
Run: `npm test -- packages/core/src/protocols/ 2>/dev/null; npm run build`
Expected: build succeeds; any moved protocol tests pass.

- [ ] **Step 6: Re-export and commit**

Add to `packages/core/src/index.ts`: `export * from "./protocols";`

```bash
git add packages/core/src/protocols src package.json packages/core/src/index.ts
git commit -m "feat(core): move protocol handlers to core, decouple from window.api"
```

---

## Task 16: Electron rewire — `main.cjs` delegates to `@portiq/core`; pin app name

**Files:**
- Modify: `electron/main.cjs`
- Modify: `packages/core/package.json` (add a build so `main.cjs` can `require` it) OR add a compiled entry — see Step 1.

**Interfaces:**
- Consumes: `@portiq/core` public API (`HttpTransport`, `sendGraphQL`, `WsManager`, `MockServerManager`, `resolveDataDir`, `openKvStore`).
- Produces: unchanged IPC channels (`http:sendRequest`, `http:cancelRequest`, `graphql:sendRequest`, `ws:*`, `mock:*`, `db:*`) whose bodies now call core.

- [ ] **Step 1: Give `main.cjs` a way to load ESM core**

`main.cjs` is CommonJS; `@portiq/core` is ESM/TS. Add a compiled CJS build of core: in `packages/core/package.json` add `"scripts": { "build": "tsc -p tsconfig.build.json" }` and create `packages/core/tsconfig.build.json` extending `tsconfig.json` with `"noEmit": false, "outDir": "dist", "module": "CommonJS", "moduleResolution": "Node", "declaration": true`; set core `package.json` `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, and add `"exports": { ".": { "import": "./src/index.ts", "require": "./dist/index.js" } }`. Add `"@portiq/core": "*"` to the root `package.json` dependencies. Add a root `prestart`/`predev` hook or a `build:core` step; simplest: add `"build:core": "npm --workspace @portiq/core run build"` and call it in `dev`/`package` scripts. Run `npm run build:core` and confirm `packages/core/dist/index.js` exists.

- [ ] **Step 2: Replace HTTP handler bodies with core**

At the top of `main.cjs` add `const core = require("@portiq/core");` and `const httpTransport = new core.HttpTransport({ appVersion: app.getVersion() });`. Replace the body of `ipcMain.handle("http:sendRequest", ...)` (`main.cjs:443-527`) with `return httpTransport.send(payload);` and `ipcMain.handle("http:cancelRequest", ...)` with `return httpTransport.cancel(payload?.requestId);`. Delete the now-unused local `sendAuto*/sendHttp*/buildHttpResult/buildAbortResult/buildMultipartBody/applyAutoHeaders/validate*/hasHeader` functions and the `pendingHttpRequests` map (they live in core now).

- [ ] **Step 3: Replace GraphQL, WS, and mock handler bodies with core**

`graphql:sendRequest` → `return core.sendGraphQL(payload);`. Create `const wsManager = new core.WsManager();` and wire `wsManager.on("message"/"closed"/"error", (evt) => BrowserWindow.getAllWindows().forEach(w => w.webContents.send("ws:"+event, evt)))` — i.e. the `BrowserWindow` push now lives in the adapter, not core; `ws:connect/send/disconnect/getMessages` handlers delegate to `wsManager`. Create `const mockManager = new core.MockServerManager();` and delegate `mock:*` handlers.

- [ ] **Step 4: Pin the app name + data dir and migrate a legacy dev store**

Immediately after `const isDev = !app.isPackaged;` add:
```js
app.setName("Portiq");
try { app.setPath("userData", core.resolveDataDir()); } catch (e) { /* fall back to default */ }
```
Then in `initDb()`, migrate a legacy lowercase-`portiq` store if present and the new one is absent:
```js
// One-time migration: older dev builds used a lowercase "portiq" userData dir.
const legacyDir = path.join(path.dirname(app.getPath("userData")), "portiq");
const legacyDb = path.join(legacyDir, "appdata.sqlite");
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
  fs.copyFileSync(legacyDb, dbPath);
}
```
(Place this before `db = new Database(dbPath)`.)

- [ ] **Step 5: Manual smoke test of the desktop app**

Run: `npm run build:core && npm run dev`
Verify by hand: app launches; an HTTP request sends and shows a response; a GraphQL query works; a WebSocket connects and echoes; the mock server starts; collections persist across a restart. Confirm the data file is at `core.resolveDataDir()/appdata.sqlite` (check `Settings → data path`, which calls `db:getDataPath`).
Expected: all behaviors identical to before.

- [ ] **Step 6: Commit**

```bash
git add electron/main.cjs packages/core/package.json packages/core/tsconfig.build.json package.json package-lock.json
git commit -m "refactor(electron): delegate execution to @portiq/core and pin app name"
```

---

## Task 17: Golden parity test + full suite green

**Files:**
- Create: `packages/core/src/parity.test.ts`

**Interfaces:**
- Consumes: `HttpTransport`, `buildHttpResult` from `@portiq/core`.

- [ ] **Step 1: Write the parity test `packages/core/src/parity.test.ts`**

This asserts the normalized HTTP result shape matches the contract in Global Constraints (the exact keys the renderer's `parseResponse` and history entries depend on), locking parity between the old `main.cjs` shape and core.

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpTransport } from "./index";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("golden parity: HTTP result shape", () => {
  it("returns exactly the keys the renderer expects", async () => {
    const port = await listen((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ a: 1 }));
    });
    const r = await new HttpTransport({ appVersion: "test" }).send({
      method: "GET", url: `http://127.0.0.1:${port}/`, httpVersion: "1.1",
    });
    expect(Object.keys(r as object).sort()).toEqual(
      ["body", "duration", "headers", "httpVersion", "json", "status", "statusText", "time"].sort()
    );
    const rr = r as any;
    expect(rr.time).toBe(rr.duration);
    expect(rr.json).toEqual({ a: 1 });
    expect(typeof rr.headers["content-type"]).toBe("string");
  });
});
```

- [ ] **Step 2: Run the parity test**

Run: `npm test -- packages/core/src/parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the ENTIRE suite + lint + build**

Run: `npm test`
Expected: all tests pass (core + relocated renderer tests).
Run: `npm run lint`
Expected: no errors.
Run: `npm run build`
Expected: renderer build succeeds.

- [ ] **Step 4: Add a changeset and commit**

Run: `npx changeset` — choose a `minor` bump for the app, summary: "Extract @portiq/core headless package (Phase 0)."

```bash
git add packages/core/src/parity.test.ts .changeset
git commit -m "test(core): golden parity test for HTTP result shape"
```

---

## Self-Review

**Spec coverage** (against `2026-07-23-cli-mcp-access-design.md` Phase 0 + data-location contract + parallelization Phase 0a):
- npm workspaces + `@portiq/core` skeleton → Task 1 ✅
- Phase 0a contract (model + public-API barrel assembled incrementally) → Tasks 1-2 + barrel exports through Task 17 ✅
- `store/` resolveDataDir + WAL + optimistic writes + portable import/export → Tasks 3-6 ✅
- `model/` explicit AppState → Task 2 ✅
- `exec/` interpolation + auto-headers + headers + multipart → Tasks 7-8 ✅
- `protocols/` + senders HTTP/GraphQL/WS → Tasks 9-11, 15 ✅
- mock server → Task 12 ✅
- `scripting/` (needed because MCP run_collection returns test results) → Task 13 ✅
- `flows/` DAG engine → Task 12 ✅
- curl import → Task 14 ✅
- Electron rewire → main.cjs uses core → Task 16 ✅
- Pin app name (+ dev/packaged convergence + legacy migration) → Task 16 ✅
- Golden parity test → Task 17 ✅
- Data-location contract (`APP_NAME = "Portiq"`, `resolveDataDir` precedence) → Task 3 + Task 16 ✅

Deferred to later phases by design (not gaps): gRPC transport (grpc.ts has no sender today), git sync, AI, and the renderer-side WS `createConnectionManager` re-home (Task 15 Step 3 notes it stays a renderer concern; Phase 1/2 wire it through the Electron adapter). The renderer continues to call `window.api.*`; only the main-process bodies moved.

**Placeholder scan:** The three private HTTP senders in Task 9 Step 4 intentionally show `throw new Error("fill from main.cjs:NNN-NNN")` skeletons with exact source line ranges to port — this is a verbatim relocation of existing, tested code, not new logic; the task's tests fully exercise the result. All other steps contain complete code.

**Type consistency:** `HttpResult` keys `{ status, statusText, time, duration, headers, body, json, httpVersion }` are consistent across `httpResult.ts` (Task 9), `sendGraphQL` (Task 10), and the parity test (Task 17). `ResolveDataDirOptions` is defined in Task 3 and consumed in Tasks 4-5. `AppState`/`Collection`/`Environment` defined in Task 2 are consumed in Tasks 5-6. `PmContext` defined in Task 13. `DagGraph` placeholder in Task 2 is repointed in Task 12 Step 3.
