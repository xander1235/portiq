# Phase 3 (Parity) — Git-based Sync `@portiq/core/sync` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Portiq's GitHub-backed sync (`src/services/githubSync.ts`) and its credential sourcing (`src/services/githubAuth.ts`) into a framework-free, self-registering `@portiq/core/sync` module, add a headless credential path, add `portiq sync push|pull|status` CLI subcommands (additive), and rewire the renderer seam to delegate to core — all with no UI behavior change.

**Architecture:** The sync logic splits into three layers. (1) **Pure serialization/secrets** — the deterministic `appState`↔file-tree transforms and the `__PORTIQ_SECRET__:` sanitize/restore logic, moved verbatim into core with zero I/O. (2) A **`SyncRemote` port** (4 methods: `getIdentity`, `ensureRepo`, `fetchWorkspace`, `pushFiles`) with two implementations that self-register into a `SyncRemoteRegistry`: `github` (wraps `@octokit/rest`, preserves current REST behavior incl. the 422 sha-retry and legacy-`state.json` fallback) and `local` (a real local/temp **git repository** used as the offline test/headless remote — no network). (3) An **engine** (`syncPush`/`syncPull`/`syncStatus`) that is remote-agnostic and, in its store-backed pull, writes the merged `appState` through the store's optimistic-concurrency path. The renderer's `githubSync.ts` becomes a thin adapter importing the pure logic + the `github` remote from `@portiq/core/sync`, keeping its own localStorage token + React-apply I/O so the desktop flow is byte-for-byte preserved.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (`node` env), `@octokit/rest@^22`, the system `git` CLI (via `node:child_process` `execFileSync`), `better-sqlite3` (via `@portiq/core` store), npm workspaces. Sync is distributed as **TS source** via the `@portiq/core` `"./sync"` `exports` subpath (mirrors the existing `./flows` subpath); consumers (renderer via Vite, CLI via its Phase-2 build) compile it.

## Global Constraints

- **Package boundaries (disjoint files):** all new core code lives under `packages/core/src/sync/**`; all new CLI code under `packages/cli/src/commands/sync.ts` (+ its test). The only shared files touched are additive edits to `packages/core/package.json` (deps + `./sync` export) and `packages/core/tsconfig.build.json` (exclude), and a delegation rewrite of `src/services/githubSync.ts`. Do not edit any shared dispatcher/switchboard.
- **Additive self-registration only:** remotes register into `SyncRemoteRegistry` by calling `registerSyncRemote(...)` at module load; CLI subcommands register into the assumed Phase-2 `commandRegistry` by calling `commandRegistry.register(...)`. Never edit a central `switch`/`if` chain.
- **Confirmed aligned with Phase 0.5 (Part C + Part D delta #11):** `SyncRemoteRegistry` (via `registerSyncRemote(...)`) is a legitimate per-domain registry — it has 2+ interchangeable implementations (`github`/`local`) behind the `SyncRemote` port, selected by string `id`, mirroring `ProtocolRegistry`. No change required. The `./sync` export stays **src-only** (no `require`/`dist` mapping) because `@octokit/rest` is ESM-only and `electron/main.cjs` never imports sync — consistent with Phase 0.5 Part B applying the CJS-`dist` condition per-subpath only where a CJS consumer exists.
- **No Electron/renderer imports in core:** nothing under `packages/core/src/sync/**` may import `electron`, `window.*`, `localStorage`, React, or `@octokit/rest` types leaking DOM globals. `btoa`/`atob` are Node 20 globals and are allowed (they are what the current code uses).
- **Data-location contract:** resolve storage only via `resolveDataDir()` / `openAppStateStore()` from `@portiq/core`; never re-derive a path. **Sync writes (the store-backed pull) MUST go through `AppStateStore.save(state, expectedVersion)` (optimistic concurrency via `setIfVersion`).**
- **better-sqlite3 ABI gotcha:** the hoisted native binary serves EITHER plain-Node (vitest/CLI) OR Electron, not both. Before running any test in this plan on plain-Node: `npm rebuild better-sqlite3`. To restore the desktop app afterward: `npm run rebuild`. The renderer-build verification (Task 11) uses `vite build` (no native binary) and is unaffected.
- **Preserve behavior verbatim:** exact string constants must not change — `SYNC_REPO_NAME = "portiq-sync"`, `WORKSPACE_ROOT = "workspace"`, `LEGACY_STATE_FILE = "state.json"`, `SECRET_PLACEHOLDER_PREFIX = "__PORTIQ_SECRET__:"` (legacy read-compat prefix `"__COMMU_SECRET__:"`), GitHub OAuth client id `"Ov23liWUpjkSkyaC3sBq"`, scope `"repo"`, token localStorage key `"ui_github_token"`. The workspace file-tree layout, managed-prefix sets, and the 422 sha-retry path must be preserved.
- **`./sync` is src-only:** do NOT add a `require`/CJS-`dist` mapping for the `./sync` export, and EXCLUDE `src/sync/**` from `tsconfig.build.json`. `@octokit/rest@22` is ESM-only; emitting a CJS `dist/sync` that `require()`s it would break, and the electron main process (which requires the CJS top barrel) never imports sync. This keeps the Phase-0 CJS `dist` byte-stable.
- Test convention (match repo): `import { describe, it, expect } from "vitest";` (add `vi`, `beforeEach`, `afterEach` as needed); import module under test by relative path; temp dirs via `mkdtempSync(join(tmpdir(), ...))` cleaned in `afterEach`; `describe` per function, `it` per behavior; inject clocks/deps for determinism.
- Commit after every task with a Conventional Commit message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Assumptions & explicit deviations (READ FIRST)

1. **Headless auth (the key decision).** The desktop flow uses an interactive **GitHub OAuth device-code** flow (`requestDeviceCode`/`pollForToken` in `src/services/githubAuth.ts`) that requires a human to open a browser and enter a code, plus a token cached in renderer `localStorage`. That interactive flow **cannot** run headlessly. **Decision:** the core headless path sources a **pre-existing token** (a PAT or a previously-obtained OAuth token) with precedence `--token` flag → `PORTIQ_GITHUB_TOKEN` env → `GITHUB_TOKEN` env → `<dataDir>/config.json` `.githubToken`. `resolveGitHubToken(opts)` in core implements this. **Explicit deviation:** the interactive device-code flow is NOT extracted to core; it remains a desktop-only convenience in `githubAuth.ts`. A headless `portiq sync login` (device flow printing the verification URL/code to stderr) is deliberately **out of scope** for this track (YAGNI); it can be added later without changing this module.

2. **"Git-based" is GitHub-REST today.** The current sync is not `git clone/push`; it is the GitHub REST API (Octokit) writing a file tree into a private `portiq-sync` repo. To satisfy both "preserve current behavior" and "test against a local/temp git repository (no network)", the module abstracts the remote behind a `SyncRemote` port. The `github` remote preserves the exact REST behavior; the `local` remote is a real local **git** repository used offline in tests (and available as a genuine offline sync backend). This is the deviation that reconciles the spec's "git sync" wording with the as-built REST implementation.

3. **`portiq sync status` is new.** There is no `status` in `githubSync.ts` today. It is defined here as a **read-only** diff of the locally-serialized `workspace/` tree against the remote tree (excluding `workspace/manifest.json`, whose `updatedAt` always differs). It performs no writes.

4. **CLI scaffold is assumed (Phase 2).** This track does NOT scaffold the CLI. It assumes Phase 2 already provides an additive command registry and context with this contract (documented in Task 12). If the real Phase-2 contract differs, only the thin registration shim in `packages/cli/src/commands/sync.ts` changes; the injectable handlers and their unit tests are contract-independent. The end-to-end CLI **integration** test is written but gated: run it only once the Phase-2 runner exists.

5. **Renderer persistence is unchanged.** The store-backed optimistic-concurrency write is the *headless/CLI* pull path. The renderer keeps writing via `window.api.saveState` + `localStorage` and applying to React state, so the desktop UI behavior does not change. Core is only the single source of truth for serialization/merge/secrets and for the `github` remote.

---

## Source-of-truth references (current code being extracted)

- `src/services/githubSync.ts` (824 lines). Constants `:5-8`. Octokit helpers: `getOctokit:25`, `ensureSyncRepo:31`, `getRepoTree:476`, `syncFiles:499` (incl. 422 sha-retry `:521-535` + stale-delete `:540-553`), `fetchWorkspaceData:620` (legacy fallback `:624-637`). Encode/slug: `encodeContent:55`, `decodeContent:59`, `slugify:63`. Secrets: `makeSecretPlaceholder:71`, `isSecretPlaceholder:75`, `parseSecretPlaceholder:79`, `isSensitiveKey:86`, `sanitizeSensitiveMap:90`, `sanitizeSensitiveRows:101`, `sanitizeSensitiveJsonText:113`, `sanitizeAuthConfig:123`, `sanitizeWsConfig:144`, `sanitizeGraphqlConfig:153`, `sanitizeRequestSecrets:161`, `restoreRowsWithLocalSecrets:175`, `restoreMapWithLocalSecrets:188`, `restoreJsonTextWithLocalSecrets:200`, `restoreAuthConfigWithLocalSecrets:211`, `restoreRequestSecrets:233`. Serialize: `previewMaskableVars:293`, `maskEnvironments:309`, `serializeCollectionItems:324`, `buildRequestLocationIndex:348`, `buildWorkspaceFiles:374`, `buildHistoryFiles:443`. Deserialize: `buildItemsFromFiles:556`, `buildRequestIndex:592`, `restoreCollectionItemsWithLocalSecrets:605`. Renderer I/O (STAYS in renderer): `getStorageJson:259`, `setStorageJson:269`, `getAppStateSnapshot:273`, `saveAppStateSnapshot:285`, `writeLegacyStateToStorage:651`, `writeWorkspaceStateToStorage:658`. Public API: `previewEnvironmentsForSync:697`, `pushStateToGitHub:703`, `pullStateFromGitHub:727`, `testGitHubConnection:800`, `pushHistoryToGitHub:806`.
- `src/services/githubAuth.ts` (82 lines). `GITHUB_TOKEN_KEY:3`, `GITHUB_CLIENT_ID:4`, `getGitHubToken:6`, `setGitHubToken:10`, `requestDeviceCode:18`, `pollForToken:35`.
- Consumers: `src/components/Modals/GitHubSyncModal.tsx` (imports both auth + sync APIs), `src/components/TableEditor.tsx:4` (`isSecretPlaceholder`, `parseSecretPlaceholder`).
- Core APIs to reuse (real signatures): `resolveDataDir(opts?): string` and `ResolveDataDirOptions { dataDir?; env?; platform?; home? }` (`packages/core/src/store/dataDir.ts`); `openAppStateStore(opts?, kv?): AppStateStore` with `load(): { state: AppState | null; version: number }` and `save(state, expectedVersion?): number` (`packages/core/src/store/appStateStore.ts`); `ConflictError` (`packages/core/src/store/kvStore.ts`); `toSteps(steps, legacyText?): ScriptStep[]` (`packages/core/src/scripting/scriptSteps.ts`); model types `AppState`, `Collection`, `Environment`, `RequestItem`, `HistoryEntry` (`packages/core/src/model`). `AppState` has an index signature `[key: string]: any`, so the flattened draft fields (`method`, `url`, `headersText`, …) that sync reads are typed-accessible.
- Config: `packages/core/package.json` (`exports` has `"."` and `"./flows"`; deps have `better-sqlite3`, `dagre`, `ws`; NO `@octokit/rest`). `packages/core/tsconfig.build.json` (`exclude: ["**/*.test.ts"]`). Root `package.json` scripts: `build:core`, `rebuild`, `test` (`vitest run`), `lint` (`eslint .`). `eslint.config.js` ignores `**/dist`.

---

## Task 1: Scaffold `sync/` module, `@octokit/rest` dep, `./sync` subpath, constants

**Files:**
- Modify: `packages/core/package.json` (add `@octokit/rest` dep; add `"./sync"` export)
- Modify: `packages/core/tsconfig.build.json` (exclude `src/sync/**`)
- Create: `packages/core/src/sync/constants.ts`
- Create: `packages/core/src/sync/index.ts`
- Create: `packages/core/src/sync/smoke.test.ts`

**Interfaces:**
- Produces: importable subpath `@portiq/core/sync` (barrel `packages/core/src/sync/index.ts`, populated task-by-task); constants `SYNC_REPO_NAME`, `WORKSPACE_ROOT`, `LEGACY_STATE_FILE`, `SECRET_PLACEHOLDER_PREFIX`, `LEGACY_SECRET_PLACEHOLDER_PREFIX`, `WORKSPACE_MANAGED_PREFIXES: string[]`, `HISTORY_PREFIX`.

- [ ] **Step 1: Write the failing smoke test `packages/core/src/sync/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SYNC_REPO_NAME, WORKSPACE_ROOT, WORKSPACE_MANAGED_PREFIXES, HISTORY_PREFIX } from "./index";

describe("@portiq/core/sync constants", () => {
  it("preserves the sync repo name and workspace root verbatim", () => {
    expect(SYNC_REPO_NAME).toBe("portiq-sync");
    expect(WORKSPACE_ROOT).toBe("workspace");
  });

  it("declares the workspace managed prefixes and history prefix", () => {
    expect(WORKSPACE_MANAGED_PREFIXES).toEqual([
      "workspace/manifest.json",
      "workspace/settings.json",
      "workspace/draft/",
      "workspace/environments/",
      "workspace/collections/",
    ]);
    expect(HISTORY_PREFIX).toBe("workspace/history/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/smoke.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Create `packages/core/src/sync/constants.ts`**

```ts
export const SYNC_REPO_NAME = "portiq-sync";
export const WORKSPACE_ROOT = "workspace";
export const LEGACY_STATE_FILE = "state.json";

export const SECRET_PLACEHOLDER_PREFIX = "__PORTIQ_SECRET__:";
export const LEGACY_SECRET_PLACEHOLDER_PREFIX = "__COMMU_SECRET__:";

export const WORKSPACE_MANAGED_PREFIXES = [
  `${WORKSPACE_ROOT}/manifest.json`,
  `${WORKSPACE_ROOT}/settings.json`,
  `${WORKSPACE_ROOT}/draft/`,
  `${WORKSPACE_ROOT}/environments/`,
  `${WORKSPACE_ROOT}/collections/`,
];

export const HISTORY_PREFIX = `${WORKSPACE_ROOT}/history/`;
```

- [ ] **Step 4: Create the barrel `packages/core/src/sync/index.ts`**

```ts
// @portiq/core/sync — headless GitHub-backed sync, exposed via the package.json
// "./sync" exports subpath (src-only; @octokit/rest is ESM and must not enter the
// CJS dist consumed by the electron main process). Populated task-by-task.
export * from "./constants";
```

- [ ] **Step 5: Add `@octokit/rest` to `packages/core/package.json` dependencies**

In the `"dependencies"` object, add (keep alphabetical-ish, next to `better-sqlite3`):

```json
    "@octokit/rest": "^22.0.1",
```

- [ ] **Step 6: Add the `"./sync"` export to `packages/core/package.json`**

In `"exports"`, after the `"./flows"` line, add (src-only — no `require` mapping):

```json
    "./sync": "./src/sync/index.ts"
```

The resulting `"exports"` block:

```json
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "require": "./dist/index.js"
    },
    "./flows": "./src/flows/index.ts",
    "./sync": "./src/sync/index.ts"
  },
