# Phase 2 — `portiq` CLI (`@portiq/cli`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `portiq` command-line client (`@portiq/cli`) that lists, inspects, searches, runs (with tests), ad-hoc-executes, and imports/exports the user's Portiq library — routing all execution through the same `@portiq/core` paths the desktop app uses.

**Architecture:** A new npm-workspace package `packages/cli` that consumes `@portiq/core` read-only. Commands are wired through an **additive command registry** (each command is a self-contained module that registers into a `commander` program), so future parity commands (`mock`, `sync`, gRPC, AI) slot in without editing a switchboard. The CLI is compiled to **CommonJS** (mirroring `electron/main.cjs`) so the built binary's `require("@portiq/core")` resolves core's `require`→`dist` export condition; unit tests run on the TypeScript source via vitest. A thin IO-injection seam (`CliContext`) makes every command testable, and a reporter layer emits `pretty` / `json` / `junit` with CI-friendly exit codes.

**Tech Stack:** TypeScript (base `moduleResolution: Bundler` for editor/vitest; build tsconfig emits CommonJS), `commander@^12` (arg parsing — chosen below), `fuse.js@^7` (fuzzy search — core has no search module), Vitest 4 (unit + spawn-the-binary integration), `@portiq/core`, Node `child_process`/`http`.

### Arg-parser choice: `commander`

`commander` is chosen over `yargs` because (a) its `Command` object model maps 1:1 onto the required **additive registry** — each command is a `Command` a module attaches with `program.addCommand(...)`, so parity plans append a module with no edits to a dispatcher; (b) it ships CommonJS + ESM and has **zero runtime dependencies**, keeping `npx portiq` install-light; (c) `.exitOverride()` lets us intercept usage errors and map them to **exit code 3** instead of commander's default `process.exit(1)`, which is essential for the CI-friendly exit-code contract. `yargs` is heavier and its middleware model is a looser fit for the "one module per command, registered additively" requirement.

## Global Constraints

- Package name: `@portiq/cli`; version starts at `0.0.0`; `"private": true` until a publish phase. Package is **CommonJS** (`"type": "commonjs"`); the built `dist/index.js` is the `portiq` bin (shebang `#!/usr/bin/env node`).
- Consume `@portiq/core` **read-only via its public API only**. Do NOT modify core logic. The `require`→`dist` mapping on core's `./flows` export (so the built CJS CLI can `require("@portiq/core/flows")`) is now owned and applied by Phase 0.5 (Part B / Task 3); **Task 2 here is verify-only and makes no core edit**. The CLI therefore modifies no file outside `packages/cli/` except the root/eslint wiring noted in Task 1.
- **better-sqlite3 ABI gotcha:** the hoisted native binary serves EITHER plain-Node OR Electron, not both. The CLI and all its tests run on **plain Node**, so `better-sqlite3` must be built for Node: run `npm rebuild better-sqlite3` before opening the store or running CLI tests; run `npm run rebuild` to return it to the Electron ABI for `npm run dev`. Call this out in every task that opens the store (Tasks 3, 10–17) and in the integration-test task (Task 19).
- **Data-location contract:** never re-derive the store path. Always resolve it through `core.resolveDataDir(...)`. Precedence is `--data-dir` flag → `PORTIQ_DATA_DIR` env → CLI config file `dataDir` → OS default. The shared store file is `<dataDir>/appdata.sqlite` (owned by `core.openAppStateStore`). The CLI **config file** is a CLI-only concept and lives in the OS-*default* data dir (computed via `core.resolveDataDir` with `PORTIQ_DATA_DIR` stripped) so it is stable even when `--data-dir` redirects the store.
- **Exit codes (CI-friendly):** `0` success · `1` runtime error · `2` test/assertion failure · `3` usage error. Implemented via typed errors (`UsageError`→3, `RuntimeError`→1, `TestFailureError`→2) mapped in one place.
- **Reporters:** `pretty` / `json` / `junit`. Default is `pretty` when stdout is a TTY, `json` when piped. `--no-color` disables ANSI. `--reporter` overrides the default. `-o/--output <file>` writes the report to a file instead of stdout.
- **Registry pattern:** commands register additively (`registerCommands(program, ctx, modules)`), never a hard-coded switch. `buildProgram(ctx, extraCommands?)` accepts external command modules so parity plans register without editing the built-in list.
- Do NOT implement `mock`, `sync`, gRPC, or AI commands — they arrive as separate parity plans that register into this registry. `mcp` is included ONLY as a thin passthrough that spawns the `portiq-mcp` binary (from the separate MCP package).
- Test convention (match repo): `import { describe, it, expect } from "vitest";` (add `vi` when mocking); import module under test by relative path; local factory helpers at top; inject clocks/IO/env for determinism; no global setup file. Reference-only imports of `@portiq/core` use the package name (`from "@portiq/core"`).
- Commit after every task with a Conventional Commit; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Verified `@portiq/core` public API (source of truth — do NOT invent names)

**Barrel `@portiq/core`** (`packages/core/src/index.ts`):
- store: `resolveDataDir(opts?: ResolveDataDirOptions): string`, `resolveDbPath(opts?): string`, `ResolveDataDirOptions { dataDir?, env?, platform?, home? }`, `APP_NAME` (`"Portiq"`), `DB_FILE` (`"appdata.sqlite"`), `openKvStore(opts?): KvStore`, `ConflictError`, `openAppStateStore(opts?: ResolveDataDirOptions, kv?): AppStateStore`.
  - `AppStateStore { load(): { state: AppState | null; version: number }; save(state, expectedVersion?): number; collections(): Collection[]; environments(): Environment[]; flattenRequests(): RequestItem[]; close(): void }`.
  - portable: `exportPortable(state: AppState, opts?: { exportedAt?: string }): PortableFile`, `importPortable(file: unknown): { collections: Collection[]; environments: Environment[] }`, `mergeIntoAppState(state, incoming): AppState`, `PortableFile { portiq: 1; exportedAt?; collections; environments }`.
- model: `AppState { collections: Collection[]; activeCollectionId: string; environments: Environment[]; activeEnvId: string | null; historyRetentionDays: number; [key]: any }`, `Collection { id; name; items: (FolderItem|RequestItem)[]; variables? }`, `FolderItem { type:"folder"; id; name; items }`, `RequestItem { type:"request"; id; name; description; tags; protocol; method; url; headersText?; bodyText?; testsPreSteps?: ScriptStep[]; testsPostSteps?: ScriptStep[]; httpVersion?; requestTimeoutMs?; bodyType?; paramsRows?: RequestRow[]; headersRows?: RequestRow[]; authRows?: RequestRow[]; authType?; authConfig?: AuthConfig; bodyRows?: RequestRow[]; graphqlConfig?: GraphqlConfig; wsConfig?; dagGraph?: DagGraph }`, `RequestRow { key; value; comment; enabled; kind?: "text"|"file"; fileName?; mimeType?; fileBase64? }`, `AuthConfig { bearer:{token}; basic:{username;password}; api_key:{key;value;add_to:"header"|"query"} }`, `Environment { id; name; vars: EnvVar[] }`, `EnvVar { key; value; comment; enabled; secret? }`, `ScriptStep { id; name; script }`, `RequestResponse`, `GraphqlConfig { query; variables; operationName; headers }`.
- exec: `getEnvVars(env: Environment | null | undefined): Record<string,string>`, `interpolate<T>(value: T, vars: Record<string,string>): T`, `redactSecrets`, `hasHeader`, `validateHeaders`, `applyBodyContentType`, `BODY_CONTENT_TYPES`, `HeaderRow`, `applyAutoHeaders`, `buildMultipartBody(parts, opts?)`, `MultipartPart`.
- transport: `class HttpTransport` — `new HttpTransport(opts?: { appVersion?: string })`, `send(payload: HttpSendPayload): Promise<HttpResult | { error: string } | { cancelled: true; error } | { timedOut: true; error }>`, `cancel(requestId): { ok: true } | { error }`. `HttpSendPayload { requestId?; method; url; headers?; body?; timeoutMs?; httpVersion?: "auto"|"1.1"|"2"; multipartParts?: MultipartPart[] }`. `HttpResult { status; statusText; time; duration; headers; body; json; httpVersion }`. `buildHttpResult`, `buildAbortResult`. `sendGraphQL(payload: GraphQLSendPayload): Promise<HttpResult | { error: string }>`, `GraphQLSendPayload { url; headers?; query; variables?; operationName? }`. `MockServerManager`, `matchPath`, `MockRoute` (not used by CLI Phase 2).
- scripting: `runSteps(steps: ScriptStep[], ctx: PmContext): Promise<TestEntry[]>`, `runScript(code: string, ctx: PmContext): Promise<TestEntry[]>`, `PmContext { request: any; response: RequestResponse; env: Record<string,string>; setEnvVar(key,value): void; sendRequest(payload): Promise<any>; label?; group? }`, `createTestHarness`, `TestEntry { type:"pass"|"fail"|"error"|"log"|"info"; text; label; group?; duration?; errorType?; errorMessage? }`, `summarizeTests(entries: TestEntry[]): TestSummary`, `TestSummary { passed; failed; errored; duration; groups: TestGroupSummary[]; console: TestEntry[] }`, `TestGroupSummary { name; passed; failed; errored; duration; entries: TestEntry[] }`.
- import: `parseCurl(command: string): ParsedCurl`, `looksLikeCurl(text): boolean`, `inferRequestNameFromUrl(value): string`, `ParsedCurl { method; url; headersRows: RequestRow[]; paramsRows: RequestRow[]; bodyType: string; bodyText: string; bodyRows: RequestRow[]; authType: string; authConfig: AuthConfig }`.
- protocols: `ProtocolRegistry` (`.get(id)`, `.getAll()`, `.getIds()`, `.detectFromUrl(url)`), `ProtocolHandler`.

**Subpath `@portiq/core/flows`** (`packages/core/src/flows/index.ts`):
- `runFlow(graph: DagGraph, deps: RunDeps, options?: RunOptions): Promise<StepsContext>`.
- `RunDeps { sendRequest: (payload: { method; url; headers: Record<string,string>; body?; timeoutMs? }) => Promise<SendResult>; lookupConfig: (id: string) => RequestConfig | undefined; env: Record<string,string>; onStatus: (nodeId, status: NodeStatus, meta?: { reason?; result?: StepResult }) => void }`, `SendResult { status; statusText?; headers?; data?; time?; error? }`.
- `savedRequestToConfig(req: unknown): RequestConfig` (flow `RequestConfig { method; url; headers; body; params; pathVars }` — all strings; `headers` is a JSON string).
- `DagGraph`, `StepsContext`, `StepResult`, `NodeStatus`, `RunOptions`.

