# Phase 1 — `portiq-mcp` stdio MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone stdio MCP server (`portiq-mcp`) in a new `@portiq/mcp` workspace that lets AI hosts browse the Portiq library (resources), run requests/collections/flows and parse curl (read/execute tools), and — opt-in — mutate the library (guarded write tools), consuming `@portiq/core` read-only.

**Architecture:** A new plain-Node npm-workspace package `packages/mcp/` depends on `@portiq/core` (workspace `*`), `@modelcontextprotocol/sdk` (^1.29.0), and `zod` (^4). The server is assembled by a factory (`createMcpServer(ctx)`) that additively invokes independent registrar modules — `registerResources`, `registerReadTools`, `registerExecTools`, `registerWriteTools` — each owning its own tool/resource list (never a shared switchboard). Execution reuses core's real senders (`HttpTransport`, `sendGraphQL`), scripting (`runSteps`/`summarizeTests`), and flow engine (`@portiq/core/flows` `runFlow`). Request-assembly (auth compilation + rows→object + body-by-type) is now the canonical `assembleRequest()` API in `@portiq/core` (extracted by Phase 0.5); `@portiq/mcp` consumes it directly (`import { assembleRequest } from "@portiq/core"`) rather than maintaining its own bridge. Storage is resolved exactly once via `core.resolveDataDir()` (through `openAppStateStore`). The `bin` (`dist/bin.js`) wires the factory to a `StdioServerTransport`.

**Tech Stack:** TypeScript (ESNext src via `moduleResolution: Bundler`; CJS `dist` build via `tsc` like `@portiq/core`), Vitest 4 (`node` environment, esbuild transpile), `@modelcontextprotocol/sdk` 1.29.0 (`McpServer`, `ResourceTemplate`, `StdioServerTransport`; client-side `Client` + `InMemoryTransport` + `StdioClientTransport` for tests), `zod` v4 for `inputSchema` shapes, `better-sqlite3` (via core), Node `http` (test servers), npm workspaces.

## Global Constraints

- Package name: `@portiq/mcp`; version starts at `0.1.0`; `"type": "module"`; `"private": true` until Phase 4 publish. Bin name is exactly `portiq-mcp`.
- **Owns only `packages/mcp/**`** plus its workspace entry. The `require`/`dist` target on the `./flows` subpath in `packages/core/package.json` (needed so a CJS consumer can `require("@portiq/core/flows")`) is now owned and applied by Phase 0.5 (Part B / Task 3), so NO cross-package edit to core is made here — Task 1 Step 5 is verify-only. No file outside `packages/mcp/` may be modified except root `package.json` scripts, `eslint.config.js` project list, and a changeset.
- **Consume `@portiq/core` read-only via its public API.** Never import from `src/` (the renderer) or `electron/`. Never reach into `packages/core/src/**` by relative path — import from `"@portiq/core"` and `"@portiq/core/flows"` only.
- **better-sqlite3 ABI gotcha:** the hoisted native binary serves EITHER plain-Node OR Electron, not both. MCP and its vitest tests run on plain-Node. Before running any task that opens the store or spawns the server (`npm rebuild better-sqlite3`); `npm run rebuild` returns the binary to Electron. Any task whose tests open `openAppStateStore`/spawn `bin.js` MUST run `npm rebuild better-sqlite3` first if it hits an `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch.
- **Data-location contract:** resolve storage ONLY via `core.resolveDataDir()` (reached through `openAppStateStore({ dataDir })`). Shared file is `<dataDir>/appdata.sqlite`. Precedence: `--data-dir` (config) → `PORTIQ_DATA_DIR` (env, honored inside `resolveDataDir`) → OS default. Never re-derive the path anywhere.
- **Registry pattern:** register tools/resources additively. Adding a tool means appending to that registrar module's own list — never editing a shared dispatcher/switch.
- **Write-gating:** all six write tools are registered ALWAYS but `.disable()`d when writes are off, so they are hidden from `tools/list` (SDK filters on `tool.enabled`) and calling one yields the SDK's `Tool <name> disabled` McpError. Gate = `--allow-writes` flag OR `PORTIQ_MCP_ALLOW_WRITES` in (`"1"`, `"true"`). Write tools carry MCP annotations (`readOnlyHint: false`; `destructiveHint: true` on update/delete). Writes go through core's optimistic path `store.save(state, expectedVersion)` with one reload-retry on `ConflictError`.
- **kv_version reconciliation caveat (known limitation):** `electron/main.cjs` still writes `appState` through its own inline `kv` connection that does NOT bump the `kv_version` table (progress.md Phase-1 follow-up #1). Therefore MCP's optimistic `expectedVersion` cannot detect writes made by a running desktop app; MCP writes are effectively last-writer-wins relative to the app until reconciliation lands. Document this in the write-tools task and README; recommend running write tools with the desktop app closed.
- **stdio purity:** the server process MUST NOT write anything but JSON-RPC frames to stdout. All diagnostics go to `stderr` (`console.error` only; never `console.log`).
- **Unsupported protocols:** `run_request`/`run_ad_hoc_request` dispatch `http` (+ empty/undefined protocol) → `HttpTransport.send`, `graphql` → `sendGraphQL`. `websocket`/`grpc` return a clear "not yet supported headlessly" error (gRPC will flow through `run_request` once its core sender lands — out of scope here).
- **History limitation:** history is renderer `localStorage` ("ui_history"), NOT in the shared `appState` blob (progress.md / Phase 0). `portiq://history` returns `state.history ?? []` (empty on stores written only by the app) with a documented note.
- Test convention (match repo): `import { describe, it, expect } from "vitest";` (add `vi`, `beforeAll`, `afterAll`, `afterEach` as needed); co-locate `*.test.ts`; local factory helpers at top; inject clocks/deps for determinism; no global setup file.
- Commit after every task with a Conventional Commit; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (verified real APIs)

- **MCP SDK 1.29.0** (`@modelcontextprotocol/sdk`, exports subpaths): server `McpServer`, `ResourceTemplate` from `@modelcontextprotocol/sdk/server/mcp.js`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. Client `Client` from `@modelcontextprotocol/sdk/client/index.js`; `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`; `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`.
  - `new McpServer({ name, version }, { capabilities?, instructions? })`.
  - `server.registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations? }, async (args, extra) => ({ content: [{ type: "text", text }], isError? }))` — `inputSchema` is a Zod raw shape object `{ k: z.string() }`; `annotations` = `{ readOnlyHint?, destructiveHint?, idempotentHint?, title? }`. Returns a `RegisteredTool` with `.enable()`, `.disable()`, `.enabled`.
  - `server.registerResource(name, uri: string | ResourceTemplate, metadata: { title?, description?, mimeType? }, readCallback)`. Static callback `(uri: URL) => ({ contents: [{ uri: uri.href, mimeType, text }] })`; template callback `(uri: URL, variables) => ...`. `new ResourceTemplate("portiq://collection/{id}", { list: undefined })`.
  - `server.connect(transport)`. `tools/list` returns only `enabled` tools; calling a disabled tool throws `McpError(InvalidParams, "Tool <name> disabled")`.
  - Client: `await client.connect(transport)`, `client.listTools()` → `{ tools: [{ name, description, inputSchema, annotations }] }`, `client.callTool({ name, arguments })` → `{ content: [{ type:"text", text }], isError? }`, `client.listResources()`, `client.readResource({ uri })` → `{ contents: [{ uri, text, mimeType }] }`. `InMemoryTransport.createLinkedPair(): [a, b]`. `new StdioClientTransport({ command, args?, env? })`.
- **`@portiq/core` public API** (from `packages/core/src/index.ts` barrel):
  - store: `resolveDataDir(opts?)`, `resolveDbPath(opts?)`, `ResolveDataDirOptions { dataDir?, env?, platform?, home? }`, `APP_NAME`, `DB_FILE`; `openKvStore`, `KvStore`, `ConflictError`; `openAppStateStore(opts?, kv?): AppStateStore { load(): { state: AppState | null; version: number }; save(state, expectedVersion?): number; collections(): Collection[]; environments(): Environment[]; flattenRequests(): RequestItem[]; close() }`; `exportPortable`, `importPortable`, `mergeIntoAppState`.
  - exec: `getEnvVars(env): Record<string,string>`, `interpolate<T>(value, vars): T`, `redactSecrets`; `validateHeaders`, `hasHeader`, `applyBodyContentType`, `applyAutoHeaders`; `buildMultipartBody(parts, opts?)`, `MultipartPart`.
  - transport: `HttpTransport` (`new HttpTransport({ appVersion? })`, `.send(payload: HttpSendPayload): Promise<HttpResult | {error} | {cancelled,error} | {timedOut,error}>`, `.cancel(id)`), `HttpSendPayload { requestId?, method, url, headers?, body?, timeoutMs?, httpVersion?, multipartParts? }`; `buildHttpResult`, `buildAbortResult`, `HttpResult { status, statusText, time, duration, headers, body, json, httpVersion }`; `sendGraphQL(payload: GraphQLSendPayload): Promise<HttpResult | {error}>`, `GraphQLSendPayload { url, headers?, query, variables?, operationName? }`; `WsManager`, `MockServerManager`, `matchPath`.
  - scripting: `runScript(code, ctx): Promise<TestEntry[]>`, `runSteps(steps, ctx): Promise<TestEntry[]>`, `PmContext { request, response, env, setEnvVar, sendRequest, label?, group? }`, `buildPm`, `createTestHarness`, `summarizeTests(entries): TestSummary`, `TestEntry`, `TestSummary`, `TestGroupSummary`; `toSteps`, `emptyStep`, `genStepId`.
  - import: `parseCurl(command): ParsedCurl`, `looksLikeCurl`, `inferRequestNameFromUrl`, `collectTemplateVars`, `findParameterizableVars`, `parameterizeParsedCurl`; `ParsedCurl { method, url, headersRows, paramsRows, bodyType, bodyText, bodyRows, authType, authConfig }`.
  - protocols: `ProtocolRegistry` (`.getAll()`, `.get(id)`, `.getIds()`, `.detectFromUrl(url)`), `ProtocolHandler`.
  - model types: `AppState`, `Collection`, `FolderItem`, `RequestItem`, `RequestRow`, `AuthConfig`, `GraphqlConfig`, `WsConfig`, `WsMessage`, `Environment`, `EnvVar`, `ScriptStep`, `RequestResponse`, `RequestConfig`, `HistoryEntry`.
  - `@portiq/core/flows` subpath: `runFlow(graph, deps: RunDeps, options?): Promise<StepsContext>`, `RunDeps { sendRequest, lookupConfig, env, onStatus }`, `SendResult { status, statusText?, headers?, data?, time?, error? }`, `RequestConfig { method, url, headers, body, params, pathVars }` (flows variant; all strings), `DagGraph`, `StepsContext`, `StepResult`, `RunOptions`, `buildSendPayload`, `topoSort`, `EMPTY_REQUEST_CONFIG`.