```

- [ ] **Step 7: Exclude `src/sync/**` from the CJS build in `packages/core/tsconfig.build.json`**

Change the `"exclude"` array from `["**/*.test.ts"]` to:

```json
  "exclude": ["**/*.test.ts", "src/sync/**"]
```

- [ ] **Step 8: Install and run the smoke test**

Run: `npm install`
Run: `npm rebuild better-sqlite3` (plain-Node ABI for vitest — see Global Constraints)
Run: `npm test -- packages/core/src/sync/smoke.test.ts`
Expected: PASS (2 tests).
Run: `npm run build:core` — Expected: succeeds and the CJS `dist/` contains NO `sync/` directory (confirm: `ls packages/core/dist/sync` → "No such file or directory").
Run: `npm run lint` — Expected: no new errors under `packages/core/src/sync`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.build.json packages/core/src/sync package-lock.json
git commit -m "chore(core): scaffold @portiq/core/sync module + octokit dep + ./sync subpath"
```

---

## Task 2: `sync/secrets.ts` — secret placeholders + sanitize/restore

**Files:**
- Create: `packages/core/src/sync/secrets.ts`
- Create: `packages/core/src/sync/secrets.test.ts`

**Interfaces:**
- Consumes: `SECRET_PLACEHOLDER_PREFIX`, `LEGACY_SECRET_PLACEHOLDER_PREFIX` from `./constants`.
- Produces (all ported verbatim from `githubSync.ts` unless noted): `makeSecretPlaceholder(scope: string): string`; `isSecretPlaceholder(value: any): boolean`; `parseSecretPlaceholder(value: string): string | null`; `isSensitiveKey(key: any): boolean`; `sanitizeSensitiveMap(input, scope)`; `sanitizeSensitiveRows(rows, scope)`; `sanitizeSensitiveJsonText(text, scope)`; `sanitizeAuthConfig(authConfig, scope)`; `sanitizeWsConfig(wsConfig, scope)`; `sanitizeGraphqlConfig(graphqlConfig, scope)`; `sanitizeRequestSecrets(request, scope)`; `restoreRowsWithLocalSecrets(remoteRows, localRows)`; `restoreMapWithLocalSecrets(remoteMap, localMap)`; `restoreJsonTextWithLocalSecrets(remoteText, localText)`; `restoreAuthConfigWithLocalSecrets(remoteAuthConfig, localAuthConfig)`; `restoreRequestSecrets(remoteRequest, localRequest)`.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/secrets.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  isSecretPlaceholder,
  parseSecretPlaceholder,
  sanitizeRequestSecrets,
  restoreRequestSecrets,
  sanitizeSensitiveRows,
} from "./secrets";

describe("secret placeholders", () => {
  it("recognizes portiq and legacy commu placeholders", () => {
    expect(isSecretPlaceholder("__PORTIQ_SECRET__:foo")).toBe(true);
    expect(isSecretPlaceholder("__COMMU_SECRET__:foo")).toBe(true);
    expect(isSecretPlaceholder("plain")).toBe(false);
  });

  it("parses the scope back out of a placeholder", () => {
    expect(parseSecretPlaceholder("__PORTIQ_SECRET__:auth:bearer:token")).toBe("auth:bearer:token");
    expect(parseSecretPlaceholder("plain")).toBeNull();
  });
});

describe("sanitize/restore round-trip", () => {
  it("masks a bearer token on sanitize and restores it from local on pull", () => {
    const local = { id: "r1", authConfig: { bearer: { token: "SECRET" }, basic: {}, api_key: {} } };
    const sanitized = sanitizeRequestSecrets(local, "request:r1");
    expect(isSecretPlaceholder(sanitized.authConfig.bearer.token)).toBe(true);

    const restored = restoreRequestSecrets(sanitized, local);
    expect(restored.authConfig.bearer.token).toBe("SECRET");
  });

  it("masks sensitive rows by key name", () => {
    const rows = [
      { key: "Authorization", value: "Bearer xyz", comment: "", enabled: true },
      { key: "X-Trace", value: "keep", comment: "", enabled: true },
    ];
    const out = sanitizeSensitiveRows(rows, "headersRows");
    expect(isSecretPlaceholder(out[0].value)).toBe(true);
    expect(out[1].value).toBe("keep");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/secrets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/secrets.ts`**

Port `githubSync.ts:71-257` verbatim, replacing the two hard-coded placeholder prefixes with the imported constants. Complete file:

```ts
import { SECRET_PLACEHOLDER_PREFIX, LEGACY_SECRET_PLACEHOLDER_PREFIX } from "./constants";

export function makeSecretPlaceholder(scope: string): string {
  return `${SECRET_PLACEHOLDER_PREFIX}${scope}`;
}

export function isSecretPlaceholder(value: any): boolean {
  return typeof value === "string" &&
    (value.startsWith(SECRET_PLACEHOLDER_PREFIX) || value.startsWith(LEGACY_SECRET_PLACEHOLDER_PREFIX));
}

export function parseSecretPlaceholder(value: string): string | null {
  if (!isSecretPlaceholder(value)) return null;
  if (value.startsWith(SECRET_PLACEHOLDER_PREFIX)) return value.slice(SECRET_PLACEHOLDER_PREFIX.length);
  if (value.startsWith(LEGACY_SECRET_PLACEHOLDER_PREFIX)) return value.slice(LEGACY_SECRET_PLACEHOLDER_PREFIX.length);
  return null;
}

export function isSensitiveKey(key: any): boolean {
  return /authorization|api[-_ ]?key|token|secret|password|cookie|auth|credential/i.test(String(key || ""));
}

export function sanitizeSensitiveMap(input: any, scope: string): any {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const next = { ...input };
  Object.keys(next).forEach((key) => {
    if (next[key] && isSensitiveKey(key)) {
      next[key] = makeSecretPlaceholder(`${scope}:${key}`);
    }
  });
  return next;
}

export function sanitizeSensitiveRows(rows: any[], scope: string): any[] {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row, index) => {
    if (!row || typeof row !== "object") return row;
    if (!row.value || !isSensitiveKey(row.key)) return row;
    return {
      ...row,
      value: makeSecretPlaceholder(`${scope}:row:${index}:${row.key || "value"}`),
    };
  });
}

export function sanitizeSensitiveJsonText(text: string, scope: string): string {
  if (typeof text !== "string" || !text.trim()) return text;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(sanitizeSensitiveMap(parsed, scope), null, 2);
  } catch {
    return text;
  }
}

export function sanitizeAuthConfig(authConfig: any, scope: string): any {
  const base = authConfig && typeof authConfig === "object" ? authConfig : {};
  const next = {
    bearer: { ...(base.bearer || {}) },
    basic: { ...(base.basic || {}) },
    api_key: { ...(base.api_key || {}) },
  };
  if (next.bearer.token) next.bearer.token = makeSecretPlaceholder(`${scope}:auth:bearer:token`);
  if (next.basic.password) next.basic.password = makeSecretPlaceholder(`${scope}:auth:basic:password`);
  if (next.api_key.value) next.api_key.value = makeSecretPlaceholder(`${scope}:auth:api_key:value`);
  return next;
}

export function sanitizeWsConfig(wsConfig: any, scope: string): any {
  if (!wsConfig || typeof wsConfig !== "object") return wsConfig;
  return {
    ...wsConfig,
    headersRows: sanitizeSensitiveRows(wsConfig.headersRows, `${scope}:ws:headersRows`),
    headersText: sanitizeSensitiveJsonText(wsConfig.headersText, `${scope}:ws:headersText`),
  };
}

export function sanitizeGraphqlConfig(graphqlConfig: any, scope: string): any {
  if (!graphqlConfig || typeof graphqlConfig !== "object") return graphqlConfig;
  return {
    ...graphqlConfig,
    headers: sanitizeSensitiveMap(graphqlConfig.headers, `${scope}:graphql:headers`),
  };
}

export function sanitizeRequestSecrets(request: any, scope: string): any {
  if (!request || typeof request !== "object") return request;
  return {
    ...request,
    authConfig: sanitizeAuthConfig(request.authConfig, scope),
    authRows: sanitizeSensitiveRows(request.authRows, `${scope}:authRows`),
    headersRows: sanitizeSensitiveRows(request.headersRows, `${scope}:headersRows`),
    paramsRows: sanitizeSensitiveRows(request.paramsRows, `${scope}:paramsRows`),
    headersText: sanitizeSensitiveJsonText(request.headersText, `${scope}:headersText`),
    graphqlConfig: sanitizeGraphqlConfig(request.graphqlConfig, scope),
    wsConfig: sanitizeWsConfig(request.wsConfig, scope),
  };
}

export function restoreRowsWithLocalSecrets(remoteRows: any[], localRows: any[]): any[] {
  if (!Array.isArray(remoteRows)) return remoteRows;
  const localList = Array.isArray(localRows) ? localRows : [];
  return remoteRows.map((row, index) => {
    if (!row || typeof row !== "object" || !isSecretPlaceholder(row.value)) return row;
    const localRow = localList[index];
    if (localRow?.value && !isSecretPlaceholder(localRow.value)) {
      return { ...row, value: localRow.value };
    }
    return row;
  });
}

export function restoreMapWithLocalSecrets(remoteMap: any, localMap: any): any {
  if (!remoteMap || typeof remoteMap !== "object" || Array.isArray(remoteMap)) return remoteMap;
  const local = localMap && typeof localMap === "object" ? localMap : {};
  const next = { ...remoteMap };
  Object.keys(next).forEach((key) => {
    if (isSecretPlaceholder(next[key]) && local[key] && !isSecretPlaceholder(local[key])) {
      next[key] = local[key];
    }
  });
  return next;
}

export function restoreJsonTextWithLocalSecrets(remoteText: string, localText: string): string {
  if (typeof remoteText !== "string" || !remoteText.trim()) return remoteText;
  try {
    const remote = JSON.parse(remoteText);
    const local = typeof localText === "string" && localText.trim() ? JSON.parse(localText) : {};
    return JSON.stringify(restoreMapWithLocalSecrets(remote, local), null, 2);
  } catch {
    return remoteText;
  }
}

export function restoreAuthConfigWithLocalSecrets(remoteAuthConfig: any, localAuthConfig: any): any {
  const remote = remoteAuthConfig && typeof remoteAuthConfig === "object" ? remoteAuthConfig : {};
  const local = localAuthConfig && typeof localAuthConfig === "object" ? localAuthConfig : {};
  const next = {
    bearer: { ...(remote.bearer || {}) },
    basic: { ...(remote.basic || {}) },
    api_key: { ...(remote.api_key || {}) },
  };
  if (isSecretPlaceholder(next.bearer.token) && local?.bearer?.token) next.bearer.token = local.bearer.token;
  if (isSecretPlaceholder(next.basic.password) && local?.basic?.password) next.basic.password = local.basic.password;
  if (isSecretPlaceholder(next.api_key.value) && local?.api_key?.value) next.api_key.value = local.api_key.value;
  return next;
}

export function restoreRequestSecrets(remoteRequest: any, localRequest: any): any {
  if (!remoteRequest || typeof remoteRequest !== "object") return remoteRequest;
  const local = localRequest && typeof localRequest === "object" ? localRequest : {};
  return {
    ...remoteRequest,
    authConfig: restoreAuthConfigWithLocalSecrets(remoteRequest.authConfig, local.authConfig),
    authRows: restoreRowsWithLocalSecrets(remoteRequest.authRows, local.authRows),
    headersRows: restoreRowsWithLocalSecrets(remoteRequest.headersRows, local.headersRows),
    paramsRows: restoreRowsWithLocalSecrets(remoteRequest.paramsRows, local.paramsRows),
    headersText: restoreJsonTextWithLocalSecrets(remoteRequest.headersText, local.headersText),
    graphqlConfig: remoteRequest.graphqlConfig
      ? {
          ...remoteRequest.graphqlConfig,
          headers: restoreMapWithLocalSecrets(remoteRequest.graphqlConfig.headers, local?.graphqlConfig?.headers),
        }
      : remoteRequest.graphqlConfig,
    wsConfig: remoteRequest.wsConfig
      ? {
          ...remoteRequest.wsConfig,
          headersRows: restoreRowsWithLocalSecrets(remoteRequest.wsConfig.headersRows, local?.wsConfig?.headersRows),
          headersText: restoreJsonTextWithLocalSecrets(remoteRequest.wsConfig.headersText, local?.wsConfig?.headersText),
        }
      : remoteRequest.wsConfig,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/secrets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Re-export from the barrel and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./secrets";`