**Request assembly — now canonical in `@portiq/core` (Phase 0.5), NOT re-ported here:** `assembleRequest(req, opts?)` reproduces `src/App.tsx` `handleSend` byte-for-byte — `parseHeaders` (rows/JSON → header object), `getCompiledAuthHeaders(type, authConfig, authRows, valFn)`, `getCompiledAuthParams(type, authConfig, valFn)`, `buildUrlWithParams` (base + params + api_key-query, with the `:port` → `/path` slash fix), body-by-`bodyType` (`none`/`json` via `stripJsonComments`+reparse / `form` via `URLSearchParams` / `multipart` parts / `xml` / `raw`), and `stripJsonComments`. Imported from the top barrel `@portiq/core` (there is **no** `@portiq/core/exec` subpath). Task 8 collapses to a thin wrapper over `assembleRequest` (Part D delta #4).

---

## Task 1: Scaffold `@portiq/cli` workspace, bin, build, and lint wiring

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/tsconfig.build.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/version.ts`
- Create: `packages/cli/src/version.test.ts`
- Modify: `eslint.config.js` (register the CLI tsconfig in `parserOptions.project`)
- Modify: `package.json` (root — add `build:cli` script)

**Interfaces:**
- Produces: the `@portiq/cli` workspace; `packages/cli/src/index.ts` as the bin entry (populated later); `CLI_NAME = "portiq"` and `CLI_VERSION` constants (`version.ts`). Build emits CommonJS to `packages/cli/dist`.

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@portiq/cli",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "bin": {
    "portiq": "dist/index.js"
  },
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "@portiq/core": "*",
    "commander": "^12.1.0",
    "fuse.js": "^7.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json` (editor/vitest type context; no emit)**

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

- [ ] **Step 3: Create `packages/cli/tsconfig.build.json` (emit CommonJS to dist)**

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

- [ ] **Step 4: Create `packages/cli/src/version.ts`**

```ts
export const CLI_NAME = "portiq";
export const CLI_VERSION = "0.0.0";
```

- [ ] **Step 5: Create `packages/cli/src/index.ts` (bin entry stub with shebang)**

```ts
#!/usr/bin/env node
import { CLI_NAME, CLI_VERSION } from "./version";

// Populated task-by-task. The real entry is wired in Task 20.
if (require.main === module) {
  process.stdout.write(`${CLI_NAME} ${CLI_VERSION}\n`);
}
```

- [ ] **Step 6: Write the smoke test `packages/cli/src/version.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { CLI_NAME, CLI_VERSION } from "./version";

describe("@portiq/cli", () => {
  it("exposes its name and version", () => {
    expect(CLI_NAME).toBe("portiq");
    expect(CLI_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 7: Register the CLI tsconfig in `eslint.config.js`**

In the `files: ['**/*.{ts,tsx}']` block, change `parserOptions.project` from
`['./tsconfig.json', './packages/core/tsconfig.json']` to:

```js
        project: ['./tsconfig.json', './packages/core/tsconfig.json', './packages/cli/tsconfig.json'],
```

- [ ] **Step 8: Add `build:cli` to root `package.json` scripts**

Insert after the `"build:core": ...` line:

```json
    "build:cli": "npm --workspace @portiq/cli run build",
```

- [ ] **Step 9: Install workspaces, ensure the Node ABI, run the smoke test**

Run: `npm install`
Run: `npm rebuild better-sqlite3` (ensure the native binary serves plain Node before any store/test work)
Run: `npm test -- packages/cli/src/version.test.ts`
Expected: 1 passed.
Run: `npm run lint`
Expected: no new errors in `packages/cli`.

- [ ] **Step 10: Commit**

```bash
git add packages/cli package.json package-lock.json eslint.config.js
git commit -m "chore(cli): scaffold @portiq/cli workspace, bin, build, lint wiring"
```

---

## Task 2: Verify `@portiq/core/flows` require→dist mapping (owned by Phase 0.5)

> **SUPERSEDED BY Phase 0.5 (Part B / Task 3).** The `require`/`dist` condition on `packages/core/package.json` `exports["./flows"]` is applied by Phase 0.5 — this task makes **no core edit** and has **no commit**. It is now a verify-only gate confirming the built CJS CLI can `require("@portiq/core/flows")`.

**Files:**
- Verify only (no edit): `packages/core/package.json` `exports["./flows"]` (owned by Phase 0.5).

**Interfaces:**
- Confirms: `require("@portiq/core/flows")` resolves to `./dist/flows/index.js` for the built CJS CLI; `import` resolves to `./src/flows/index.ts` for vitest/editor. No logic/API change (nor a change made here).

- [ ] **Step 1: Verify the dist emit** (Part B / Task 3 assumes this)

Run: `npm run build:core`
Run: `node -e "require('fs').accessSync('packages/core/dist/flows/index.js'); console.log('flows dist present')"`
Expected: `flows dist present` (the core build emits `dist/flows/` because `tsconfig.build.json` has `rootDir: src` and no per-file include filter). If missing, STOP — the core build config changed.

- [ ] **Step 2: Verify the require resolves** (mapping applied by Phase 0.5)

Run: `node -e "const f = require('@portiq/core/flows'); if (typeof f.runFlow !== 'function') throw new Error('runFlow missing'); if (typeof f.savedRequestToConfig !== 'function') throw new Error('savedRequestToConfig missing'); console.log('flows require ok')"`
Expected: `flows require ok`. If it fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`, Phase 0.5 has not landed — STOP and land it first (do NOT edit core here).

- [ ] **Step 3: Confirm vitest still resolves the import condition**

Run: `npm test -- packages/core/src`
Expected: full core suite still green (uses the `import`→src condition).

_(No commit: this task changes no files.)_

---

## Task 3: CLI config file + data-dir resolution

**Files:**
- Create: `packages/cli/src/config.ts`
- Create: `packages/cli/src/config.test.ts`

**Interfaces:**
- Consumes: `resolveDataDir`, `ResolveDataDirOptions` from `@portiq/core`.
- Produces:
  - `interface CliConfig { dataDir?: string; reporter?: "pretty" | "json" | "junit"; env?: string }`.
  - `resolveConfigPath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string` — `<OS-default data dir>/cli-config.json`, computed via `resolveDataDir` with `PORTIQ_DATA_DIR` stripped (config is stable regardless of `--data-dir`).
  - `loadConfig(configPath: string): CliConfig` — reads+parses the file; returns `{}` if missing/invalid.
  - `saveConfig(configPath: string, config: CliConfig): void` — mkdir -p + write pretty JSON.
  - `resolveEffectiveDataDir(flags: { dataDir?: string }, env: NodeJS.ProcessEnv, config: CliConfig): string` — precedence `--data-dir` → `PORTIQ_DATA_DIR` → `config.dataDir` → OS default, always delegating to `core.resolveDataDir` (never re-derives paths).

- [ ] **Step 1: Write the failing test `packages/cli/src/config.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEffectiveDataDir, loadConfig, saveConfig, resolveConfigPath } from "./config";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-cli-cfg-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveEffectiveDataDir", () => {
  it("prefers the --data-dir flag", () => {
    expect(resolveEffectiveDataDir({ dataDir: "/flag" }, { PORTIQ_DATA_DIR: "/env" }, { dataDir: "/cfg" }))
      .toBe("/flag");
  });
  it("falls back to PORTIQ_DATA_DIR next", () => {
    expect(resolveEffectiveDataDir({}, { PORTIQ_DATA_DIR: "/env" }, { dataDir: "/cfg" })).toBe("/env");
  });
  it("falls back to config dataDir next", () => {
    expect(resolveEffectiveDataDir({}, {}, { dataDir: "/cfg" })).toBe("/cfg");
  });
  it("falls back to the OS default last (via core resolver)", () => {
    const d = resolveEffectiveDataDir({}, {}, {});
    expect(d.endsWith("Portiq")).toBe(true);
  });
});

describe("config file round-trip", () => {
  it("returns {} for a missing file", () => {
    expect(loadConfig(join(tempDir(), "nope.json"))).toEqual({});
  });
  it("saves and reloads config", () => {
    const p = join(tempDir(), "cli-config.json");
    saveConfig(p, { dataDir: "/x", reporter: "json" });
    expect(loadConfig(p)).toEqual({ dataDir: "/x", reporter: "json" });
  });
});

describe("resolveConfigPath", () => {
  it("ignores PORTIQ_DATA_DIR so config is stable", () => {
    const p = resolveConfigPath({ PORTIQ_DATA_DIR: "/redirected" }, "linux", "/home/u");
    expect(p).toBe("/home/u/.config/Portiq/cli-config.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/config.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir } from "@portiq/core";

export interface CliConfig {
  dataDir?: string;
  reporter?: "pretty" | "json" | "junit";
  env?: string;
}

const CONFIG_FILE = "cli-config.json";

export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home?: string
): string {
  const stripped = { ...env };
  delete stripped.PORTIQ_DATA_DIR;
  const base = resolveDataDir({ env: stripped, platform, home });
  return join(base, CONFIG_FILE);
}

export function loadConfig(configPath: string): CliConfig {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(configPath: string, config: CliConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function resolveEffectiveDataDir(
  flags: { dataDir?: string },
  env: NodeJS.ProcessEnv,
  config: CliConfig
): string {
  if (flags.dataDir) return resolveDataDir({ dataDir: flags.dataDir });
  if (env.PORTIQ_DATA_DIR) return resolveDataDir({ env });
  if (config.dataDir) return resolveDataDir({ dataDir: config.dataDir });
  return resolveDataDir({ env });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/config.test.ts`
Expected: PASS (7 tests). (NOTE: `@portiq/core` loads `better-sqlite3` transitively; if a native-ABI error appears, run `npm rebuild better-sqlite3` first.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/src/config.test.ts
git commit -m "feat(cli): config file + data-dir resolution honoring the core contract"
```

---

## Task 4: Typed errors + exit-code mapping + `CliContext`

**Files:**
- Create: `packages/cli/src/errors.ts`
- Create: `packages/cli/src/context.ts`
- Create: `packages/cli/src/errors.test.ts`

**Interfaces:**
- Produces:
  - `errors.ts`: `class UsageError extends Error`, `class RuntimeError extends Error`, `class TestFailureError extends Error`; `EXIT = { SUCCESS: 0, RUNTIME: 1, TEST: 2, USAGE: 3 } as const`; `toExitCode(err: unknown): number` (`UsageError`→3, `TestFailureError`→2, `RuntimeError`→1, anything else→1).
  - `context.ts`: `interface CliContext { argv: string[]; env: NodeJS.ProcessEnv; cwd: string; stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; isTTY: boolean; now: () => number }`; `defaultContext(): CliContext` (binds `process.*`, `isTTY = !!process.stdout.isTTY`).

- [ ] **Step 1: Write the failing test `packages/cli/src/errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { UsageError, RuntimeError, TestFailureError, toExitCode, EXIT } from "./errors";

describe("toExitCode", () => {
  it("maps UsageError to 3", () => {
    expect(toExitCode(new UsageError("bad flag"))).toBe(EXIT.USAGE);
  });
  it("maps TestFailureError to 2", () => {
    expect(toExitCode(new TestFailureError("2 tests failed"))).toBe(EXIT.TEST);
  });
  it("maps RuntimeError to 1", () => {
    expect(toExitCode(new RuntimeError("connection refused"))).toBe(EXIT.RUNTIME);
  });
  it("maps unknown throwables to 1", () => {
    expect(toExitCode(new Error("boom"))).toBe(EXIT.RUNTIME);
    expect(toExitCode("nope")).toBe(EXIT.RUNTIME);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/errors.ts`**

```ts
export const EXIT = { SUCCESS: 0, RUNTIME: 1, TEST: 2, USAGE: 3 } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class TestFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestFailureError";
  }
}

export function toExitCode(err: unknown): number {
  if (err instanceof UsageError) return EXIT.USAGE;
  if (err instanceof TestFailureError) return EXIT.TEST;
  if (err instanceof RuntimeError) return EXIT.RUNTIME;
  return EXIT.RUNTIME;
}
```

- [ ] **Step 4: Implement `packages/cli/src/context.ts`**

```ts
export interface CliContext {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  isTTY: boolean;
  now: () => number;
}

export function defaultContext(): CliContext {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: !!process.stdout.isTTY,
    now: () => Date.now(),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/cli/src/errors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/errors.ts packages/cli/src/context.ts packages/cli/src/errors.test.ts
git commit -m "feat(cli): typed errors, exit-code mapping, and injectable CliContext"
```

---

## Task 5: Reporters (pretty / json / junit) + selection

**Files:**
- Create: `packages/cli/src/reporters/types.ts`
- Create: `packages/cli/src/reporters/junit.ts`
- Create: `packages/cli/src/reporters/index.ts`
- Create: `packages/cli/src/reporters/reporters.test.ts`

**Interfaces:**
- Consumes: `TestSummary`, `HttpResult` from `@portiq/core`.
- Produces:
  - `types.ts`: `ExecRequestView { protocol: string; method: string; url: string; headers: Record<string,string>; body?: string }`; discriminated union
    `type CommandOutput = { kind: "table"; columns: string[]; rows: string[][] } | { kind: "entity"; entity: Record<string, unknown> } | { kind: "execution"; request: ExecRequestView; response: HttpResult | null; error: string | null; tests: TestSummary | null; steps?: unknown } | { kind: "suite"; label: string; items: Array<{ name: string; response: HttpResult | null; error: string | null }>; tests: TestSummary } | { kind: "message"; text: string }`; `interface Reporter { write(out: CommandOutput): string }` (returns the serialized string; the command layer writes it to stdout or `-o`).
  - `junit.ts`: `testSummaryToJUnit(summary: TestSummary, suiteName: string): string`.
  - `index.ts`: `class PrettyReporter`, `class JsonReporter`, `class JunitReporter` (all implement `Reporter`); `selectReporter(opts: { reporter?: "pretty"|"json"|"junit"; isTTY: boolean; color: boolean }): Reporter` (explicit `reporter` wins; else `pretty` if TTY else `json`).

- [ ] **Step 1: Write the failing test `packages/cli/src/reporters/reporters.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { selectReporter, JsonReporter, JunitReporter } from "./index";
import { testSummaryToJUnit } from "./junit";
import type { CommandOutput } from "./types";
import type { TestSummary } from "@portiq/core";

const summary: TestSummary = {
  passed: 1, failed: 1, errored: 0, duration: 12,
  groups: [{
    name: "status", passed: 1, failed: 1, errored: 0, duration: 12,
    entries: [
      { type: "pass", text: "is 200", label: "post", group: "status", duration: 5 },
      { type: "fail", text: "has token", label: "post", group: "status", duration: 7, errorType: "Error", errorMessage: "missing" },
    ],
  }],
  console: [],
};

describe("selectReporter", () => {
  it("defaults to json when not a TTY", () => {
    expect(selectReporter({ isTTY: false, color: false })).toBeInstanceOf(JsonReporter);
  });
  it("honors an explicit junit choice", () => {
    expect(selectReporter({ reporter: "junit", isTTY: true, color: false })).toBeInstanceOf(JunitReporter);
  });
});

describe("JsonReporter", () => {
  it("serializes a table output to parseable JSON", () => {
    const out: CommandOutput = { kind: "table", columns: ["a"], rows: [["1"]] };
    const parsed = JSON.parse(new JsonReporter().write(out));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows[0][0]).toBe("1");
  });
});

describe("testSummaryToJUnit", () => {
  it("emits a testsuite with a failure element", () => {
    const xml = testSummaryToJUnit(summary, "run");
    expect(xml).toContain('<testsuites tests="2" failures="1" errors="0"');
    expect(xml).toContain('name="has token"');
    expect(xml).toContain("<failure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/reporters/reporters.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/cli/src/reporters/types.ts`**

```ts
import type { HttpResult, TestSummary } from "@portiq/core";

export interface ExecRequestView {
  protocol: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type CommandOutput =
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "entity"; entity: Record<string, unknown> }
  | {
      kind: "execution";
      request: ExecRequestView;
      response: HttpResult | null;
      error: string | null;
      tests: TestSummary | null;
      steps?: unknown;
    }
  | {
      kind: "suite";
      label: string;
      items: Array<{ name: string; response: HttpResult | null; error: string | null }>;
      tests: TestSummary;
    }
  | { kind: "message"; text: string };

export interface Reporter {
  write(out: CommandOutput): string;
}
```

- [ ] **Step 4: Implement `packages/cli/src/reporters/junit.ts`**

```ts
import type { TestSummary } from "@portiq/core";

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function testSummaryToJUnit(summary: TestSummary, suiteName: string): string {
  const cases: string[] = [];
  for (const g of summary.groups) {
    for (const e of g.entries) {
      const time = ((e.duration ?? 0) / 1000).toFixed(3);
      const base = `    <testcase classname="${esc(g.name)}" name="${esc(e.text)}" time="${time}"`;
      if (e.type === "pass") {
        cases.push(`${base}/>`);
      } else if (e.type === "fail") {
        cases.push(`${base}><failure message="${esc(e.errorMessage || "")}">${esc(e.errorType || "AssertionError")}</failure></testcase>`);
      } else if (e.type === "error") {
        cases.push(`${base}><error message="${esc(e.errorMessage || "")}">${esc(e.errorType || "Error")}</error></testcase>`);
      }
    }
  }
  const total = summary.passed + summary.failed + summary.errored;
  const time = (summary.duration / 1000).toFixed(3);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${summary.failed}" errors="${summary.errored}" time="${time}">`,
    `  <testsuite name="${esc(suiteName)}" tests="${total}" failures="${summary.failed}" errors="${summary.errored}" time="${time}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
}
```

- [ ] **Step 5: Implement `packages/cli/src/reporters/index.ts`**

```ts
import type { CommandOutput, Reporter } from "./types";
import { testSummaryToJUnit } from "./junit";

export type { CommandOutput, Reporter, ExecRequestView } from "./types";
export { testSummaryToJUnit } from "./junit";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

export class JsonReporter implements Reporter {
  write(out: CommandOutput): string {
    return JSON.stringify(out, null, 2);
  }
}

export class JunitReporter implements Reporter {
  write(out: CommandOutput): string {
    if (out.kind === "execution" && out.tests) return testSummaryToJUnit(out.tests, "run");
    if (out.kind === "suite") return testSummaryToJUnit(out.tests, out.label);
    // Non-test outputs: emit an empty suite so junit consumers get valid XML.
    return testSummaryToJUnit({ passed: 0, failed: 0, errored: 0, duration: 0, groups: [], console: [] }, out.kind);
  }
}

export class PrettyReporter implements Reporter {
  constructor(private color: boolean) {}
  private c(code: string, s: string): string {
    return this.color ? `${code}${s}${RESET}` : s;
  }
  write(out: CommandOutput): string {
    switch (out.kind) {
      case "message":
        return out.text;
      case "table":
        return this.table(out.columns, out.rows);
      case "entity":
        return Object.entries(out.entity)
          .map(([k, v]) => `${this.c(DIM, k + ":")} ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("\n");
      case "execution":
        return this.execution(out.request.method, out.request.url, out.response, out.error, out.tests);
      case "suite": {
        const lines = out.items.map((it) =>
          this.execution(it.name, it.name, it.response, it.error, null)
        );
        lines.push(this.testsLine(out.tests));
        return lines.join("\n");
      }
    }
  }
  private table(columns: string[], rows: string[][]): string {
    const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] ?? "").length)));
    const fmt = (cells: string[]) => cells.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ");
    return [this.c(DIM, fmt(columns)), ...rows.map(fmt)].join("\n");
  }
  private execution(
    method: string,
    url: string,
    response: { status: number; statusText: string; time: number } | null,
    error: string | null,
    tests: import("@portiq/core").TestSummary | null
  ): string {
    const head = `${method} ${url}`;
    if (error) return `${head}\n${this.c(RED, "ERROR")} ${error}`;
    const status = response
      ? `${this.c(response.status >= 400 ? RED : GREEN, String(response.status))} ${response.statusText} ${this.c(DIM, `(${response.time}ms)`)}`
      : this.c(DIM, "(not sent)");
    const parts = [`${head}\n${status}`];
    if (tests) parts.push(this.testsLine(tests));
    return parts.join("\n");
  }
  private testsLine(tests: import("@portiq/core").TestSummary): string {
    const failed = tests.failed + tests.errored;
    const label = `tests: ${tests.passed} passed, ${tests.failed} failed, ${tests.errored} errored`;
    return this.c(failed > 0 ? RED : GREEN, label);
  }
}

export function selectReporter(opts: {
  reporter?: "pretty" | "json" | "junit";
  isTTY: boolean;
  color: boolean;
}): Reporter {
  const kind = opts.reporter ?? (opts.isTTY ? "pretty" : "json");
  if (kind === "json") return new JsonReporter();
  if (kind === "junit") return new JunitReporter();
  return new PrettyReporter(opts.color);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- packages/cli/src/reporters/reporters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/reporters
git commit -m "feat(cli): pretty/json/junit reporters with TTY-aware selection"
```

---

## Task 6: Reference resolver, request paths, and variable resolution

**Files:**
- Create: `packages/cli/src/resolve/refs.ts`
- Create: `packages/cli/src/resolve/refs.test.ts`

**Interfaces:**
- Consumes: `AppState`, `Collection`, `FolderItem`, `RequestItem`, `Environment`, `getEnvVars` from `@portiq/core`; `UsageError` from `../errors`.
- Produces:
  - `interface RequestWithPath { path: string; item: RequestItem }`.
  - `listRequestsWithPaths(state: AppState): RequestWithPath[]` — walks every collection/folder, building `Collection/Folder/Request` paths.
  - `isFlow(item: RequestItem): boolean` — `item.protocol === "dag"`.
  - `interface ResolvedRef { kind: "request" | "collection" | "environment" | "flow"; path: string; request?: RequestItem; collection?: Collection; environment?: Environment }`.
  - `resolveRef(state: AppState, opts: { ref?: string; id?: string }): ResolvedRef` — `id` searches requests → collections → environments by id; `ref` resolves a `Collection/Folder/Request` tree path (request/flow or collection), else a single-segment environment name; throws `UsageError` when unresolved or when neither is given.
  - `resolveVars(state: AppState, flags: { env?: string; var?: string[] }): Record<string,string>` — active env by `--env` name (or `state.activeEnvId`), overlaid with repeatable `--var k=v`; `UsageError` on an unknown env name or a malformed `--var`.

- [ ] **Step 1: Write the failing test `packages/cli/src/resolve/refs.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { listRequestsWithPaths, resolveRef, resolveVars, isFlow } from "./refs";
import { UsageError } from "../errors";
import type { AppState } from "@portiq/core";

const state = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
      { type: "folder", id: "f1", name: "Users", items: [
        { type: "request", id: "r2", name: "Create", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/users" },
      ] },
      { type: "request", id: "r3", name: "Flow", description: "", tags: [], protocol: "dag", method: "GET", url: "", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("listRequestsWithPaths", () => {
  it("builds Collection/Folder/Request paths", () => {
    const paths = listRequestsWithPaths(state()).map((r) => r.path).sort();
    expect(paths).toEqual(["API/Flow", "API/List", "API/Users/Create"]);
  });
});

describe("resolveRef", () => {
  it("resolves a nested request by path", () => {
    const r = resolveRef(state(), { ref: "API/Users/Create" });
    expect(r.kind).toBe("request");
    expect(r.request?.id).toBe("r2");
  });
  it("classifies a dag request as a flow", () => {
    expect(resolveRef(state(), { ref: "API/Flow" }).kind).toBe("flow");
  });
  it("resolves a collection", () => {
    expect(resolveRef(state(), { ref: "API" }).kind).toBe("collection");
  });
  it("resolves by id", () => {
    expect(resolveRef(state(), { id: "r1" }).request?.name).toBe("List");
  });
  it("throws UsageError on an unknown ref", () => {
    expect(() => resolveRef(state(), { ref: "API/Nope" })).toThrow(UsageError);
  });
});

describe("resolveVars", () => {
  it("uses the active env and overlays --var", () => {
    expect(resolveVars(state(), { var: ["token=abc"] })).toEqual({ baseUrl: "https://x", token: "abc" });
  });
  it("throws on an unknown --env", () => {
    expect(() => resolveVars(state(), { env: "Prod" })).toThrow(UsageError);
  });
  it("throws on a malformed --var", () => {
    expect(() => resolveVars(state(), { var: ["oops"] })).toThrow(UsageError);
  });
});

describe("isFlow", () => {
  it("is true only for protocol dag", () => {
    expect(isFlow({ type: "request", id: "x", name: "n", description: "", tags: [], protocol: "dag", method: "GET", url: "" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/resolve/refs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/resolve/refs.ts`**

```ts
import { getEnvVars, type AppState, type Collection, type Environment, type FolderItem, type RequestItem } from "@portiq/core";
import { UsageError } from "../errors";

export interface RequestWithPath {
  path: string;
  item: RequestItem;
}

export function isFlow(item: RequestItem): boolean {
  return item.protocol === "dag";
}

function walk(items: (FolderItem | RequestItem)[], prefix: string, out: RequestWithPath[]): void {
  for (const item of items) {
    if (item.type === "request") out.push({ path: `${prefix}/${item.name}`, item });
    else if (item.type === "folder") walk(item.items, `${prefix}/${item.name}`, out);
  }
}

export function listRequestsWithPaths(state: AppState): RequestWithPath[] {
  const out: RequestWithPath[] = [];
  for (const c of state.collections ?? []) walk(c.items ?? [], c.name, out);
  return out;
}

export interface ResolvedRef {
  kind: "request" | "collection" | "environment" | "flow";
  path: string;
  request?: RequestItem;
  collection?: Collection;
  environment?: Environment;
}

function findRequestById(state: AppState, id: string): RequestWithPath | undefined {
  return listRequestsWithPaths(state).find((r) => r.item.id === id);
}

export function resolveRef(state: AppState, opts: { ref?: string; id?: string }): ResolvedRef {
  if (opts.id) {
    const req = findRequestById(state, opts.id);
    if (req) return { kind: isFlow(req.item) ? "flow" : "request", path: req.path, request: req.item };
    const col = (state.collections ?? []).find((c) => c.id === opts.id);
    if (col) return { kind: "collection", path: col.name, collection: col };
    const env = (state.environments ?? []).find((e) => e.id === opts.id);
    if (env) return { kind: "environment", path: env.name, environment: env };
    throw new UsageError(`No collection, request, or environment with id "${opts.id}"`);
  }
  if (!opts.ref) throw new UsageError("A reference (Collection/Folder/Request) or --id is required");

  const segments = opts.ref.split("/").filter(Boolean);
  const col = (state.collections ?? []).find((c) => c.name === segments[0]);
  if (col) {
    if (segments.length === 1) return { kind: "collection", path: col.name, collection: col };
    let items: (FolderItem | RequestItem)[] = col.items ?? [];
    for (let i = 1; i < segments.length; i++) {
      const match = items.find((it) => it.name === segments[i]);
      if (!match) throw new UsageError(`Could not resolve "${opts.ref}" (no "${segments[i]}")`);
      if (i === segments.length - 1) {
        if (match.type !== "request") throw new UsageError(`"${opts.ref}" is a folder, not a request`);
        return { kind: isFlow(match) ? "flow" : "request", path: opts.ref, request: match };
      }
      if (match.type !== "folder") throw new UsageError(`"${segments[i]}" is not a folder`);
      items = match.items;
    }
  }
  if (segments.length === 1) {
    const env = (state.environments ?? []).find((e) => e.name === segments[0]);
    if (env) return { kind: "environment", path: env.name, environment: env };
  }
  throw new UsageError(`Could not resolve reference "${opts.ref}"`);
}

export function resolveVars(state: AppState, flags: { env?: string; var?: string[] }): Record<string, string> {
  let env: Environment | undefined;
  if (flags.env) {
    env = (state.environments ?? []).find((e) => e.name === flags.env);
    if (!env) throw new UsageError(`Unknown environment "${flags.env}"`);
  } else if (state.activeEnvId) {
    env = (state.environments ?? []).find((e) => e.id === state.activeEnvId);
  }
  const vars = getEnvVars(env ?? null);
  for (const pair of flags.var ?? []) {
    const idx = pair.indexOf("=");
    if (idx === -1) throw new UsageError(`Invalid --var "${pair}", expected key=value`);
    vars[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return vars;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/resolve/refs.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/resolve/refs.ts packages/cli/src/resolve/refs.test.ts
git commit -m "feat(cli): reference resolver, request paths, and variable resolution"
```

---

## Task 7: Command registry + program builder

**Files:**
- Create: `packages/cli/src/registry.ts`
- Create: `packages/cli/src/registry.test.ts`

**Interfaces:**
- Consumes: `Command` from `commander`; `CliContext` from `./context`; `UsageError` from `./errors`.
- Produces:
  - `interface GlobalFlags { dataDir?: string; env?: string; var: string[]; reporter?: "pretty"|"json"|"junit"; output?: string; timeout?: number; failOnTest?: boolean; dryRun?: boolean; color: boolean }`.
  - `interface CommandModule { register(program: Command, ctx: CliContext): void }`.
  - `parseGlobalFlags(cmd: Command): GlobalFlags` — reads merged global options off a commander command (via `.optsWithGlobals()`), normalizing `--no-color`→`color`, `timeout`→number.
  - `buildProgram(ctx: CliContext, modules: CommandModule[]): Command` — creates the root `portiq` program, declares the shared global options once, `.exitOverride()` so commander usage failures throw (mapped to exit 3 by the entry), and registers every module. Parity plans pass extra modules here.

- [ ] **Step 1: Write the failing test `packages/cli/src/registry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { buildProgram, type CommandModule } from "./registry";
import { defaultContext } from "./context";

const noop: CommandModule = {
  register(program) {
    program.command("ping").action(() => { /* no-op */ });
  },
};

describe("buildProgram", () => {
  it("registers provided command modules additively", () => {
    const program = buildProgram(defaultContext(), [noop]);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("ping");
  });

  it("declares the shared --data-dir global option", () => {
    const program = buildProgram(defaultContext(), []);
    const opt = program.options.find((o) => o.long === "--data-dir");
    expect(opt).toBeTruthy();
  });

  it("throws instead of exiting on an unknown command (exitOverride)", () => {
    const program = buildProgram(defaultContext(), [noop]);
    expect(() => program.parse(["nope"], { from: "user" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/registry.ts`**

```ts
import { Command, Option } from "commander";
import type { CliContext } from "./context";
import { CLI_NAME, CLI_VERSION } from "./version";

export interface GlobalFlags {
  dataDir?: string;
  env?: string;
  var: string[];
  reporter?: "pretty" | "json" | "junit";
  output?: string;
  timeout?: number;
  failOnTest?: boolean;
  dryRun?: boolean;
  color: boolean;
}

export interface CommandModule {
  register(program: Command, ctx: CliContext): void;
}

export function parseGlobalFlags(cmd: Command): GlobalFlags {
  const o = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    dataDir: o.dataDir as string | undefined,
    env: o.env as string | undefined,
    var: (o.var as string[] | undefined) ?? [],
    reporter: o.reporter as GlobalFlags["reporter"],
    output: o.output as string | undefined,
    timeout: o.timeout !== undefined ? Number(o.timeout) : undefined,
    failOnTest: o.failOnTest as boolean | undefined,
    dryRun: o.dryRun as boolean | undefined,
    color: o.color !== false,
  };
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function buildProgram(ctx: CliContext, modules: CommandModule[]): Command {
  const program = new Command();
  program
    .name(CLI_NAME)
    .version(CLI_VERSION)
    .description("Portiq API client — run your API library from the terminal")
    .option("--data-dir <path>", "override the Portiq data directory")
    .option("--env <name>", "environment to interpolate variables from")
    .option("--var <k=v>", "override a variable (repeatable)", collect, [])
    .addOption(new Option("--reporter <format>", "output format").choices(["pretty", "json", "junit"]))
    .option("-o, --output <file>", "write the report to a file instead of stdout")
    .option("--timeout <ms>", "request timeout in milliseconds")
    .option("--fail-on-test", "exit 2 when any test fails")
    .option("--dry-run", "resolve the request without sending it")
    .option("--no-color", "disable ANSI color");
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => ctx.stdout.write(str),
    writeErr: (str) => ctx.stderr.write(str),
  });
  for (const m of modules) m.register(program, ctx);
  return program;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/registry.ts packages/cli/src/registry.test.ts
git commit -m "feat(cli): additive command registry + program builder with global flags"
```

---

## Task 8: Request resolver — `RequestItem` → `HttpSendPayload`

**Files:**
- Create: `packages/cli/src/resolve/httpPayload.ts`
- Create: `packages/cli/src/resolve/httpPayload.test.ts`

> **COLLAPSED per Phase 0.5 (Part A / Part D delta #4).** Request assembly is no longer ported into the CLI — it is the canonical `assembleRequest` in `@portiq/core`. This task collapses to a thin wrapper that delegates to `assembleRequest` and adapts the result to the CLI's `{ payload, view }` shape.

**Interfaces:**
- Consumes: `assembleRequest`, `stripJsonComments`, `InvalidJsonBodyError`, `type AssemblableRequest`, `type HttpSendPayload` from `@portiq/core` (Phase 0.5 request-assembly API, imported from the top barrel — there is **no** `@portiq/core/exec` subpath); `ExecRequestView` from `../reporters`; `UsageError` from `../errors`.
- Produces:
  - `type ResolvableRequest = AssemblableRequest` — alias of core's type (identical `Pick<RequestItem, …>` shape), kept so existing CLI imports of `ResolvableRequest` are unchanged.
  - `stripJsonComments` — re-exported from `@portiq/core` (the local copy is dropped).
  - `resolveHttpPayload(req: ResolvableRequest, vars: Record<string,string>, opts?: { requestId?: string; timeoutMs?: number }): { payload: HttpSendPayload; view: ExecRequestView }` — a thin wrapper: calls `assembleRequest(req, { vars, requestId, timeoutMs })`, derives the `ExecRequestView`, and maps core's `InvalidJsonBodyError` → `UsageError`.

- [ ] **Step 1: Write the failing test `packages/cli/src/resolve/httpPayload.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveHttpPayload, stripJsonComments, type ResolvableRequest } from "./httpPayload";
import { UsageError } from "../errors";

const vars = { baseUrl: "https://api.test", token: "abc" };

describe("resolveHttpPayload", () => {
  it("interpolates the url and merges auth + table headers", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "GET", url: "{{baseUrl}}/users",
      headersRows: [{ key: "X-Trace", value: "1", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
      paramsRows: [{ key: "page", value: "2", comment: "", enabled: true }],
      bodyType: "none",
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.url).toBe("https://api.test/users?page=2");
    expect(payload.headers?.Authorization).toBe("Bearer abc");
    expect(payload.headers?.["X-Trace"]).toBe("1");
    expect(payload.body).toBeUndefined();
  });

  it("adds api_key auth to the query when configured", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "GET", url: "https://x/",
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "k", value: "{{token}}", add_to: "query" } },
      bodyType: "none",
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.url).toBe("https://x/?k=abc");
  });

  it("compacts a json body and sets it", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "POST", url: "https://x/",
      bodyType: "json", bodyText: '{\n  "a": "{{token}}" // note\n}',
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.body).toBe('{"a":"abc"}');
  });

  it("throws UsageError on invalid json body", () => {
    const req: ResolvableRequest = { protocol: "http", method: "POST", url: "https://x/", bodyType: "json", bodyText: "{ not json" };
    expect(() => resolveHttpPayload(req, vars)).toThrow(UsageError);
  });

  it("builds a form body", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "POST", url: "https://x/",
      bodyType: "form", bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.body).toBe("a=1&b=abc");
  });
});

describe("stripJsonComments", () => {
  it("removes // and /* */ comments", () => {
    expect(stripJsonComments('{"a":1} // x')).toContain('{"a":1}');
    expect(stripJsonComments("{/* c */}")).toBe("{}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/resolve/httpPayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/resolve/httpPayload.ts`**

```ts
import {
  assembleRequest,
  stripJsonComments,
  InvalidJsonBodyError,
  type AssemblableRequest,
  type HttpSendPayload,
} from "@portiq/core";
import type { ExecRequestView } from "../reporters";
import { UsageError } from "../errors";

/** The CLI's resolvable request is exactly core's AssemblableRequest. */
export type ResolvableRequest = AssemblableRequest;

/** Re-export core's canonical helper so existing CLI imports keep resolving. */
export { stripJsonComments };

/**
 * Thin wrapper over the canonical core assembler (Phase 0.5). Delegates
 * assembly to `assembleRequest`, then derives the CLI's dry-run `view`.
 * Core's `InvalidJsonBodyError` is mapped to the CLI's `UsageError` (exit 3).
 */
export function resolveHttpPayload(
  req: ResolvableRequest,
  vars: Record<string, string>,
  opts: { requestId?: string; timeoutMs?: number } = {}
): { payload: HttpSendPayload; view: ExecRequestView } {
  let payload: HttpSendPayload;
  try {
    payload = assembleRequest(req, { vars, requestId: opts.requestId, timeoutMs: opts.timeoutMs });
  } catch (err) {
    if (err instanceof InvalidJsonBodyError) throw new UsageError(err.message);
    throw err;
  }
  const view: ExecRequestView = {
    protocol: req.protocol || "http",
    method: payload.method,
    url: payload.url,
    headers: payload.headers ?? {},
    body: payload.body,
  };
  return { payload, view };
}
```

Note: `resolveHttpPayload` passes the CLI's already-resolved `vars` straight to `assembleRequest`; core's `assembleRequest` runs `resolveVars(undefined, vars)` internally, so the merged map is used as-is (no env double-resolution). The Step 1 tests are unchanged and now exercise the wrapper + core.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/resolve/httpPayload.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/resolve/httpPayload.ts packages/cli/src/resolve/httpPayload.test.ts
git commit -m "feat(cli): resolve requests via core assembleRequest (thin wrapper)"
```

---

## Task 9: Execution service — `runRequest` (transport + scripts)

> Confirmed aligned with Phase 0.5 (Part D delta #6): **no code change here.** This task still consumes `resolveHttpPayload` from `../resolve/httpPayload`, which is now the thin wrapper over core's `assembleRequest` (Task 8). Importing `assembleRequest` directly is optional and not necessary.

**Files:**
- Create: `packages/cli/src/exec/runRequest.ts`
- Create: `packages/cli/src/exec/runRequest.test.ts`

**Interfaces:**
- Consumes: `HttpTransport`, `sendGraphQL`, `runSteps`, `summarizeTests`, `interpolate`, `HttpResult`, `HttpSendPayload`, `TestEntry`, `TestSummary`, `ScriptStep`, `RequestItem`, `GraphqlConfig` from `@portiq/core`; `resolveHttpPayload`, `ResolvableRequest` from `../resolve/httpPayload` (`ResolvableRequest` is now an alias of core's `AssemblableRequest`); `ExecRequestView` from `../reporters`; `RuntimeError` from `../errors`.
- Produces:
  - `interface RunOutcome { request: ExecRequestView; response: HttpResult | null; error: string | null; tests: TestSummary | null }`.
  - `interface RunDeps { transport: HttpTransport; sendGraphQL: typeof import("@portiq/core").sendGraphQL; now: () => number }`.
  - `defaultRunDeps(appVersion?: string): RunDeps`.
  - `runRequest(req: RequestItem, vars: Record<string,string>, deps: RunDeps, opts?: { timeoutMs?: number; runTests?: boolean }): Promise<RunOutcome>` — routes `protocol` `http`/`""`→`transport.send`, `graphql`→`sendGraphQL`, throws `RuntimeError` for `websocket`/`grpc`; runs `testsPreSteps` (mutable request, response null) before send and `testsPostSteps` (response populated) after, summarizing all `TestEntry` via `summarizeTests` when `runTests` (default true). Env var writes from scripts stay in-memory (do not persist).

- [ ] **Step 1: Write the failing test `packages/cli/src/exec/runRequest.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { runRequest, type RunDeps } from "./runRequest";
import type { HttpResult, RequestItem } from "@portiq/core";

const okResult: HttpResult = {
  status: 200, statusText: "OK", time: 5, duration: 5,
  headers: { "content-type": "application/json" }, body: '{"id":1}', json: { id: 1 }, httpVersion: "auto",
};

function deps(sendImpl: () => Promise<unknown>): RunDeps {
  return {
    transport: { send: vi.fn(sendImpl), cancel: vi.fn() } as unknown as RunDeps["transport"],
    sendGraphQL: vi.fn(async () => okResult) as unknown as RunDeps["sendGraphQL"],
    now: () => 0,
  };
}

const httpReq = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "r1", name: "Get", description: "", tags: [],
  protocol: "http", method: "GET", url: "https://x/", bodyType: "none", ...over,
});

describe("runRequest", () => {
  it("sends an http request and returns the response", async () => {
    const outcome = await runRequest(httpReq(), {}, deps(async () => okResult));
    expect(outcome.error).toBeNull();
    expect(outcome.response?.status).toBe(200);
  });

  it("surfaces a transport error", async () => {
    const outcome = await runRequest(httpReq(), {}, deps(async () => ({ error: "ECONNREFUSED" })));
    expect(outcome.response).toBeNull();
    expect(outcome.error).toBe("ECONNREFUSED");
  });

  it("runs post-test steps against the response", async () => {
    const req = httpReq({
      testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('200', () => pm.response.to.have.status(200));" }],
    });
    const outcome = await runRequest(req, {}, deps(async () => okResult));
    expect(outcome.tests?.passed).toBe(1);
    expect(outcome.tests?.failed).toBe(0);
  });

  it("rejects unsupported protocols with a RuntimeError", async () => {
    await expect(runRequest(httpReq({ protocol: "websocket" }), {}, deps(async () => okResult))).rejects.toThrow(/websocket/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/exec/runRequest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/exec/runRequest.ts`**

```ts
import {
  HttpTransport, sendGraphQL as coreSendGraphQL, runSteps, summarizeTests, interpolate,
  type GraphqlConfig, type HttpResult, type RequestItem, type RequestResponse, type ScriptStep, type TestEntry, type TestSummary,
} from "@portiq/core";
import { resolveHttpPayload } from "../resolve/httpPayload";
import type { ExecRequestView } from "../reporters";
import { RuntimeError } from "../errors";

export interface RunOutcome {
  request: ExecRequestView;
  response: HttpResult | null;
  error: string | null;
  tests: TestSummary | null;
}

export interface RunDeps {
  transport: HttpTransport;
  sendGraphQL: typeof coreSendGraphQL;
  now: () => number;
}

export function defaultRunDeps(appVersion?: string): RunDeps {
  return { transport: new HttpTransport({ appVersion }), sendGraphQL: coreSendGraphQL, now: () => Date.now() };
}

function isHttpResult(r: unknown): r is HttpResult {
  return !!r && typeof r === "object" && "status" in (r as object) && !("error" in (r as object) && (r as { status?: unknown }).status === undefined);
}

export async function runRequest(
  req: RequestItem,
  vars: Record<string, string>,
  deps: RunDeps,
  opts: { timeoutMs?: number; runTests?: boolean } = {}
): Promise<RunOutcome> {
  const protocol = req.protocol || "http";
  if (protocol === "websocket" || protocol === "grpc") {
    throw new RuntimeError(`Protocol "${protocol}" is not supported via the CLI (interactive/experimental).`);
  }
  const runTests = opts.runTests !== false;
  const entries: TestEntry[] = [];
  const env = { ...vars };
  const setEnvVar = (key: string, value: string) => { env[key] = value; };
  const sendForScripts = (payload: { method: string; url: string; headers?: Record<string, string>; body?: string }) =>
    deps.transport.send({ method: payload.method, url: payload.url, headers: payload.headers, body: payload.body, httpVersion: "auto" });

  if (protocol === "graphql") {
    const cfg = (req.graphqlConfig ?? {}) as GraphqlConfig;
    const url = interpolate(req.url || "", env);
    const raw = await deps.sendGraphQL({
      url,
      headers: cfg.headers,
      query: interpolate(cfg.query || "", env),
      variables: interpolate(cfg.variables || "", env),
      operationName: interpolate(cfg.operationName || "", env),
    });
    const view: ExecRequestView = { protocol, method: "POST", url, headers: cfg.headers ?? {} };
    if ("error" in raw) return { request: view, response: null, error: raw.error, tests: null };
    const response = raw as HttpResult;
    if (runTests) {
      const post: ScriptStep[] = req.testsPostSteps ?? [];
      entries.push(...await runSteps(post, { request: view, response: response as unknown as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "post" }));
    }
    return { request: view, response, error: null, tests: runTests ? summarizeTests(entries) : null };
  }

  // http (and default)
  const { payload, view } = resolveHttpPayload(req, env, { timeoutMs: opts.timeoutMs });
  const requestObj = { method: view.method, url: view.url, headers: { ...view.headers }, body: view.body };
  if (runTests) {
    entries.push(...await runSteps(req.testsPreSteps ?? [], { request: requestObj, response: {} as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "pre" }));
    payload.method = requestObj.method || payload.method;
    payload.url = requestObj.url || payload.url;
    payload.headers = requestObj.headers || payload.headers;
    payload.body = requestObj.body ?? payload.body;
  }
  const raw = await deps.transport.send(payload);
  if ("error" in raw && (raw as { status?: unknown }).status === undefined) {
    return { request: view, response: null, error: (raw as { error: string }).error, tests: runTests ? summarizeTests(entries) : null };
  }
  const response = raw as HttpResult;
  if (runTests) {
    entries.push(...await runSteps(req.testsPostSteps ?? [], { request: requestObj, response: response as unknown as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "post" }));
  }
  return { request: view, response, error: null, tests: runTests ? summarizeTests(entries) : null };
}

void isHttpResult;
```

> **Note:** `void isHttpResult;` avoids an unused-symbol warning while keeping the type guard documented for future streaming protocols; delete it if you inline the guard. The error discrimination uses core's documented abort/error shapes (`{ error }`, `{ cancelled, error }`, `{ timedOut, error }`) — all lack a numeric `status`, while `HttpResult` always has one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/exec/runRequest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/exec/runRequest.ts packages/cli/src/exec/runRequest.test.ts
git commit -m "feat(cli): runRequest execution service over core transport + scripting"
```

---

## Task 10: `where` and `config` commands

**Files:**
- Create: `packages/cli/src/commands/where.ts`
- Create: `packages/cli/src/commands/config.ts`
- Create: `packages/cli/src/commands/where.test.ts`

**Interfaces:**
- Consumes: `resolveDbPath` from `@portiq/core`; `CommandModule`, `parseGlobalFlags` from `../registry`; `resolveConfigPath`, `loadConfig`, `saveConfig`, `resolveEffectiveDataDir` from `../config`; `selectReporter` from `../reporters`; `CliContext` from `../context`.
- Produces: `whereCommand: CommandModule` (`portiq where` → prints resolved data dir + db path + config path as an `entity` output); `configCommand: CommandModule` (`portiq config` prints config; `portiq config set <key> <value>` writes `dataDir`/`reporter`/`env`; `portiq config path` prints the config file path). Both honor `--reporter`/`--no-color`/`-o` via a shared `emit(ctx, flags, output)` helper (defined here, reused by all commands).

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/where.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { buildProgram } from "../registry";
import { whereCommand } from "./where";
import type { CliContext } from "../context";

function capture(): { ctx: CliContext; out: () => string } {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return { ctx, out: () => buf };
}

describe("where command", () => {
  it("prints the resolved data dir and db path as json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portiq-where-"));
    try {
      const { ctx, out } = capture();
      const program = buildProgram(ctx, [whereCommand]);
      await program.parseAsync(["where", "--data-dir", dir, "--reporter", "json"], { from: "user" });
      const parsed = JSON.parse(out());
      expect(parsed.entity.dataDir).toBe(dir);
      expect(parsed.entity.dbPath).toBe(join(dir, "appdata.sqlite"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/where.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the shared `emit` helper `packages/cli/src/commands/emit.ts`**

```ts
import { writeFileSync } from "node:fs";
import type { CliContext } from "../context";
import { selectReporter, type CommandOutput } from "../reporters";
import type { GlobalFlags } from "../registry";

export function emit(ctx: CliContext, flags: GlobalFlags, output: CommandOutput): void {
  const reporter = selectReporter({ reporter: flags.reporter, isTTY: ctx.isTTY, color: flags.color });
  const text = reporter.write(output);
  if (flags.output) {
    writeFileSync(flags.output, text.endsWith("\n") ? text : text + "\n", "utf8");
  } else {
    ctx.stdout.write(text.endsWith("\n") ? text : text + "\n");
  }
}
```

- [ ] **Step 4: Implement `packages/cli/src/commands/where.ts`**

```ts
import { resolveDbPath } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";
import { emit } from "./emit";

export const whereCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("where")
      .description("print the resolved data directory, database, and config paths")
      .action((_opts, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const configPath = resolveConfigPath(ctx.env);
        const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(configPath));
        emit(ctx, flags, {
          kind: "entity",
          entity: { dataDir, dbPath: resolveDbPath({ dataDir }), configPath },
        });
      });
  },
};
```

- [ ] **Step 5: Implement `packages/cli/src/commands/config.ts`**

```ts
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { loadConfig, resolveConfigPath, saveConfig, type CliConfig } from "../config";
import { UsageError } from "../errors";
import { emit } from "./emit";

const SETTABLE = new Set(["dataDir", "reporter", "env"]);

export const configCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    const config = program.command("config").description("view or edit CLI configuration");

    config
      .command("path")
      .description("print the config file path")
      .action((_o, cmd: Command) => {
        emit(ctx, parseGlobalFlags(cmd), { kind: "message", text: resolveConfigPath(ctx.env) });
      });

    config
      .command("set <key> <value>")
      .description("set a config key (dataDir | reporter | env)")
      .action((key: string, value: string, _o, cmd: Command) => {
        if (!SETTABLE.has(key)) throw new UsageError(`Unknown config key "${key}" (allowed: ${[...SETTABLE].join(", ")})`);
        const path = resolveConfigPath(ctx.env);
        const next = { ...loadConfig(path), [key]: value } as CliConfig;
        saveConfig(path, next);
        emit(ctx, parseGlobalFlags(cmd), { kind: "message", text: `set ${key} = ${value}` });
      });

    config
      .action((_o, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const current = loadConfig(resolveConfigPath(ctx.env)) as Record<string, unknown>;
        emit(ctx, flags, { kind: "entity", entity: current });
      });
  },
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/where.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/emit.ts packages/cli/src/commands/where.ts packages/cli/src/commands/config.ts packages/cli/src/commands/where.test.ts
git commit -m "feat(cli): where + config commands and shared emit helper"
```

---

## Task 11: Store-open helper + `ls` command

**Files:**
- Create: `packages/cli/src/commands/store.ts`
- Create: `packages/cli/src/commands/ls.ts`
- Create: `packages/cli/src/commands/ls.test.ts`

**Interfaces:**
- Consumes: `openAppStateStore`, `AppState` from `@portiq/core`; `listRequestsWithPaths`, `isFlow` from `../resolve/refs`; `parseGlobalFlags`, `CommandModule` from `../registry`; `emit` from `./emit`; `resolveEffectiveDataDir`, `loadConfig`, `resolveConfigPath` from `../config`; `RuntimeError` from `../errors`.
- Produces:
  - `store.ts`: `withState<T>(ctx: CliContext, flags: { dataDir?: string }, fn: (state: AppState, store: AppStateStore) => T): T` — resolves the data dir (contract-compliant), opens the store, loads state (throws `RuntimeError` "No Portiq data found" when null), runs `fn`, and always `close()`s. Also `withStateAsync` for async commands.
  - `ls.ts`: `lsCommand: CommandModule` — `portiq ls [kind]` where kind ∈ `collections|requests|envs|flows` (default `collections`); emits a `table` output.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/ls.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { lsCommand } from "./ls";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
    { type: "request", id: "r2", name: "Flow", description: "", tags: [], protocol: "dag", method: "GET", url: "", dagGraph: { version: 2, nodes: [], edges: [], positions: {} } },
  ] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-ls-"));
  const s = openAppStateStore({ dataDir: dir });
  s.save(seed());
  s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const program = buildProgram(ctx, [lsCommand]);
  return program.parseAsync(args, { from: "user" }).then(() => buf);
}

describe("ls command", () => {
  it("lists requests with paths (json)", async () => {
    const parsed = JSON.parse(await run(["ls", "requests", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows.some((r: string[]) => r[0] === "API/List")).toBe(true);
  });
  it("lists only flows", async () => {
    const parsed = JSON.parse(await run(["ls", "flows", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][0]).toBe("API/Flow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3` (ensure plain-Node ABI for the store)
Run: `npm test -- packages/cli/src/commands/ls.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/store.ts`**

```ts
import { openAppStateStore, type AppState, type AppStateStore } from "@portiq/core";
import type { CliContext } from "../context";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";
import { RuntimeError } from "../errors";

function open(ctx: CliContext, flags: { dataDir?: string }): { store: AppStateStore; state: AppState } {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  const store = openAppStateStore({ dataDir });
  const { state } = store.load();
  if (!state) {
    store.close();
    throw new RuntimeError(`No Portiq data found at ${dataDir}. Run the desktop app or import a collection first.`);
  }
  return { store, state };
}

export function withState<T>(ctx: CliContext, flags: { dataDir?: string }, fn: (state: AppState, store: AppStateStore) => T): T {
  const { store, state } = open(ctx, flags);
  try {
    return fn(state, store);
  } finally {
    store.close();
  }
}

export async function withStateAsync<T>(
  ctx: CliContext,
  flags: { dataDir?: string },
  fn: (state: AppState, store: AppStateStore) => Promise<T>
): Promise<T> {
  const { store, state } = open(ctx, flags);
  try {
    return await fn(state, store);
  } finally {
    store.close();
  }
}
```

- [ ] **Step 4: Implement `packages/cli/src/commands/ls.ts`**

```ts
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { listRequestsWithPaths, isFlow } from "../resolve/refs";
import { UsageError } from "../errors";
import { emit } from "./emit";
import { withState } from "./store";
import type { CommandOutput } from "../reporters";

const KINDS = new Set(["collections", "requests", "envs", "flows"]);

export const lsCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("ls [kind]")
      .description("list collections | requests | envs | flows")
      .action((kind: string | undefined, _o, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const which = kind ?? "collections";
        if (!KINDS.has(which)) throw new UsageError(`Unknown ls kind "${which}" (allowed: ${[...KINDS].join(", ")})`);
        const output = withState(ctx, flags, (state): CommandOutput => {
          if (which === "collections") {
            return { kind: "table", columns: ["id", "name", "requests"], rows: (state.collections ?? []).map((c) => [c.id, c.name, String(listRequestsWithPaths({ ...state, collections: [c] }).length)]) };
          }
          if (which === "envs") {
            return { kind: "table", columns: ["id", "name", "vars"], rows: (state.environments ?? []).map((e) => [e.id, e.name, String(e.vars?.length ?? 0)]) };
          }
          const reqs = listRequestsWithPaths(state).filter((r) => (which === "flows" ? isFlow(r.item) : true));
          return { kind: "table", columns: ["path", "protocol", "method", "url"], rows: reqs.map((r) => [r.path, r.item.protocol, r.item.method, r.item.url]) };
        });
        emit(ctx, flags, output);
      });
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/ls.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/store.ts packages/cli/src/commands/ls.ts packages/cli/src/commands/ls.test.ts
git commit -m "feat(cli): store-open helper + ls command"
```

---

## Task 12: `get` command

**Files:**
- Create: `packages/cli/src/commands/get.ts`
- Create: `packages/cli/src/commands/get.test.ts`

**Interfaces:**
- Consumes: `resolveRef` from `../resolve/refs`; `withState` from `./store`; `parseGlobalFlags`, `CommandModule` from `../registry`; `emit` from `./emit`.
- Produces: `getCommand: CommandModule` — `portiq get <ref>` (or `--id <uuid>`) → emits an `entity` output describing the resolved request/collection/environment/flow (id, name, path, kind, and protocol-relevant fields).

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/get.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { getCommand } from "./get";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/list" },
  ] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-get-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(seed()); s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [getCommand]).parseAsync(args, { from: "user" }).then(() => buf);
}

describe("get command", () => {
  it("inspects a request by path", async () => {
    const parsed = JSON.parse(await run(["get", "API/List", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.entity.kind).toBe("request");
    expect(parsed.entity.method).toBe("GET");
    expect(parsed.entity.url).toBe("https://x/list");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/get.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/get.ts`**

```ts
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";
import type { CommandOutput } from "../reporters";

export const getCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("get <ref>")
      .description("inspect a resolved request, collection, environment, or flow")
      .option("--id <uuid>", "resolve by id instead of path")
      .action((ref: string, opts: { id?: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state): CommandOutput => {
          const r = resolveRef(state, { ref, id: opts.id });
          if (r.kind === "collection" && r.collection) {
            return { kind: "entity", entity: { kind: "collection", id: r.collection.id, name: r.collection.name, path: r.path } };
          }
          if (r.kind === "environment" && r.environment) {
            return { kind: "entity", entity: { kind: "environment", id: r.environment.id, name: r.environment.name, vars: r.environment.vars?.map((v) => v.key) ?? [] } };
          }
          const req = r.request!;
          return { kind: "entity", entity: { kind: r.kind, id: req.id, name: req.name, path: r.path, protocol: req.protocol, method: req.method, url: req.url, headers: req.headersRows ?? [], bodyType: req.bodyType ?? "none" } };
        });
        emit(ctx, flags, output);
      });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/get.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/get.ts packages/cli/src/commands/get.test.ts
git commit -m "feat(cli): get command to inspect a resolved reference"
```

---

## Task 13: `search` command (fuzzy, via fuse.js)

**Files:**
- Create: `packages/cli/src/commands/search.ts`
- Create: `packages/cli/src/commands/search.test.ts`

**Interfaces:**
- Consumes: `Fuse` from `fuse.js`; `listRequestsWithPaths` from `../resolve/refs`; `withState` from `./store`; `parseGlobalFlags`, `CommandModule` from `../registry`; `emit` from `./emit`.
- Produces: `searchCommand: CommandModule` — `portiq search <query>` fuzzy-matches request `path`/`name`/`url` (and collection/env names), emitting a ranked `table` output (`path`, `protocol`, `method`, `url`). Core has no search module, so the CLI owns the index.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/search.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { searchCommand } from "./search";
import type { CliContext } from "../context";

let dir: string;
const seed = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "List Users", description: "", tags: [], protocol: "http", method: "GET", url: "https://x/users" },
    { type: "request", id: "r2", name: "Create Order", description: "", tags: [], protocol: "http", method: "POST", url: "https://x/orders" },
  ] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-search-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(seed()); s.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<string> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [searchCommand]).parseAsync(args, { from: "user" }).then(() => buf);
}

describe("search command", () => {
  it("ranks fuzzy matches for the query", async () => {
    const parsed = JSON.parse(await run(["search", "users", "--data-dir", dir, "--reporter", "json"]));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows[0][0]).toBe("API/List Users");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/search.ts`**

```ts
import Fuse from "fuse.js";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { listRequestsWithPaths, type RequestWithPath } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";

export const searchCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("search <query>")
      .description("fuzzy-search the library")
      .action((query: string, _o, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state) => {
          const items = listRequestsWithPaths(state);
          const fuse = new Fuse<RequestWithPath>(items, {
            includeScore: true,
            threshold: 0.4,
            keys: [
              { name: "path", weight: 0.5 },
              { name: "item.name", weight: 0.3 },
              { name: "item.url", weight: 0.2 },
            ],
          });
          const hits = fuse.search(query).map((h) => h.item);
          return {
            kind: "table" as const,
            columns: ["path", "protocol", "method", "url"],
            rows: hits.map((r) => [r.path, r.item.protocol, r.item.method, r.item.url]),
          };
        });
        emit(ctx, flags, output);
      });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/search.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/search.ts packages/cli/src/commands/search.test.ts
git commit -m "feat(cli): fuzzy search command backed by fuse.js"
```

---

## Task 14: `exec` command (ad-hoc: curl-like flags or `--from-curl`)

**Files:**
- Create: `packages/cli/src/commands/exec.ts`
- Create: `packages/cli/src/commands/exec.test.ts`

**Interfaces:**
- Consumes: `parseCurl`, `RequestItem`, `RequestRow` from `@portiq/core`; `resolveHttpPayload`, `ResolvableRequest` from `../resolve/httpPayload`; `runRequest`, `defaultRunDeps`, `RunDeps` from `../exec/runRequest`; `resolveVars` from `../resolve/refs`; `withState`, `withStateAsync` from `./store`; `parseGlobalFlags`, `CommandModule` from `../registry`; `emit` from `./emit`; `UsageError` from `../errors`.
- Produces: `execCommand: CommandModule` — `portiq exec [url]` with `-X/--method`, `-H/--header <h>` (repeatable), `-d/--data <body>`, `--from-curl <command>`; builds a `ResolvableRequest` (from flags or `parseCurl`), resolves vars from the store (or empty when no store/`--data-dir`), and runs it ad-hoc (no saved tests). `--dry-run` emits the resolved request without sending. Exports `buildExecRequest(opts): ResolvableRequest` for unit testing.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/exec.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildExecRequest } from "./exec";

describe("buildExecRequest", () => {
  it("builds from curl-like flags", () => {
    const req = buildExecRequest({ url: "https://x/", method: "POST", header: ["Accept: application/json"], data: '{"a":1}' });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://x/");
    expect(req.headersRows?.[0]).toEqual({ key: "Accept", value: "application/json", comment: "", enabled: true });
    expect(req.bodyType).toBe("raw");
    expect(req.bodyText).toBe('{"a":1}');
  });

  it("defaults to POST when data is present without an explicit method", () => {
    expect(buildExecRequest({ url: "https://x/", header: [], data: "x=1" }).method).toBe("POST");
  });

  it("parses --from-curl", () => {
    const req = buildExecRequest({ header: [], fromCurl: "curl -X PUT https://x/items -H 'X-A: 1'" });
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://x/items");
    expect(req.headersRows?.some((r) => r.key === "X-A" && r.value === "1")).toBe(true);
  });

  it("throws UsageError when neither url nor --from-curl is given", () => {
    expect(() => buildExecRequest({ header: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/exec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/exec.ts`**

```ts
import { parseCurl, type RequestRow } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { type ResolvableRequest } from "../resolve/httpPayload";
import { resolveHttpPayload } from "../resolve/httpPayload";
import { runRequest, defaultRunDeps, type RunDeps } from "../exec/runRequest";
import { resolveVars } from "../resolve/refs";
import { withStateAsync } from "./store";
import { emit } from "./emit";
import { UsageError } from "../errors";
import type { CommandOutput } from "../reporters";
import type { AppState, RequestItem } from "@portiq/core";

export interface ExecOptions {
  url?: string;
  method?: string;
  header: string[];
  data?: string;
  fromCurl?: string;
}

function headerRows(headers: string[]): RequestRow[] {
  return headers.map((h) => {
    const idx = h.indexOf(":");
    const key = idx === -1 ? h.trim() : h.slice(0, idx).trim();
    const value = idx === -1 ? "" : h.slice(idx + 1).trim();
    return { key, value, comment: "", enabled: true };
  });
}

export function buildExecRequest(opts: ExecOptions): ResolvableRequest {
  if (opts.fromCurl) {
    const parsed = parseCurl(opts.fromCurl);
    return {
      protocol: "http", method: parsed.method, url: parsed.url,
      headersRows: parsed.headersRows, paramsRows: parsed.paramsRows,
      authType: parsed.authType, authConfig: parsed.authConfig,
      bodyType: parsed.bodyType, bodyText: parsed.bodyText, bodyRows: parsed.bodyRows,
    };
  }
  if (!opts.url) throw new UsageError("exec requires a <url> or --from-curl");
  const method = opts.method ? opts.method.toUpperCase() : opts.data !== undefined ? "POST" : "GET";
  return {
    protocol: "http", method, url: opts.url,
    headersRows: headerRows(opts.header),
    bodyType: opts.data !== undefined ? "raw" : "none",
    bodyText: opts.data,
  };
}

export const execCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("exec [url]")
      .description("send an ad-hoc request (curl-like flags or --from-curl); not saved")
      .option("-X, --method <method>", "HTTP method")
      .option("-H, --header <header>", "request header 'Key: Value' (repeatable)", (v: string, p: string[]) => p.concat([v]), [])
      .option("-d, --data <body>", "request body")
      .option("--from-curl <command>", "parse a curl command string")
      .action(async (url: string | undefined, opts: Omit<ExecOptions, "url">, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const req = buildExecRequest({ ...opts, url });
        const vars = safeResolveVars(ctx, flags);

        if (flags.dryRun) {
          const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
          emit(ctx, flags, { kind: "entity", entity: { ...view } } as CommandOutput);
          return;
        }

        const deps: RunDeps = defaultRunDeps();
        const item: RequestItem = { type: "request", id: "adhoc", name: "adhoc", description: "", tags: [], ...req } as RequestItem;
        const outcome = await runRequest(item, vars, deps, { timeoutMs: flags.timeout, runTests: false });
        emit(ctx, flags, { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: null });
        if (outcome.error) process.exitCode = 1;
      });
  },
};

function safeResolveVars(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  // exec works without a store; resolve vars best-effort.
  try {
    return withStateAsyncSync(ctx, flags);
  } catch {
    const vars: Record<string, string> = {};
    for (const pair of flags.var) {
      const idx = pair.indexOf("=");
      if (idx === -1) throw new UsageError(`Invalid --var "${pair}", expected key=value`);
      vars[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return vars;
  }
}

// Synchronous store read for var resolution (open+load+close are all sync in core).
function withStateAsyncSync(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  let result: Record<string, string> = {};
  // withStateAsync is async-only; use a synchronous open via the same helper path.
  // Import lazily to avoid a cycle at module load.
  const { withState } = require("./store") as typeof import("./store");
  result = withState(ctx, flags, (state: AppState) => resolveVars(state, flags));
  return result;
}
```

> **Note:** `exec` must not hard-fail when there is no store (ad-hoc use outside a Portiq install). `safeResolveVars` reads env vars from the store when present, otherwise falls back to `--var` overlays only. The `require("./store")` in `withStateAsyncSync` is intentional (avoids a static import cycle with `store.ts`); it resolves to the compiled CJS module. `withStateAsync` is imported at the top only to keep the symbol available for future async needs — if lint flags it as unused, drop the import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/exec.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/exec.ts packages/cli/src/commands/exec.test.ts
git commit -m "feat(cli): exec ad-hoc command with curl-like flags and --from-curl"
```

---

## Task 15: `run` command (saved request / collection / flow + tests)

**Files:**
- Create: `packages/cli/src/exec/runFlow.ts`
- Create: `packages/cli/src/commands/run.ts`
- Create: `packages/cli/src/commands/run.test.ts`

**Interfaces:**
- Consumes: `runFlow`, `savedRequestToConfig`, `RunDeps as FlowRunDeps`, `NodeStatus`, `StepsContext`, `DagGraph` from `@portiq/core/flows`; `HttpTransport`, `HttpResult`, `summarizeTests`, `TestEntry`, `RequestItem`, `AppState`, `Collection`, `FolderItem` from `@portiq/core`; `runRequest`, `defaultRunDeps` from `../exec/runRequest`; `resolveRef`, `resolveVars`, `listRequestsWithPaths` from `../resolve/refs`; `withStateAsync` from `./store`; `emit`, `parseGlobalFlags`, `CommandModule`; `TestFailureError` from `../errors`.
- Produces:
  - `runFlow.ts`: `runSavedFlow(item: RequestItem, allRequests: RequestItem[], vars: Record<string,string>, transport: HttpTransport, timeoutMs?: number): Promise<{ steps: StepsContext; tests: import("@portiq/core").TestSummary }>` — builds `lookupConfig` from saved requests via `savedRequestToConfig`, adapts `HttpTransport` into the flow `sendRequest` shape, collects node statuses, and maps them to a `TestSummary` via `summarizeTests`.
  - `run.ts`: `runCommand: CommandModule` — `portiq run <ref>` (or `--id`); dispatches request→`runRequest`, flow→`runSavedFlow`, collection→iterate + aggregate `suite`; honors `--dry-run` (resolve without sending) and `--fail-on-test` (throw `TestFailureError`→exit 2 when failures/errors exist).

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/run.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createServer, type Server } from "node:http";
import { openAppStateStore, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { runCommand } from "./run";
import type { CliContext } from "../context";

let dir: string;
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  dir = mkdtempSync(join(tmpdir(), "portiq-run-"));
  const seed: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/ping`, bodyType: "none",
        testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "r2", name: "Fail", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/x`, bodyType: "none",
        testsPostSteps: [{ id: "s2", name: "bad", script: "pm.test('is 500', () => pm.response.to.have.status(500));" }] },
    ] }],
    activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
  };
  const s = openAppStateStore({ dataDir: dir }); s.save(seed); s.close();
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

function run(args: string[]): Promise<{ out: string; code: number | undefined }> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const prev = process.exitCode;
  process.exitCode = undefined;
  return buildProgram(ctx, [runCommand]).parseAsync(args, { from: "user" })
    .then(() => ({ out: buf, code: process.exitCode }))
    .catch((e) => { throw e; })
    .finally(() => { const c = process.exitCode; process.exitCode = prev; void c; });
}

describe("run command", () => {
  it("runs a saved request and reports a passing test", async () => {
    const { out } = await run(["run", "API/Ping", "--data-dir", dir, "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("execution");
    expect(parsed.response.status).toBe(200);
    expect(parsed.tests.passed).toBe(1);
  });

  it("dry-run resolves without sending", async () => {
    const { out } = await run(["run", "API/Ping", "--data-dir", dir, "--dry-run", "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.response).toBeNull();
    expect(parsed.request.method).toBe("GET");
  });

  it("throws a test-failure error with --fail-on-test", async () => {
    await expect(run(["run", "API/Fail", "--data-dir", dir, "--fail-on-test", "--reporter", "json"])).rejects.toThrow(/test/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm rebuild better-sqlite3`
Run: `npm test -- packages/cli/src/commands/run.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/cli/src/exec/runFlow.ts`**

```ts
import { runFlow, savedRequestToConfig, type RequestConfig, type StepsContext } from "@portiq/core/flows";
import { HttpTransport, summarizeTests, type HttpResult, type RequestItem, type TestEntry, type TestSummary } from "@portiq/core";

export async function runSavedFlow(
  item: RequestItem,
  allRequests: RequestItem[],
  vars: Record<string, string>,
  transport: HttpTransport,
  timeoutMs?: number
): Promise<{ steps: StepsContext; tests: TestSummary }> {
  const graph = item.dagGraph;
  if (!graph) return { steps: {}, tests: summarizeTests([]) };

  const byId = new Map(allRequests.map((r) => [r.id, r]));
  const lookupConfig = (id: string): RequestConfig | undefined => {
    const req = byId.get(id);
    return req ? savedRequestToConfig(req) : undefined;
  };

  const statuses: Record<string, string> = {};
  const nodeName = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  const steps = await runFlow(graph, {
    env: vars,
    lookupConfig,
    sendRequest: async (payload) => {
      const res = await transport.send({ method: payload.method, url: payload.url, headers: payload.headers, body: payload.body, timeoutMs: payload.timeoutMs ?? timeoutMs, httpVersion: "auto" });
      if ("error" in res && (res as { status?: unknown }).status === undefined) return { status: 0, error: (res as { error: string }).error };
      const r = res as HttpResult;
      return { status: r.status, statusText: r.statusText, headers: r.headers, data: r.json ?? r.body, time: r.time };
    },
    onStatus: (id, status) => { statuses[id] = status; },
  });

  const entries: TestEntry[] = Object.entries(statuses).map(([id, status]) => ({
    type: status === "error" ? "fail" : status === "skipped" ? "info" : "pass",
    text: nodeName(id),
    label: "flow",
    group: "flow",
  }));
  return { steps, tests: summarizeTests(entries) };
}
```

- [ ] **Step 4: Implement `packages/cli/src/commands/run.ts`**

```ts
import { HttpTransport, type Collection, type FolderItem, type RequestItem, type TestSummary } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef, resolveVars, listRequestsWithPaths } from "../resolve/refs";
import { resolveHttpPayload } from "../resolve/httpPayload";
import { runRequest, defaultRunDeps } from "../exec/runRequest";
import { runSavedFlow } from "../exec/runFlow";
import { withStateAsync } from "./store";
import { emit } from "./emit";
import { TestFailureError } from "../errors";
import type { CommandOutput } from "../reporters";

function flatten(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const it of items) {
    if (it.type === "request") out.push(it);
    else if (it.type === "folder") flatten(it.items, out);
  }
}

function hasFailures(tests: TestSummary | null): boolean {
  return !!tests && tests.failed + tests.errored > 0;
}

export const runCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("run <ref>")
      .description("execute a saved request, collection, or flow and run its tests")
      .option("--id <uuid>", "resolve by id instead of path")
      .action(async (ref: string, opts: { id?: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const { output, failed } = await withStateAsync(ctx, flags, async (state) => {
          const resolved = resolveRef(state, { ref, id: opts.id });
          const vars = resolveVars(state, flags);
          const deps = defaultRunDeps();

          if (resolved.kind === "collection" && resolved.collection) {
            const reqs: RequestItem[] = [];
            flatten(resolved.collection.items ?? [], reqs);
            const items: Array<{ name: string; response: import("@portiq/core").HttpResult | null; error: string | null }> = [];
            const entries: import("@portiq/core").TestEntry[] = [];
            for (const r of reqs.filter((x) => x.protocol !== "dag" && x.protocol !== "websocket" && x.protocol !== "grpc")) {
              const outcome = await runRequest(r, vars, deps, { timeoutMs: flags.timeout });
              items.push({ name: r.name, response: outcome.response, error: outcome.error });
              if (outcome.tests) for (const g of outcome.tests.groups) entries.push(...g.entries);
            }
            const { summarizeTests } = await import("@portiq/core");
            const tests = summarizeTests(entries);
            const output: CommandOutput = { kind: "suite", label: resolved.collection.name, items, tests };
            return { output, failed: hasFailures(tests) };
          }

          if (resolved.kind === "flow" && resolved.request) {
            if (flags.dryRun) {
              const output: CommandOutput = { kind: "entity", entity: { kind: "flow", name: resolved.request.name, nodes: resolved.request.dagGraph?.nodes.map((n) => n.name) ?? [] } };
              return { output, failed: false };
            }
            const all = listRequestsWithPaths(state).map((r) => r.item);
            const transport = new HttpTransport();
            const { steps, tests } = await runSavedFlow(resolved.request, all, vars, transport, flags.timeout);
            const output: CommandOutput = { kind: "execution", request: { protocol: "dag", method: "FLOW", url: resolved.request.name, headers: {} }, response: null, error: null, tests, steps };
            return { output, failed: hasFailures(tests) };
          }

          // single request
          const req = resolved.request!;
          if (flags.dryRun) {
            const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
            const output: CommandOutput = { kind: "execution", request: view, response: null, error: null, tests: null };
            return { output, failed: false };
          }
          const outcome = await runRequest(req, vars, deps, { timeoutMs: flags.timeout });
          const output: CommandOutput = { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: outcome.tests };
          if (outcome.error) process.exitCode = 1;
          return { output, failed: hasFailures(outcome.tests) };
        });

        emit(ctx, flags, output);
        if (failed && flags.failOnTest) {
          throw new TestFailureError("one or more tests failed");
        }
      });
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- packages/cli/src/commands/run.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/exec/runFlow.ts packages/cli/src/commands/run.ts packages/cli/src/commands/run.test.ts
git commit -m "feat(cli): run command for saved requests, collections, and flows"
```

---

## Task 16: `import` command (curl + portiq.json)

**Files:**
- Create: `packages/cli/src/commands/openStore.ts`
- Create: `packages/cli/src/commands/import.ts`
- Create: `packages/cli/src/commands/import.test.ts`

**Interfaces:**
- Consumes: `openAppStateStore`, `importPortable`, `mergeIntoAppState`, `parseCurl`, `looksLikeCurl`, `inferRequestNameFromUrl`, `ConflictError`, `AppState`, `RequestItem` from `@portiq/core`; `resolveEffectiveDataDir`, `loadConfig`, `resolveConfigPath` from `../config`; `emit`, `parseGlobalFlags`, `CommandModule`; `UsageError`, `RuntimeError` from `../errors`.
- Produces:
  - `openStore.ts`: `openStoreForWrite(ctx, flags): AppStateStore` — resolves the data dir (contract) and opens the store for read+write. (Distinct from `store.ts`'s read helper because writes need the returned handle + version.)
  - `import.ts`: `importCommand: CommandModule` — `portiq import <file>` with `--collection <name>` (target for curl imports, default `"Imported"`); auto-detects curl vs `portiq.json`, merges into `AppState`, and saves with **optimistic concurrency** (`save(next, version)`, retry once on `ConflictError`). Exports `parsedCurlToRequest(parsed, name): RequestItem`.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/import.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, exportPortable, type AppState } from "@portiq/core";
import { buildProgram } from "../registry";
import { importCommand } from "./import";
import type { CliContext } from "../context";

let dir: string;
const baseState = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portiq-import-"));
  const s = openAppStateStore({ dataDir: dir }); s.save(baseState()); s.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]): Promise<void> {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  return buildProgram(ctx, [importCommand]).parseAsync(args, { from: "user" }).then(() => undefined);
}

describe("import command", () => {
  it("imports a curl file into a target collection", async () => {
    const file = join(dir, "req.txt");
    writeFileSync(file, "curl -X POST https://x/users -H 'Accept: application/json' -d '{\"a\":1}'");
    await run(["import", file, "--collection", "Imported", "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    const imported = state!.collections.find((c) => c.name === "Imported");
    expect(imported).toBeTruthy();
    expect((imported!.items[0] as { method: string }).method).toBe("POST");
    s.close();
  });

  it("imports a portiq.json portable file (merge by id)", async () => {
    const portable = exportPortable({ ...baseState(), collections: [{ id: "c2", name: "Fromfile", items: [] }] });
    const file = join(dir, "lib.portiq.json");
    writeFileSync(file, JSON.stringify(portable));
    await run(["import", file, "--data-dir", dir]);
    const s = openAppStateStore({ dataDir: dir });
    const { state } = s.load();
    expect(state!.collections.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    s.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm rebuild better-sqlite3`
Run: `npm test -- packages/cli/src/commands/import.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/openStore.ts`**

```ts
import { openAppStateStore, type AppStateStore } from "@portiq/core";
import type { CliContext } from "../context";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";

export function openStoreForWrite(ctx: CliContext, flags: { dataDir?: string }): AppStateStore {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  return openAppStateStore({ dataDir });
}
```

- [ ] **Step 4: Implement `packages/cli/src/commands/import.ts`**

```ts
import { readFileSync } from "node:fs";
import {
  ConflictError, importPortable, inferRequestNameFromUrl, looksLikeCurl, mergeIntoAppState, parseCurl,
  type AppState, type ParsedCurl, type RequestItem,
} from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { emit } from "./emit";
import { openStoreForWrite } from "./openStore";
import { RuntimeError, UsageError } from "../errors";

let counter = 0;
function newId(): string {
  counter += 1;
  return `imported-${Date.now()}-${counter}`;
}

export function parsedCurlToRequest(parsed: ParsedCurl, name: string): RequestItem {
  return {
    type: "request", id: newId(), name, description: "", tags: [], protocol: "http",
    method: parsed.method, url: parsed.url,
    headersRows: parsed.headersRows, paramsRows: parsed.paramsRows,
    authType: parsed.authType, authConfig: parsed.authConfig,
    bodyType: parsed.bodyType, bodyText: parsed.bodyText, bodyRows: parsed.bodyRows,
  };
}

function applyImport(state: AppState, contents: string, collectionName: string): { state: AppState; summary: string } {
  if (looksLikeCurl(contents)) {
    const parsed = parseCurl(contents.trim());
    const req = parsedCurlToRequest(parsed, inferRequestNameFromUrl(parsed.url));
    const collections = [...(state.collections ?? [])];
    let target = collections.find((c) => c.name === collectionName);
    if (!target) {
      target = { id: newId(), name: collectionName, items: [] };
      collections.push(target);
    }
    target.items = [...target.items, req];
    return { state: { ...state, collections }, summary: `imported curl request "${req.name}" into "${collectionName}"` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new UsageError("File is neither a curl command nor valid JSON");
  }
  const incoming = importPortable(parsed);
  return {
    state: mergeIntoAppState(state, incoming),
    summary: `merged ${incoming.collections.length} collection(s), ${incoming.environments.length} environment(s)`,
  };
}

export const importCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("import <file>")
      .description("import a curl command or a portiq.json portable file")
      .option("--collection <name>", "target collection for curl imports", "Imported")
      .action((file: string, opts: { collection: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const contents = readFileSync(file, "utf8");
        const store = openStoreForWrite(ctx, flags);
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const { state, version } = store.load();
            if (!state) throw new RuntimeError("No Portiq data found to import into");
            const { state: next, summary } = applyImport(state, contents, opts.collection);
            try {
              store.save(next, version);
              emit(ctx, flags, { kind: "message", text: summary });
              return;
            } catch (err) {
              if (err instanceof ConflictError && attempt === 0) continue;
              throw err;
            }
          }
        } finally {
          store.close();
        }
      });
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- packages/cli/src/commands/import.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/openStore.ts packages/cli/src/commands/import.ts packages/cli/src/commands/import.test.ts
git commit -m "feat(cli): import curl + portiq.json with optimistic-concurrency writes"
```

---

## Task 17: `export` command (curl + portiq.json)

**Files:**
- Create: `packages/cli/src/exec/toCurl.ts`
- Create: `packages/cli/src/commands/export.ts`
- Create: `packages/cli/src/commands/export.test.ts`

**Interfaces:**
- Consumes: `exportPortable`, `RequestItem`, `AppState`, `AuthConfig`, `RequestRow` from `@portiq/core`; `resolveRef` from `../resolve/refs`; `withState` from `./store`; `emit`, `parseGlobalFlags`, `CommandModule`; `UsageError` from `../errors`.
- Produces:
  - `toCurl.ts`: `requestItemToCurl(item: RequestItem): string` — emits `curl -X METHOD url` with params, `-H` headers (incl. compiled auth), and `-d`/`-F` body; keeps `{{templates}}` verbatim (no interpolation).
  - `export.ts`: `exportCommand: CommandModule` — `portiq export <ref>` with `--format curl|portiq` (default `portiq`); curl requires a request/flow ref, portiq exports the resolved collection (or the whole library when ref omitted via `--all`). Writes to stdout or `-o`.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/export.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { requestItemToCurl } from "../exec/toCurl";
import type { RequestItem } from "@portiq/core";

const req: RequestItem = {
  type: "request", id: "r1", name: "Create", description: "", tags: [], protocol: "http",
  method: "POST", url: "https://x/users",
  headersRows: [{ key: "Accept", value: "application/json", comment: "", enabled: true }],
  authType: "bearer",
  authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
  paramsRows: [{ key: "page", value: "2", comment: "", enabled: true }],
  bodyType: "json", bodyText: '{"a":1}',
};

describe("requestItemToCurl", () => {
  it("emits method, url with params, headers, auth, and body verbatim", () => {
    const curl = requestItemToCurl(req);
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("https://x/users?page=2");
    expect(curl).toContain("-H 'Accept: application/json'");
    expect(curl).toContain("-H 'Authorization: Bearer {{token}}'");
    expect(curl).toContain(`-d '{"a":1}'`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/exec/toCurl.ts`**

```ts
import type { AuthConfig, RequestItem, RequestRow } from "@portiq/core";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function authHeader(type: string | undefined, cfg: AuthConfig | undefined): [string, string] | null {
  if (!type || type === "none" || !cfg) return null;
  if (type === "bearer" && cfg.bearer?.token) return ["Authorization", `Bearer ${cfg.bearer.token}`];
  if (type === "basic" && (cfg.basic?.username || cfg.basic?.password)) {
    return ["Authorization", `Basic ${Buffer.from(`${cfg.basic.username}:${cfg.basic.password}`).toString("base64")}`];
  }
  if (type === "api_key" && cfg.api_key?.add_to === "header" && cfg.api_key?.key) return [cfg.api_key.key, cfg.api_key.value];
  return null;
}

function urlWithParams(item: RequestItem): string {
  const rows: RequestRow[] = [...(item.paramsRows ?? [])];
  if (item.authType === "api_key" && item.authConfig?.api_key?.add_to === "query" && item.authConfig.api_key.key) {
    rows.push({ key: item.authConfig.api_key.key, value: item.authConfig.api_key.value, comment: "", enabled: true });
  }
  const qs = rows
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value || "")}`)
    .join("&");
  if (!qs) return item.url;
  return item.url.includes("?") ? `${item.url}&${qs}` : `${item.url}?${qs}`;
}

export function requestItemToCurl(item: RequestItem): string {
  const parts: string[] = [`curl -X ${(item.method || "GET").toUpperCase()}`, shellQuote(urlWithParams(item))];
  const headers: Array<[string, string]> = (item.headersRows ?? [])
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => [r.key, r.value] as [string, string]);
  const auth = authHeader(item.authType, item.authConfig);
  if (auth) headers.unshift(auth);
  for (const [k, v] of headers) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);

  const bodyType = item.bodyType ?? "none";
  if (bodyType === "json" || bodyType === "xml" || bodyType === "raw") {
    if (item.bodyText) parts.push(`-d ${shellQuote(item.bodyText)}`);
  } else if (bodyType === "form") {
    const data = (item.bodyRows ?? [])
      .filter((r) => r.key && r.enabled !== false)
      .map((r) => `${r.key}=${r.value}`)
      .join("&");
    if (data) parts.push(`-d ${shellQuote(data)}`);
  } else if (bodyType === "multipart") {
    for (const r of (item.bodyRows ?? []).filter((r) => r.key && r.enabled !== false)) {
      parts.push(`-F ${shellQuote(r.kind === "file" ? `${r.key}=@${r.fileName || "upload.bin"}` : `${r.key}=${r.value}`)}`);
    }
  }
  return parts.join(" ");
}
```

- [ ] **Step 4: Implement `packages/cli/src/commands/export.ts`**

```ts
import { exportPortable, type AppState } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef } from "../resolve/refs";
import { requestItemToCurl } from "../exec/toCurl";
import { emit } from "./emit";
import { withState } from "./store";
import { UsageError } from "../errors";
import type { CommandOutput } from "../reporters";

export const exportCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("export [ref]")
      .description("export a request as curl, or a collection/library as portiq.json")
      .option("--format <format>", "curl | portiq", "portiq")
      .option("--id <uuid>", "resolve by id instead of path")
      .option("--all", "export the entire library (portiq format only)")
      .action((ref: string | undefined, opts: { format: string; id?: string; all?: boolean }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state): CommandOutput => {
          if (opts.format === "curl") {
            if (!ref && !opts.id) throw new UsageError("curl export requires a request <ref> or --id");
            const r = resolveRef(state, { ref, id: opts.id });
            if (!r.request) throw new UsageError("curl export target must be a request");
            return { kind: "message", text: requestItemToCurl(r.request) };
          }
          if (opts.format !== "portiq") throw new UsageError(`Unknown --format "${opts.format}" (allowed: curl, portiq)`);
          let slice: AppState = state;
          if (!opts.all) {
            if (!ref && !opts.id) throw new UsageError("portiq export requires a collection <ref>, --id, or --all");
            const r = resolveRef(state, { ref, id: opts.id });
            if (!r.collection) throw new UsageError("portiq export target must be a collection (or pass --all)");
            slice = { ...state, collections: [r.collection], environments: [] };
          }
          const portable = exportPortable(slice, { exportedAt: new Date(ctx.now()).toISOString() });
          return { kind: "message", text: JSON.stringify(portable, null, 2) };
        });
        emit(ctx, flags, output);
      });
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/export.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/exec/toCurl.ts packages/cli/src/commands/export.ts packages/cli/src/commands/export.test.ts
git commit -m "feat(cli): export requests as curl and collections/library as portiq.json"
```

---

## Task 18: `mcp` passthrough command (spawns `portiq-mcp`)

> **Dependency:** this command only *launches* the `portiq-mcp` binary provided by the separate `@portiq/mcp` package (Phase 1). The CLI does not implement MCP; it is a thin passthrough. When `portiq-mcp` is not installed, it prints a clear install hint.

**Files:**
- Create: `packages/cli/src/commands/mcp.ts`
- Create: `packages/cli/src/commands/mcp.test.ts`

**Interfaces:**
- Consumes: `spawn` from `node:child_process`; `parseGlobalFlags`, `CommandModule` from `../registry`; `CliContext`.
- Produces: `interface McpSpawner { (command: string, args: string[], opts: { stdio: "inherit"; env: NodeJS.ProcessEnv }): { on(event: "error" | "exit", cb: (arg: unknown) => void): void } }`; `mcpCommand(spawner?: McpSpawner): CommandModule` — `portiq mcp [args...]` forwards args + stdio to `portiq-mcp`; on `ENOENT` prints an install hint and sets exit code 1.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/mcp.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { buildProgram } from "../registry";
import { mcpCommand, type McpSpawner } from "./mcp";
import type { CliContext } from "../context";

describe("mcp command", () => {
  it("spawns portiq-mcp with forwarded args and inherited stdio", async () => {
    let captured: { command: string; args: string[] } | null = null;
    const spawner: McpSpawner = (command, args) => {
      captured = { command, args };
      return { on: (event, cb) => { if (event === "exit") setImmediate(() => cb(0)); } };
    };
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
    await buildProgram(ctx, [mcpCommand(spawner)]).parseAsync(["mcp", "--allow-writes"], { from: "user" });
    expect(captured!.command).toBe("portiq-mcp");
    expect(captured!.args).toEqual(["--allow-writes"]);
  });

  it("prints an install hint when portiq-mcp is missing", async () => {
    let out = "";
    const spawner: McpSpawner = () => ({ on: (event, cb) => { if (event === "error") setImmediate(() => cb(Object.assign(new Error("nope"), { code: "ENOENT" }))); } });
    const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
    const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
    await buildProgram(ctx, [mcpCommand(spawner)]).parseAsync(["mcp"], { from: "user" });
    expect(out).toMatch(/portiq-mcp/);
    expect(out).toMatch(/@portiq\/mcp/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- packages/cli/src/commands/mcp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/mcp.ts`**

```ts
import { spawn as nodeSpawn } from "node:child_process";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";

export type McpSpawner = (
  command: string,
  args: string[],
  opts: { stdio: "inherit"; env: NodeJS.ProcessEnv }
) => { on(event: "error" | "exit", cb: (arg: unknown) => void): void };

const defaultSpawner: McpSpawner = (command, args, opts) => nodeSpawn(command, args, opts);

export function mcpCommand(spawner: McpSpawner = defaultSpawner): CommandModule {
  return {
    register(program: Command, ctx: CliContext) {
      program
        .command("mcp")
        .description("start the stdio MCP server (spawns the portiq-mcp binary from @portiq/mcp)")
        .allowUnknownOption(true)
        .helpOption(false)
        .argument("[args...]", "arguments forwarded to portiq-mcp")
        .action((args: string[], _opts, cmd: Command) => {
          void parseGlobalFlags(cmd);
          return new Promise<void>((resolve) => {
            const child = spawner("portiq-mcp", args ?? [], { stdio: "inherit", env: ctx.env });
            child.on("error", (err) => {
              const code = (err as { code?: string }).code;
              if (code === "ENOENT") {
                ctx.stdout.write("portiq-mcp is not installed. Install it with: npm i -g @portiq/mcp\n");
              } else {
                ctx.stdout.write(`Failed to launch portiq-mcp: ${(err as Error).message}\n`);
              }
              process.exitCode = 1;
              resolve();
            });
            child.on("exit", (codeArg) => {
              const code = typeof codeArg === "number" ? codeArg : 0;
              if (code) process.exitCode = code;
              resolve();
            });
          });
        });
    },
  };
}
```

> **Note:** `mcp` is registered as `mcpCommand()` (a factory) rather than a bare module so tests can inject a spawner. Parity commands (`mock`, `sync`, …) will likewise register additively via the registry with no edits to a switchboard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- packages/cli/src/commands/mcp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/mcp.ts packages/cli/src/commands/mcp.test.ts
git commit -m "feat(cli): mcp passthrough that spawns the portiq-mcp binary"
```

---

## Task 19: Entry wiring — built-in registry, `runCli`, and the bin

**Files:**
- Create: `packages/cli/src/commands/index.ts`
- Create: `packages/cli/src/run.ts`
- Create: `packages/cli/src/run.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: all command modules; `buildProgram`, `CommandModule`; `CliContext`, `defaultContext`; `toExitCode`, `UsageError`, `EXIT` from `../errors`.
- Produces:
  - `commands/index.ts`: `builtinCommands: CommandModule[]` (the built-in list; parity plans append to a copy, never edit this file's callers of a switch).
  - `run.ts`: `runCli(ctx: CliContext, extra?: CommandModule[]): Promise<number>` — builds the program with `[...builtinCommands, ...extra]`, `parseAsync`es `ctx.argv`, returns `0` on success, maps commander help/version to `0`, commander usage failures to `EXIT.USAGE`, and typed errors via `toExitCode` (writing the message to `ctx.stderr`).
  - `index.ts`: bin entry calls `runCli(defaultContext())` and sets `process.exitCode`.

- [ ] **Step 1: Write the failing test `packages/cli/src/run.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { runCli } from "./run";
import type { CliContext } from "./context";

function ctxFor(argv: string[]): { ctx: CliContext; err: () => string; out: () => string } {
  let e = "", o = "";
  const errSink = new Writable({ write(c, _en, cb) { e += c.toString(); cb(); } });
  const outSink = new Writable({ write(c, _en, cb) { o += c.toString(); cb(); } });
  return { ctx: { argv, env: {}, cwd: "/", stdout: outSink, stderr: errSink, isTTY: false, now: () => 0 }, err: () => e, out: () => o };
}

describe("runCli", () => {
  it("returns 3 (usage) for an unknown command", async () => {
    const { ctx } = ctxFor(["totally-unknown"]);
    expect(await runCli(ctx)).toBe(3);
  });

  it("returns 3 (usage) when a required ref is missing for get", async () => {
    const { ctx } = ctxFor(["get"]);
    expect(await runCli(ctx)).toBe(3);
  });

  it("returns 0 for --version", async () => {
    const { ctx } = ctxFor(["--version"]);
    expect(await runCli(ctx)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- packages/cli/src/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/index.ts`**

```ts
import type { CommandModule } from "../registry";
import { whereCommand } from "./where";
import { configCommand } from "./config";
import { lsCommand } from "./ls";
import { getCommand } from "./get";
import { searchCommand } from "./search";
import { execCommand } from "./exec";
import { runCommand } from "./run";
import { importCommand } from "./import";
import { exportCommand } from "./export";
import { mcpCommand } from "./mcp";

export const builtinCommands: CommandModule[] = [
  lsCommand,
  getCommand,
  searchCommand,
  runCommand,
  execCommand,
  importCommand,
  exportCommand,
  whereCommand,
  configCommand,
  mcpCommand(),
];
```

- [ ] **Step 4: Implement `packages/cli/src/run.ts`**

```ts
import { CommanderError } from "commander";
import type { CliContext } from "./context";
import { buildProgram, type CommandModule } from "./registry";
import { builtinCommands } from "./commands";
import { EXIT, UsageError, toExitCode } from "./errors";

const SUCCESS_CODES = new Set(["commander.helpDisplayed", "commander.version", "commander.help"]);

export async function runCli(ctx: CliContext, extra: CommandModule[] = []): Promise<number> {
  const program = buildProgram(ctx, [...builtinCommands, ...extra]);
  try {
    await program.parseAsync(ctx.argv, { from: "user" });
    return process.exitCode ? Number(process.exitCode) : EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (SUCCESS_CODES.has(err.code)) return EXIT.SUCCESS;
      ctx.stderr.write(`${err.message}\n`);
      return EXIT.USAGE;
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.stderr.write(`${err instanceof UsageError ? "usage error" : "error"}: ${message}\n`);
    return toExitCode(err);
  }
}
```

- [ ] **Step 5: Replace `packages/cli/src/index.ts` with the real bin entry**

```ts
#!/usr/bin/env node
import { defaultContext } from "./context";
import { runCli } from "./run";

runCli(defaultContext())
  .then((code) => { process.exitCode = code; })
  .catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exitCode = 1; });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- packages/cli/src/run.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/index.ts packages/cli/src/run.ts packages/cli/src/run.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): built-in command registry, runCli dispatch, and bin entry"
```

---

## Task 20: CLI integration tests (built binary + mock server + exit codes)

**Files:**
- Create: `packages/cli/src/__integration__/cli.integration.test.ts`

**Interfaces:**
- Consumes: the built binary `packages/cli/dist/index.js`; `openAppStateStore` from `@portiq/core`; Node `child_process.execFile`, `http`.
- Produces: end-to-end coverage asserting exit codes (0/1/2/3) and reporter output from the real binary against a temp `--data-dir` and a local mock HTTP server. These are the spec-mandated CLI integration tests.

- [ ] **Step 1: Write the integration test `packages/cli/src/__integration__/cli.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { openAppStateStore, type AppState } from "@portiq/core";

const BIN = resolve(__dirname, "../../dist/index.js");
let dir: string;
let server: Server;
let port: number;

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile("node", [BIN, ...args], { env: { ...process.env } }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : 0;
      resolvePromise({ code, stdout, stderr });
    });
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;

  dir = mkdtempSync(join(tmpdir(), "portiq-cli-int-"));
  const seed: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/ping`, bodyType: "none",
        testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "r2", name: "Fail", description: "", tags: [], protocol: "http", method: "GET",
        url: `http://127.0.0.1:${port}/x`, bodyType: "none",
        testsPostSteps: [{ id: "s2", name: "bad", script: "pm.test('is 500', () => pm.response.to.have.status(500));" }] },
    ] }],
    activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
  };
  const s = openAppStateStore({ dataDir: dir }); s.save(seed); s.close();
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

describe("portiq CLI (built binary)", () => {
  it("ls requests exits 0 and prints json when piped", async () => {
    const { code, stdout } = await cli(["ls", "requests", "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).kind).toBe("table");
  });

  it("run of a passing request exits 0", async () => {
    const { code, stdout } = await cli(["run", "API/Ping", "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).tests.passed).toBe(1);
  });

  it("run --fail-on-test of a failing request exits 2", async () => {
    const { code } = await cli(["run", "API/Fail", "--data-dir", dir, "--fail-on-test"]);
    expect(code).toBe(2);
  });

  it("unknown command exits 3", async () => {
    const { code } = await cli(["frobnicate"]);
    expect(code).toBe(3);
  });

  it("exec against the mock server exits 0 and reports 200", async () => {
    const { code, stdout } = await cli(["exec", `http://127.0.0.1:${port}/echo`, "--data-dir", dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).response.status).toBe(200);
  });

  it("junit reporter emits a testsuites element", async () => {
    const { stdout } = await cli(["run", "API/Ping", "--data-dir", dir, "--reporter", "junit"]);
    expect(stdout).toContain("<testsuites");
  });
});
```

- [ ] **Step 2: Build core + CLI so the binary exists**

Run: `npm rebuild better-sqlite3` (the spawned binary runs on plain Node)
Run: `npm run build:core`
Run: `npm run build:cli`
Run: `node -e "require('fs').accessSync('packages/cli/dist/index.js'); console.log('cli bin present')"`
Expected: `cli bin present`.

- [ ] **Step 3: Run the integration tests**

Run: `npm test -- packages/cli/src/__integration__/cli.integration.test.ts`
Expected: PASS (6 tests). NOTE: if a run reports a `better-sqlite3` native-ABI error, the hoisted binary is on the Electron ABI — run `npm rebuild better-sqlite3` and rebuild.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/__integration__/cli.integration.test.ts
git commit -m "test(cli): integration tests over the built binary, mock server, exit codes"
```

---

## Task 21: Root script wiring, changeset, and final gates

**Files:**
- Modify: `package.json` (root — wire `build:cli` into `package*` scripts so releases build the bin)
- Create: `.changeset/portiq-cli-phase2.md`

**Interfaces:**
- Produces: `build:cli` runs wherever `build:core` runs for packaging; a changeset recording the new package.

- [ ] **Step 1: Wire `build:cli` into the packaging scripts**

In root `package.json`, for each `package*` script that currently starts with `npm run build:core && ...`, insert `npm run build:cli && ` immediately after `build:core`. For example change:

```json
    "package": "npm run build:core && vite build && electron-builder build --publish never",
```

to:

```json
    "package": "npm run build:core && npm run build:cli && vite build && electron-builder build --publish never",
```

Apply the same insertion to `package:desktop`, `package:mac`, `package:win`, `package:linux`, and `package:release`. (Do NOT add it to `predev`/`dev` — the desktop dev loop does not need the CLI bin, and building it there would need the plain-Node ABI while `dev` needs the Electron ABI.)

- [ ] **Step 2: Create the changeset `.changeset/portiq-cli-phase2.md`**

```markdown
---
"@portiq/cli": minor
---

Add the `portiq` CLI (`@portiq/cli`): ls/get/search/run/exec/import/export/where/config plus an `mcp` passthrough, with pretty/json/junit reporters and CI-friendly exit codes. Consumes `@portiq/core` read-only (including its canonical `assembleRequest` and the `./flows` `require`→`dist` mapping, both owned by Phase 0.5); the CLI makes no core edit, so no `@portiq/core` bump is needed here.
```

- [ ] **Step 3: Ensure the plain-Node ABI, then run the full suite**

Run: `npm rebuild better-sqlite3`
Run: `npm test`
Expected: the entire repo suite is green, including all new `packages/cli` unit + integration tests (224 prior + the new CLI tests).

- [ ] **Step 4: Lint and builds**

Run: `npm run lint`
Expected: 0 errors (warnings tolerated per the repo baseline).
Run: `npm run build:core && npm run build:cli`
Expected: both builds succeed; `packages/cli/dist/index.js` exists.

- [ ] **Step 5: Smoke the built bin**

Run: `node packages/cli/dist/index.js --help`
Expected: exit 0; usage text lists `ls`, `get`, `search`, `run`, `exec`, `import`, `export`, `where`, `config`, `mcp`.

- [ ] **Step 6: Restore the Electron ABI for desktop dev (courtesy note)**

Run: `npm run rebuild`
Expected: `better-sqlite3` returns to the Electron ABI so `npm run dev` works. (Any subsequent CLI test run needs `npm rebuild better-sqlite3` again — this Node↔Electron toggle is the known ABI constraint.)

- [ ] **Step 7: Commit**

```bash
git add package.json .changeset/portiq-cli-phase2.md
git commit -m "chore(cli): wire build:cli into packaging + add changeset"
```

---

## Self-Review (completed against the spec)

**1. Spec coverage** — every CLI requirement in `docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md` ("CLI design (portiq)") maps to a task:
- `ls [collections|requests|envs|flows]` → Task 11. `get <ref>` → Task 12. `search <query>` → Task 13. `run <ref>` (request/collection/flow + tests) → Task 15. `exec ...` (curl-like + `--from-curl`, not saved) → Task 14. `import`/`export` (curl + portiq.json) → Tasks 16–17. `where`/`config` → Task 10. `mcp` thin passthrough → Task 18 (marked as depending on `@portiq/mcp`).
- Reference syntax path-style + `--id` → Task 6. Flags (`--env`, `--var` repeatable, `--data-dir`, `--reporter`, `-o/--output`, `--timeout`, `--fail-on-test`, `--dry-run`, `--no-color`) → global options in Task 7, consumed in 10–17. Exit codes 0/1/2/3 → Task 4 + verified end-to-end in Task 20. Reporters pretty/json/junit with TTY default → Task 5. Same core exec/scripting path → Tasks 8–9/15 route through `HttpTransport`/`sendGraphQL`/`runSteps`/`runFlow`. CLI integration tests → Task 20.
- Global constraints: better-sqlite3 ABI (called out in Tasks 1, 11, 15, 16, 20, 21); data-location contract via `core.resolveDataDir` only (Task 3, never re-derived); additive registry (Task 7, extended additively in Task 19); TDD/DRY/YAGNI/frequent commits throughout.
- Out-of-scope respected: no `mock`/`sync`/gRPC/AI commands; those register additively later via `buildProgram(ctx, extra)`.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle edge cases"/"similar to Task N": every code step contains complete, runnable code; every run step has an exact command and expected result.

**3. Type consistency** — cross-task names verified against the real `@portiq/core` API and against each other: `CliContext`, `GlobalFlags`, `CommandModule`/`buildProgram`/`parseGlobalFlags`, `CommandOutput`/`Reporter`/`ExecRequestView`, `ResolvableRequest`/`resolveHttpPayload`, `RunOutcome`/`RunDeps`/`runRequest`/`defaultRunDeps`, `withState`/`withStateAsync`/`openStoreForWrite`, `resolveRef`/`resolveVars`/`listRequestsWithPaths`/`isFlow`, `UsageError`/`RuntimeError`/`TestFailureError`/`toExitCode`/`EXIT`, `emit`. Core names used (verified present): `openAppStateStore`, `resolveDataDir`/`resolveDbPath`, `exportPortable`/`importPortable`/`mergeIntoAppState`, `getEnvVars`/`interpolate`, `HttpTransport`/`HttpSendPayload`/`HttpResult`, `sendGraphQL`/`GraphQLSendPayload`, `runSteps`/`summarizeTests`/`TestSummary`/`TestEntry`, `parseCurl`/`looksLikeCurl`/`inferRequestNameFromUrl`/`ParsedCurl`, and from `@portiq/core/flows`: `runFlow`/`savedRequestToConfig`/`RequestConfig`/`StepsContext`/`NodeStatus`.

**Assumptions / open questions (for the coordinator):**
- **`--fail-on-test` semantics:** test failures report but exit `0` by default; only `--fail-on-test` makes them exit `2`. Transport/runtime errors always exit `1`. (Chosen for CI ergonomics; flag it if the desired default is non-zero-on-failure.)
- **Request assembly now lives in `@portiq/core`** as the canonical `assembleRequest` (extracted by Phase 0.5). Task 8 collapses to a thin wrapper over it (`resolveHttpPayload`), so desktop, CLI, and MCP share one assembler; the CLI no longer mirrors `src/App.tsx`.
- **No sanctioned core touch:** the `require`→`dist` mapping on `@portiq/core`'s `./flows` export is owned by Phase 0.5 (Part B), so Task 2 is verify-only and the CLI makes zero core edits. Phase 0.5 is therefore a prerequisite for `run <flow>` and `exec`.
- **`websocket`/`grpc` requests** are rejected by `run`/`exec` with a `RuntimeError` (interactive/experimental; out of Phase 2 parity scope).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase2-portiq-cli.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — execute tasks in this session with batch checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

Which approach?