- **Request assembly — now canonical in `@portiq/core` (Phase 0.5):** `assembleRequest(req, opts?)` reproduces `src/App.tsx` `handleSend` (`:2211-2276`) byte-for-byte (body-by-type + payload build, `getCompiledAuthHeaders`/`getCompiledAuthParams`, `rowsToObject`/`buildUrlWithParams`) and is proven by a golden parity test. MCP consumes it (`import { assembleRequest } from "@portiq/core"`) instead of re-implementing — see Task 4 (superseded) and Task 5.
- **Electron delegation (parity reference):** `electron/main.cjs` `const core = require("@portiq/core")`; `app.setPath("userData", core.resolveDataDir())`; `httpTransport = new core.HttpTransport({ appVersion: app.getVersion() })`; `httpTransport.send(payload)`; `core.sendGraphQL(payload)`.

---

## Task 1: Scaffold `@portiq/mcp` workspace + core `./flows` require-mapping

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/tsconfig.build.json`
- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/version.ts`
- Create: `packages/mcp/src/smoke.test.ts`
- Verify only (no edit): `packages/core/package.json` `./flows` `require`/`dist` mapping — applied by Phase 0.5 (Part B / Task 3)
- Modify: root `package.json` (add `build:mcp` script)
- Modify: `eslint.config.js` (register `packages/mcp/tsconfig.json`)

**Interfaces:**
- Produces: the `@portiq/mcp` workspace importable as `@portiq/mcp`; `packages/mcp/src/index.ts` as the public barrel (populated in later tasks); `SERVER_NAME`, `SERVER_VERSION` constants (`version.ts`).
- Confirms: `@portiq/core/flows` is resolvable via `require` at runtime (CJS consumers). The `require`/`dist` mapping is owned by Phase 0.5 (Part B); Step 5 only verifies it — no core edit here.

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "@portiq/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "src/index.ts",
  "bin": {
    "portiq-mcp": "dist/bin.js"
  },
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "require": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json && node -e \"require('fs').writeFileSync('dist/package.json', JSON.stringify({ type: 'commonjs' }))\""
  },
  "dependencies": {
    "@portiq/core": "*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`** (type-check/vitest context; Bundler resolution reads SDK subpath types)

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

- [ ] **Step 3: Create `packages/mcp/tsconfig.build.json`** (CJS emit, mirrors `packages/core/tsconfig.build.json`)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "ignoreDeprecations": "6.0",
    "declaration": false,
    "noEmitOnError": false
  },
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 4: Create `packages/mcp/src/version.ts`**

```ts
export const SERVER_NAME = "portiq-mcp";
export const SERVER_VERSION = "0.1.0";
```

- [ ] **Step 5: Verify the core `./flows` `require`→`dist` mapping (owned by Phase 0.5)**

> **SUPERSEDED BY Phase 0.5 (Part B / Task 3).** The `require`/`dist` condition on `packages/core/package.json` `exports["./flows"]` is applied by Phase 0.5 — do NOT edit core here. This step only confirms the mapping is present so `@portiq/mcp`'s built CJS `bin.js` can `require("@portiq/core/flows")`.

Run: `node -e "require('@portiq/core/flows')"`
Expected: resolves without `ERR_PACKAGE_PATH_NOT_EXPORTED` (the `./flows` export already maps `require`→`./dist/flows/index.js`). If it fails, Phase 0.5 has not landed — STOP and land Phase 0.5 first.

- [ ] **Step 6: Add `build:mcp` to root `package.json` scripts**

Insert after the `"build:core": ...` line:

```json
    "build:mcp": "npm run build:core && npm --workspace @portiq/mcp run build",
```

- [ ] **Step 7: Register the mcp tsconfig in `eslint.config.js`**

In the `files: ['**/*.{ts,tsx}']` block, change `parserOptions.project` from `['./tsconfig.json', './packages/core/tsconfig.json']` to:

```js
        project: ['./tsconfig.json', './packages/core/tsconfig.json', './packages/mcp/tsconfig.json'],
```

- [ ] **Step 8: Create `packages/mcp/src/index.ts` (barrel; populated later)**

```ts
// @portiq/mcp public API. Populated task-by-task in Phase 1.
export { SERVER_NAME, SERVER_VERSION } from "./version";
```