```bash
git add packages/core/src/sync/secrets.ts packages/core/src/sync/secrets.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): extract sync secret sanitize/restore into @portiq/core/sync"
```

---

## Task 3: `sync/serialize.ts` — encode/slug/mask + workspace-file builder

**Files:**
- Create: `packages/core/src/sync/serialize.ts`
- Create: `packages/core/src/sync/serialize.test.ts`

**Interfaces:**
- Consumes: `WORKSPACE_ROOT` from `./constants`; `sanitizeRequestSecrets` from `./secrets`; `AppState` from `../model`.
- Produces: `encodeContent(value: any): string`; `decodeContent(base64: string): any`; `slugify(value: any): string`; `previewMaskableVars(environments: any[]): any[]`; `maskEnvironments(environments: any[], maskedVarIds: Set<string>): any[]`; `serializeCollectionItems(items: any[], basePath: string, files: Record<string, any>): void`; `buildWorkspaceFiles(appState: AppState, maskedVarIds?: Set<string>): Record<string, any>`. (History builders come in Task 4.)

- [ ] **Step 1: Write the failing test `packages/core/src/sync/serialize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { encodeContent, decodeContent, slugify, buildWorkspaceFiles, previewMaskableVars } from "./serialize";
import type { AppState } from "../model";

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "My API",
    items: [
      { type: "request", id: "r1", name: "Get User", description: "", tags: [], protocol: "http", method: "GET", url: "https://x",
        authConfig: { bearer: { token: "SECRET" }, basic: {}, api_key: {} } } as any,
      { type: "folder", id: "f1", name: "Sub", items: [
        { type: "request", id: "r2", name: "Post", description: "", tags: [], protocol: "http", method: "POST", url: "https://y" } as any,
      ] } as any,
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "token", value: "abc", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("encode/decode/slug", () => {
  it("round-trips arbitrary JSON through base64", () => {
    const v = { a: 1, b: "héllo" };
    expect(decodeContent(encodeContent(v))).toEqual(v);
  });
  it("slugifies to lowercase dash form", () => {
    expect(slugify("My API!")).toBe("my-api");
    expect(slugify("")).toBe("item");
  });
});

describe("buildWorkspaceFiles", () => {
  it("emits manifest, settings, draft, environments and per-collection files", () => {
    const files = buildWorkspaceFiles(sample());
    expect(files["workspace/manifest.json"].format).toBe("portiq-workspace-tree");
    expect(files["workspace/settings.json"].activeCollectionId).toBe("c1");
    expect(files["workspace/environments/environments.json"]).toHaveLength(1);
    expect(files["workspace/collections/my-api__c1/collection.json"].name).toBe("My API");
    expect(files["workspace/collections/my-api__c1/get-user__r1.request.json"].id).toBe("r1");
    expect(files["workspace/collections/my-api__c1/sub__f1/folder.json"].type).toBe("folder");
    expect(files["workspace/collections/my-api__c1/sub__f1/items/post__r2.request.json"].id).toBe("r2");
  });

  it("sanitizes request secrets in the serialized tree", () => {
    const files = buildWorkspaceFiles(sample());
    const req = files["workspace/collections/my-api__c1/get-user__r1.request.json"];
    expect(String(req.authConfig.bearer.token).startsWith("__PORTIQ_SECRET__:")).toBe(true);
  });

  it("masks env vars whose id is in the masked set", () => {
    const files = buildWorkspaceFiles(sample(), new Set(["e1::0"]));
    expect(files["workspace/environments/environments.json"][0].vars[0].value).toBe("<SECRET_STORED_LOCALLY>");
  });
});

describe("previewMaskableVars", () => {
  it("flags likely-secret vars for masking", () => {
    const preview = previewMaskableVars([{ id: "e1", name: "L", vars: [{ key: "token", value: "x" }, { key: "page", value: "1" }] }]);
    expect(preview[0].vars[0].shouldMask).toBe(true);
    expect(preview[0].vars[1].shouldMask).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/serialize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/serialize.ts`**

Port `githubSync.ts:55-68, 293-441` verbatim (dropping the history builder — Task 4), replacing the literal `"workspace"` string with `WORKSPACE_ROOT` and importing `sanitizeRequestSecrets`. Complete file:

```ts
import { WORKSPACE_ROOT } from "./constants";
import { sanitizeRequestSecrets } from "./secrets";
import type { AppState } from "../model";

export function encodeContent(value: any): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2))));
}

export function decodeContent(base64: string): any {
  return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

export function slugify(value: any): string {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function previewMaskableVars(environments: any[]): any[] {
  return (environments || []).map((env: any) => ({
    id: env.id,
    name: env.name,
    vars: (env.vars || []).map((v: any, index: number) => {
      const keyStr = (v.key || "").toLowerCase();
      const isLikelySecret = v.secret || /secret|token|password|key|auth|cred/i.test(keyStr);
      return { ...v, id: v.id || index, shouldMask: isLikelySecret };
    }),
  }));
}

export function maskEnvironments(environments: any[], maskedVarIds: Set<string>): any[] {
  return (environments || []).map((env: any) => ({
    ...env,
    vars: (env.vars || []).map((v: any, index: number) => {
      const varId = `${env.id}::${v.id || index}`;
      if (!maskedVarIds.has(varId)) return v;
      return { ...v, value: "<SECRET_STORED_LOCALLY>", secret: true };
    }),
  }));
}

export function serializeCollectionItems(items: any[], basePath: string, files: Record<string, any>): void {
  (items || []).forEach((item: any, index: number) => {
    if (item.type === "folder") {
      const folderDir = `${basePath}/${slugify(item.name)}__${item.id}`;
      files[`${folderDir}/folder.json`] = { id: item.id, type: "folder", name: item.name, sortOrder: index };
      serializeCollectionItems(item.items || [], `${folderDir}/items`, files);
      return;
    }
    if (item.type === "request") {
      const requestPath = `${basePath}/${slugify(item.name)}__${item.id}.request.json`;
      files[requestPath] = { ...sanitizeRequestSecrets(item, `request:${item.id}`), sortOrder: index };
    }
  });
}

export function buildWorkspaceFiles(appState: AppState, maskedVarIds: Set<string> = new Set()): Record<string, any> {
  const files: Record<string, any> = {};
  const collections = Array.isArray(appState.collections) ? appState.collections : [];
  const environments = maskEnvironments(appState.environments || [], maskedVarIds);

  files[`${WORKSPACE_ROOT}/manifest.json`] = {
    version: 2,
    updatedAt: new Date().toISOString(),
    format: "portiq-workspace-tree",
  };

  files[`${WORKSPACE_ROOT}/settings.json`] = {
    activeCollectionId: appState.activeCollectionId || null,
    activeEnvId: appState.activeEnvId || null,
    activeRequestTab: appState.activeRequestTab || "Body",
    activeResponseTab: appState.activeResponseTab || "Pretty",
    headersMode: appState.headersMode || "table",
    testsMode: appState.testsMode || "post",
    selectedTablePath: appState.selectedTablePath || "$",
    search: appState.search || "",
    searchKey: appState.searchKey || "all",
    sortKey: appState.sortKey || "",
    sortDirection: appState.sortDirection || "asc",
    historyRetentionDays: appState.historyRetentionDays || 7,
  };

  files[`${WORKSPACE_ROOT}/draft/current-request.json`] = {
    ...sanitizeRequestSecrets({
      method: appState.method || "GET",
      url: appState.url || "",
      headersText: appState.headersText || "",
      bodyText: appState.bodyText || "",
      testsPreSteps: appState.testsPreSteps || [],
      testsPostSteps: appState.testsPostSteps || [],
      testsInputText: appState.testsInputText || "",
      httpVersion: appState.httpVersion || "auto",
      requestTimeoutMs: appState.requestTimeoutMs || 30000,
      bodyType: appState.bodyType || "json",
      paramsRows: appState.paramsRows || [],
      headersRows: appState.headersRows || [],
      authRows: appState.authRows || [],
      authType: appState.authType || "none",
      authConfig: appState.authConfig || {},
      bodyRows: appState.bodyRows || [],
      graphqlConfig: appState.graphqlConfig || {},
      wsConfig: appState.wsConfig || {},
      protocol: appState.protocol || "http",
      requestName: appState.requestName || "New Request",
      currentRequestId: appState.currentRequestId || "",
    }, `draft:${appState.currentRequestId || "current"}`),
  };

  files[`${WORKSPACE_ROOT}/environments/environments.json`] = environments;

  collections.forEach((collection: any, index: number) => {
    const collectionDir = `${WORKSPACE_ROOT}/collections/${slugify(collection.name)}__${collection.id}`;
    files[`${collectionDir}/collection.json`] = {
      id: collection.id,
      type: "collection",
      name: collection.name,
      variables: collection.variables || {},
      sortOrder: index,
    };
    serializeCollectionItems(collection.items || [], collectionDir, files);
  });

  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/serialize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./serialize";`

```bash
git add packages/core/src/sync/serialize.ts packages/core/src/sync/serialize.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): extract sync workspace-tree serializer into @portiq/core/sync"
```

---

## Task 4: `sync/serialize.ts` — history-file builder + location index

**Files:**
- Modify: `packages/core/src/sync/serialize.ts` (append history builders)
- Modify: `packages/core/src/sync/serialize.test.ts` (append history tests)

**Interfaces:**
- Consumes: `WORKSPACE_ROOT` from `./constants`; `slugify` from same file.
- Produces: `buildRequestLocationIndex(collections: any[]): Map<string, any>`; `buildHistoryFiles(history: any[], collections: any[]): Record<string, any>`.

- [ ] **Step 1: Append the failing test to `packages/core/src/sync/serialize.test.ts`**

```ts
import { buildHistoryFiles } from "./serialize";

describe("buildHistoryFiles", () => {
  it("bins a history entry under workspace/history/<day>/<collection>/root", () => {
    const history = [{
      timestamp: Date.parse("2026-07-23T10:00:00Z"),
      request: { requestId: "r1", requestName: "Get User", collectionName: "My API", collectionId: "c1", folderPath: [] },
      response: { status: 200 },
    }];
    const files = buildHistoryFiles(history, []);
    const paths = Object.keys(files);
    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith("workspace/history/2026-07-23/my-api__c1/root/")).toBe(true);
    expect(paths[0].endsWith("__get-user__0.json")).toBe(true);
  });

  it("skips entries without a timestamp", () => {
    expect(Object.keys(buildHistoryFiles([{ request: {} }], []))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/serialize.test.ts`
Expected: FAIL — `buildHistoryFiles` is not exported.

- [ ] **Step 3: Append the history builders to `packages/core/src/sync/serialize.ts`**

Port `githubSync.ts:348-474` verbatim (literal `"workspace"` → `WORKSPACE_ROOT`):

```ts
export function buildRequestLocationIndex(collections: any[]): Map<string, any> {
  const index = new Map<string, any>();
  const walk = (items: any[], collectionMeta: any, folderPath: string[] = []) => {
    (items || []).forEach((item: any) => {
      if (item.type === "folder") {
        walk(item.items || [], collectionMeta, [...folderPath, item.name]);
        return;
      }
      if (item.type === "request") {
        index.set(item.id, {
          collectionId: collectionMeta.id,
          collectionName: collectionMeta.name,
          folderPath,
        });
      }
    });
  };
  (collections || []).forEach((collection: any) => {
    walk(collection.items || [], { id: collection.id, name: collection.name }, []);
  });
  return index;
}

export function buildHistoryFiles(history: any[], collections: any[]): Record<string, any> {
  const files: Record<string, any> = {};
  const locationIndex = buildRequestLocationIndex(collections);

  (history || []).forEach((entry: any, index: number) => {
    if (!entry?.timestamp) return;
    const date = new Date(entry.timestamp);
    const day = date.toISOString().split("T")[0];
    const requestId = entry.request?.requestId;
    const indexedMeta = requestId ? locationIndex.get(requestId) : null;
    const collectionName = entry.request?.collectionName || indexedMeta?.collectionName || "unassigned";
    const folderPath = entry.request?.folderPath || indexedMeta?.folderPath || [];
    const requestName = entry.request?.requestName || "request";

    const normalizedFolderPath = Array.isArray(folderPath) && folderPath.length > 0
      ? folderPath.map((segment: string) => slugify(segment))
      : ["root"];

    const pathParts = [
      WORKSPACE_ROOT,
      "history",
      day,
      `${slugify(collectionName)}__${entry.request?.collectionId || indexedMeta?.collectionId || "unassigned"}`,
      ...normalizedFolderPath,
    ];

    const filename = `${new Date(entry.timestamp).toISOString().replace(/[:.]/g, "-")}__${slugify(requestName)}__${index}.json`;
    files[`${pathParts.join("/")}/${filename}`] = entry;
  });

  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/serialize.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/serialize.ts packages/core/src/sync/serialize.test.ts
git commit -m "feat(core): extract sync history-file builder into @portiq/core/sync"
```

---

## Task 5: `sync/deserialize.ts` — file-tree → AppState merge (pull assembly)

**Files:**
- Create: `packages/core/src/sync/deserialize.ts`
- Create: `packages/core/src/sync/deserialize.test.ts`

**Interfaces:**
- Consumes: `WORKSPACE_ROOT` from `./constants`; `restoreRequestSecrets` from `./secrets`; `AppState`, `HistoryEntry` from `../model`.
- Produces: `buildItemsFromFiles(prefix: string, fileMap: Record<string, any>): any[]`; `buildRequestIndex(items: any[], index?: Map<string, any>): Map<string, any>`; `restoreCollectionItemsWithLocalSecrets(items: any[], localIndex: Map<string, any>): any[]`; `mergePulledState(localState: AppState, fileMap: Record<string, any>): { appState: AppState; history: HistoryEntry[] }`. `mergePulledState` reproduces the merge in `pullStateFromGitHub` (`githubSync.ts:738-798`) as a **pure** function — no I/O, no `localStorage`.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/deserialize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildWorkspaceFiles } from "./serialize";
import { mergePulledState } from "./deserialize";
import type { AppState } from "../model";