- [ ] **Step 9: Write the smoke test `packages/mcp/src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "./index";

describe("@portiq/mcp", () => {
  it("exposes server identity constants", () => {
    expect(SERVER_NAME).toBe("portiq-mcp");
    expect(SERVER_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 10: Install workspaces and verify**

Run: `npm install` (installs `@modelcontextprotocol/sdk`; links `@portiq/mcp`).
Run: `npm test -- packages/mcp/src/smoke.test.ts`
Expected: 1 passed.
Run: `npm run build:mcp`
Expected: emits `packages/core/dist/**` and `packages/mcp/dist/index.js` with no errors.
Run: `npm run lint`
Expected: no new errors under `packages/mcp`.

- [ ] **Step 11: Commit**

```bash
git add packages/mcp package.json package-lock.json eslint.config.js
git commit -m "chore(mcp): scaffold @portiq/mcp workspace (core flows require mapping owned by Phase 0.5)"
```

---

## Task 2: `config.ts` — parse server flags/env

**Files:**
- Create: `packages/mcp/src/config.ts`
- Create: `packages/mcp/src/config.test.ts`

**Interfaces:**
- Consumes: `SERVER_VERSION` from `./version`.
- Produces: `interface ServerConfig { dataDir?: string; allowWrites: boolean; appVersion: string }`; `parseServerConfig(argv: string[], env?: NodeJS.ProcessEnv): ServerConfig`. Precedence for writes: `--allow-writes` flag OR `PORTIQ_MCP_ALLOW_WRITES` ∈ {`"1"`,`"true"`}. `dataDir` from `--data-dir <path>` / `--data-dir=<path>` (undefined otherwise — resolver handles env/default). `appVersion` from `PORTIQ_MCP_APP_VERSION` else `SERVER_VERSION`.

- [ ] **Step 1: Write the failing test `packages/mcp/src/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseServerConfig } from "./config";

describe("parseServerConfig", () => {
  it("defaults to writes disabled and no explicit dataDir", () => {
    const c = parseServerConfig([], {});
    expect(c.allowWrites).toBe(false);
    expect(c.dataDir).toBeUndefined();
    expect(c.appVersion).toBe("0.1.0");
  });

  it("enables writes via --allow-writes flag", () => {
    expect(parseServerConfig(["--allow-writes"], {}).allowWrites).toBe(true);
  });

  it("enables writes via PORTIQ_MCP_ALLOW_WRITES=1", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "1" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "true" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "0" }).allowWrites).toBe(false);
  });

  it("reads --data-dir in both spaced and = forms", () => {
    expect(parseServerConfig(["--data-dir", "/tmp/a"], {}).dataDir).toBe("/tmp/a");
    expect(parseServerConfig(["--data-dir=/tmp/b"], {}).dataDir).toBe("/tmp/b");
  });

  it("honors PORTIQ_MCP_APP_VERSION override", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_APP_VERSION: "9.9.9" }).appVersion).toBe("9.9.9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/mcp/src/config.ts`**

```ts
import { SERVER_VERSION } from "./version";

export interface ServerConfig {
  dataDir?: string;
  allowWrites: boolean;
  appVersion: string;
}

const DATA_DIR_PREFIX = "--data-dir=";

export function parseServerConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const envFlag = env.PORTIQ_MCP_ALLOW_WRITES;
  let allowWrites = envFlag === "1" || envFlag === "true";
  let dataDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-writes") {
      allowWrites = true;
    } else if (arg === "--data-dir") {
      dataDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith(DATA_DIR_PREFIX)) {
      dataDir = arg.slice(DATA_DIR_PREFIX.length);
    }
  }

  return {
    dataDir,
    allowWrites,
    appVersion: env.PORTIQ_MCP_APP_VERSION || SERVER_VERSION,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/mcp/src/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/config.ts packages/mcp/src/config.test.ts
git commit -m "feat(mcp): parse --allow-writes/--data-dir flags and env"
```

---

## Task 3: `search.ts` — library search over AppState

**Files:**
- Create: `packages/mcp/src/search.ts`
- Create: `packages/mcp/src/search.test.ts`

**Interfaces:**
- Consumes: `AppState`, `Collection`, `RequestItem`, `FolderItem`, `Environment` from `@portiq/core`.
- Produces: `interface SearchHit { type: "request" | "collection" | "environment" | "flow"; id: string; name: string; detail?: string; score: number }`; `searchLibrary(state: AppState | null, query: string, limit?: number): SearchHit[]`. Case-insensitive substring scoring over request name/method/url/tags, collection name, environment name, and flows (requests with `dagGraph`). Higher score = better; results sorted desc then by name; `limit` defaults to 25.

- [ ] **Step 1: Write the failing test `packages/mcp/src/search.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { searchLibrary } from "./search";
import type { AppState } from "@portiq/core";

const state = (): AppState => ({
  collections: [{
    id: "c1", name: "Users API",
    items: [
      { type: "request", id: "r1", name: "List Users", description: "", tags: ["users"], protocol: "http", method: "GET", url: "https://api.test/users" },
      { type: "folder", id: "f1", name: "Admin", items: [
        { type: "request", id: "r2", name: "Delete User", description: "", tags: [], protocol: "http", method: "DELETE", url: "https://api.test/users/1" },
        { type: "request", id: "r3", name: "User Flow", description: "", tags: [], protocol: "http", method: "GET", url: "https://api.test/flow", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("searchLibrary", () => {
  it("returns [] for null state or empty query", () => {
    expect(searchLibrary(null, "x")).toEqual([]);
    expect(searchLibrary(state(), "  ")).toEqual([]);
  });

  it("matches request names and urls case-insensitively", () => {
    const hits = searchLibrary(state(), "user");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
  });

  it("matches by http method", () => {
    const hits = searchLibrary(state(), "delete");
    expect(hits[0].id).toBe("r2");
  });

  it("classifies dagGraph requests as flow hits", () => {
    const hit = searchLibrary(state(), "User Flow").find((h) => h.id === "r3");
    expect(hit?.type).toBe("flow");
  });

  it("respects the limit", () => {
    expect(searchLibrary(state(), "user", 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/mcp/src/search.ts`**

```ts
import type { AppState, Collection, FolderItem, RequestItem } from "@portiq/core";

export interface SearchHit {
  type: "request" | "collection" | "environment" | "flow";
  id: string;
  name: string;
  detail?: string;
  score: number;
}

function scoreText(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  if (!h) return 0;
  const idx = h.indexOf(needle);
  if (idx === -1) return 0;
  // Exact match beats prefix beats substring; shorter haystacks rank higher.
  if (h === needle) return 100;
  if (idx === 0) return 60;
  return 30 + Math.max(0, 10 - Math.floor(idx / 4));
}

function walk(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") walk(item.items, out);
  }
}

export function searchLibrary(state: AppState | null, query: string, limit = 25): SearchHit[] {
  const needle = (query || "").trim().toLowerCase();
  if (!state || !needle) return [];

  const hits: SearchHit[] = [];

  const collections: Collection[] = state.collections ?? [];
  for (const c of collections) {
    const cScore = scoreText(c.name, needle);
    if (cScore > 0) hits.push({ type: "collection", id: c.id, name: c.name, score: cScore });

    const requests: RequestItem[] = [];
    walk(c.items ?? [], requests);
    for (const r of requests) {
      const fields = [r.name, r.method, r.url, ...(r.tags ?? [])];
      const best = Math.max(...fields.map((f) => scoreText(String(f ?? ""), needle)), 0);
      if (best > 0) {
        hits.push({
          type: r.dagGraph ? "flow" : "request",
          id: r.id,
          name: r.name,
          detail: `${r.method} ${r.url}`,
          score: best,
        });
      }
    }
  }

  for (const e of state.environments ?? []) {
    const eScore = scoreText(e.name, needle);
    if (eScore > 0) hits.push({ type: "environment", id: e.id, name: e.name, score: eScore });
  }

  hits.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/mcp/src/search.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/search.ts packages/mcp/src/search.test.ts
git commit -m "feat(mcp): substring-scored library search over AppState"
```

---

## Task 4: `exec/resolveHttpSend.ts` — RequestItem → HttpSendPayload bridge

> **SUPERSEDED BY Phase 0.5 (Part A / Task 1 + Part D delta #1).** This task no longer reimplements request assembly. The canonical `assembleRequest(req, opts?)` now lives in `@portiq/core` (Phase 0.5, extracted from the renderer's `handleSend` and proven byte-identical by a golden test). Do NOT create `packages/mcp/src/exec/resolveHttpSend.ts`, `mergeVars`, `rowsToObject`, `compileAuth*`, `buildUrl`, or `buildBody` — consume `assembleRequest` directly (see Task 5). Consuming core also silently FIXES the MCP port's three former divergences (header-precedence: `headersText` JSON now wins over rows; JSON-body comment-stripping now applied; URL query encoding now manual `encodeURIComponent` + host:port slash fix, not `URLSearchParams`). Variable merging is provided by core's `resolveVars(env, overrides)`.

**Files:**
- (none created — module removed; `assembleRequest`/`resolveVars` consumed from `@portiq/core`)

**Interfaces:**
- Consumes: `assembleRequest(req, opts?)`, `resolveVars(env, overrides?)`, `InvalidJsonBodyError`, `type AssemblableRequest` from `@portiq/core` (Phase 0.5).
- Produces: nothing new. The only wiring left to MCP is passing tool options (`env`, `vars`, `requestId`) through to `assembleRequest` — exercised by Task 5's `runRequestItem` suite (its end-to-end send asserts the assembled request reached the test server), so no separate `resolveHttpSend.test.ts` is created.

This task produces no code. Request assembly is consumed from `@portiq/core` in Task 5:

```ts
import { assembleRequest, resolveVars, InvalidJsonBodyError } from "@portiq/core";

// item is a saved RequestItem (a valid AssemblableRequest); env/vars/requestId come from the tool call.
const payload = assembleRequest(item, { env, vars, requestId });
```

The former `mergeVars(env, overrides)` helper is replaced by core's `resolveVars(env, overrides)`. Invalid JSON bodies now throw core's `InvalidJsonBodyError`, which the tool handler converts to the standard error-tool result (`errorToolResult(err.message)`), exactly as the previous throw was handled. No `resolveHttpSend.ts` / `resolveHttpSend.test.ts` is created; the single option-passthrough check lives in Task 5's suite.

---

## Task 5: `exec/run.ts` — execute a request and run its scripts/tests

**Files:**
- Create: `packages/mcp/src/exec/run.ts`
- Create: `packages/mcp/src/testkit/httpServer.ts`
- Create: `packages/mcp/src/exec/run.test.ts`

**Interfaces:**
- Consumes: `HttpTransport`, `sendGraphQL`, `runSteps`, `summarizeTests`, `interpolate`, `assembleRequest`, `resolveVars`, `HttpResult`, `TestEntry`, `TestSummary`, `RequestItem`, `Environment` from `@portiq/core`. `assembleRequest(...)` / `resolveVars(...)` are the Phase 0.5 request-assembly API (Task 4 is superseded — there is no local `resolveHttpSend`/`mergeVars`). `assembleRequest` may throw `InvalidJsonBodyError` (also exported from `@portiq/core`); the tool handler's existing `try/catch` converts it to an error-tool result, so `runRequestItem` needs no extra handling. This is where the ≤1 option-passthrough check (env/vars/requestId reach the assembler) lives.
- Produces:
  - `testkit/httpServer.ts`: `startTestHttpServer(): Promise<{ url: string; close: () => Promise<void> }>` — a plain-Node echo server returning `{ method, path, headers, body }` as JSON.
  - `run.ts`: `interface NormalizedResponse { status; statusText; headers; body; json; time; httpVersion?; error?; cancelled?; timedOut? }`; `interface RunResult { response: NormalizedResponse; tests: TestSummary }`; `interface RunContext { transport: HttpTransport; env?: Environment | null; vars?: Record<string,string> }`; `runRequestItem(item: RequestItem, ctx: RunContext): Promise<RunResult>`. Dispatches by `item.protocol` (http/empty → transport; graphql → `sendGraphQL`; websocket/grpc → throw `Error("Protocol '<p>' is not supported headlessly yet")`). Runs `item.testsPreSteps` then sends, then `item.testsPostSteps`, sharing one mutable `env` map for chaining; returns summarized pre+post entries. (Pre-script request mutation is NOT wired — documented limitation.)

- [ ] **Step 1: Write the failing test `packages/mcp/src/exec/run.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpTransport } from "@portiq/core";
import type { RequestItem } from "@portiq/core";
import { runRequestItem } from "./run";
import { startTestHttpServer } from "../testkit/httpServer";

let server: { url: string; close: () => Promise<void> };
beforeAll(async () => { server = await startTestHttpServer(); });
afterAll(async () => { await server.close(); });

const transport = new HttpTransport({ appVersion: "test" });

describe("runRequestItem", () => {
  it("sends an http GET and normalizes the response", async () => {
    const item: RequestItem = {
      type: "request", id: "r1", name: "get", description: "", tags: [],
      protocol: "http", method: "GET", url: `${server.url}/ping`,
    };
    const { response } = await runRequestItem(item, { transport });
    expect(response.status).toBe(200);
    expect(response.json.method).toBe("GET");
    expect(response.json.path).toBe("/ping");
  });

  it("runs post-script tests against the response", async () => {
    const item: RequestItem = {
      type: "request", id: "r2", name: "tested", description: "", tags: [],
      protocol: "http", method: "GET", url: `${server.url}/x`,
      testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('ok', () => pm.response.to.have.status(200));" }],
    };
    const { tests } = await runRequestItem(item, { transport });
    expect(tests.passed).toBe(1);
    expect(tests.failed).toBe(0);
  });

  it("rejects unsupported protocols with a clear message", async () => {
    const item: RequestItem = {
      type: "request", id: "r3", name: "ws", description: "", tags: [],
      protocol: "websocket", method: "GET", url: "wss://x",
    };
    await expect(runRequestItem(item, { transport })).rejects.toThrow(/not supported headlessly/i);
  });
});
```

- [ ] **Step 2: Write `packages/mcp/src/testkit/httpServer.ts`**

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startTestHttpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- packages/mcp/src/exec/run.test.ts`
Expected: FAIL — `./run` module not found.

- [ ] **Step 4: Implement `packages/mcp/src/exec/run.ts`**

```ts
import {
  sendGraphQL,
  runSteps,
  summarizeTests,
  interpolate,
  assembleRequest,
  resolveVars,
  type Environment,
  type HttpResult,
  type HttpTransport,
  type RequestItem,
  type TestEntry,
  type TestSummary,
} from "@portiq/core";

export interface NormalizedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  json: unknown;
  time: number;
  httpVersion?: string;
  error?: string;
  cancelled?: boolean;
  timedOut?: boolean;
}

export interface RunContext {
  transport: HttpTransport;
  env?: Environment | null;
  vars?: Record<string, string>;
}

export interface RunResult {
  response: NormalizedResponse;
  tests: TestSummary;
}

type SendOutcome =
  | HttpResult
  | { error: string }
  | { cancelled: true; error: string }
  | { timedOut: true; error: string };

function normalize(r: SendOutcome): NormalizedResponse {
  if ("cancelled" in r && r.cancelled) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, cancelled: true, error: r.error };
  }
  if ("timedOut" in r && r.timedOut) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, timedOut: true, error: r.error };
  }
  if ("error" in r) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, error: r.error };
  }
  return {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
    body: r.body,
    json: r.json,
    time: r.time,
    httpVersion: r.httpVersion,
  };
}

export async function runRequestItem(item: RequestItem, ctx: RunContext): Promise<RunResult> {
  const vars = resolveVars(ctx.env, ctx.vars); // shared mutable map: pm.environment.set chains across steps
  const entries: TestEntry[] = [];
  const setEnvVar = (key: string, value: string) => { vars[key] = value; };

  // Pre-scripts (side effects + tests; request mutation not wired in v1).
  if (item.testsPreSteps?.length) {
    entries.push(...await runSteps(item.testsPreSteps, {
      request: { method: item.method, url: item.url, headers: {}, body: item.bodyText },
      response: null as never,
      env: vars,
      setEnvVar,
      sendRequest: async () => ({}),
      label: "pre-script",
    }));
  }

  const protocol = (item.protocol || "http").toLowerCase();
  let outcome: SendOutcome;
  if (protocol === "http" || protocol === "") {
    const payload = assembleRequest(item, { env: ctx.env, vars });
    outcome = await ctx.transport.send(payload);
  } else if (protocol === "graphql") {
    const gql = item.graphqlConfig;
    outcome = await sendGraphQL({
      url: interpolate(item.url ?? "", vars),
      headers: { ...compileGraphqlHeaders(item, vars) },
      query: interpolate(gql?.query ?? "", vars),
      variables: interpolate(gql?.variables ?? "", vars),
      operationName: gql?.operationName || undefined,
    });
  } else {
    throw new Error(`Protocol '${protocol}' is not supported headlessly yet`);
  }

  const response = normalize(outcome);

  // Post-scripts / tests.
  if (item.testsPostSteps?.length) {
    entries.push(...await runSteps(item.testsPostSteps, {
      request: { method: item.method, url: item.url, headers: {}, body: item.bodyText },
      response,
      env: vars,
      setEnvVar,
      sendRequest: async () => ({}),
      label: "post-script",
    }));
  }

  return { response, tests: summarizeTests(entries) };
}

function compileGraphqlHeaders(item: RequestItem, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(item.graphqlConfig?.headers ?? {})) {
    out[k] = interpolate(String(v), vars);
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm rebuild better-sqlite3` (ensures plain-Node ABI; core is imported transitively).
Run: `npm test -- packages/mcp/src/exec/run.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/exec/run.ts packages/mcp/src/testkit/httpServer.ts packages/mcp/src/exec/run.test.ts
git commit -m "feat(mcp): execute requests via core senders + run pre/post scripts"
```

---

## Task 6: `exec/flow.ts` — run a saved flow via `@portiq/core/flows`

**Files:**
- Create: `packages/mcp/src/exec/flow.ts`
- Create: `packages/mcp/src/exec/flow.test.ts`

**Interfaces:**
- Consumes: `runFlow`, `RunDeps`, `SendResult`, `RequestConfig` (flows variant), `DagGraph`, `StepsContext` from `@portiq/core/flows`; `HttpTransport`, `RequestItem` from `@portiq/core`.
- Produces: `toFlowRequestConfig(item: RequestItem): RequestConfig` (RAW/untemplated — flows resolves `{{ }}` against its own steps+env context; headers = JSON string of raw `headersRows`, params = `k=v` newline string, body = raw `bodyText`); `interface FlowRunContext { transport: HttpTransport; env: Record<string,string>; lookupRequest: (id: string) => RequestItem | undefined }`; `runSavedFlow(graph: DagGraph, ctx: FlowRunContext): Promise<StepsContext>`. Wires `RunDeps.sendRequest` → `transport.send` (normalized to `SendResult`), `RunDeps.lookupConfig` → `toFlowRequestConfig(lookupRequest(id))`, `RunDeps.onStatus` → collected into node statuses (no-op sink).

- [ ] **Step 1: Write the failing test `packages/mcp/src/exec/flow.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpTransport } from "@portiq/core";
import type { RequestItem } from "@portiq/core";
import type { DagGraph } from "@portiq/core/flows";
import { runSavedFlow, toFlowRequestConfig } from "./flow";
import { startTestHttpServer } from "../testkit/httpServer";

let server: { url: string; close: () => Promise<void> };
beforeAll(async () => { server = await startTestHttpServer(); });
afterAll(async () => { await server.close(); });

describe("toFlowRequestConfig", () => {
  it("emits raw (untemplated) fields with headers as a JSON string", () => {
    const item: RequestItem = {
      type: "request", id: "r1", name: "r", description: "", tags: [],
      protocol: "http", method: "post", url: "{{baseUrl}}/x",
      headersRows: [{ key: "X-A", value: "1", comment: "", enabled: true }],
      bodyType: "raw", bodyText: "hello",
    };
    const cfg = toFlowRequestConfig(item);
    expect(cfg.method).toBe("POST");
    expect(cfg.url).toBe("{{baseUrl}}/x");
    expect(JSON.parse(cfg.headers)).toEqual({ "X-A": "1" });
    expect(cfg.body).toBe("hello");
  });
});

describe("runSavedFlow", () => {
  it("executes a single-request flow against the test server", async () => {
    const graph: DagGraph = {
      version: 2,
      nodes: [{
        id: "n1", type: "request", name: "step1", label: "Step 1", status: "idle",
        data: { overrides: {}, inlineConfig: { method: "GET", url: `${server.url}/flow`, headers: "", body: "", params: "", pathVars: "" } },
      }],
      edges: [],
      positions: {},
    };
    const steps = await runSavedFlow(graph, {
      transport: new HttpTransport({ appVersion: "test" }),
      env: {},
      lookupRequest: () => undefined,
    });
    expect(steps.step1.response?.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- packages/mcp/src/exec/flow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/mcp/src/exec/flow.ts`**

```ts
import type { HttpTransport, RequestItem, RequestRow } from "@portiq/core";
import {
  runFlow,
  type DagGraph,
  type RequestConfig,
  type RunDeps,
  type SendResult,
  type StepsContext,
} from "@portiq/core/flows";

function rawHeaders(rows: RequestRow[] | undefined): string {
  const obj: Record<string, string> = {};
  for (const r of rows ?? []) {
    if (r.key && r.enabled !== false) obj[r.key] = r.value ?? "";
  }
  return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

function rawParams(rows: RequestRow[] | undefined): string {
  return (rows ?? [])
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => `${r.key}=${r.value ?? ""}`)
    .join("\n");
}

export function toFlowRequestConfig(item: RequestItem): RequestConfig {
  return {
    method: (item.method || "GET").toUpperCase(),
    url: item.url ?? "",
    headers: rawHeaders(item.headersRows),
    body: item.bodyText ?? "",
    params: rawParams(item.paramsRows),
    pathVars: "",
  };
}

export interface FlowRunContext {
  transport: HttpTransport;
  env: Record<string, string>;
  lookupRequest: (id: string) => RequestItem | undefined;
}

export async function runSavedFlow(graph: DagGraph, ctx: FlowRunContext): Promise<StepsContext> {
  const deps: RunDeps = {
    env: ctx.env,
    lookupConfig: (id) => {
      const item = ctx.lookupRequest(id);
      return item ? toFlowRequestConfig(item) : undefined;
    },
    sendRequest: async (payload): Promise<SendResult> => {
      const r = await ctx.transport.send({
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        timeoutMs: payload.timeoutMs,
      });
      if ("error" in r) return { status: 0, error: r.error };
      if ("cancelled" in r || "timedOut" in r) return { status: 0, error: (r as { error: string }).error };
      return { status: r.status, statusText: r.statusText, headers: r.headers, data: r.json ?? r.body, time: r.time };
    },
    onStatus: () => { /* headless: statuses are reflected on graph nodes in-place */ },
  };
  return runFlow(graph, deps);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm rebuild better-sqlite3` (if not already plain-Node ABI).
Run: `npm test -- packages/mcp/src/exec/flow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/exec/flow.ts packages/mcp/src/exec/flow.test.ts
git commit -m "feat(mcp): run saved DAG flows through @portiq/core/flows"
```

---

## Task 7: `context.ts` — server context (store + transport + config)

**Files:**
- Create: `packages/mcp/src/context.ts`
- Create: `packages/mcp/src/testkit/tempStore.ts`
- Create: `packages/mcp/src/context.test.ts`

**Interfaces:**
- Consumes: `openAppStateStore`, `AppStateStore`, `HttpTransport`, `AppState` from `@portiq/core`; `ServerConfig` from `./config`.
- Produces:
  - `context.ts`: `interface ServerContext { config: ServerConfig; store: AppStateStore; transport: HttpTransport; close(): void }`; `buildContext(config: ServerConfig): ServerContext` — opens the store via `openAppStateStore({ dataDir: config.dataDir })` (path resolved ONLY inside core) and constructs `new HttpTransport({ appVersion: config.appVersion })`.
  - `testkit/tempStore.ts`: `withTempDataDir(): { dir: string; cleanup: () => void }`; `seedStore(dir: string, state: AppState): void` (opens a store, saves, closes). Used by later tests.

- [ ] **Step 1: Write `packages/mcp/src/testkit/tempStore.ts`**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore, type AppState } from "@portiq/core";

export function withTempDataDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "portiq-mcp-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function seedStore(dir: string, state: AppState): void {
  const store = openAppStateStore({ dataDir: dir });
  store.save(state);
  store.close();
}
```