const local = (): AppState => ({
  collections: [{
    id: "c1", name: "My API",
    items: [{ type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x",
      authConfig: { bearer: { token: "LOCAL_SECRET" }, basic: {}, api_key: {} } } as any],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("mergePulledState", () => {
  it("reconstructs collections from the serialized file tree", () => {
    const fileMap = buildWorkspaceFiles(local());
    const { appState } = mergePulledState(local(), fileMap);
    expect(appState.collections).toHaveLength(1);
    expect(appState.collections[0].id).toBe("c1");
    expect((appState.collections[0].items[0] as any).id).toBe("r1");
  });

  it("restores a sanitized secret from local state on pull", () => {
    const fileMap = buildWorkspaceFiles(local()); // bearer token now a placeholder in the tree
    const { appState } = mergePulledState(local(), fileMap);
    expect((appState.collections[0].items[0] as any).authConfig.bearer.token).toBe("LOCAL_SECRET");
  });

  it("returns history sorted by path", () => {
    const fileMap = buildWorkspaceFiles(local());
    fileMap["workspace/history/2026-07-23/x/root/a.json"] = { timestamp: 1, request: {}, response: {} };
    const { history } = mergePulledState(local(), fileMap);
    expect(history).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/deserialize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/deserialize.ts`**

Port `buildItemsFromFiles`/`buildRequestIndex`/`restoreCollectionItemsWithLocalSecrets` verbatim from `githubSync.ts:556-618`, and lift the merge body of `pullStateFromGitHub` (`:738-790`) into the pure `mergePulledState` (dropping the `localStorage`/`window.api` write calls, which stay in the renderer adapter). Complete file:

```ts
import { WORKSPACE_ROOT } from "./constants";
import { restoreRequestSecrets } from "./secrets";
import type { AppState, HistoryEntry } from "../model";

export function buildItemsFromFiles(prefix: string, fileMap: Record<string, any>): any[] {
  const itemsPrefix = `${prefix}/items/`;
  const directChildren = new Map<string, any>();

  Object.keys(fileMap).forEach((path: string) => {
    if (!path.startsWith(itemsPrefix)) return;
    const remainder = path.slice(itemsPrefix.length);
    const firstSegment = remainder.split("/")[0];
    if (!firstSegment) return;
    if (!directChildren.has(firstSegment)) {
      directChildren.set(firstSegment, { segment: firstSegment, path: `${itemsPrefix}${firstSegment}` });
    }
  });

  return Array.from(directChildren.values())
    .map(({ path }: any) => {
      if (path.endsWith(".request.json") && fileMap[path]) return fileMap[path];
      const folderMeta = fileMap[`${path}/folder.json`];
      if (!folderMeta) return null;
      return { ...folderMeta, items: buildItemsFromFiles(path, fileMap) };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
}

export function buildRequestIndex(items: any[], index: Map<string, any> = new Map<string, any>()): Map<string, any> {
  (items || []).forEach((item: any) => {
    if (item.type === "folder") {
      buildRequestIndex(item.items || [], index);
      return;
    }
    if (item.type === "request" && item.id) index.set(item.id, item);
  });
  return index;
}

export function restoreCollectionItemsWithLocalSecrets(items: any[], localIndex: Map<string, any>): any[] {
  return (items || []).map((item: any) => {
    if (item.type === "folder") {
      return { ...item, items: restoreCollectionItemsWithLocalSecrets(item.items || [], localIndex) };
    }
    if (item.type === "request") return restoreRequestSecrets(item, localIndex.get(item.id));
    return item;
  });
}

/** Pure reproduction of pullStateFromGitHub's merge (githubSync.ts:738-790).
 *  Takes the current local AppState + the fetched remote fileMap; returns the
 *  next AppState + extracted history. No localStorage / window.api side effects. */
export function mergePulledState(
  localState: AppState,
  fileMap: Record<string, any>,
): { appState: AppState; history: HistoryEntry[] } {
  const currentAppState = localState || ({} as AppState);
  const settings = fileMap[`${WORKSPACE_ROOT}/settings.json`] || {};
  const draft = fileMap[`${WORKSPACE_ROOT}/draft/current-request.json`] || {};
  const environments = fileMap[`${WORKSPACE_ROOT}/environments/environments.json`] || [];

  const collections = Object.keys(fileMap)
    .filter((path) => path.startsWith(`${WORKSPACE_ROOT}/collections/`) && path.endsWith("/collection.json"))
    .map((path) => {
      const collectionDir = path.replace(/\/collection\.json$/, "");
      const meta = fileMap[path];
      return { ...meta, items: buildItemsFromFiles(collectionDir, fileMap) };
    })
    .sort((a, b) => {
      const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });

  const localRequestIndex = buildRequestIndex((currentAppState as any).collections || []);
  const mergedCollections = collections.map((collection) => ({
    ...collection,
    items: restoreCollectionItemsWithLocalSecrets(collection.items || [], localRequestIndex),
  }));

  const restoredDraft = restoreRequestSecrets(draft, {
    headersText: (currentAppState as any).headersText,
    authRows: (currentAppState as any).authRows,
    headersRows: (currentAppState as any).headersRows,
    paramsRows: (currentAppState as any).paramsRows,
    authConfig: (currentAppState as any).authConfig,
    graphqlConfig: (currentAppState as any).graphqlConfig,
    wsConfig: (currentAppState as any).wsConfig,
  });

  const history = Object.keys(fileMap)
    .filter((path) => path.startsWith(`${WORKSPACE_ROOT}/history/`) && path.endsWith(".json"))
    .sort()
    .map((path) => fileMap[path]);

  const nextAppState = {
    ...currentAppState,
    ...settings,
    ...restoredDraft,
    collections: mergedCollections,
    environments,
    activeCollectionId: settings.activeCollectionId || (currentAppState as any).activeCollectionId || null,
    activeEnvId: settings.activeEnvId || (currentAppState as any).activeEnvId || null,
    historyRetentionDays: settings.historyRetentionDays || (currentAppState as any).historyRetentionDays || 7,
  } as AppState;

  return { appState: nextAppState, history: history as HistoryEntry[] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/deserialize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./deserialize";`

```bash
git add packages/core/src/sync/deserialize.ts packages/core/src/sync/deserialize.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): extract sync pull-merge (file tree -> AppState) into @portiq/core/sync"
```

---

## Task 6: `sync/types.ts` — `SyncRemote` port + `SyncRemoteRegistry`

**Files:**
- Create: `packages/core/src/sync/types.ts`
- Create: `packages/core/src/sync/registry.ts`
- Create: `packages/core/src/sync/registry.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `interface SyncRemote { getIdentity(): Promise<{ login: string }>; ensureRepo(): Promise<SyncRepoInfo>; fetchWorkspace(): Promise<FetchWorkspaceResult>; pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]): Promise<void>; }`
  - `interface SyncRepoInfo { owner: string; repo: string; defaultBranch: string }`
  - `interface FetchWorkspaceResult { fileMap?: Record<string, any>; legacy?: any }`
  - `interface SyncFileDiff { path: string; state: "added" | "removed" | "modified" }`
  - `interface SyncStatus { repo: string; branch: string; remoteExists: boolean; legacy: boolean; inSync: boolean; diffs: SyncFileDiff[] }`
  - `type SyncRemoteFactory = (opts: any) => SyncRemote`
- Produces (`registry.ts`): `registerSyncRemote(kind: string, factory: SyncRemoteFactory): void`; `getSyncRemoteFactory(kind: string): SyncRemoteFactory | null`; `listSyncRemoteKinds(): string[]`. Additive `Map`-backed registry mirroring `ProtocolRegistry`; last-writer-wins with a `console.warn` on overwrite.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/registry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { registerSyncRemote, getSyncRemoteFactory, listSyncRemoteKinds } from "./registry";
import type { SyncRemote } from "./types";

const fakeFactory = (): SyncRemote => ({
  getIdentity: async () => ({ login: "test" }),
  ensureRepo: async () => ({ owner: "test", repo: "portiq-sync", defaultBranch: "main" }),
  fetchWorkspace: async () => ({ fileMap: {} }),
  pushFiles: async () => {},
});

describe("SyncRemoteRegistry", () => {
  it("registers and resolves a remote factory by kind", () => {
    registerSyncRemote("unit-test-remote", fakeFactory);
    expect(getSyncRemoteFactory("unit-test-remote")).toBe(fakeFactory);
    expect(listSyncRemoteKinds()).toContain("unit-test-remote");
  });

  it("returns null for an unknown kind", () => {
    expect(getSyncRemoteFactory("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/registry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/core/src/sync/types.ts`**

```ts
export interface SyncRepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface FetchWorkspaceResult {
  /** The workspace file tree (path -> decoded JSON). Present when a workspace exists. */
  fileMap?: Record<string, any>;
  /** Legacy single-file state.json payload, if that is all the remote has. */
  legacy?: any;
}

/**
 * The transport boundary for sync. Each backend (GitHub REST, local git repo)
 * implements these four operations; the engine is remote-agnostic.
 */
export interface SyncRemote {
  getIdentity(): Promise<{ login: string }>;
  ensureRepo(): Promise<SyncRepoInfo>;
  fetchWorkspace(): Promise<FetchWorkspaceResult>;
  /** Write every file in desiredFiles, then delete tracked files under
   *  managedPrefixes that are absent from desiredFiles (stale cleanup). */
  pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]): Promise<void>;
}

export type SyncRemoteFactory = (opts: any) => SyncRemote;

export interface SyncFileDiff {
  path: string;
  state: "added" | "removed" | "modified";
}

export interface SyncStatus {
  repo: string;
  branch: string;
  remoteExists: boolean;
  legacy: boolean;
  inSync: boolean;
  diffs: SyncFileDiff[];
}
```

- [ ] **Step 4: Implement `packages/core/src/sync/registry.ts`**

```ts
import type { SyncRemoteFactory } from "./types";

const factories = new Map<string, SyncRemoteFactory>();

/** Additive self-registration — mirrors ProtocolRegistry. Call at module load. */
export function registerSyncRemote(kind: string, factory: SyncRemoteFactory): void {
  if (!kind) throw new Error("Sync remote must have a non-empty kind");
  if (factories.has(kind)) {
    console.warn(`Sync remote "${kind}" is already registered. Overwriting.`);
  }
  factories.set(kind, factory);
}

export function getSyncRemoteFactory(kind: string): SyncRemoteFactory | null {
  return factories.get(kind) || null;
}

export function listSyncRemoteKinds(): string[] {
  return Array.from(factories.keys());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./types";` and `export * from "./registry";`

```bash
git add packages/core/src/sync/types.ts packages/core/src/sync/registry.ts packages/core/src/sync/registry.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add SyncRemote port + additive SyncRemoteRegistry"
```

---

## Task 7: `sync/localRemote.ts` — local git repository remote (offline, no network)

**Files:**
- Create: `packages/core/src/sync/localRemote.ts`
- Create: `packages/core/src/sync/localRemote.test.ts`

**Interfaces:**
- Consumes: `SyncRemote`, `FetchWorkspaceResult` from `./types`; `WORKSPACE_ROOT`, `SYNC_REPO_NAME` from `./constants`; `registerSyncRemote` from `./registry`; `node:child_process` `execFileSync`, `node:fs`, `node:path`.
- Produces: `interface LocalGitRemoteOptions { dir: string }`; `createLocalGitRemote(opts: LocalGitRemoteOptions): SyncRemote`. Self-registers under kind `"local"` via `registerSyncRemote("local", (o) => createLocalGitRemote(o))`. Backs a real git repo in `opts.dir`: `ensureRepo` runs `git init -b main` + sets a throwaway `user.email`/`user.name` if unset; `fetchWorkspace` reads all tracked files under `workspace/` into a fileMap (never legacy); `pushFiles` writes/`git add`s each file, removes stale tracked files under the managed prefixes, and makes a single commit.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/localRemote.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitRemote } from "./localRemote";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-git-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("createLocalGitRemote", () => {
  it("ensureRepo initializes an empty repo and fetchWorkspace is empty", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    const info = await r.ensureRepo();
    expect(info.defaultBranch).toBe("main");
    expect(await r.fetchWorkspace()).toEqual({ fileMap: {} });
  });

  it("pushFiles then fetchWorkspace round-trips content", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    await r.ensureRepo();
    await r.pushFiles({ "workspace/settings.json": { a: 1 } }, ["workspace/settings.json"]);
    const { fileMap } = await r.fetchWorkspace();
    expect(fileMap!["workspace/settings.json"]).toEqual({ a: 1 });
  });

  it("pushFiles deletes stale files under a managed prefix", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    await r.ensureRepo();
    await r.pushFiles({ "workspace/collections/a/collection.json": { id: "a" } }, ["workspace/collections/"]);
    await r.pushFiles({ "workspace/collections/b/collection.json": { id: "b" } }, ["workspace/collections/"]);
    const { fileMap } = await r.fetchWorkspace();
    expect(fileMap!["workspace/collections/a/collection.json"]).toBeUndefined();
    expect(fileMap!["workspace/collections/b/collection.json"]).toEqual({ id: "b" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/localRemote.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/localRemote.ts`**

```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_ROOT, SYNC_REPO_NAME } from "./constants";
import { registerSyncRemote } from "./registry";
import type { FetchWorkspaceResult, SyncRemote } from "./types";

export interface LocalGitRemoteOptions {
  dir: string;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).toString();
}

function hasCommits(dir: string): boolean {
  try {
    git(dir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function trackedFiles(dir: string): string[] {
  if (!hasCommits(dir)) return [];
  return git(dir, ["ls-files"]).split("\n").map((l) => l.trim()).filter(Boolean);
}

export function createLocalGitRemote(opts: LocalGitRemoteOptions): SyncRemote {
  const { dir } = opts;

  return {
    async getIdentity() {
      return { login: "local" };
    },

    async ensureRepo() {
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, ".git"))) {
        git(dir, ["init", "-b", "main"]);
      }
      // Throwaway identity so commits succeed in CI where global git config is absent.
      try { git(dir, ["config", "user.email"]); } catch { git(dir, ["config", "user.email", "portiq@local"]); }
      try { git(dir, ["config", "user.name"]); } catch { git(dir, ["config", "user.name", "Portiq Sync"]); }
      return { owner: "local", repo: SYNC_REPO_NAME, defaultBranch: "main" };
    },

    async fetchWorkspace(): Promise<FetchWorkspaceResult> {
      const fileMap: Record<string, any> = {};
      for (const path of trackedFiles(dir)) {
        if (!path.startsWith(`${WORKSPACE_ROOT}/`)) continue;
        fileMap[path] = JSON.parse(readFileSync(join(dir, path), "utf8"));
      }
      return { fileMap };
    },

    async pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]) {
      for (const [path, content] of Object.entries(desiredFiles)) {
        const abs = join(dir, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, JSON.stringify(content, null, 2));
        git(dir, ["add", "--", path]);
      }

      const stale = trackedFiles(dir).filter(
        (path) =>
          !(path in desiredFiles) &&
          managedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)),
      );
      for (const path of stale) {
        rmSync(join(dir, path), { force: true });
        git(dir, ["rm", "--cached", "--", path]);
      }

      // Commit only if the index changed.
      const status = git(dir, ["status", "--porcelain"]).trim();
      if (status) git(dir, ["commit", "-m", "Sync workspace", "--no-verify"]);
    },
  };
}

registerSyncRemote("local", (o: LocalGitRemoteOptions) => createLocalGitRemote(o));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/localRemote.test.ts`
Expected: PASS (3 tests). (Requires the `git` CLI on PATH — confirmed present in the target env; `git --version` ≥ 2.53.)

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./localRemote";`

```bash
git add packages/core/src/sync/localRemote.ts packages/core/src/sync/localRemote.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add offline local-git SyncRemote for tests/headless"
```

---

## Task 8: `sync/githubRemote.ts` — Octokit-backed remote (preserves REST behavior)

**Files:**
- Create: `packages/core/src/sync/githubRemote.ts`
- Create: `packages/core/src/sync/githubRemote.test.ts`

**Interfaces:**
- Consumes: `SyncRemote`, `FetchWorkspaceResult`, `SyncRepoInfo` from `./types`; `registerSyncRemote` from `./registry`; `WORKSPACE_ROOT`, `LEGACY_STATE_FILE`, `SYNC_REPO_NAME` from `./constants`; `encodeContent`, `decodeContent` from `./serialize`; `Octokit` from `@octokit/rest`.
- Produces: `interface OctokitLike { rest: { users: { getAuthenticated(): Promise<{ data: { login: string } }> }; repos: { get(p): Promise<any>; createForAuthenticatedUser(p): Promise<any>; createOrUpdateFileContents(p): Promise<any>; getContent(p): Promise<any>; deleteFile(p): Promise<any> }; git: { getRef(p): Promise<any>; getCommit(p): Promise<any>; getTree(p): Promise<any>; getBlob(p): Promise<any> } } }`; `interface GithubRemoteOptions { token: string; client?: OctokitLike }`; `createGithubRemote(opts: GithubRemoteOptions): SyncRemote`. Self-registers kind `"github"` via `registerSyncRemote("github", (o) => createGithubRemote(o))`. Ports `getOctokit`/`ensureSyncRepo`/`getRepoTree`/`syncFiles`(incl. 422 retry + stale delete)/`fetchWorkspaceData`(incl. legacy fallback) from `githubSync.ts`, but with the client injectable for network-free tests.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/githubRemote.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createGithubRemote, type OctokitLike } from "./githubRemote";
import { encodeContent } from "./serialize";

/** Minimal in-memory fake of the Octokit surface used by the github remote. */
function fakeOctokit(overrides: Partial<any> = {}): OctokitLike {
  return {
    rest: {
      users: { getAuthenticated: async () => ({ data: { login: "octo" } }) },
      repos: {
        get: async () => ({ data: { default_branch: "main" } }),
        createForAuthenticatedUser: async () => ({ data: { default_branch: "main" } }),
        createOrUpdateFileContents: async () => ({ data: {} }),
        getContent: async () => ({ data: { sha: "server-sha" } }),
        deleteFile: async () => ({ data: {} }),
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "ref-sha" } } }),
        getCommit: async () => ({ data: { tree: { sha: "tree-sha" } } }),
        getTree: async () => ({ data: { tree: [] } }),
        getBlob: async () => ({ data: { content: encodeContent({}) } }),
      },
      ...overrides.rest,
    },
  } as OctokitLike;
}

describe("createGithubRemote", () => {
  it("ensureRepo returns the existing repo's default branch", async () => {
    const r = createGithubRemote({ token: "t", client: fakeOctokit() });
    expect(await r.ensureRepo()).toEqual({ owner: "octo", repo: "portiq-sync", defaultBranch: "main" });
  });

  it("falls back to legacy state.json when no workspace tree exists", async () => {
    const client = fakeOctokit();
    client.rest.repos.getContent = async () => ({ data: { content: encodeContent({ ui_url: "x" }) } });
    const r = createGithubRemote({ token: "t", client });
    const result = await r.fetchWorkspace();
    expect(result.legacy).toEqual({ ui_url: "x" });
  });

  it("retries a 422 sha error by re-fetching the current sha", async () => {
    let attempts = 0;
    const client = fakeOctokit();
    await r_pushShaRetry(client, () => { attempts++; });
    async function r_pushShaRetry(c: OctokitLike, onCall: () => void) {
      c.rest.repos.createOrUpdateFileContents = async (p: any) => {
        onCall();
        if (!p.sha) { const e: any = new Error("sha mismatch"); e.status = 422; throw e; }
        return { data: {} };
      };
      const remote = createGithubRemote({ token: "t", client: c });
      await remote.pushFiles({ "workspace/settings.json": { a: 1 } }, ["workspace/"]);
    }
    expect(attempts).toBe(2); // first (no sha) throws 422, retry (with server-sha) succeeds
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/githubRemote.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/githubRemote.ts`**

Port `getOctokit`/`ensureSyncRepo`/`getRepoTree`/`syncFiles`/`fetchWorkspaceData` from `githubSync.ts`, making the client injectable. Complete file:

```ts
import { Octokit } from "@octokit/rest";
import { WORKSPACE_ROOT, LEGACY_STATE_FILE, SYNC_REPO_NAME } from "./constants";
import { encodeContent, decodeContent } from "./serialize";
import { registerSyncRemote } from "./registry";
import type { FetchWorkspaceResult, SyncRemote, SyncRepoInfo } from "./types";

/** The exact subset of the Octokit REST surface used by the github remote. */
export interface OctokitLike {
  rest: {
    users: { getAuthenticated(): Promise<{ data: { login: string } }> };
    repos: {
      get(p: any): Promise<any>;
      createForAuthenticatedUser(p: any): Promise<any>;
      createOrUpdateFileContents(p: any): Promise<any>;
      getContent(p: any): Promise<any>;
      deleteFile(p: any): Promise<any>;
    };
    git: {
      getRef(p: any): Promise<any>;
      getCommit(p: any): Promise<any>;
      getTree(p: any): Promise<any>;
      getBlob(p: any): Promise<any>;
    };
  };
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

export interface GithubRemoteOptions {
  token: string;
  /** Injectable client for tests; defaults to a real Octokit bound to token. */
  client?: OctokitLike;
}

export function createGithubRemote(opts: GithubRemoteOptions): SyncRemote {
  if (!opts.token && !opts.client) throw new Error("No GitHub token found.");
  const octokit: OctokitLike = opts.client ?? (new Octokit({ auth: opts.token }) as unknown as OctokitLike);

  let cached: SyncRepoInfo | null = null;

  async function ensureRepo(): Promise<SyncRepoInfo> {
    if (cached) return cached;
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owner = user.login;
    try {
      const { data: repo } = await octokit.rest.repos.get({ owner, repo: SYNC_REPO_NAME });
      cached = { owner, repo: SYNC_REPO_NAME, defaultBranch: repo.default_branch || "main" };
    } catch (e: any) {
      if (e.status === 404) {
        const { data: createdRepo } = await octokit.rest.repos.createForAuthenticatedUser({
          name: SYNC_REPO_NAME,
          private: true,
          auto_init: true,
          description: "Portiq App Sync Repository",
        });
        cached = { owner, repo: SYNC_REPO_NAME, defaultBranch: createdRepo.default_branch || "main" };
      } else {
        throw e;
      }
    }
    return cached;
  }

  async function getRepoTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data: commit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.object.sha });
    const { data: tree } = await octokit.rest.git.getTree({ owner, repo, tree_sha: commit.tree.sha, recursive: "true" });
    return (tree.tree || []) as TreeEntry[];
  }

  return {
    async getIdentity() {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      return { login: user.login };
    },

    ensureRepo,

    async fetchWorkspace(): Promise<FetchWorkspaceResult> {
      const { owner, repo, defaultBranch } = await ensureRepo();
      const tree = await getRepoTree(owner, repo, defaultBranch);
      const workspaceEntries = tree.filter((e) => e.type === "blob" && e.path.startsWith(`${WORKSPACE_ROOT}/`));

      if (workspaceEntries.length === 0) {
        try {
          const response: any = await octokit.rest.repos.getContent({ owner, repo, path: LEGACY_STATE_FILE, ref: defaultBranch });
          return { legacy: decodeContent(response.data.content) };
        } catch (e: any) {
          if (e.status === 404) throw new Error("No synced workspace found in the repository.");
          throw e;
        }
      }

      const fileMap: Record<string, any> = {};
      for (const entry of workspaceEntries) {
        const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
        fileMap[entry.path] = decodeContent(blob.data.content);
      }
      return { fileMap };
    },

    async pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]) {
      const { owner, repo, defaultBranch } = await ensureRepo();
      const branch = defaultBranch;
      const tree = await getRepoTree(owner, repo, branch);
      const existingBlobs = new Map<string, string>(
        tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
      );

      for (const [path, content] of Object.entries(desiredFiles)) {
        const encodedContent = encodeContent(content);
        const updateFile = async (sha?: string) =>
          octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path, branch,
            message: `Sync ${path}`,
            content: encodedContent,
            ...(sha ? { sha } : {}),
          });

        try {
          await updateFile(existingBlobs.get(path));
        } catch (error: any) {
          const needsShaRetry = error?.status === 422 && /sha/i.test(error?.message || "");
          if (!needsShaRetry) throw error;
          const currentFile: any = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
          const currentSha = currentFile?.data?.sha;
          if (!currentSha) throw error;
          await updateFile(currentSha);
          existingBlobs.set(path, currentSha);
        }

        existingBlobs.delete(path);
      }

      const stalePaths = Array.from(existingBlobs.keys()).filter((path) =>
        managedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)),
      );
      for (const path of stalePaths) {
        await octokit.rest.repos.deleteFile({
          owner, repo, path, branch,
          message: `Remove stale synced file ${path}`,
          sha: existingBlobs.get(path)!,
        });
      }
    },
  };
}

registerSyncRemote("github", (o: GithubRemoteOptions) => createGithubRemote(o));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/githubRemote.test.ts`
Expected: PASS (3 tests). No network — the fake `OctokitLike` client is injected.

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./githubRemote";`

```bash
git add packages/core/src/sync/githubRemote.ts packages/core/src/sync/githubRemote.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add Octokit-backed github SyncRemote preserving REST behavior"
```

---

## Task 9: `sync/engine.ts` — remote-agnostic push/pull/status + store optimistic write

**Files:**
- Create: `packages/core/src/sync/engine.ts`
- Create: `packages/core/src/sync/engine.test.ts`

**Interfaces:**
- Consumes: `SyncRemote`, `SyncStatus`, `SyncFileDiff` from `./types`; `buildWorkspaceFiles`, `buildHistoryFiles` from `./serialize`; `mergePulledState` from `./deserialize`; `WORKSPACE_MANAGED_PREFIXES`, `HISTORY_PREFIX`, `WORKSPACE_ROOT` from `./constants`; `AppState`, `HistoryEntry` from `../model`; `openAppStateStore`, `type AppStateStore` from `../store/appStateStore`; `ConflictError` from `../store/kvStore`; `type ResolveDataDirOptions` from `../store/dataDir`.
- Produces:
  - `class SyncConflictError extends Error` (thrown when the store version changed under a store-backed pull).
  - `syncPush(remote: SyncRemote, state: AppState, opts?: { maskedVarIds?: Set<string>; history?: HistoryEntry[] }): Promise<void>` — pushes the workspace tree (managed prefixes) then, if `history` given, the history tree (history prefix) as a **second** `pushFiles` call, preserving current scoping.
  - `pullMerged(remote: SyncRemote, localState: AppState): Promise<{ appState: AppState; history: HistoryEntry[]; legacy?: any }>` — fetch + pure merge; surfaces `{ legacy }` untouched for the renderer's legacy path.
  - `syncPullToStore(remote: SyncRemote, opts?: ResolveDataDirOptions, store?: AppStateStore): Promise<{ appState: AppState; history: HistoryEntry[]; version: number }>` — the **headless/CLI** path: loads `{ state, version }` from the store, merges, and writes via `store.save(appState, version)` (optimistic). On `ConflictError` throws `SyncConflictError`.
  - `syncStatus(remote: SyncRemote, localState: AppState): Promise<SyncStatus>` — read-only diff of local vs remote workspace tree, excluding `workspace/manifest.json`.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/engine.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitRemote } from "./localRemote";
import { syncPush, pullMerged, syncPullToStore, syncStatus, SyncConflictError } from "./engine";
import { openAppStateStore } from "../store/appStateStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-eng-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" } as any,
  ] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("engine push/pull round-trip via local git remote", () => {
  it("pushes then pulls back an equivalent AppState", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    const { appState } = await pullMerged(remote, { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
    expect(appState.collections[0].id).toBe("c1");
    expect((appState.collections[0].items[0] as any).id).toBe("r1");
  });
});

describe("syncPullToStore optimistic concurrency", () => {
  it("writes the merged state through the store at the loaded version", async () => {
    const dataDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample()); // version 1
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    const res = await syncPullToStore(remote, {}, store);
    expect(res.version).toBe(2);
    expect(store.load().version).toBe(2);
    store.close();
  });

  it("throws SyncConflictError when the store version changed during pull", async () => {
    const dataDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample()); // version 1
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    // Simulate a concurrent writer bumping the version after load but before save
    // by wrapping the store: load reports v1, but the underlying store is at v2.
    const racing = openAppStateStore({ dataDir });
    const conflicting = {
      load: () => ({ state: sample(), version: 1 }),
      save: (s: AppState, v?: number) => racing.save(s, v),
      collections: racing.collections, environments: racing.environments,
      flattenRequests: racing.flattenRequests, close: racing.close,
    };
    racing.save(sample()); // underlying now version 2
    await expect(syncPullToStore(remote, {}, conflicting as any)).rejects.toBeInstanceOf(SyncConflictError);
    racing.close();
    store.close();
  });
});