- [ ] **Step 2: Write the failing test `packages/mcp/src/context.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("buildContext", () => {
  it("opens the store at the configured data dir and reads seeded data", () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    seedStore(dir, sample());

    const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
    expect(ctx.store.collections()[0].name).toBe("API");
    expect(ctx.transport).toBeDefined();
    ctx.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/context.test.ts`
Expected: FAIL — `./context` module not found.

- [ ] **Step 4: Implement `packages/mcp/src/context.ts`**

```ts
import { openAppStateStore, HttpTransport, type AppStateStore } from "@portiq/core";
import type { ServerConfig } from "./config";

export interface ServerContext {
  config: ServerConfig;
  store: AppStateStore;
  transport: HttpTransport;
  close(): void;
}

export function buildContext(config: ServerConfig): ServerContext {
  const store = openAppStateStore({ dataDir: config.dataDir });
  const transport = new HttpTransport({ appVersion: config.appVersion });
  return {
    config,
    store,
    transport,
    close() {
      store.close();
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI to open the store).
Run: `npm test -- packages/mcp/src/context.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/context.ts packages/mcp/src/testkit/tempStore.ts packages/mcp/src/context.test.ts
git commit -m "feat(mcp): server context opening store + transport via core"
```

---

## Task 8: `server.ts` factory + JSON helpers + in-process test client

**Files:**
- Create: `packages/mcp/src/util/mcpJson.ts`
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/testkit/inProcessClient.ts`
- Create: `packages/mcp/src/server.test.ts`

**Interfaces:**
- Consumes: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; `Client` from `@modelcontextprotocol/sdk/client/index.js`; `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`; `ServerContext` from `./context`; `SERVER_NAME`, `SERVER_VERSION` from `./version`.
- Produces:
  - `util/mcpJson.ts`: `jsonToolResult(data: unknown): { content: [{ type: "text"; text: string }] }`; `errorToolResult(message: string): { content: [{ type: "text"; text: string }]; isError: true }`; `jsonResource(uri: URL, data: unknown): { contents: [{ uri: string; mimeType: string; text: string }] }`.
  - `server.ts`: `createMcpServer(ctx: ServerContext): McpServer` — constructs `new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions })` then invokes the (initially empty) registrars `registerResources`, `registerReadTools`, `registerExecTools`, `registerWriteTools` (added in Tasks 9–12); in this task the registrars are imported lazily as no-ops that Tasks 9–12 flesh out. To keep the task independently testable, define local no-op registrars here and REPLACE the imports in later tasks.
  - `testkit/inProcessClient.ts`: `connectInProcess(server: McpServer): Promise<Client>` (links a client to the server over `InMemoryTransport.createLinkedPair()`).

> Implementation note: to avoid forward-referencing unbuilt modules, this task ships `server.ts` calling four registrar functions that live in their own files created here as stubs (`resources.ts`, `tools/read.ts`, `tools/exec.ts`, `tools/write.ts` each exporting a no-op `register*`). Tasks 9–12 replace the stub bodies. This keeps the additive-registry contract (server never edits a switchboard; each registrar owns its file).

- [ ] **Step 1: Write `packages/mcp/src/util/mcpJson.ts`**

```ts
export function jsonToolResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorToolResult(message: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function jsonResource(
  uri: URL,
  data: unknown
): { contents: [{ uri: string; mimeType: string; text: string }] } {
  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
  };
}
```

- [ ] **Step 2: Write the four registrar stubs**

Create `packages/mcp/src/resources.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./context";

export function registerResources(_server: McpServer, _ctx: ServerContext): void {
  // Populated in Task 9.
}
```

Create `packages/mcp/src/tools/read.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context";

export function registerReadTools(_server: McpServer, _ctx: ServerContext): void {
  // Populated in Task 10.
}
```

Create `packages/mcp/src/tools/exec.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context";

export function registerExecTools(_server: McpServer, _ctx: ServerContext): void {
  // Populated in Task 11.
}
```

Create `packages/mcp/src/tools/write.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context";

export function registerWriteTools(_server: McpServer, _ctx: ServerContext): void {
  // Populated in Task 12.
}
```