describe("syncStatus", () => {
  it("reports inSync=false with a removed diff when the remote lacks a local collection", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    const status = await syncStatus(remote, sample());
    expect(status.remoteExists).toBe(false);
    expect(status.inSync).toBe(false);
    expect(status.diffs.some((d) => d.state === "added")).toBe(true); // local-only files are "added" vs remote
  });

  it("reports inSync=true right after a push", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    const state = sample();
    await syncPush(remote, state);
    const status = await syncStatus(remote, state);
    expect(status.inSync).toBe(true);
    expect(status.diffs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/engine.ts`**

```ts
import { WORKSPACE_ROOT, WORKSPACE_MANAGED_PREFIXES, HISTORY_PREFIX } from "./constants";
import { buildWorkspaceFiles, buildHistoryFiles } from "./serialize";
import { mergePulledState } from "./deserialize";
import type { SyncRemote, SyncStatus, SyncFileDiff } from "./types";
import type { AppState, HistoryEntry } from "../model";
import { openAppStateStore, type AppStateStore } from "../store/appStateStore";
import { ConflictError } from "../store/kvStore";
import type { ResolveDataDirOptions } from "../store/dataDir";

const MANIFEST_PATH = `${WORKSPACE_ROOT}/manifest.json`;

export class SyncConflictError extends Error {
  constructor(message = "Local store changed during pull; reload and retry.") {
    super(message);
    this.name = "SyncConflictError";
  }
}

export async function syncPush(
  remote: SyncRemote,
  state: AppState,
  opts: { maskedVarIds?: Set<string>; history?: HistoryEntry[] } = {},
): Promise<void> {
  await remote.ensureRepo();
  const workspaceFiles = buildWorkspaceFiles(state, opts.maskedVarIds ?? new Set());
  await remote.pushFiles(workspaceFiles, WORKSPACE_MANAGED_PREFIXES);
  if (opts.history) {
    const historyFiles = buildHistoryFiles(opts.history, (state as any).collections || []);
    await remote.pushFiles(historyFiles, [HISTORY_PREFIX]);
  }
}

export async function pullMerged(
  remote: SyncRemote,
  localState: AppState,
): Promise<{ appState: AppState; history: HistoryEntry[]; legacy?: any }> {
  await remote.ensureRepo();
  const workspace = await remote.fetchWorkspace();
  if (workspace.legacy) return { appState: localState, history: [], legacy: workspace.legacy };
  const merged = mergePulledState(localState, workspace.fileMap || {});
  return { appState: merged.appState, history: merged.history };
}

export async function syncPullToStore(
  remote: SyncRemote,
  opts: ResolveDataDirOptions = {},
  store?: AppStateStore,
): Promise<{ appState: AppState; history: HistoryEntry[]; version: number }> {
  const s = store ?? openAppStateStore(opts);
  try {
    const { state, version } = s.load();
    const localState = state ?? ({ collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
    const { appState, history } = await pullMerged(remote, localState);
    try {
      const newVersion = s.save(appState, version);
      return { appState, history, version: newVersion };
    } catch (e) {
      if (e instanceof ConflictError) throw new SyncConflictError();
      throw e;
    }
  } finally {
    if (!store) s.close();
  }
}

export async function syncStatus(remote: SyncRemote, localState: AppState): Promise<SyncStatus> {
  const info = await remote.ensureRepo();
  const identity = await remote.getIdentity().catch(() => ({ login: info.owner }));
  const workspace = await remote.fetchWorkspace().catch((e) => {
    if (/No synced workspace/i.test(String(e?.message))) return { fileMap: {} };
    throw e;
  });

  if (workspace.legacy) {
    return { repo: `${identity.login}/${info.repo}`, branch: info.defaultBranch, remoteExists: true, legacy: true, inSync: false, diffs: [] };
  }

  const remoteFiles = workspace.fileMap || {};
  const localFiles = buildWorkspaceFiles(localState);
  const remoteExists = Object.keys(remoteFiles).length > 0;

  const diffs: SyncFileDiff[] = [];
  const allPaths = new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)]);
  for (const path of allPaths) {
    if (path === MANIFEST_PATH) continue; // updatedAt always differs; ignore
    const inLocal = path in localFiles;
    const inRemote = path in remoteFiles;
    if (inLocal && !inRemote) diffs.push({ path, state: "added" });
    else if (!inLocal && inRemote) diffs.push({ path, state: "removed" });
    else if (JSON.stringify(localFiles[path]) !== JSON.stringify(remoteFiles[path])) diffs.push({ path, state: "modified" });
  }

  return {
    repo: `${identity.login}/${info.repo}`,
    branch: info.defaultBranch,
    remoteExists,
    legacy: false,
    inSync: diffs.length === 0,
    diffs: diffs.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (the store-backed tests open a real DB)
Run: `npm test -- packages/core/src/sync/engine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./engine";`

```bash
git add packages/core/src/sync/engine.ts packages/core/src/sync/engine.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add remote-agnostic sync engine (push/pull/status + optimistic store write)"
```

---

## Task 10: `sync/auth.ts` — headless GitHub token resolution

**Files:**
- Create: `packages/core/src/sync/auth.ts`
- Create: `packages/core/src/sync/auth.test.ts`

**Interfaces:**
- Consumes: `resolveDataDir`, `type ResolveDataDirOptions` from `../store/dataDir`; `node:fs`, `node:path`.
- Produces: `GITHUB_TOKEN_KEY = "ui_github_token"` (re-exported for parity with the renderer); `GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq"`; `interface ResolveTokenOptions extends ResolveDataDirOptions { token?: string; env?: NodeJS.ProcessEnv }`; `resolveGitHubToken(opts?: ResolveTokenOptions): string | null`. Precedence: `opts.token` (the `--token` flag) → `env.PORTIQ_GITHUB_TOKEN` → `env.GITHUB_TOKEN` → `<dataDir>/config.json` `.githubToken`. Returns `null` when none found (callers raise the same "No GitHub token found." error the current code uses).

- [ ] **Step 1: Write the failing test `packages/core/src/sync/auth.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitHubToken, GITHUB_CLIENT_ID } from "./auth";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-auth-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveGitHubToken", () => {
  it("prefers the explicit flag token", () => {
    expect(resolveGitHubToken({ token: "flag", env: { PORTIQ_GITHUB_TOKEN: "env" }, dataDir: tempDir() })).toBe("flag");
  });
  it("falls back to PORTIQ_GITHUB_TOKEN then GITHUB_TOKEN", () => {
    expect(resolveGitHubToken({ env: { PORTIQ_GITHUB_TOKEN: "p" }, dataDir: tempDir() })).toBe("p");
    expect(resolveGitHubToken({ env: { GITHUB_TOKEN: "g" }, dataDir: tempDir() })).toBe("g");
  });
  it("reads config.json githubToken last", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ githubToken: "cfg" }));
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("cfg");
  });
  it("returns null when no token is available", () => {
    expect(resolveGitHubToken({ env: {}, dataDir: tempDir() })).toBeNull();
  });
  it("exposes the desktop OAuth client id for parity", () => {
    expect(GITHUB_CLIENT_ID).toBe("Ov23liWUpjkSkyaC3sBq");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/sync/auth.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir, type ResolveDataDirOptions } from "../store/dataDir";

/** Kept identical to the renderer's localStorage key and OAuth app for parity. */
export const GITHUB_TOKEN_KEY = "ui_github_token";
export const GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq";

export interface ResolveTokenOptions extends ResolveDataDirOptions {
  token?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Headless credential sourcing. Precedence:
 *   --token flag → PORTIQ_GITHUB_TOKEN → GITHUB_TOKEN → <dataDir>/config.json .githubToken
 * The interactive OAuth device-code flow is desktop-only and NOT sourced here.
 */
export function resolveGitHubToken(opts: ResolveTokenOptions = {}): string | null {
  const env = opts.env ?? process.env;
  if (opts.token && opts.token.trim()) return opts.token.trim();
  if (env.PORTIQ_GITHUB_TOKEN && env.PORTIQ_GITHUB_TOKEN.trim()) return env.PORTIQ_GITHUB_TOKEN.trim();
  if (env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()) return env.GITHUB_TOKEN.trim();

  const configPath = join(resolveDataDir(opts), "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      if (cfg && typeof cfg.githubToken === "string" && cfg.githubToken.trim()) return cfg.githubToken.trim();
    } catch {
      // ignore malformed config
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/sync/index.ts`: `export * from "./auth";`

```bash
git add packages/core/src/sync/auth.ts packages/core/src/sync/auth.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add headless GitHub token resolution (flag/env/config)"
```

---

## Task 11: Renderer rewire — `githubSync.ts` delegates to `@portiq/core/sync`

**Files:**
- Modify: `src/services/githubSync.ts` (delete duplicated pure logic; import from core; keep renderer I/O + `github` remote wiring; re-export secret helpers)
- Verify (no change expected): `src/components/Modals/GitHubSyncModal.tsx`, `src/components/TableEditor.tsx`, `src/services/githubAuth.ts`

**Interfaces:**
- Consumes: from `@portiq/core/sync` — `buildWorkspaceFiles`, `buildHistoryFiles`, `previewMaskableVars`, `mergePulledState`, `createGithubRemote`, `syncPush`, `pullMerged`, `isSecretPlaceholder`, `parseSecretPlaceholder`, `SECRET_PLACEHOLDER_PREFIX`; from `@portiq/core` — `toSteps`.
- Produces: the same public exports the renderer already relies on — `previewEnvironmentsForSync()`, `pushStateToGitHub(maskedVarIds?)`, `pullStateFromGitHub()`, `pushHistoryToGitHub()`, `testGitHubConnection()`, `isSecretPlaceholder`, `parseSecretPlaceholder`, `SECRET_PLACEHOLDER_PREFIX`. Signatures and runtime behavior unchanged. No IPC/electron changes (sync never used `electron/main.cjs`).

**Rationale:** This mirrors the Phase-0 pattern of repointing renderer imports at core (App.tsx, panes) while deleting the now-duplicated logic. The renderer keeps: the localStorage token (via `getGitHubToken()` from `githubAuth.ts`), `getAppStateSnapshot`/`saveAppStateSnapshot` (window.api + localStorage), `writeLegacyStateToStorage`/`writeWorkspaceStateToStorage`, and constructs the `github` remote with the localStorage token so Octokit still runs in the renderer (CORS-permitted by GitHub). `githubAuth.ts` is unchanged (desktop device-flow stays).

- [ ] **Step 1: Replace `src/services/githubSync.ts` with the thin delegating adapter**

Full new file (keeps only the renderer-specific I/O helpers; everything pure comes from core):

```ts
import { getGitHubToken } from "./githubAuth";
import {
  buildWorkspaceFiles,
  buildHistoryFiles,
  previewMaskableVars,
  mergePulledState,
  createGithubRemote,
  syncPush,
  isSecretPlaceholder,
  parseSecretPlaceholder,
  SECRET_PLACEHOLDER_PREFIX,
  WORKSPACE_MANAGED_PREFIXES,
  HISTORY_PREFIX,
  type SyncRemote,
} from "@portiq/core/sync";
import { toSteps } from "@portiq/core";

// Re-export for existing consumers (TableEditor.tsx imports these two).
export { isSecretPlaceholder, parseSecretPlaceholder, SECRET_PLACEHOLDER_PREFIX };

function buildRemote(): SyncRemote {
  const token = getGitHubToken();
  if (!token) throw new Error("No GitHub token found.");
  // Octokit runs in the renderer (GitHub REST is CORS-permitted), exactly as before.
  return createGithubRemote({ token });
}

// ---- renderer state I/O (unchanged behavior) ----

function getStorageJson(key: string, fallback: any = null): any {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function setStorageJson(key: string, value: any): void {
  localStorage.setItem(key, JSON.stringify(value));
}

async function getAppStateSnapshot(): Promise<any> {
  try {
    if ((window as any).api?.loadState) {
      const raw = await (window as any).api.loadState("appState");
      if (raw) return JSON.parse(raw);
    }
  } catch {
    // fall through
  }
  return getStorageJson("appState", {}) || {};
}

async function saveAppStateSnapshot(appState: any): Promise<void> {
  const encoded = JSON.stringify(appState);
  if ((window as any).api?.saveState) {
    await (window as any).api.saveState("appState", encoded);
  }
  localStorage.setItem("appState", encoded);
}

function writeLegacyStateToStorage(data: any): void {
  Object.entries(data || {}).forEach(([key, value]) => {
    const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    localStorage.setItem(key, strValue);
  });
}

function writeWorkspaceStateToStorage(appState: any, history: any[]): void {
  setStorageJson("ui_collections", appState.collections || []);
  setStorageJson("ui_activeCollectionId", appState.activeCollectionId || "");
  setStorageJson("ui_environments", appState.environments || []);
  setStorageJson("ui_activeEnvId", appState.activeEnvId || "");
  setStorageJson("ui_history", history || []);
  setStorageJson("ui_historyRetentionDays", appState.historyRetentionDays || 7);
  setStorageJson("ui_method", appState.method || "GET");
  setStorageJson("ui_url", appState.url || "");
  setStorageJson("ui_headersText", appState.headersText || "");
  setStorageJson("ui_bodyText", appState.bodyText || "");
  setStorageJson("ui_testsPreSteps", toSteps(appState.testsPreSteps, appState.testsPreText));
  setStorageJson("ui_testsPostSteps", toSteps(appState.testsPostSteps, appState.testsPostText));
  setStorageJson("ui_testsInputText", appState.testsInputText || "");
  setStorageJson("ui_httpVersion", appState.httpVersion || "auto");
  setStorageJson("ui_requestTimeoutMs", appState.requestTimeoutMs || 30000);
  setStorageJson("ui_paramsRows", appState.paramsRows || []);
  setStorageJson("ui_headersRows", appState.headersRows || []);
  setStorageJson("ui_authRows", appState.authRows || []);
  setStorageJson("ui_authType", appState.authType || "none");
  setStorageJson("ui_authConfig", appState.authConfig || {});
  setStorageJson("ui_bodyType", appState.bodyType || "json");
  setStorageJson("ui_bodyRows", appState.bodyRows || []);
  setStorageJson("ui_graphqlConfig", appState.graphqlConfig || {});
  setStorageJson("ui_wsConfig", appState.wsConfig || {});
  setStorageJson("ui_protocol", appState.protocol || "http");
  setStorageJson("ui_requestName", appState.requestName || "New Request");
  setStorageJson("ui_currentRequestId", appState.currentRequestId || "");
  setStorageJson("ui_activeRequestTab", appState.activeRequestTab || "Body");
  setStorageJson("ui_activeResponseTab", appState.activeResponseTab || "Pretty");
  setStorageJson("ui_headersMode", appState.headersMode || "table");
  setStorageJson("ui_testsMode", appState.testsMode || "post");
  setStorageJson("ui_selectedTablePath", appState.selectedTablePath || "$");
  setStorageJson("ui_search", appState.search || "");
  setStorageJson("ui_searchKey", appState.searchKey || "all");
  setStorageJson("ui_sortKey", appState.sortKey || "");
  setStorageJson("ui_sortDirection", appState.sortDirection || "asc");
}

// ---- public API (unchanged signatures) ----

export function previewEnvironmentsForSync() {
  const snapshot = getStorageJson("appState", null);
  const environments = snapshot?.environments || getStorageJson("ui_environments", []);
  return previewMaskableVars(environments);
}

export async function pushStateToGitHub(maskedVarIds: Set<string> = new Set<string>()) {
  const remote = buildRemote();
  const appState = await getAppStateSnapshot();
  await remote.ensureRepo();
  await remote.pushFiles(buildWorkspaceFiles(appState, maskedVarIds), WORKSPACE_MANAGED_PREFIXES);
  return true;
}

export async function pushHistoryToGitHub() {
  const remote = buildRemote();
  const appState = await getAppStateSnapshot();
  const history = getStorageJson("ui_history", []);
  await remote.ensureRepo();
  await remote.pushFiles(buildHistoryFiles(history, appState.collections || []), [HISTORY_PREFIX]);
  return true;
}

export async function pullStateFromGitHub() {
  const remote = buildRemote();
  const currentAppState = await getAppStateSnapshot();
  await remote.ensureRepo();
  const workspace = await remote.fetchWorkspace();

  if (workspace.legacy) {
    writeLegacyStateToStorage(workspace.legacy);
    return true;
  }

  const { appState, history } = mergePulledState(currentAppState, workspace.fileMap || {});
  await saveAppStateSnapshot(appState);
  writeWorkspaceStateToStorage(appState, history);
  return { appState, history };
}

export async function testGitHubConnection() {
  const remote = buildRemote();
  const identity = await remote.getIdentity();
  return identity; // shape: { login } — the modal reads user.login
}
```

Note the one intentional, behavior-preserving simplification: `testGitHubConnection()` returns `{ login }` (the modal only reads `verifiedUser.login`). If a reviewer wants the full user object, expose it via `remote.getIdentity()` returning the raw `data`; not required for the modal.

- [ ] **Step 2: Type-check and build the renderer**

Run: `npx tsc --noEmit` (repo root renderer tsconfig)
Expected: 0 errors. If `syncPush` is reported as unused, remove it from the import list (the renderer uses `remote.pushFiles` directly to keep per-tree prefix scoping identical; `syncPush` is the CLI-facing convenience).
Run: `vite build`
Expected: build succeeds (this does NOT need the native better-sqlite3 binary).

- [ ] **Step 3: Confirm consumers still resolve**

Run: `grep -n "isSecretPlaceholder\|parseSecretPlaceholder" src/components/TableEditor.tsx`
Expected: import line unchanged and now resolves to the re-exported core helpers.
Run: `grep -n "testGitHubConnection\|pushStateToGitHub\|pullStateFromGitHub\|pushHistoryToGitHub\|previewEnvironmentsForSync" src/components/Modals/GitHubSyncModal.tsx`
Expected: all five imports still present and satisfied.

- [ ] **Step 4: Run the full test suite**

Run: `npm rebuild better-sqlite3`
Run: `npm test`
Expected: all prior tests plus the new sync tests pass; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/services/githubSync.ts
git commit -m "refactor(renderer): delegate githubSync to @portiq/core/sync (no behavior change)"
```

---

## Task 12: CLI subcommands `portiq sync push|pull|status` (additive)

**Files:**
- Create: `packages/cli/src/commands/sync.ts`
- Create: `packages/cli/src/commands/sync.test.ts`

**ASSUMED Phase-2 CLI contract** (documented here so the registration is precise; if the real contract differs, only the registration shim changes):

```ts
// Provided by the Phase-2 @portiq/cli scaffold (NOT created by this track):
export interface CliContext {
  args: string[];                                   // positional args after the subcommand
  flags: Record<string, string | boolean>;          // parsed --flags
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  dataDir?: string;                                  // resolved from --data-dir/env
}
export interface CliCommand {
  name: string;
  describe: string;
  subcommands?: CliCommand[];
  run(ctx: CliContext): Promise<number>;             // returns an exit code
}
export const commandRegistry: { register(cmd: CliCommand): void };
```

**Interfaces:**
- Consumes: from `@portiq/core/sync` — `createGithubRemote`, `resolveGitHubToken`, `syncPush`, `syncPullToStore`, `syncStatus`, `getSyncRemoteFactory`, `SyncConflictError`, `type SyncRemote`; from `@portiq/core` — `openAppStateStore`. From the assumed CLI scaffold — `commandRegistry`, `type CliCommand`, `type CliContext`.
- Produces: injectable handlers `runSyncPush(ctx, deps)`, `runSyncPull(ctx, deps)`, `runSyncStatus(ctx, deps)` returning exit codes (`0` ok, `1` runtime error, `3` usage error) — testable without the runtime; plus the `syncCommand: CliCommand` self-registered via `commandRegistry.register(syncCommand)`. `deps` defaults to real implementations but accepts an injected `SyncRemote` factory + store for tests. Remote selection honors `--remote local --dir <path>` (uses `getSyncRemoteFactory("local")`) else defaults to `github` with `resolveGitHubToken`.

- [ ] **Step 1: Write the failing handler test `packages/cli/src/commands/sync.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitRemote } from "@portiq/core/sync";
import { openAppStateStore } from "@portiq/core";
import { runSyncPush, runSyncPull, runSyncStatus } from "./sync";
import type { AppState } from "@portiq/core";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-cli-sync-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

function makeCtx(overrides: Partial<any> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ctx: { args: [], flags: {}, dataDir: tempDir(), stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), ...overrides },
    out, err,
  };
}

describe("runSyncPush / runSyncPull / runSyncStatus (local remote)", () => {
  it("push then pull round-trips through the store, returning exit code 0", async () => {
    const dataDir = tempDir();
    const remoteDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample());
    store.close();

    const remote = createLocalGitRemote({ dir: remoteDir });
    const deps = { remote };

    const pushCtx = makeCtx({ dataDir });
    expect(await runSyncPush(pushCtx.ctx as any, deps)).toBe(0);

    const pullCtx = makeCtx({ dataDir });
    expect(await runSyncPull(pullCtx.ctx as any, deps)).toBe(0);

    const reopened = openAppStateStore({ dataDir });
    expect(reopened.load().state?.collections[0].id).toBe("c1");
    reopened.close();
  });

  it("status reports in-sync after a push (exit code 0)", async () => {
    const dataDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample());
    store.close();
    const remote = createLocalGitRemote({ dir: tempDir() });
    const deps = { remote };
    await runSyncPush(makeCtx({ dataDir }).ctx as any, deps);
    const statusCtx = makeCtx({ dataDir });
    expect(await runSyncStatus(statusCtx.ctx as any, deps)).toBe(0);
    expect(statusCtx.out.join("\n")).toMatch(/in sync/i);
  });

  it("push with no resolvable token and no injected remote returns usage error 3", async () => {
    const c = makeCtx({ flags: { remote: "github" }, dataDir: tempDir() });
    // env has no token; no injected remote → resolveGitHubToken returns null
    expect(await runSyncPush(c.ctx as any, { env: {} })).toBe(3);
    expect(c.err.join("\n")).toMatch(/No GitHub token/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/sync.test.ts`
Expected: FAIL — module `./sync` and/or `@portiq/cli` scaffold not found. (If the `@portiq/cli` workspace does not yet exist, this test cannot run until the Phase-2 scaffold lands — see Step 6. The handler imports from `@portiq/core/*` only, so create the file and run this test once the CLI package `package.json` exists with `@portiq/core` as a dependency.)

- [ ] **Step 3: Implement `packages/cli/src/commands/sync.ts`**

```ts
import {
  createGithubRemote,
  resolveGitHubToken,
  getSyncRemoteFactory,
  syncPush,
  syncPullToStore,
  syncStatus,
  SyncConflictError,
  type SyncRemote,
} from "@portiq/core/sync";
import { openAppStateStore } from "@portiq/core";
// Assumed Phase-2 scaffold contract:
import { commandRegistry, type CliCommand, type CliContext } from "../registry";

export interface SyncDeps {
  remote?: SyncRemote;
  env?: NodeJS.ProcessEnv;
}

/** Resolve the remote from flags/deps: injected remote > --remote local --dir X > github. */
function resolveRemote(ctx: CliContext, deps: SyncDeps): { remote?: SyncRemote; error?: string } {
  if (deps.remote) return { remote: deps.remote };
  const kind = String(ctx.flags.remote || "github");
  if (kind === "local") {
    const dir = String(ctx.flags.dir || "");
    if (!dir) return { error: "sync --remote local requires --dir <path>" };
    const factory = getSyncRemoteFactory("local");
    if (!factory) return { error: "local sync remote is not registered" };
    return { remote: factory({ dir }) };
  }
  const token = resolveGitHubToken({ token: ctx.flags.token as string | undefined, env: deps.env, dataDir: ctx.dataDir });
  if (!token) return { error: "No GitHub token found. Set PORTIQ_GITHUB_TOKEN, GITHUB_TOKEN, --token, or config.json." };
  return { remote: createGithubRemote({ token }) };
}

export async function runSyncPush(ctx: CliContext, deps: SyncDeps = {}): Promise<number> {
  const { remote, error } = resolveRemote(ctx, deps);
  if (error) { ctx.stderr(error); return 3; }
  const store = openAppStateStore({ dataDir: ctx.dataDir });
  try {
    const { state } = store.load();
    if (!state) { ctx.stderr("No local app state to push."); return 1; }
    const history = (state as any).history; // optional; renderer keeps history separately
    await syncPush(remote!, state, { history: Array.isArray(history) ? history : undefined });
    ctx.stdout("Pushed workspace to remote.");
    return 0;
  } catch (e: any) {
    ctx.stderr(`Push failed: ${e?.message || e}`);
    return 1;
  } finally {
    store.close();
  }
}

export async function runSyncPull(ctx: CliContext, deps: SyncDeps = {}): Promise<number> {
  const { remote, error } = resolveRemote(ctx, deps);
  if (error) { ctx.stderr(error); return 3; }
  try {
    const { version } = await syncPullToStore(remote!, { dataDir: ctx.dataDir });
    ctx.stdout(`Pulled workspace into local store (version ${version}).`);
    return 0;
  } catch (e: any) {
    if (e instanceof SyncConflictError) { ctx.stderr(e.message); return 1; }
    ctx.stderr(`Pull failed: ${e?.message || e}`);
    return 1;
  }
}

export async function runSyncStatus(ctx: CliContext, deps: SyncDeps = {}): Promise<number> {
  const { remote, error } = resolveRemote(ctx, deps);
  if (error) { ctx.stderr(error); return 3; }
  const store = openAppStateStore({ dataDir: ctx.dataDir });
  try {
    const { state } = store.load();
    const localState = state ?? ({ collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as any);
    const status = await syncStatus(remote!, localState);
    ctx.stdout(`Repo: ${status.repo} (${status.branch})`);
    if (status.inSync) ctx.stdout("Status: in sync");
    else {
      ctx.stdout(`Status: ${status.diffs.length} change(s)`);
      for (const d of status.diffs.slice(0, 50)) ctx.stdout(`  ${d.state}\t${d.path}`);
    }
    return 0;
  } catch (e: any) {
    ctx.stderr(`Status failed: ${e?.message || e}`);
    return 1;
  } finally {
    store.close();
  }
}

export const syncCommand: CliCommand = {
  name: "sync",
  describe: "Sync the library with a git-backed remote (GitHub or a local git repo)",
  subcommands: [
    { name: "push", describe: "Push local workspace to the remote", run: (ctx) => runSyncPush(ctx) },
    { name: "pull", describe: "Pull the remote workspace into the local store", run: (ctx) => runSyncPull(ctx) },
    { name: "status", describe: "Show local-vs-remote differences", run: (ctx) => runSyncStatus(ctx) },
  ],
  run: async (ctx) => { ctx.stderr("Usage: portiq sync <push|pull|status>"); return 3; },
};

// Additive self-registration — no shared switchboard edited.
commandRegistry.register(syncCommand);
```

- [ ] **Step 4: Run the handler test to verify it passes**

Run: `npm test -- packages/cli/src/commands/sync.test.ts`
Expected: PASS (3 tests). If the `@portiq/cli` package/`../registry` scaffold is absent, this step is BLOCKED on Phase 2 — record it as pending and proceed; the core module (Tasks 1-11) is independently complete and green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/sync.ts packages/cli/src/commands/sync.test.ts
git commit -m "feat(cli): add additive portiq sync push|pull|status subcommands"
```

- [ ] **Step 6 (gated): End-to-end CLI integration test**

Only once the Phase-2 `@portiq/cli` runner exists: add an integration test that spawns the built `portiq` binary with `--data-dir <temp>` and `sync --remote local --dir <temp-git>` for `push`/`status`/`pull`, asserting exit codes (`0`/`0`/`0`) and that a subsequent `sync status` prints "in sync". Do NOT block Tasks 1-11 on this. If the runner is absent, note "CLI integration deferred to Phase 2 scaffold" in the progress ledger.

---

## Task 13: Gates, changeset, ledger, self-review

**Files:**
- Create: `.changeset/phase3-git-sync.md`
- Modify: `.superpowers/sdd/progress.md` (append a Phase-3 sync section)

- [ ] **Step 1: Run the full gate set**

Run: `npm rebuild better-sqlite3`
Run: `npm test` — Expected: all tests green (Task 12 handler test may be pending if the CLI scaffold is absent — note it).
Run: `npm run lint` — Expected: 0 errors (warnings unchanged from baseline).
Run: `npm run build:core` — Expected: succeeds; confirm `packages/core/dist/sync` is NOT emitted (`ls packages/core/dist/sync` → not found).
Run: `vite build` — Expected: renderer build succeeds.
Run: `npm run rebuild` — restore the Electron ABI so the desktop app is runnable again (leave the tree in this state for the user).

- [ ] **Step 2: Add a changeset `.changeset/phase3-git-sync.md`**

```md
---
"@portiq/core": minor
---

Add @portiq/core/sync: headless GitHub-backed sync (serialization, secret
sanitize/restore, SyncRemote port with github + local-git remotes,
push/pull/status engine with optimistic store writes) and headless token
resolution. Renderer githubSync now delegates to core with no behavior change.
```

- [ ] **Step 3: Append a Phase-3 section to `.superpowers/sdd/progress.md`**

Record: plan path, branch, tasks completed with commits, the headless-auth decision (token via flag/env/config; device-flow stays desktop-only), the local-git-remote testing approach, and whether the CLI integration test (Task 12 Step 6) is pending the Phase-2 scaffold.

- [ ] **Step 4: Commit**

```bash
git add .changeset/phase3-git-sync.md .superpowers/sdd/progress.md
git commit -m "chore(core): changeset + progress ledger for Phase 3 git sync"
```

- [ ] **Step 5: Final self-review (run the checklist yourself)**

1. **Spec coverage:** `sync/` core module (Tasks 1-10) ✓; renderer rewire, no UI change (Task 11) ✓; additive `portiq sync push|pull|status` (Task 12) ✓; core unit tests using a local/temp git repo as remote covering push/pull/status + conflict paths (Tasks 7-9) ✓; CLI integration test allowed-by-contract (Task 12 Step 6, gated) ✓; headless credential path + documented deviation (Assumptions + Task 10) ✓; store optimistic-concurrency writes (Task 9 `syncPullToStore`) ✓; additive self-registration, no switchboard edits (Task 6 registry + Task 8/7 self-register + Task 12 `commandRegistry.register`) ✓; disjoint files ✓; better-sqlite3 ABI gotcha in Global Constraints + gate steps ✓.
2. **Placeholder scan:** every code step is complete; no TODO/TBD.
3. **Type consistency:** `SyncRemote` (4 methods) is used identically in `localRemote`, `githubRemote`, and `engine`; `SyncStatus`/`SyncFileDiff` match between `types.ts` and `engine.ts`; `resolveGitHubToken` signature matches its CLI call; `syncPullToStore`/`syncPush`/`syncStatus` signatures match their CLI + test call sites. Fix any drift found here inline.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase3-parity-git-sync.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