- [ ] **Step 3: Write `packages/mcp/src/testkit/inProcessClient.ts`**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function connectInProcess(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "portiq-mcp-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
```

- [ ] **Step 4: Write the failing test `packages/mcp/src/server.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { connectInProcess } from "./testkit/inProcessClient";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

function serverForEmptyStore() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  return createMcpServer(ctx);
}

describe("createMcpServer", () => {
  it("connects to an in-process client and reports server info", async () => {
    const client = await connectInProcess(serverForEmptyStore());
    const version = client.getServerVersion();
    expect(version?.name).toBe("portiq-mcp");
    await client.close();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/server.test.ts`
Expected: FAIL — `./server` module not found.

- [ ] **Step 6: Implement `packages/mcp/src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./version";
import type { ServerContext } from "./context";
import { registerResources } from "./resources";
import { registerReadTools } from "./tools/read";
import { registerExecTools } from "./tools/exec";
import { registerWriteTools } from "./tools/write";

const INSTRUCTIONS = [
  "Portiq API library over MCP.",
  "Resources browse the library (portiq://collections, portiq://request/{id}, etc.).",
  "Read/execute tools (list_*, get_*, search, run_*, import_curl) are always available.",
  "Write tools (create_*, update_*, delete_*, set_environment_variable, save_ad_hoc_as_request)",
  "are disabled unless the server is started with --allow-writes (or PORTIQ_MCP_ALLOW_WRITES=1).",
].join(" ");

export function createMcpServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  // Additive registrars — each owns its own file; the factory never edits a switchboard.
  registerResources(server, ctx);
  registerReadTools(server, ctx);
  registerExecTools(server, ctx);
  registerWriteTools(server, ctx);

  return server;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src/util packages/mcp/src/server.ts packages/mcp/src/resources.ts packages/mcp/src/tools packages/mcp/src/testkit/inProcessClient.ts packages/mcp/src/server.test.ts
git commit -m "feat(mcp): server factory with additive registrar wiring + test client"
```

---

## Task 9: `resources.ts` — read-only resources

**Files:**
- Modify: `packages/mcp/src/resources.ts` (replace the stub body)
- Create: `packages/mcp/src/resources.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `ResourceTemplate` from `@modelcontextprotocol/sdk/server/mcp.js`; `ServerContext` from `./context`; `jsonResource` from `./util/mcpJson`; `RequestItem` from `@portiq/core`.
- Produces: `registerResources(server, ctx)` registering 8 resources:
  - static: `portiq://collections`, `portiq://environments`, `portiq://flows`, `portiq://history`.
  - templated: `portiq://collection/{id}`, `portiq://request/{id}`, `portiq://environment/{id}`, `portiq://flow/{id}`.
  - Flows = `store.flattenRequests()` filtered to items with `dagGraph`. `history` reads `state.history ?? []` (documented empty for app-written stores). Missing ids resolve to `{ error: "... not found" }` JSON (never throw).

- [ ] **Step 1: Write the failing test `packages/mcp/src/resources.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { connectInProcess } from "./testkit/inProcessClient";
import { withTempDataDir, seedStore } from "./testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/1" },
      { type: "request", id: "fl1", name: "Flow", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/f", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "k", value: "v", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return c;
}

const readJson = async (c: Awaited<ReturnType<typeof client>>, uri: string) =>
  JSON.parse((await c.readResource({ uri })).contents[0].text as string);

describe("resources", () => {
  it("lists the static resources", async () => {
    const c = await client();
    const uris = (await c.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("portiq://collections");
    expect(uris).toContain("portiq://environments");
    expect(uris).toContain("portiq://flows");
    expect(uris).toContain("portiq://history");
  });

  it("reads a collection by id", async () => {
    const c = await client();
    const data = await readJson(c, "portiq://collection/c1");
    expect(data.name).toBe("API");
  });

  it("reads a request by id", async () => {
    const c = await client();
    const data = await readJson(c, "portiq://request/r1");
    expect(data.method).toBe("GET");
  });

  it("lists only dagGraph requests under flows", async () => {
    const c = await client();
    const flows = await readJson(c, "portiq://flows");
    expect(flows.map((f: { id: string }) => f.id)).toEqual(["fl1"]);
  });

  it("returns an empty history array", async () => {
    const c = await client();
    expect(await readJson(c, "portiq://history")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/resources.test.ts`
Expected: FAIL — resources not registered (stub).

- [ ] **Step 3: Replace `packages/mcp/src/resources.ts`**

```ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestItem } from "@portiq/core";
import type { ServerContext } from "./context";
import { jsonResource } from "./util/mcpJson";

const JSON_META = { mimeType: "application/json" };

function flows(ctx: ServerContext): RequestItem[] {
  return ctx.store.flattenRequests().filter((r) => !!r.dagGraph);
}

export function registerResources(server: McpServer, ctx: ServerContext): void {
  server.registerResource("collections", "portiq://collections", { title: "Collections", ...JSON_META }, (uri) =>
    jsonResource(uri, ctx.store.collections().map((c) => ({ id: c.id, name: c.name, items: c.items?.length ?? 0 })))
  );

  server.registerResource("environments", "portiq://environments", { title: "Environments", ...JSON_META }, (uri) =>
    jsonResource(uri, ctx.store.environments().map((e) => ({ id: e.id, name: e.name, vars: e.vars?.length ?? 0 })))
  );

  server.registerResource("flows", "portiq://flows", { title: "Flows", ...JSON_META }, (uri) =>
    jsonResource(uri, flows(ctx).map((f) => ({ id: f.id, name: f.name })))
  );

  server.registerResource("history", "portiq://history", { title: "History", ...JSON_META }, (uri) =>
    jsonResource(uri, (ctx.store.load().state?.history as unknown[] | undefined) ?? [])
  );

  server.registerResource(
    "collection",
    new ResourceTemplate("portiq://collection/{id}", { list: undefined }),
    { title: "Collection", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.collections().find((c) => c.id === id);
      return jsonResource(uri, found ?? { error: `Collection '${id}' not found` });
    }
  );

  server.registerResource(
    "request",
    new ResourceTemplate("portiq://request/{id}", { list: undefined }),
    { title: "Request", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.flattenRequests().find((r) => r.id === id);
      return jsonResource(uri, found ?? { error: `Request '${id}' not found` });
    }
  );

  server.registerResource(
    "environment",
    new ResourceTemplate("portiq://environment/{id}", { list: undefined }),
    { title: "Environment", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.environments().find((e) => e.id === id);
      return jsonResource(uri, found ?? { error: `Environment '${id}' not found` });
    }
  );

  server.registerResource(
    "flow",
    new ResourceTemplate("portiq://flow/{id}", { list: undefined }),
    { title: "Flow", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = flows(ctx).find((f) => f.id === id);
      return jsonResource(uri, found ?? { error: `Flow '${id}' not found` });
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/resources.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/resources.ts packages/mcp/src/resources.test.ts
git commit -m "feat(mcp): read-only resources for collections/requests/envs/flows/history"
```

---

## Task 10: `tools/read.ts` — ungated read tools

**Files:**
- Modify: `packages/mcp/src/tools/read.ts` (replace the stub body)
- Create: `packages/mcp/src/tools/read.test.ts`

**Interfaces:**
- Consumes: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; `z` from `zod`; `ServerContext` from `../context`; `jsonToolResult`, `errorToolResult` from `../util/mcpJson`; `searchLibrary` from `../search`; `parseCurl` from `@portiq/core`.
- Produces: `registerReadTools(server, ctx)` registering (all `annotations: { readOnlyHint: true }`):
  - `list_collections` (no args) → `[{ id, name, itemCount }]`.
  - `list_requests` (`{ collectionId?: string }`) → flattened `[{ id, name, method, url, collectionId, isFlow }]`, filtered by collection when given.
  - `get_request` (`{ id: string }`) → full `RequestItem` or `errorToolResult`.
  - `search` (`{ query: string; limit?: number }`) → `SearchHit[]`.
  - `list_environments` (no args) → `[{ id, name, varCount }]`.
  - `get_environment` (`{ id: string }`) → full `Environment` or `errorToolResult`.
  - `import_curl` (`{ command: string }`, parse-only) → `parseCurl(command)` result, or `errorToolResult` on parse failure.

- [ ] **Step 1: Write the failing test `packages/mcp/src/tools/read.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/users" },
      { type: "folder", id: "f1", name: "sub", items: [
        { type: "request", id: "r2", name: "Create", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/users" },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "k", value: "v", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return c;
}

const call = async (c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown> = {}) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text as string);

describe("read tools", () => {
  it("exposes all read tools with readOnlyHint", async () => {
    const c = await client();
    const tools = (await c.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of ["list_collections", "list_requests", "get_request", "search", "list_environments", "get_environment", "import_curl"]) {
      expect(names).toContain(n);
    }
    expect(tools.find((t) => t.name === "get_request")?.annotations?.readOnlyHint).toBe(true);
  });

  it("list_requests flattens folders and filters by collection", async () => {
    const c = await client();
    const all = await call(c, "list_requests");
    expect(all.map((r: { id: string }) => r.id).sort()).toEqual(["r1", "r2"]);
    const filtered = await call(c, "list_requests", { collectionId: "c1" });
    expect(filtered).toHaveLength(2);
  });

  it("get_request returns an error result for a missing id", async () => {
    const c = await client();
    const res = await c.callTool({ name: "get_request", arguments: { id: "nope" } });
    expect(res.isError).toBe(true);
  });

  it("search finds by name", async () => {
    const c = await client();
    const hits = await call(c, "search", { query: "create" });
    expect(hits[0].id).toBe("r2");
  });

  it("import_curl parses a command into a request object", async () => {
    const c = await client();
    const parsed = await call(c, "import_curl", { command: "curl -X POST https://x/y -H 'Accept: application/json'" });
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://x/y");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/tools/read.test.ts`
Expected: FAIL — read tools not registered (stub).

- [ ] **Step 3: Replace `packages/mcp/src/tools/read.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseCurl, type FolderItem, type RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { searchLibrary } from "../search";

const READ_ONLY = { readOnlyHint: true } as const;

interface FlatRequest {
  item: RequestItem;
  collectionId: string;
}

function flatten(ctx: ServerContext): FlatRequest[] {
  const out: FlatRequest[] = [];
  const walk = (items: (FolderItem | RequestItem)[], collectionId: string) => {
    for (const it of items) {
      if (it.type === "request") out.push({ item: it, collectionId });
      else if (it.type === "folder") walk(it.items, collectionId);
    }
  };
  for (const c of ctx.store.collections()) walk(c.items ?? [], c.id);
  return out;
}

export function registerReadTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_collections",
    { title: "List collections", description: "List all collections in the library.", inputSchema: {}, annotations: READ_ONLY },
    async () => jsonToolResult(ctx.store.collections().map((c) => ({ id: c.id, name: c.name, itemCount: c.items?.length ?? 0 })))
  );

  server.registerTool(
    "list_requests",
    {
      title: "List requests",
      description: "List saved requests, optionally filtered by collection id.",
      inputSchema: { collectionId: z.string().optional() },
      annotations: READ_ONLY,
    },
    async ({ collectionId }) =>
      jsonToolResult(
        flatten(ctx)
          .filter((f) => !collectionId || f.collectionId === collectionId)
          .map((f) => ({
            id: f.item.id,
            name: f.item.name,
            method: f.item.method,
            url: f.item.url,
            protocol: f.item.protocol,
            collectionId: f.collectionId,
            isFlow: !!f.item.dagGraph,
          }))
      )
  );

  server.registerTool(
    "get_request",
    { title: "Get request", description: "Fetch a full saved request by id.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    async ({ id }) => {
      const found = ctx.store.flattenRequests().find((r) => r.id === id);
      return found ? jsonToolResult(found) : errorToolResult(`Request '${id}' not found`);
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search library",
      description: "Fuzzy/substring search across requests, collections, environments and flows.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => jsonToolResult(searchLibrary(ctx.store.load().state, query, limit))
  );

  server.registerTool(
    "list_environments",
    { title: "List environments", description: "List all environments.", inputSchema: {}, annotations: READ_ONLY },
    async () => jsonToolResult(ctx.store.environments().map((e) => ({ id: e.id, name: e.name, varCount: e.vars?.length ?? 0 })))
  );

  server.registerTool(
    "get_environment",
    { title: "Get environment", description: "Fetch a full environment by id.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    async ({ id }) => {
      const found = ctx.store.environments().find((e) => e.id === id);
      return found ? jsonToolResult(found) : errorToolResult(`Environment '${id}' not found`);
    }
  );

  server.registerTool(
    "import_curl",
    {
      title: "Import cURL (parse only)",
      description: "Parse a curl command into a Portiq request object. Does NOT save.",
      inputSchema: { command: z.string() },
      annotations: READ_ONLY,
    },
    async ({ command }) => {
      try {
        return jsonToolResult(parseCurl(command));
      } catch (err) {
        return errorToolResult(`Failed to parse cURL: ${(err as Error).message}`);
      }
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/tools/read.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/read.ts packages/mcp/src/tools/read.test.ts
git commit -m "feat(mcp): ungated read tools (list/get/search/import_curl)"
```

---

## Task 11: `tools/exec.ts` — ungated execute tools

**Files:**
- Modify: `packages/mcp/src/tools/exec.ts` (replace the stub body)
- Create: `packages/mcp/src/exec/env.ts`
- Create: `packages/mcp/src/tools/exec.test.ts`

**Interfaces:**
- Consumes: `McpServer` from SDK; `z` from `zod`; `ServerContext` from `../context`; `jsonToolResult`, `errorToolResult` from `../util/mcpJson`; `runRequestItem` from `../exec/run`; `runSavedFlow` from `../exec/flow`; `Environment`, `RequestItem`, `Collection`, `FolderItem` from `@portiq/core`.
- Produces:
  - `exec/env.ts`: `resolveEnvironment(ctx, ref?: string): Environment | null` — matches an environment by id OR name; when `ref` omitted, uses `activeEnvId`; returns `null` if none.
  - `tools/exec.ts`: `registerExecTools(server, ctx)` registering (all `annotations: { readOnlyHint: false }` — execution can have side effects on remote systems):
    - `run_request` (`{ id: string; env?: string; vars?: Record<string,string> }`) → `runRequestItem` → `{ response, tests }`; `errorToolResult` if id missing / unsupported protocol.
    - `run_ad_hoc_request` (`{ method: string; url: string; headers?; body?; bodyType?; protocol?; env?; vars? }`) → build a transient `RequestItem`, run it.
    - `run_collection` (`{ collectionId: string; env?; vars? }`) → run each request in the collection sharing one vars map; return `{ requests: [{ id, name, tests }], totals: { passed, failed, errored } }`.
    - `run_flow` (`{ id: string; env?; vars? }`) → load the request's `dagGraph`, `runSavedFlow`; `errorToolResult` if not a flow.

- [ ] **Step 1: Write `packages/mcp/src/exec/env.ts`**

```ts
import type { Environment } from "@portiq/core";
import type { ServerContext } from "../context";

export function resolveEnvironment(ctx: ServerContext, ref?: string): Environment | null {
  const envs = ctx.store.environments();
  if (ref) {
    return envs.find((e) => e.id === ref) ?? envs.find((e) => e.name === ref) ?? null;
  }
  const activeId = ctx.store.load().state?.activeEnvId;
  return activeId ? envs.find((e) => e.id === activeId) ?? null : null;
}
```

- [ ] **Step 2: Write the failing test `packages/mcp/src/tools/exec.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let http: { url: string; close: () => Promise<void> };
beforeAll(async () => { http = await startTestHttpServer(); });
afterAll(async () => { await http.close(); });

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/ping`,
        testsPostSteps: [{ id: "s1", name: "ok", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "fl1", name: "Flow", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/f`,
        dagGraph: { version: 2, nodes: [{ id: "n1", type: "request", name: "step1", label: "S1", status: "idle",
          data: { overrides: {}, inlineConfig: { method: "GET", url: `${http.url}/f`, headers: "", body: "", params: "", pathVars: "" } } }], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return c;
}

const call = async (c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown>) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text as string);

describe("exec tools", () => {
  it("run_request returns a normalized response and test results", async () => {
    const c = await client();
    const out = await call(c, "run_request", { id: "r1" });
    expect(out.response.status).toBe(200);
    expect(out.tests.passed).toBe(1);
  });

  it("run_ad_hoc_request sends an inline request", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", { method: "GET", url: `${http.url}/adhoc` });
    expect(out.response.json.path).toBe("/adhoc");
  });

  it("run_collection aggregates test totals", async () => {
    const c = await client();
    const out = await call(c, "run_collection", { collectionId: "c1" });
    expect(out.totals.passed).toBe(1);
    expect(out.requests.length).toBeGreaterThanOrEqual(1);
  });

  it("run_flow executes a saved flow", async () => {
    const c = await client();
    const out = await call(c, "run_flow", { id: "fl1" });
    expect(out.step1.response.status).toBe(200);
  });

  it("run_request errors on an unknown id", async () => {
    const c = await client();
    const res = await c.callTool({ name: "run_request", arguments: { id: "nope" } });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/tools/exec.test.ts`
Expected: FAIL — exec tools not registered (stub).

- [ ] **Step 4: Replace `packages/mcp/src/tools/exec.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveVars, type FolderItem, type RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { runRequestItem } from "../exec/run";
import { runSavedFlow } from "../exec/flow";
import { resolveEnvironment } from "../exec/env";

const EXECUTES = { readOnlyHint: false } as const;
const varsSchema = z.record(z.string(), z.string()).optional();

function collectionRequests(ctx: ServerContext, collectionId: string): RequestItem[] {
  const collection = ctx.store.collections().find((c) => c.id === collectionId);
  if (!collection) return [];
  const out: RequestItem[] = [];
  const walk = (items: (FolderItem | RequestItem)[]) => {
    for (const it of items) {
      if (it.type === "request") out.push(it);
      else if (it.type === "folder") walk(it.items);
    }
  };
  walk(collection.items ?? []);
  return out;
}

export function registerExecTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "run_request",
    {
      title: "Run saved request",
      description: "Execute a saved request by id (with optional environment + variable overrides) and run its tests.",
      inputSchema: { id: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ id, env, vars }) => {
      const item = ctx.store.flattenRequests().find((r) => r.id === id);
      if (!item) return errorToolResult(`Request '${id}' not found`);
      try {
        return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars }));
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "run_ad_hoc_request",
    {
      title: "Run ad-hoc request",
      description: "Execute an inline request that is not saved to the library.",
      inputSchema: {
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        bodyType: z.string().optional(),
        protocol: z.string().optional(),
        env: z.string().optional(),
        vars: varsSchema,
      },
      annotations: EXECUTES,
    },
    async ({ method, url, headers, body, bodyType, protocol, env, vars }) => {
      const item: RequestItem = {
        type: "request", id: "ad-hoc", name: "ad-hoc", description: "", tags: [],
        protocol: protocol || "http", method, url,
        bodyType: bodyType || (body ? "raw" : "none"), bodyText: body ?? "",
        headersRows: Object.entries(headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
      };
      try {
        return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars }));
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "run_collection",
    {
      title: "Run collection",
      description: "Execute every request in a collection (sharing one variable context) and return a test summary.",
      inputSchema: { collectionId: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ collectionId, env, vars }) => {
      const requests = collectionRequests(ctx, collectionId);
      if (requests.length === 0) return errorToolResult(`Collection '${collectionId}' has no requests or does not exist`);
      const environment = resolveEnvironment(ctx, env);
      const shared = resolveVars(environment, vars); // shared across requests for chaining via pm.environment.set
      const results: Array<{ id: string; name: string; tests: unknown; error?: string }> = [];
      const totals = { passed: 0, failed: 0, errored: 0 };
      for (const item of requests) {
        try {
          const { tests } = await runRequestItem(item, { transport: ctx.transport, env: environment, vars: shared });
          totals.passed += tests.passed;
          totals.failed += tests.failed;
          totals.errored += tests.errored;
          results.push({ id: item.id, name: item.name, tests });
        } catch (err) {
          totals.errored += 1;
          results.push({ id: item.id, name: item.name, tests: null, error: (err as Error).message });
        }
      }
      return jsonToolResult({ requests: results, totals });
    }
  );

  server.registerTool(
    "run_flow",
    {
      title: "Run flow",
      description: "Execute a saved flow (a request carrying a dagGraph) and return the per-step results.",
      inputSchema: { id: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ id, env, vars }) => {
      const item = ctx.store.flattenRequests().find((r) => r.id === id);
      if (!item) return errorToolResult(`Request '${id}' not found`);
      if (!item.dagGraph) return errorToolResult(`Request '${id}' is not a flow (no dagGraph)`);
      const environment = resolveEnvironment(ctx, env);
      try {
        const steps = await runSavedFlow(item.dagGraph, {
          transport: ctx.transport,
          env: resolveVars(environment, vars),
          lookupRequest: (rid) => ctx.store.flattenRequests().find((r) => r.id === rid),
        });
        return jsonToolResult(steps);
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/tools/exec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/exec.ts packages/mcp/src/exec/env.ts packages/mcp/src/tools/exec.test.ts
git commit -m "feat(mcp): ungated execute tools (run_request/ad_hoc/collection/flow)"
```

---

## Task 12: `tools/write.ts` — guarded write tools (opt-in)

**Files:**
- Modify: `packages/mcp/src/tools/write.ts` (replace the stub body)
- Create: `packages/mcp/src/store/write.ts`
- Create: `packages/mcp/src/store/write.test.ts`
- Create: `packages/mcp/src/tools/write.test.ts`

**Interfaces:**
- Consumes: `McpServer` from SDK; `z` from `zod`; `ServerContext` from `../context`; `jsonToolResult`, `errorToolResult` from `../util/mcpJson`; `AppState`, `Collection`, `RequestItem`, `Environment`, `ConflictError`, `FolderItem` from `@portiq/core`.
- Produces:
  - `store/write.ts`: `emptyState(): AppState`; `withOptimisticWrite<T>(store, mutate: (state: AppState) => { next: AppState; result: T }): T` — `load()` → clone → `mutate` → `save(next, version)`; on `ConflictError` reload+retry once, else throw. `newId(prefix: string): string`.
  - `tools/write.ts`: `registerWriteTools(server, ctx)` — registers all six tools ALWAYS, then `.disable()`s each when `!ctx.config.allowWrites` (hidden from `tools/list`; calling → SDK `Tool <name> disabled`). Annotations: `readOnlyHint: false` on all; `destructiveHint: true` on `update_request`, `delete_request`, `set_environment_variable`. Tools: `create_request` (`{ collectionId, name, method, url, protocol?, headers?, body?, bodyType? }`), `update_request` (`{ id, patch }`), `delete_request` (`{ id }`), `create_collection` (`{ name }`), `set_environment_variable` (`{ envId, key, value }`), `save_ad_hoc_as_request` (`{ collectionId, name, method, url, protocol?, headers?, body?, bodyType? }`).

- [ ] **Step 1: Write the failing test `packages/mcp/src/store/write.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { openAppStateStore, type AppState } from "@portiq/core";
import { withOptimisticWrite, emptyState, newId } from "./write";
import { withTempDataDir } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

describe("write helpers", () => {
  it("emptyState is a valid blank AppState", () => {
    const s = emptyState();
    expect(s.collections).toEqual([]);
    expect(s.environments).toEqual([]);
    expect(s.historyRetentionDays).toBeGreaterThan(0);
  });

  it("newId returns a prefixed unique id", () => {
    expect(newId("col")).toMatch(/^col-/);
    expect(newId("col")).not.toBe(newId("col"));
  });

  it("withOptimisticWrite persists a mutation", () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    const store = openAppStateStore({ dataDir: dir });
    dirs.push(() => store.close());
    const added = withOptimisticWrite<string>(store, (state: AppState) => {
      state.collections.push({ id: "c9", name: "New", items: [] });
      return { next: state, result: "c9" };
    });
    expect(added).toBe("c9");
    expect(store.collections().find((c) => c.id === "c9")?.name).toBe("New");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/store/write.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/mcp/src/store/write.ts`**

```ts
import { ConflictError, type AppState, type AppStateStore } from "@portiq/core";

export function emptyState(): AppState {
  return { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 30 };
}

export function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function withOptimisticWrite<T>(
  store: AppStateStore,
  mutate: (state: AppState) => { next: AppState; result: T }
): T {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { state, version } = store.load();
    const base = state ? (structuredClone(state) as AppState) : emptyState();
    const { next, result } = mutate(base);
    try {
      store.save(next, version);
      return result;
    } catch (err) {
      if (err instanceof ConflictError && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("Optimistic write failed: version conflict after retry");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/store/write.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test `packages/mcp/src/tools/write.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { openAppStateStore } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const WRITE_TOOLS = ["create_request", "update_request", "delete_request", "create_collection", "set_environment_variable", "save_ad_hoc_as_request"];

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client(allowWrites: boolean) {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return { c, dir };
}

describe("write gating", () => {
  it("hides all write tools when writes are disabled", async () => {
    const { c } = await client(false);
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of WRITE_TOOLS) expect(names).not.toContain(n);
  });

  it("exposes write tools with destructive/readOnly hints when enabled", async () => {
    const { c } = await client(true);
    const tools = (await c.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of WRITE_TOOLS) expect(names).toContain(n);
    expect(tools.find((t) => t.name === "delete_request")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "create_request")?.annotations?.readOnlyHint).toBe(false);
  });

  it("rejects a disabled write tool call with a clear message", async () => {
    const { c } = await client(false);
    await expect(c.callTool({ name: "create_collection", arguments: { name: "X" } })).rejects.toThrow(/disabled/i);
  });
});

describe("write mutation", () => {
  it("create_collection persists through the optimistic store", async () => {
    const { c, dir } = await client(true);
    const out = JSON.parse((await c.callTool({ name: "create_collection", arguments: { name: "Fresh" } })).content[0].text as string);
    expect(out.id).toBeTruthy();
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.collections().some((col) => col.name === "Fresh")).toBe(true);
    verify.close();
  });

  it("create_request adds a request to a collection", async () => {
    const { c, dir } = await client(true);
    const out = JSON.parse((await c.callTool({ name: "create_request", arguments: { collectionId: "c1", name: "New", method: "GET", url: "https://x" } })).content[0].text as string);
    const verify = openAppStateStore({ dataDir: dir });
    expect(verify.flattenRequests().some((r) => r.id === out.id)).toBe(true);
    verify.close();
  });

  it("set_environment_variable upserts a variable", async () => {
    const { c, dir } = await client(true);
    await c.callTool({ name: "set_environment_variable", arguments: { envId: "e1", key: "token", value: "abc" } });
    const verify = openAppStateStore({ dataDir: dir });
    const env = verify.environments().find((e) => e.id === "e1");
    expect(env?.vars.find((v) => v.key === "token")?.value).toBe("abc");
    verify.close();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/tools/write.test.ts`
Expected: FAIL — write tools not registered (stub).

- [ ] **Step 7: Replace `packages/mcp/src/tools/write.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Collection, Environment, FolderItem, RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { withOptimisticWrite, emptyState, newId } from "../store/write";

const MUTATES = { readOnlyHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

function findRequest(collections: Collection[], id: string): RequestItem | undefined {
  const walk = (items: (FolderItem | RequestItem)[]): RequestItem | undefined => {
    for (const it of items) {
      if (it.type === "request" && it.id === id) return it;
      if (it.type === "folder") {
        const hit = walk(it.items);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const c of collections) {
    const hit = walk(c.items ?? []);
    if (hit) return hit;
  }
  return undefined;
}

function makeRequestItem(args: { name: string; method: string; url: string; protocol?: string; headers?: Record<string, string>; body?: string; bodyType?: string }): RequestItem {
  return {
    type: "request", id: newId("req"), name: args.name, description: "", tags: [],
    protocol: args.protocol || "http", method: args.method, url: args.url,
    bodyType: args.bodyType || (args.body ? "raw" : "none"), bodyText: args.body ?? "",
    headersRows: Object.entries(args.headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
  };
}

const requestFields = {
  collectionId: z.string(),
  name: z.string(),
  method: z.string(),
  url: z.string(),
  protocol: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  bodyType: z.string().optional(),
};

export function registerWriteTools(server: McpServer, ctx: ServerContext): void {
  const registered = [
    server.registerTool(
      "create_request",
      { title: "Create request", description: "Add a new request to a collection.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const created = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const collection = state.collections.find((c) => c.id === args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            const item = makeRequestItem(args);
            (collection.items ??= []).push(item);
            return { next: state, result: item };
          });
          return jsonToolResult(created);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "update_request",
      {
        title: "Update request",
        description: "Patch fields of an existing request by id.",
        inputSchema: { id: z.string(), patch: z.record(z.string(), z.unknown()) },
        annotations: DESTRUCTIVE,
      },
      async ({ id, patch }) => {
        try {
          const updated = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const item = findRequest(state.collections, id);
            if (!item) throw new Error(`Request '${id}' not found`);
            Object.assign(item, patch, { type: "request", id });
            return { next: state, result: item };
          });
          return jsonToolResult(updated);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "delete_request",
      { title: "Delete request", description: "Remove a request from its collection by id.", inputSchema: { id: z.string() }, annotations: DESTRUCTIVE },
      async ({ id }) => {
        try {
          const removed = withOptimisticWrite<boolean>(ctx.store, (state) => {
            let found = false;
            const prune = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
              items.filter((it) => {
                if (it.type === "request" && it.id === id) { found = true; return false; }
                if (it.type === "folder") it.items = prune(it.items);
                return true;
              });
            for (const c of state.collections) c.items = prune(c.items ?? []);
            if (!found) throw new Error(`Request '${id}' not found`);
            return { next: state, result: true };
          });
          return jsonToolResult({ deleted: removed, id });
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "create_collection",
      { title: "Create collection", description: "Create a new empty collection.", inputSchema: { name: z.string() }, annotations: MUTATES },
      async ({ name }) => {
        try {
          const created = withOptimisticWrite<Collection>(ctx.store, (state) => {
            const collection: Collection = { id: newId("col"), name, items: [] };
            state.collections.push(collection);
            if (!state.activeCollectionId) state.activeCollectionId = collection.id;
            return { next: state, result: collection };
          });
          return jsonToolResult(created);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "set_environment_variable",
      {
        title: "Set environment variable",
        description: "Create or update a variable in an environment.",
        inputSchema: { envId: z.string(), key: z.string(), value: z.string() },
        annotations: DESTRUCTIVE,
      },
      async ({ envId, key, value }) => {
        try {
          const env = withOptimisticWrite<Environment>(ctx.store, (state) => {
            const target = state.environments.find((e) => e.id === envId);
            if (!target) throw new Error(`Environment '${envId}' not found`);
            const existing = (target.vars ??= []).find((v) => v.key === key);
            if (existing) existing.value = value;
            else target.vars.push({ key, value, comment: "", enabled: true });
            return { next: state, result: target };
          });
          return jsonToolResult(env);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "save_ad_hoc_as_request",
      { title: "Save ad-hoc request", description: "Persist an ad-hoc request into a collection.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const created = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const collection = state.collections.find((c) => c.id === args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            const item = makeRequestItem(args);
            (collection.items ??= []).push(item);
            return { next: state, result: item };
          });
          return jsonToolResult(created);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),
  ];

  if (!ctx.config.allowWrites) {
    for (const tool of registered) tool.disable();
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm test -- packages/mcp/src/tools/write.test.ts`
Expected: PASS (6 tests: 3 gating + 3 mutation).

- [ ] **Step 9: Commit**

```bash
git add packages/mcp/src/tools/write.ts packages/mcp/src/store/write.ts packages/mcp/src/store/write.test.ts packages/mcp/src/tools/write.test.ts
git commit -m "feat(mcp): guarded write tools gated by --allow-writes with optimistic store writes"
```

---

## Task 13: `bin.ts` stdio entry + end-to-end stdio harness test

**Files:**
- Create: `packages/mcp/src/bin.ts`
- Create: `packages/mcp/src/stdio.e2e.test.ts`

**Interfaces:**
- Consumes: `parseServerConfig` from `./config`; `buildContext` from `./context`; `createMcpServer` from `./server`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`.
- Produces: an executable `dist/bin.js` (shebang `#!/usr/bin/env node`) that wires config → context → server → `StdioServerTransport`, logging only to `stderr`. The `.e2e.test.ts` BUILDS `@portiq/mcp` then spawns the real bin via `StdioClientTransport`, asserting tool schemas, write-gating default, and a real `run_request` against a temp `--data-dir` + local HTTP server.

- [ ] **Step 1: Write `packages/mcp/src/bin.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerConfig } from "./config";
import { buildContext } from "./context";
import { createMcpServer } from "./server";

async function main(): Promise<void> {
  const config = parseServerConfig(process.argv.slice(2), process.env);
  const ctx = buildContext(config);
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive by reading stdin.
  process.on("SIGINT", () => { ctx.close(); process.exit(0); });
  process.on("SIGTERM", () => { ctx.close(); process.exit(0); });
  console.error(`[portiq-mcp] ready (writes ${config.allowWrites ? "ENABLED" : "disabled"})`);
}

main().catch((err) => {
  console.error("[portiq-mcp] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the bin barrel export to `packages/mcp/src/index.ts`**

Append:

```ts
export { parseServerConfig, type ServerConfig } from "./config";
export { buildContext, type ServerContext } from "./context";
export { createMcpServer } from "./server";
```

- [ ] **Step 3: Write the failing test `packages/mcp/src/stdio.e2e.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AppState } from "@portiq/core";
import { withTempDataDir, seedStore } from "./testkit/tempStore";
import { startTestHttpServer } from "./testkit/httpServer";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages/mcp/dist/bin.js");

let http: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  execSync("npm run build:mcp", { cwd: ROOT, stdio: "inherit" });
  http = await startTestHttpServer();
}, 120000);

afterAll(async () => {
  while (cleanups.length) cleanups.pop()!();
  await http.close();
});

const seeded = (): { dir: string } => {
  const { dir, cleanup } = withTempDataDir();
  cleanups.push(cleanup);
  const state: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/ping` },
    ] }],
    activeCollectionId: "c1",
    environments: [{ id: "e1", name: "Local", vars: [] }],
    activeEnvId: "e1",
    historyRetentionDays: 7,
  };
  seedStore(dir, state);
  return { dir };
};

async function spawnClient(args: string[]): Promise<Client> {
  const client = new Client({ name: "e2e", version: "0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, ...args], env: { ...process.env } as Record<string, string> });
  await client.connect(transport);
  cleanups.push(() => { void client.close(); });
  return client;
}

describe("portiq-mcp stdio", () => {
  it("hides write tools by default and lists read/exec tools", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_collections");
    expect(names).toContain("run_request");
    expect(names).not.toContain("create_request");
  });

  it("exposes write tools with --allow-writes", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir, "--allow-writes"]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("create_request");
  });

  it("runs a saved request over stdio against a local server", async () => {
    const { dir } = seeded();
    const client = await spawnClient(["--data-dir", dir]);
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    expect(out.response.json.path).toBe("/ping");
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI for both the vitest process and the spawned server).
Run: `npm test -- packages/mcp/src/stdio.e2e.test.ts`
Expected: first run FAILS if `dist/bin.js` is missing before build; after the `beforeAll` build it PASSES (3 tests). If it fails with a native-module error, confirm `npm rebuild better-sqlite3` ran.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/bin.ts packages/mcp/src/index.ts packages/mcp/src/stdio.e2e.test.ts
git commit -m "feat(mcp): portiq-mcp stdio bin + end-to-end stdio client harness"
```

---

## Task 14: Host-config docs, full-suite gates, changeset

**Files:**
- Create: `packages/mcp/README.md`
- Create: `.changeset/portiq-mcp-phase1.md`

**Interfaces:**
- Produces: user-facing host-config drop-in snippets (Claude Code / Claude Desktop) and a changeset marking `@portiq/mcp` as a new minor. No code interfaces.

- [ ] **Step 1: Write `packages/mcp/README.md`**

````markdown
# @portiq/mcp — `portiq-mcp` stdio MCP server

A Model Context Protocol server exposing your Portiq API library to AI hosts.
It reads the same shared store as the desktop app (`<dataDir>/appdata.sqlite`)
resolved via `@portiq/core`'s `resolveDataDir()`.

## Run

```bash
# Read + execute only (default; writes disabled):
portiq-mcp

# Enable guarded write tools:
portiq-mcp --allow-writes
# or: PORTIQ_MCP_ALLOW_WRITES=1 portiq-mcp

# Point at a specific data dir (else PORTIQ_DATA_DIR, else OS default):
portiq-mcp --data-dir /path/to/dir
```

## Tools

- **Read (always on):** `list_collections`, `list_requests`, `get_request`,
  `search`, `list_environments`, `get_environment`, `import_curl` (parse-only).
- **Execute (always on):** `run_request`, `run_ad_hoc_request`, `run_collection`,
  `run_flow`.
- **Write (opt-in via `--allow-writes`; hidden otherwise):** `create_request`,
  `update_request`, `delete_request`, `create_collection`,
  `set_environment_variable`, `save_ad_hoc_as_request`.

## Resources

`portiq://collections`, `portiq://collection/{id}`, `portiq://request/{id}`,
`portiq://environments`, `portiq://environment/{id}`, `portiq://flows`,
`portiq://flow/{id}`, `portiq://history`.

## Claude Code

```bash
claude mcp add portiq -- portiq-mcp
# with writes:
claude mcp add portiq -- portiq-mcp --allow-writes
```

Or add to `.mcp.json` / your Claude Code config:

```json
{
  "mcpServers": {
    "portiq": { "command": "portiq-mcp", "args": [] }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "portiq": {
      "command": "npx",
      "args": ["-y", "@portiq/mcp"]
    }
  }
}
```

## Notes & limitations

- **stdio only** (no HTTP transport in this phase).
- **Protocols:** `http` and `graphql` execute; `websocket`/`grpc` return a clear
  "not supported headlessly yet" error (gRPC will run through `run_request` once
  its core sender lands).
- **History:** `portiq://history` reflects only history stored in the shared
  `appState` blob; the desktop app currently keeps history in renderer
  `localStorage`, so this is typically empty.
- **Concurrency:** while the desktop app is running, its writes do not bump the
  optimistic `kv_version` counter yet, so MCP write tools cannot detect a
  concurrent app edit (last-writer-wins). Prefer running write tools with the
  desktop app closed until version reconciliation lands.
- Runs on plain Node. If you also run the Electron app from source, remember the
  `better-sqlite3` ABI split: `npm rebuild better-sqlite3` for Node/MCP,
  `npm run rebuild` for Electron.
````

- [ ] **Step 2: Write the changeset `.changeset/portiq-mcp-phase1.md`**

```markdown
---
"@portiq/mcp": minor
---

Add the `portiq-mcp` stdio MCP server: read-only resources, ungated read/execute
tools (list/get/search/import_curl, run_request/ad_hoc/collection/flow), and
opt-in guarded write tools (--allow-writes). Consumes @portiq/core read-only.
```

- [ ] **Step 3: Run the full gate suite**

Run: `npm rebuild better-sqlite3` (plain-Node ABI).
Run: `npm run build:mcp`
Expected: clean build; `packages/mcp/dist/{index.js,bin.js}` emitted.
Run: `npm test`
Expected: full suite green — the prior core tests (now including Phase 0.5's `assembleRequest` + golden parity suites) PLUS the new `@portiq/mcp` tests (smoke, config, search, run, flow, context, server, resources, read, exec, write, store/write, stdio.e2e). Note: there is no `resolveHttpSend` suite — Task 4 is superseded by Phase 0.5.
Run: `npm run lint`
Expected: 0 new errors under `packages/mcp` (pre-existing warnings unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/README.md .changeset/portiq-mcp-phase1.md
git commit -m "docs(mcp): host-config snippets + changeset for phase 1 MCP server"
```

---

## Self-Review (completed against the spec)

**1. Spec coverage (MCP section of `2026-07-23-cli-mcp-access-design.md`):**
- Resources (8) → Task 9. ✓
- Read/execute tools (`list_collections`, `list_requests`, `get_request`, `search`, `list_environments`, `get_environment`, `import_curl`) → Task 10; (`run_request`, `run_ad_hoc_request`, `run_collection`, `run_flow`) → Task 11. ✓ All call real core functions (`store.collections/flattenRequests/environments/load`, `parseCurl`, `searchLibrary` over `AppState`, `HttpTransport.send`, `sendGraphQL`, `runSteps`/`summarizeTests`, `runFlow`).
- Guarded write tools (6) gated by `--allow-writes`/`PORTIQ_MCP_ALLOW_WRITES`, hidden when off, destructive/readOnly hints, optimistic `store.save(state, expectedVersion)` → Task 12. ✓
- Host config snippets (Claude Code/Desktop) → Task 14 README. ✓
- stdio MCP-client test harness (schemas, default write-gating, read/execute vs temp `--data-dir` + local HTTP server) → in-process harness in Tasks 9–12 + spawned stdio harness Task 13. ✓
- Excluded (mock/git-sync/gRPC/AI tools) → not present. ✓ `run_flow`/`run_collection` included (core ships flows + scripting). ✓
- Global constraints (better-sqlite3 ABI, `resolveDataDir` single source, additive registry, TDD/DRY/YAGNI, frequent commits) → baked into Global Constraints + per-task `npm rebuild` notes + separate registrar files. ✓

**2. Placeholder scan:** No `TBD`/"handle edge cases"/"similar to Task N"; every code step contains real, compilable code. ✓

**3. Type consistency:** `ServerConfig`/`ServerContext`/`SearchHit`/`NormalizedResponse`/`RunResult`/`RunContext`/`FlowRunContext` names are used identically across tasks; registrar signatures `(server: McpServer, ctx: ServerContext)` are stable from the Task 8 stubs through Tasks 9–12; `assembleRequest`/`resolveVars` (from `@portiq/core`, Phase 0.5)/`runRequestItem`/`runSavedFlow`/`toFlowRequestConfig`/`withOptimisticWrite`/`emptyState`/`newId`/`jsonToolResult`/`errorToolResult`/`jsonResource` signatures match their consumers. ✓

**Assumptions/open questions surfaced for the coordinator:**
- Request-assembly (auth compilation + rows→object + body-by-type) now lives in `@portiq/core` as `assembleRequest` (extracted by Phase 0.5 from the renderer and surfaced through the top barrel `@portiq/core` — there is NO `@portiq/core/exec` subpath). MCP consumes it directly (Task 5); Task 4's former local bridge is superseded, which also closes the renderer/MCP drift (progress.md follow-up #3). JSON body comment-stripping is now applied by core; pre-script request mutation remains intentionally not wired (documented).
- The "writes disabled" behavior uses the SDK's `.disable()` (hides from `tools/list`; calling yields `Tool <name> disabled`). This satisfies both "hidden" and "clear message on invoke" via one idiomatic mechanism rather than a custom per-handler message.
- `portiq://history` is effectively empty against app-written stores (history is renderer `localStorage`).
- Write-vs-app concurrency: MCP cannot see the desktop app's version bumps until `kv_version` reconciliation (progress.md Phase-1 follow-up #1) — documented as last-writer-wins.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase1-portiq-mcp-server.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).
2. **Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).
