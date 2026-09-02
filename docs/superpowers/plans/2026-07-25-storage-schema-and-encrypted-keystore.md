# Storage Schema Normalization & Encrypted Keystore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two independent storage-layer efforts: (A) normalize the whole-blob `appState` row into per-entity SQLite rows so concurrent writers get fine-grained optimistic concurrency, with a forward migration + rollback + every surface (desktop, MCP, CLI) kept working; and (B) an encrypted-at-rest keystore for AI (and optionally GitHub) credentials, with an OS-keychain encryptor injected by the desktop (Electron `safeStorage`) and a `node:crypto` fallback for headless CLI/MCP, migrating existing plaintext secrets.

**Architecture:** Both efforts live under `packages/core/src/store/**` and stay framework-free. Part A adds an `EntityStore` layered over the existing `KvStore` (new namespaced keys `ent:index` / `ent:col:<id>` / `ent:env:<id>`, each independently versioned via the existing `setIfVersion`/`ConflictError` contract); `openAppStateStore` becomes a thin compatibility facade over it so MCP/CLI read paths are untouched, while the desktop's `db:saveState`/`db:loadState` IPC is routed through the facade (blob in/out preserved, storage normalized, legacy blob dual-written for rollback). Part B adds a pure `Encryptor` interface + `enc:v1:` tagging (browser-safe) and a Node-only `createLocalEncryptor` (AES-256-GCM); `saveAiConfig`/`resolveAiConfig` encrypt/decrypt credential values, the desktop injects a `safeStorage`-backed encryptor, and CLI/MCP fall back to the local keyfile encryptor.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler` for core; classic `Node` for CLI/MCP), Vitest 4 (`node` env, temp-dir stores), `better-sqlite3` (WAL kv store), `node:crypto` (AES-256-GCM), Electron `safeStorage` (desktop-only, injected).

> **These are two independent plans in one file.** Part A (schema normalization) and Part B (encrypted keystore) share the `packages/core/src/store/**` directory and both add one line to `packages/core/src/index.ts` and touch `electron/main.cjs`, but they have **no ordering dependency** and touch disjoint kv keys (`ent:*`/`appState` vs `aiSettings`/`keystore.key`). They can be executed as two parallel tracks; if run concurrently, coordinate the two trivial `index.ts`/`main.cjs` merges (see cross-plan note in Self-Review).

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

- **Per-entity/version contract preserved.** Every entity row keeps the existing `setIfVersion(key, value, expectedVersion)` → `ConflictError(key, expected, actual)` behavior of `kvStore.ts`. The whole-state facade (`AppStateStore.save`) preserves its current signature `save(state, expectedVersion?) → number` and continues to throw `ConflictError` on a stale version — existing `appStateStore.test.ts` and `mcp/src/store/write.test.ts` are the parity guard and MUST stay green unchanged.
- **Blob IPC contract preserved.** The desktop renderer only knows the `"appState"` blob key via `db:saveState`/`db:loadState` (`electron/preload.cjs:46-47`, `src/App.tsx:942-1050`). Part A must NOT change the renderer or the IPC signatures — main.cjs decomposes/recomposes internally.
- **Legacy-blob back-compat.** The legacy `appState` row is NEVER deleted by migration and is dual-written on every whole-state save, so a downgraded/old binary keeps reading valid data. Per-entity (MCP) writes leave the blob stale by design (fine-grained win); `recomposeLegacyBlob()` refreshes it for the downgrade path.
- **Keystore key-source doc (Part B).** Credential encryption key source, by surface: **desktop** → Electron `safeStorage` (OS keychain: macOS Keychain / Windows DPAPI / Linux libsecret when available); **desktop on Linux without a keyring, and all CLI/MCP** → `node:crypto` AES-256-GCM with a 32-byte key from `PORTIQ_KEYSTORE_KEY` (base64/hex) else a generated `<dataDir>/keystore.key` (mode `0600`). The keyfile fallback is at-rest obfuscation against casual DB/disk inspection, NOT against an attacker who can read the data dir — this is the acknowledged OS-keychain gap from the design's Open Questions. Encrypted values are tagged `enc:v1:`; untagged values are treated as plaintext for back-compat.

---

## File Structure

**Part A — schema normalization**
- `packages/core/src/store/kvStore.ts` — *(modify)* add `keys(prefix)`, `deleteKey(key)`, `transaction(fn)` to `KvStore` for multi-key atomic entity writes + prefix listing.
- `packages/core/src/store/kvStore.test.ts` — *(modify)* cover the three new methods.
- `packages/core/src/store/entityStore.ts` — *(create)* `EntityStore` + `openEntityStore`: index/meta types, `loadState`/`saveState` (diff + dual-write legacy blob), per-entity `get/upsert/delete` for collections + environments.
- `packages/core/src/store/entityStore.test.ts` — *(create)* recompose round-trip, diff-only writes, per-entity fine-grained no-conflict, whole-state `ConflictError`.
- `packages/core/src/store/migrate.ts` — *(create)* `migrateBlobIfNeeded(kv)` (forward) + `recomposeLegacyBlob(kv)` (rollback).
- `packages/core/src/store/migrate.test.ts` — *(create)* decompose + keep-blob, idempotent, recompose fidelity.
- `packages/core/src/store/appStateStore.ts` — *(modify)* delegate to `EntityStore`; expose `.entities` for fine-grained callers.
- `packages/core/src/store/appStateStore.test.ts` — *(unchanged parity guard)* + one new test for `.entities`.
- `packages/core/src/index.ts` — *(modify)* `export * from "./store/entityStore"` and `"./store/migrate"`.
- `packages/mcp/src/store/write.ts` — *(modify)* add per-entity optimistic helpers.
- `packages/mcp/src/tools/write.ts` — *(modify)* create/update/delete request, create collection, set env var → per-entity writes.
- `packages/mcp/src/tools/write.test.ts` — *(modify)* assert fine-grained behavior.
- `electron/main.cjs` — *(modify)* open an `AppStateStore`; route `db:saveState`/`db:loadState` for key `"appState"` through it; other keys stay raw kv.
- `packages/cli/src/commands/store.ts` — *(modify)* add `recomposeLegacyBlob` accessor for the down-migration command.
- `packages/cli/src/commands/config.ts` — *(modify)* add hidden `--recompose-legacy-blob` action (rollback helper).
- `packages/cli/src/commands/config.test.ts` — *(modify)* cover the rollback flag.

**Part B — encrypted keystore**
- `packages/core/src/store/keystoreTypes.ts` — *(create, browser-safe)* `Encryptor` interface, `ENC_PREFIX`, `isEncrypted`, `tagCipher`, `untagCipher`.
- `packages/core/src/store/keystoreTypes.test.ts` — *(create)* pure tagging round-trip.
- `packages/core/src/store/keystore.ts` — *(create, Node-only)* `createLocalEncryptor(opts)` (AES-256-GCM, keyfile/env).
- `packages/core/src/store/keystore.test.ts` — *(create)* round-trip, tamper→throw, keyfile `0600`, env-key override, cross-instance determinism.
- `packages/core/src/index.ts` — *(modify)* export `keystoreTypes` (both barrels) + `keystore` (Node barrel only).
- `packages/core/src/index.browser.ts` — *(modify)* export `keystoreTypes` only.
- `packages/core/src/ai/config.ts` — *(modify)* add `encryptor?: Encryptor` to `AiConfigOptions`; re-export `Encryptor` type.
- `packages/core/src/ai/configStore.ts` — *(modify)* `resolveEncryptor`, encrypt-on-save, decrypt-on-read, `migrateAiKeystore`.
- `packages/core/src/ai/config.test.ts` — *(modify)* encrypted-at-rest + plaintext back-compat + migrate.
- `electron/keystore.cjs` — *(create)* `safeStorage`-backed `Encryptor` factory.
- `electron/main.cjs` — *(modify)* pass the encryptor to `ai:saveConfig`; run `migrateAiKeystore` on startup.
- `packages/core/src/sync/auth.ts` — *(modify, optional B5)* decrypt tagged `githubToken`; add `saveGitHubToken`.
- `packages/core/src/sync/auth.test.ts` — *(modify, optional B5)* encrypted token round-trip.

---
---

# PART A — Per-entity store schema normalization

> **HIGHEST-RISK TASK IN THIS FILE.** The desktop renderer persists its entire state as one opaque
> `appState` JSON blob via IPC and knows no other key. Normalizing storage while keeping that blob
> contract byte-for-byte semantically identical (including arbitrary UI/draft extras), keeping MCP/CLI
> read paths untouched, preserving the `ConflictError` contract, AND providing a safe downgrade path is
> the load-bearing work. Do Tasks A1→A4 (core, fully tested) before touching any surface (A5→A7).

## Task A1: Extend `KvStore` with atomic multi-key primitives

**Files:**
- Modify: `packages/core/src/store/kvStore.ts:12` (interface) and `:52` (returned object)
- Test: `packages/core/src/store/kvStore.test.ts`

**Interfaces:**
- Consumes: existing `openKvStore`, `ConflictError`, better-sqlite3 `Database`.
- Produces: `KvStore` gains `keys(prefix?: string): string[]`, `deleteKey(key: string): void`, `transaction<T>(fn: () => T): T`. Existing `get/getVersioned/set/setIfVersion/clear/close` unchanged.

- [ ] **Step 1: Write the failing test (append to `packages/core/src/store/kvStore.test.ts`)**

```ts
describe("openKvStore multi-key primitives", () => {
  it("lists keys by prefix", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("ent:col:a", "1");
    s.set("ent:col:b", "2");
    s.set("ent:env:x", "3");
    expect(s.keys("ent:col:").sort()).toEqual(["ent:col:a", "ent:col:b"]);
    expect(s.keys().length).toBe(3);
    s.close();
  });

  it("deleteKey removes value and version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("k", "v");
    s.deleteKey("k");
    expect(s.get("k")).toBeNull();
    expect(s.getVersioned("k").version).toBe(0);
    s.close();
  });

  it("transaction commits multiple writes atomically and rolls back on throw", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.transaction(() => { s.set("a", "1"); s.set("b", "2"); });
    expect(s.get("a")).toBe("1");
    expect(s.get("b")).toBe("2");
    expect(() => s.transaction(() => { s.set("a", "9"); throw new Error("boom"); })).toThrow("boom");
    expect(s.get("a")).toBe("1"); // rolled back
    s.close();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/kvStore.test.ts`
Expected: FAIL — `s.keys is not a function` (and `deleteKey`/`transaction` undefined). If a `better-sqlite3` native ABI error appears instead, run `npm rebuild better-sqlite3`, then re-run.

- [ ] **Step 3: Implement — extend the `KvStore` interface**

In `packages/core/src/store/kvStore.ts`, add to `interface KvStore` (after `setIfVersion`, before `clear`):

```ts
  keys(prefix?: string): string[];
  deleteKey(key: string): void;
  transaction<T>(fn: () => T): T;
```

- [ ] **Step 4: Implement — add the methods to the returned object**

In the returned object (after `setIfVersion`, before `clear`):

```ts
    keys(prefix) {
      const rows = prefix
        ? db.prepare("SELECT key FROM kv WHERE key LIKE ? || '%'").all(prefix)
        : db.prepare("SELECT key FROM kv").all();
      return (rows as { key: string }[]).map((r) => r.key);
    },
    deleteKey(key) {
      db.prepare("DELETE FROM kv WHERE key = ?").run(key);
      db.prepare("DELETE FROM kv_version WHERE key = ?").run(key);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
```

(Nested `db.transaction` calls made by `set`/`setIfVersion` inside `fn` are fine — better-sqlite3 uses savepoints when a transaction is already active.)

- [ ] **Step 5: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/kvStore.test.ts`
Expected: PASS (all prior kvStore tests + the 3 new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/kvStore.ts packages/core/src/store/kvStore.test.ts
git commit -m "feat(core): add atomic multi-key primitives to KvStore (keys/deleteKey/transaction)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A2: `entityStore.ts` — per-entity rows over `KvStore`

**Files:**
- Create: `packages/core/src/store/entityStore.ts`
- Test: `packages/core/src/store/entityStore.test.ts`

**Interfaces:**
- Consumes: `openKvStore`, `ConflictError`, `type KvStore` from `./kvStore`; `type ResolveDataDirOptions` from `./dataDir`; `type AppState, Collection, Environment` from `../model`.
- Produces:
  - `const INDEX_KEY = "ent:index"`, `const LEGACY_BLOB_KEY = "appState"`, `const COL_PREFIX = "ent:col:"`, `const ENV_PREFIX = "ent:env:"`.
  - `interface EntityIndex { collectionIds: string[]; environmentIds: string[]; meta: { activeCollectionId: string; activeEnvId: string | null; historyRetentionDays: number; extras: Record<string, unknown> } }`.
  - `function toEntityIndex(state: AppState): EntityIndex` and `function recomposeState(kv: KvStore): { state: AppState | null; version: number }` (pure-ish helpers reused by `migrate.ts`).
  - `interface EntityStore { loadState(): { state: AppState | null; version: number }; saveState(state: AppState, expectedVersion?: number): number; getCollection(id: string): { collection: Collection | null; version: number }; upsertCollection(collection: Collection, expectedVersion?: number): number; deleteCollection(id: string, expectedVersion?: number): void; getEnvironment(id: string): { environment: Environment | null; version: number }; upsertEnvironment(env: Environment, expectedVersion?: number): number; deleteEnvironment(id: string, expectedVersion?: number): void; raw: KvStore; close(): void }`.
  - `function openEntityStore(opts?: ResolveDataDirOptions, kv?: KvStore): EntityStore`.

- [ ] **Step 1: Write the failing test `packages/core/src/store/entityStore.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore, ConflictError } from "./kvStore";
import { openEntityStore, INDEX_KEY, COL_PREFIX, LEGACY_BLOB_KEY } from "./entityStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-ent-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [
    { id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" }] },
    { id: "c2", name: "Other", items: [] },
  ],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
  uiDraftFoo: { open: true }, // arbitrary extra must survive round-trip
});

describe("entityStore round-trip", () => {
  it("returns null/version 0 when empty", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    expect(s.loadState()).toEqual({ state: null, version: 0 });
    s.close();
  });

  it("saveState decomposes into per-entity rows and recomposes identically (incl. extras)", () => {
    const dir = tempDir();
    const s = openEntityStore({ dataDir: dir });
    const v = s.saveState(sample());
    expect(v).toBe(1);
    const kv = s.raw;
    expect(kv.keys(COL_PREFIX).sort()).toEqual(["ent:col:c1", "ent:col:c2"]);
    expect(kv.get(INDEX_KEY)).toBeTruthy();
    expect(kv.get(LEGACY_BLOB_KEY)).toBeTruthy(); // dual-written for rollback
    const { state } = s.loadState();
    expect(state).toEqual(sample());
    s.close();
  });

  it("saveState only bumps versions of changed collections (diff)", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const c1v = s.getCollection("c1").version;
    const c2v = s.getCollection("c2").version;
    const next = sample();
    next.collections[0].name = "API v2"; // change c1 only
    s.saveState(next, s.loadState().version);
    expect(s.getCollection("c1").version).toBe(c1v + 1);
    expect(s.getCollection("c2").version).toBe(c2v); // untouched
    s.close();
  });

  it("saveState throws ConflictError on a stale whole-state version", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());       // version 1
    s.saveState(sample());       // version 2
    expect(() => s.saveState(sample(), 1)).toThrow(ConflictError);
    s.close();
  });

  it("per-entity upsert of different collections does not conflict (fine-grained)", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const c1 = s.getCollection("c1");
    const c2 = s.getCollection("c2");
    // two writers each hold their own entity version and both succeed
    s.upsertCollection({ ...c1.collection!, name: "A2" }, c1.version);
    s.upsertCollection({ ...c2.collection!, name: "B2" }, c2.version);
    expect(s.getCollection("c1").collection?.name).toBe("A2");
    expect(s.getCollection("c2").collection?.name).toBe("B2");
    s.close();
  });

  it("per-entity upsert throws ConflictError on a stale entity version", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const { collection, version } = s.getCollection("c1");
    s.upsertCollection({ ...collection!, name: "A2" }, version);          // now version+1
    expect(() => s.upsertCollection({ ...collection!, name: "A3" }, version)).toThrow(ConflictError);
    s.close();
  });

  it("upsertCollection adds a brand-new collection to the index", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    s.upsertCollection({ id: "c9", name: "New", items: [] });
    expect(s.loadState().state?.collections.map((c) => c.id).sort()).toEqual(["c1", "c2", "c9"]);
    s.close();
  });

  it("deleteCollection removes the row and de-indexes it", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    s.deleteCollection("c2");
    expect(s.getCollection("c2").collection).toBeNull();
    expect(s.loadState().state?.collections.map((c) => c.id)).toEqual(["c1"]);
    s.close();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/entityStore.test.ts`
Expected: FAIL — cannot find module `./entityStore`.

- [ ] **Step 3: Implement `packages/core/src/store/entityStore.ts`**

```ts
import { openKvStore, ConflictError, type KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment } from "../model";

export const INDEX_KEY = "ent:index";
export const LEGACY_BLOB_KEY = "appState";
export const COL_PREFIX = "ent:col:";
export const ENV_PREFIX = "ent:env:";

/** AppState top-level fields promoted to their own rows / the index meta. */
const RESERVED = new Set(["collections", "environments", "activeCollectionId", "activeEnvId", "historyRetentionDays"]);

export interface EntityIndex {
  collectionIds: string[];
  environmentIds: string[];
  meta: {
    activeCollectionId: string;
    activeEnvId: string | null;
    historyRetentionDays: number;
    extras: Record<string, unknown>;
  };
}

export function toEntityIndex(state: AppState): EntityIndex {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (!RESERVED.has(k)) extras[k] = v;
  return {
    collectionIds: (state.collections ?? []).map((c) => c.id),
    environmentIds: (state.environments ?? []).map((e) => e.id),
    meta: {
      activeCollectionId: state.activeCollectionId ?? "",
      activeEnvId: state.activeEnvId ?? null,
      historyRetentionDays: state.historyRetentionDays ?? 30,
      extras,
    },
  };
}

function readIndex(kv: KvStore): { index: EntityIndex | null; version: number } {
  const { value, version } = kv.getVersioned(INDEX_KEY);
  if (!value) return { index: null, version };
  try { return { index: JSON.parse(value) as EntityIndex, version }; }
  catch { return { index: null, version }; }
}

/** Recompose the full AppState from the index + per-entity rows. Reused by migrate.ts. */
export function recomposeState(kv: KvStore): { state: AppState | null; version: number } {
  const { index, version } = readIndex(kv);
  if (!index) return { state: null, version };
  const collections: Collection[] = [];
  for (const id of index.collectionIds) {
    const raw = kv.get(COL_PREFIX + id);
    if (raw) collections.push(JSON.parse(raw) as Collection);
  }
  const environments: Environment[] = [];
  for (const id of index.environmentIds) {
    const raw = kv.get(ENV_PREFIX + id);
    if (raw) environments.push(JSON.parse(raw) as Environment);
  }
  const state = {
    ...index.meta.extras,
    collections,
    environments,
    activeCollectionId: index.meta.activeCollectionId,
    activeEnvId: index.meta.activeEnvId,
    historyRetentionDays: index.meta.historyRetentionDays,
  } as AppState;
  return { state, version };
}

export interface EntityStore {
  loadState(): { state: AppState | null; version: number };
  saveState(state: AppState, expectedVersion?: number): number;
  getCollection(id: string): { collection: Collection | null; version: number };
  upsertCollection(collection: Collection, expectedVersion?: number): number;
  deleteCollection(id: string, expectedVersion?: number): void;
  getEnvironment(id: string): { environment: Environment | null; version: number };
  upsertEnvironment(env: Environment, expectedVersion?: number): number;
  deleteEnvironment(id: string, expectedVersion?: number): void;
  raw: KvStore;
  close(): void;
}

export function openEntityStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): EntityStore {
  const store = kv ?? openKvStore(opts);

  function saveState(state: AppState, expectedVersion?: number): number {
    return store.transaction(() => {
      const { index: prev, version } = readIndex(store);
      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new ConflictError(INDEX_KEY, expectedVersion, version);
      }
      const staleCols = new Set(prev?.collectionIds ?? []);
      for (const c of state.collections ?? []) {
        const encoded = JSON.stringify(c);
        if (store.get(COL_PREFIX + c.id) !== encoded) store.set(COL_PREFIX + c.id, encoded);
        staleCols.delete(c.id);
      }
      for (const id of staleCols) store.deleteKey(COL_PREFIX + id);

      const staleEnvs = new Set(prev?.environmentIds ?? []);
      for (const e of state.environments ?? []) {
        const encoded = JSON.stringify(e);
        if (store.get(ENV_PREFIX + e.id) !== encoded) store.set(ENV_PREFIX + e.id, encoded);
        staleEnvs.delete(e.id);
      }
      for (const id of staleEnvs) store.deleteKey(ENV_PREFIX + id);

      // Dual-write the legacy blob so a downgraded/old binary keeps reading valid data.
      store.set(LEGACY_BLOB_KEY, JSON.stringify(state));
      // The index row's version IS the whole-state version (preserves the ConflictError contract).
      return store.set(INDEX_KEY, JSON.stringify(toEntityIndex(state)));
    });
  }

  function ensureIndexed(kind: "col" | "env", id: string): void {
    const { index } = readIndex(store);
    if (!index) {
      store.set(INDEX_KEY, JSON.stringify({
        collectionIds: kind === "col" ? [id] : [],
        environmentIds: kind === "env" ? [id] : [],
        meta: { activeCollectionId: kind === "col" ? id : "", activeEnvId: null, historyRetentionDays: 30, extras: {} },
      } satisfies EntityIndex));
      return;
    }
    const list = kind === "col" ? index.collectionIds : index.environmentIds;
    if (!list.includes(id)) {
      list.push(id);
      store.set(INDEX_KEY, JSON.stringify(index));
    }
  }

  function deIndex(kind: "col" | "env", id: string): void {
    const { index } = readIndex(store);
    if (!index) return;
    if (kind === "col") index.collectionIds = index.collectionIds.filter((x) => x !== id);
    else index.environmentIds = index.environmentIds.filter((x) => x !== id);
    store.set(INDEX_KEY, JSON.stringify(index));
  }

  return {
    loadState: () => recomposeState(store),
    saveState,
    getCollection(id) {
      const { value, version } = store.getVersioned(COL_PREFIX + id);
      return { collection: value ? (JSON.parse(value) as Collection) : null, version };
    },
    upsertCollection(collection, expectedVersion) {
      return store.transaction(() => {
        const key = COL_PREFIX + collection.id;
        const encoded = JSON.stringify(collection);
        const next = expectedVersion === undefined ? store.set(key, encoded) : store.setIfVersion(key, encoded, expectedVersion);
        ensureIndexed("col", collection.id);
        return next;
      });
    },
    deleteCollection(id, expectedVersion) {
      store.transaction(() => {
        if (expectedVersion !== undefined) {
          const { version } = store.getVersioned(COL_PREFIX + id);
          if (version !== expectedVersion) throw new ConflictError(COL_PREFIX + id, expectedVersion, version);
        }
        store.deleteKey(COL_PREFIX + id);
        deIndex("col", id);
      });
    },
    getEnvironment(id) {
      const { value, version } = store.getVersioned(ENV_PREFIX + id);
      return { environment: value ? (JSON.parse(value) as Environment) : null, version };
    },
    upsertEnvironment(env, expectedVersion) {
      return store.transaction(() => {
        const key = ENV_PREFIX + env.id;
        const encoded = JSON.stringify(env);
        const next = expectedVersion === undefined ? store.set(key, encoded) : store.setIfVersion(key, encoded, expectedVersion);
        ensureIndexed("env", env.id);
        return next;
      });
    },
    deleteEnvironment(id, expectedVersion) {
      store.transaction(() => {
        if (expectedVersion !== undefined) {
          const { version } = store.getVersioned(ENV_PREFIX + id);
          if (version !== expectedVersion) throw new ConflictError(ENV_PREFIX + id, expectedVersion, version);
        }
        store.deleteKey(ENV_PREFIX + id);
        deIndex("env", id);
      });
    },
    raw: store,
    close() {
      if (!kv) store.close();
    },
  };
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/entityStore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/entityStore.ts packages/core/src/store/entityStore.test.ts
git commit -m "feat(core): per-entity EntityStore over KvStore with fine-grained optimistic concurrency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A3: Forward migration + rollback (`migrate.ts`)

**Files:**
- Create: `packages/core/src/store/migrate.ts`
- Test: `packages/core/src/store/migrate.test.ts`

**Interfaces:**
- Consumes: `type KvStore` from `./kvStore`; `INDEX_KEY, LEGACY_BLOB_KEY, COL_PREFIX, ENV_PREFIX, toEntityIndex, recomposeState` from `./entityStore`; `type AppState` from `../model`.
- Produces: `function migrateBlobIfNeeded(kv: KvStore): boolean` (forward: decompose the legacy `appState` blob into entity rows; keep the blob; idempotent; returns `true` iff it migrated). `function recomposeLegacyBlob(kv: KvStore): boolean` (rollback: rewrite the `appState` blob from entity rows; returns `true` iff entities existed).

- [ ] **Step 1: Write the failing test `packages/core/src/store/migrate.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore } from "./kvStore";
import { migrateBlobIfNeeded, recomposeLegacyBlob } from "./migrate";
import { INDEX_KEY, COL_PREFIX, ENV_PREFIX, LEGACY_BLOB_KEY, recomposeState } from "./entityStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), "portiq-mig-")); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const blob = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }, { id: "c2", name: "B", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 30,
  uiDraft: { tab: "params" },
});

describe("migrateBlobIfNeeded", () => {
  it("decomposes a legacy appState blob into entity rows and keeps the blob", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    expect(migrateBlobIfNeeded(kv)).toBe(true);
    expect(kv.keys(COL_PREFIX).sort()).toEqual(["ent:col:c1", "ent:col:c2"]);
    expect(kv.keys(ENV_PREFIX)).toEqual(["ent:env:e1"]);
    expect(kv.get(INDEX_KEY)).toBeTruthy();
    expect(kv.get(LEGACY_BLOB_KEY)).toBeTruthy(); // NOT deleted
    expect(recomposeState(kv).state).toEqual(blob()); // fidelity incl. extras
    kv.close();
  });

  it("is a no-op when an index already exists", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    migrateBlobIfNeeded(kv);
    expect(migrateBlobIfNeeded(kv)).toBe(false);
    kv.close();
  });

  it("is a no-op on an empty store", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    expect(migrateBlobIfNeeded(kv)).toBe(false);
    kv.close();
  });
});

describe("recomposeLegacyBlob (rollback)", () => {
  it("rewrites the appState blob from entity rows", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    migrateBlobIfNeeded(kv);
    kv.deleteKey(LEGACY_BLOB_KEY);            // simulate a stale/removed blob
    expect(recomposeLegacyBlob(kv)).toBe(true);
    expect(JSON.parse(kv.get(LEGACY_BLOB_KEY)!)).toEqual(blob());
    kv.close();
  });

  it("returns false when there are no entities", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    expect(recomposeLegacyBlob(kv)).toBe(false);
    kv.close();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/migrate.test.ts`
Expected: FAIL — cannot find module `./migrate`.

- [ ] **Step 3: Implement `packages/core/src/store/migrate.ts`**

```ts
import type { KvStore } from "./kvStore";
import { INDEX_KEY, LEGACY_BLOB_KEY, COL_PREFIX, ENV_PREFIX, toEntityIndex, recomposeState } from "./entityStore";
import type { AppState } from "../model";

/**
 * Forward migration: if the per-entity index is absent but a legacy `appState`
 * blob exists, decompose the blob into per-entity rows. The blob is KEPT (never
 * deleted) as a rollback backup. Idempotent. Returns true iff it migrated.
 */
export function migrateBlobIfNeeded(kv: KvStore): boolean {
  return kv.transaction(() => {
    if (kv.get(INDEX_KEY) !== null) return false;
    const raw = kv.get(LEGACY_BLOB_KEY);
    if (!raw) return false;
    let state: AppState;
    try { state = JSON.parse(raw) as AppState; } catch { return false; }
    for (const c of state.collections ?? []) kv.set(COL_PREFIX + c.id, JSON.stringify(c));
    for (const e of state.environments ?? []) kv.set(ENV_PREFIX + e.id, JSON.stringify(e));
    kv.set(INDEX_KEY, JSON.stringify(toEntityIndex(state)));
    return true;
  });
}

/**
 * Rollback / downgrade helper: rewrite the legacy `appState` blob from the
 * current per-entity rows so an old binary that only reads `appState` sees the
 * latest data. Returns true iff entity rows existed.
 */
export function recomposeLegacyBlob(kv: KvStore): boolean {
  const { state } = recomposeState(kv);
  if (!state) return false;
  kv.set(LEGACY_BLOB_KEY, JSON.stringify(state));
  return true;
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/migrate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire migration into `openEntityStore` (auto-migrate on open)**

In `packages/core/src/store/entityStore.ts`, add the import at the top:

```ts
import { migrateBlobIfNeeded } from "./migrate";
```

and call it inside `openEntityStore`, immediately after `const store = kv ?? openKvStore(opts);`:

```ts
  migrateBlobIfNeeded(store);
```

- [ ] **Step 6: Add a migration test to `entityStore.test.ts` and run both suites**

Append to `packages/core/src/store/entityStore.test.ts`:

```ts
describe("entityStore auto-migration", () => {
  it("adopts an existing legacy appState blob on open", () => {
    const dir = tempDir();
    const kv = openKvStore({ dataDir: dir });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(sample()));
    kv.close();
    const s = openEntityStore({ dataDir: dir });
    expect(s.loadState().state).toEqual(sample());
    s.close();
  });
});
```

Run: `npm test -- packages/core/src/store/entityStore.test.ts packages/core/src/store/migrate.test.ts`
Expected: PASS (both suites; note `entityStore.ts` now imports `migrate.ts` which imports `entityStore.ts` — this cycle is safe because `migrate.ts` only imports value functions used at call time, not at module init).

- [ ] **Step 7: Export from the top barrel and commit**

In `packages/core/src/index.ts`, add after the `appStateStore` export (line 6):

```ts
export * from "./store/entityStore";
export * from "./store/migrate";
```

```bash
git add packages/core/src/store/migrate.ts packages/core/src/store/migrate.test.ts packages/core/src/store/entityStore.ts packages/core/src/store/entityStore.test.ts packages/core/src/index.ts
git commit -m "feat(core): forward blob->entity migration + legacy-blob rollback helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A4: `appStateStore` becomes a compatibility facade over `EntityStore`

**Files:**
- Modify: `packages/core/src/store/appStateStore.ts`
- Test: `packages/core/src/store/appStateStore.test.ts` (existing tests are the parity guard; add one)

**Interfaces:**
- Consumes: `openEntityStore, type EntityStore` from `./entityStore`; `type KvStore` from `./kvStore`; `type ResolveDataDirOptions` from `./dataDir`; model types.
- Produces: `AppStateStore` keeps `load/save/collections/environments/flattenRequests/close` **unchanged in signature and behavior**, plus a new `entities: EntityStore` field exposing the fine-grained API. `openAppStateStore(opts?, kv?)` unchanged signature.

- [ ] **Step 1: Add a failing test to `packages/core/src/store/appStateStore.test.ts`**

Append:

```ts
describe("appStateStore fine-grained access", () => {
  it("exposes the per-entity EntityStore via .entities", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    s.save(sample());
    const { collection, version } = s.entities.getCollection("c1");
    expect(collection?.name).toBe("API");
    s.entities.upsertCollection({ ...collection!, name: "API v2" }, version);
    expect(s.collections().find((c) => c.id === "c1")?.name).toBe("API v2");
    s.close();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/appStateStore.test.ts`
Expected: FAIL — `s.entities` is undefined.

- [ ] **Step 3: Rewrite `packages/core/src/store/appStateStore.ts` to delegate**

```ts
import { openEntityStore, type EntityStore } from "./entityStore";
import type { KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment, RequestItem, FolderItem } from "../model";

export interface AppStateStore {
  load(): { state: AppState | null; version: number };
  save(state: AppState, expectedVersion?: number): number;
  collections(): Collection[];
  environments(): Environment[];
  flattenRequests(): RequestItem[];
  /** Fine-grained per-entity access (used by MCP/CLI writers). */
  entities: EntityStore;
  close(): void;
}

function collect(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") collect(item.items, out);
  }
}

export function openAppStateStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): AppStateStore {
  const entities = openEntityStore(opts, kv);

  function load(): { state: AppState | null; version: number } {
    return entities.loadState();
  }

  return {
    load,
    save(state, expectedVersion) {
      return entities.saveState(state, expectedVersion);
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
    entities,
    close() {
      entities.close();
    },
  };
}
```

- [ ] **Step 4: Run the test, expect PASS (existing parity tests + new)**

Run: `npm test -- packages/core/src/store/appStateStore.test.ts`
Expected: PASS — the three original tests (null/version, save+reload returns version 1, flattenRequests) plus the new `.entities` test. This proves the facade preserves the whole-state contract.

- [ ] **Step 5: Run the full core store suite as a regression gate**

Run: `npm test -- packages/core/src/store`
Expected: PASS (dataDir, kvStore, appStateStore, entityStore, migrate, portable).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/appStateStore.ts packages/core/src/store/appStateStore.test.ts
git commit -m "refactor(core): back AppStateStore with the normalized EntityStore (facade preserves contract)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A5: MCP write tools use per-entity optimistic concurrency

**Files:**
- Modify: `packages/mcp/src/store/write.ts` (add per-entity helpers alongside `withOptimisticWrite`)
- Modify: `packages/mcp/src/tools/write.ts`
- Test: `packages/mcp/src/store/write.test.ts` (append), `packages/mcp/src/tools/write.test.ts` (keep green)

**Interfaces:**
- Consumes: `ctx.store.entities` (`getCollection/upsertCollection/getEnvironment/upsertEnvironment` + `ConflictError`) from `@portiq/core`.
- Produces: `withEntityRetry<T>(fn: () => T): T` — runs `fn`, retrying once on `ConflictError`. Write tools mutate a single collection or environment entity per call, so `create_request`/`update_request`/`delete_request`/`save_ad_hoc_as_request`/`set_environment_variable` no longer read-modify-write the whole blob; `create_collection` upserts one new collection.

- [ ] **Step 1: Write the failing test (append to `packages/mcp/src/store/write.test.ts`)**

```ts
import { withEntityRetry } from "./write";

describe("withEntityRetry", () => {
  it("returns the result on success", () => {
    expect(withEntityRetry(() => 42)).toBe(42);
  });

  it("retries once then rethrows a persistent ConflictError", () => {
    const { ConflictError } = require("@portiq/core");
    let calls = 0;
    expect(() => withEntityRetry(() => { calls += 1; throw new ConflictError("k", 1, 2); })).toThrow(ConflictError);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/mcp/src/store/write.test.ts`
Expected: FAIL — `withEntityRetry` is not exported.

- [ ] **Step 3: Implement `withEntityRetry` (append to `packages/mcp/src/store/write.ts`)**

```ts
/** Retry a single-entity optimistic write once on ConflictError, then rethrow. */
export function withEntityRetry<T>(fn: () => T): T {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ConflictError && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("Entity write failed: version conflict after retry");
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/mcp/src/store/write.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the write tools to per-entity in `packages/mcp/src/tools/write.ts`**

Change the import on line 6 from:

```ts
import { withOptimisticWrite, newId } from "../store/write";
```

to:

```ts
import { withEntityRetry, newId } from "../store/write";
```

Replace the `create_request` handler body (lines 54-67) with a per-collection write:

```ts
      async (args) => {
        try {
          const item = makeRequestItem(args);
          withEntityRetry(() => {
            const { collection, version } = ctx.store.entities.getCollection(args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            (collection.items ??= []).push(item);
            ctx.store.entities.upsertCollection(collection, version);
          });
          return jsonToolResult(item);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

Replace the `update_request` handler body (lines 78-90) — it must locate the request's owning collection, mutate, and write only that collection:

```ts
      async ({ id, patch }) => {
        try {
          let updated: RequestItem | null = null;
          withEntityRetry(() => {
            for (const meta of ctx.store.collections()) {
              const fresh = ctx.store.entities.getCollection(meta.id);
              if (!fresh.collection) continue;
              const item = findRequest([fresh.collection], id);
              if (!item) continue;
              Object.assign(item, patch, { type: "request", id });
              ctx.store.entities.upsertCollection(fresh.collection, fresh.version);
              updated = item;
              return;
            }
            throw new Error(`Request '${id}' not found`);
          });
          return jsonToolResult(updated);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

Replace the `delete_request` handler body (lines 96-114):

```ts
      async ({ id }) => {
        try {
          withEntityRetry(() => {
            for (const meta of ctx.store.collections()) {
              const fresh = ctx.store.entities.getCollection(meta.id);
              if (!fresh.collection) continue;
              let found = false;
              const prune = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
                items.filter((it) => {
                  if (it.type === "request" && it.id === id) { found = true; return false; }
                  if (it.type === "folder") it.items = prune(it.items);
                  return true;
                });
              fresh.collection.items = prune(fresh.collection.items ?? []);
              if (found) { ctx.store.entities.upsertCollection(fresh.collection, fresh.version); return; }
            }
            throw new Error(`Request '${id}' not found`);
          });
          return jsonToolResult({ deleted: true, id });
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

Replace the `create_collection` handler body (lines 120-132):

```ts
      async ({ name }) => {
        try {
          const collection: Collection = { id: newId("col"), name, items: [] };
          withEntityRetry(() => ctx.store.entities.upsertCollection(collection));
          return jsonToolResult(collection);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

Replace the `set_environment_variable` handler body (lines 143-157):

```ts
      async ({ envId, key, value }) => {
        try {
          let target: Environment | null = null;
          withEntityRetry(() => {
            const { environment, version } = ctx.store.entities.getEnvironment(envId);
            if (!environment) throw new Error(`Environment '${envId}' not found`);
            const existing = (environment.vars ??= []).find((v) => v.key === key);
            if (existing) existing.value = value;
            else environment.vars.push({ key, value, comment: "", enabled: true });
            ctx.store.entities.upsertEnvironment(environment, version);
            target = environment;
          });
          return jsonToolResult(target);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

Replace the `save_ad_hoc_as_request` handler body (lines 163-176) with the same per-collection write as `create_request`:

```ts
      async (args) => {
        try {
          const item = makeRequestItem(args);
          withEntityRetry(() => {
            const { collection, version } = ctx.store.entities.getCollection(args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            (collection.items ??= []).push(item);
            ctx.store.entities.upsertCollection(collection, version);
          });
          return jsonToolResult(item);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
```

- [ ] **Step 6: Run the MCP write suite, expect PASS**

Run: `npm test -- packages/mcp/src/tools/write.test.ts packages/mcp/src/store/write.test.ts`
Expected: PASS — the existing tool tests (create/update/delete/collection/env/save + write-gating) still pass because the observable tool results are unchanged; storage is now per-entity.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/store/write.ts packages/mcp/src/tools/write.ts packages/mcp/src/store/write.test.ts
git commit -m "refactor(mcp): route write tools through per-entity optimistic concurrency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A6: Rewire desktop `electron/main.cjs` to the normalized store

**Files:**
- Modify: `electron/main.cjs` (`:23` kvStore var, `:47-62` initDb, `:196-215` db:saveState/loadState/clearAll)

**Interfaces:**
- Consumes: `core.openAppStateStore({ dataDir })`, `core.recomposeLegacyBlob`.
- Produces: `db:loadState("appState")` returns the recomposed blob string; `db:saveState("appState", value)` decomposes via `appStateStore.save`; all OTHER keys keep raw kv behavior. Renderer/IPC signatures unchanged.

- [ ] **Step 1: Add an app-state store handle alongside `kvStore` (`electron/main.cjs:23`)**

Replace line 23 (`let kvStore = null;`) with:

```js
let kvStore = null;
let appStore = null;
```

- [ ] **Step 2: Open the app-state store in `initDb` (`electron/main.cjs:61`)**

After `kvStore = core.openKvStore({ dataDir: dir });` add:

```js
  // Normalized per-entity store; shares the same kv handle so the migration and
  // dual-written legacy blob stay consistent within the process.
  appStore = core.openAppStateStore({ dataDir: dir }, kvStore);
```

- [ ] **Step 3: Route the `appState` key through the normalized store (`electron/main.cjs:196-205`)**

Replace the `db:saveState` and `db:loadState` handlers with:

```js
ipcMain.handle("db:saveState", async (_event, key, value) => {
  if (!kvStore) initDb();
  if (key === "appState") {
    // Decompose into per-entity rows; the legacy blob is dual-written inside save()
    // so external/old readers keep working. Renderer contract (blob in) is unchanged.
    appStore.save(JSON.parse(value));
  } else {
    kvStore.set(key, value);
  }
  return { ok: true };
});

ipcMain.handle("db:loadState", async (_event, key) => {
  if (!kvStore) initDb();
  if (key === "appState") {
    const { state } = appStore.load();
    return state ? JSON.stringify(state) : null;
  }
  return kvStore.get(key);
});
```

- [ ] **Step 4: Verify the renderer still loads (GUI smoke)**

Run: `npm run rebuild` (restore the Electron better-sqlite3 ABI), then `npm run dev`.
Expected: the app launches, collections/requests/environments load and persist across a reload exactly as before (no UI behavior change). Confirm the DB now contains `ent:index` / `ent:col:*` rows AND a still-present `appState` blob:

```bash
sqlite3 "$HOME/Library/Application Support/Portiq/appdata.sqlite" "SELECT key FROM kv WHERE key LIKE 'ent:%' OR key='appState';"
```

- [ ] **Step 5: Restore the Node ABI for the test suite and commit**

Run: `npm rebuild better-sqlite3` (back to Node ABI for vitest).

```bash
git add electron/main.cjs
git commit -m "refactor(electron): route appState IPC through the normalized per-entity store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A7: CLI back-compat + `recompose-blob` rollback command

**Files:**
- Modify: `packages/cli/src/commands/store.ts` (add a `recomposeLegacyBlob` accessor)
- Modify: `packages/cli/src/commands/config.ts` (add the `--recompose-legacy-blob` action)
- Test: `packages/cli/src/commands/config.test.ts`

**Interfaces:**
- Consumes: `openAppStateStore`, `recomposeLegacyBlob` from `@portiq/core`; `resolveEffectiveDataDir` from `../config`.
- Produces: `portiq config --recompose-legacy-blob` rewrites the `appState` blob from the per-entity rows (the documented pre-downgrade step). CLI import (`packages/cli/src/commands/import.ts`) needs NO change — it uses the whole-state `store.save(state, version)` facade path which still works and now dual-writes the blob.

- [ ] **Step 1: Confirm CLI import still passes against the facade (regression gate, no code change)**

Run: `npm test -- packages/cli/src/commands/import.test.ts`
Expected: PASS — `openStoreForWrite` → `openAppStateStore` now returns the entity-backed facade; the load/mutate/`save(next, version)` retry loop and `ConflictError` handling are unchanged.

- [ ] **Step 2: Read the current `config` command to match its style**

Read: `packages/cli/src/commands/config.ts` (note how it registers options + calls `emit`). Read `packages/cli/src/commands/config.test.ts` for the test harness (temp `--data-dir`, `runCli`-style invocation used by the other `*.test.ts` in that dir).

- [ ] **Step 3: Add a failing test to `packages/cli/src/commands/config.test.ts`**

```ts
it("recompose-legacy-blob rewrites the appState blob from entity rows", () => {
  const dir = tempDir(); // existing helper in this file
  const store = openAppStateStore({ dataDir: dir });
  store.save({ collections: [{ id: "c1", name: "A", items: [] }], activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 30 });
  store.entities.raw.deleteKey("appState"); // simulate a stale blob
  store.close();

  const res = runConfig(["--recompose-legacy-blob", "--data-dir", dir]); // match this file's invocation helper
  expect(res.exitCode).toBe(0);

  const kv = openKvStore({ dataDir: dir });
  expect(JSON.parse(kv.get("appState")!).collections[0].id).toBe("c1");
  kv.close();
});
```

(Add `import { openAppStateStore, openKvStore } from "@portiq/core";` to the test's imports; reuse whatever `tempDir`/invocation helper the file already defines.)

- [ ] **Step 4: Run the test, expect FAIL**

Run: `npm test -- packages/cli/src/commands/config.test.ts`
Expected: FAIL — the `--recompose-legacy-blob` option does not exist (Commander errors on the unknown flag / the assertion on `appState` fails).

- [ ] **Step 5: Add the accessor in `packages/cli/src/commands/store.ts`**

Append:

```ts
import { recomposeLegacyBlob } from "@portiq/core";

/** Rollback helper: rewrite the legacy `appState` blob from per-entity rows. */
export function recomposeBlob(ctx: CliContext, flags: { dataDir?: string }): boolean {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  const store = openAppStateStore({ dataDir });
  try {
    return recomposeLegacyBlob(store.entities.raw);
  } finally {
    store.close();
  }
}
```

- [ ] **Step 6: Register the option in `packages/cli/src/commands/config.ts`**

Add the option to the `config` command definition and handle it in the action (matching the file's existing `parseGlobalFlags`/`emit` pattern):

```ts
      .option("--recompose-legacy-blob", "rewrite the appState blob from per-entity rows (run before downgrading)")
```

and at the top of the action, before the existing config-print logic:

```ts
        if (opts.recomposeLegacyBlob) {
          const ok = recomposeBlob(ctx, flags);
          emit(ctx, flags, { kind: "message", text: ok ? "Recomposed appState blob from entity rows." : "No entity rows to recompose." });
          return;
        }
```

(Add `import { recomposeBlob } from "./store";` to `config.ts`.)

- [ ] **Step 7: Run the test, expect PASS**

Run: `npm test -- packages/cli/src/commands/config.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite regression + commit**

Run: `npm test`
Expected: the entire monorepo suite is green (core store, MCP writes, CLI import/config, parity golden test). If a `better-sqlite3` ABI error appears, run `npm rebuild better-sqlite3` first.

```bash
git add packages/cli/src/commands/store.ts packages/cli/src/commands/config.ts packages/cli/src/commands/config.test.ts
git commit -m "feat(cli): portiq config --recompose-legacy-blob rollback helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
---

# PART B — Encrypted-at-rest keystore for credentials

> Independent of Part A. Encrypts AI credential values (`aiSettings` kv key) at rest, injecting an
> OS-keychain encryptor on the desktop (Electron `safeStorage`) and a `node:crypto` keyfile fallback for
> headless CLI/MCP. Optionally extends to the GitHub token (B5). Existing plaintext secrets migrate on
> first run. See the "Keystore key-source doc" subsystem constraint above for the authoritative key-source table.

## Task B1: `keystoreTypes.ts` — pure `Encryptor` interface + `enc:v1:` tagging (browser-safe)

**Files:**
- Create: `packages/core/src/store/keystoreTypes.ts`
- Test: `packages/core/src/store/keystoreTypes.test.ts`

**Interfaces:**
- Produces (NO `node:` builtins — safe for the renderer bundle): `interface Encryptor { encrypt(plaintext: string): string; decrypt(ciphertext: string): string; readonly available: boolean }`; `const ENC_PREFIX = "enc:v1:"`; `function isEncrypted(s: string | null | undefined): boolean`; `function tagCipher(payloadB64: string): string`; `function untagCipher(tagged: string): string` (strips `ENC_PREFIX`, throws if untagged).

- [ ] **Step 1: Write the failing test `packages/core/src/store/keystoreTypes.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ENC_PREFIX, isEncrypted, tagCipher, untagCipher } from "./keystoreTypes";

describe("keystore tagging", () => {
  it("tags and detects encrypted values", () => {
    const tagged = tagCipher("YWJj");
    expect(tagged).toBe(`${ENC_PREFIX}YWJj`);
    expect(isEncrypted(tagged)).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it("untags a tagged value and rejects an untagged one", () => {
    expect(untagCipher(`${ENC_PREFIX}YWJj`)).toBe("YWJj");
    expect(() => untagCipher("plain")).toThrow(/not encrypted/i);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/keystoreTypes.test.ts`
Expected: FAIL — cannot find module `./keystoreTypes`.

- [ ] **Step 3: Implement `packages/core/src/store/keystoreTypes.ts`**

```ts
// Pure, browser-safe keystore contract. NO node: builtins or native addons —
// the renderer bundle imports this (via AiConfigOptions.encryptor). The Node-only
// implementation (AES-256-GCM keyfile) lives in ./keystore.ts.

export const ENC_PREFIX = "enc:v1:";

/** Symmetric encryptor injected per surface (desktop safeStorage / headless keyfile). */
export interface Encryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  /** false when no key source is available (e.g. Linux desktop without a keyring). */
  readonly available: boolean;
}

export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(ENC_PREFIX);
}

export function tagCipher(payloadB64: string): string {
  return ENC_PREFIX + payloadB64;
}

export function untagCipher(tagged: string): string {
  if (!isEncrypted(tagged)) throw new Error("Value is not encrypted (missing enc:v1: tag)");
  return tagged.slice(ENC_PREFIX.length);
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/keystoreTypes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Export from BOTH barrels (browser-safe) and commit**

In `packages/core/src/index.ts`, add after the `portable` export (line 7):

```ts
export * from "./store/keystoreTypes";
```

In `packages/core/src/index.browser.ts`, add after the `portable` export (line 25):

```ts
export * from "./store/keystoreTypes";
```

```bash
git add packages/core/src/store/keystoreTypes.ts packages/core/src/store/keystoreTypes.test.ts packages/core/src/index.ts packages/core/src/index.browser.ts
git commit -m "feat(core): browser-safe Encryptor interface + enc:v1: tagging helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B2: `keystore.ts` — `node:crypto` local encryptor (headless fallback)

**Files:**
- Create: `packages/core/src/store/keystore.ts`
- Test: `packages/core/src/store/keystore.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (`randomBytes`, `createCipheriv`, `createDecipheriv`), `node:fs`, `node:path`; `resolveDataDir, type ResolveDataDirOptions` from `./dataDir`; `Encryptor, tagCipher, untagCipher, ENC_PREFIX` from `./keystoreTypes`.
- Produces: `const KEYSTORE_FILE = "keystore.key"`; `interface LocalEncryptorOptions extends ResolveDataDirOptions { key?: Buffer }`; `function createLocalEncryptor(opts?: LocalEncryptorOptions): Encryptor` — AES-256-GCM; key from `opts.key` → `PORTIQ_KEYSTORE_KEY` env (base64 or hex, 32 bytes) → a generated `<dataDir>/keystore.key` (mode `0600`). Ciphertext payload = base64(`iv(12) || tag(16) || ciphertext`), tagged `enc:v1:`. `decrypt` throws on tamper (GCM auth failure).

- [ ] **Step 1: Write the failing test `packages/core/src/store/keystore.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLocalEncryptor, KEYSTORE_FILE } from "./keystore";
import { isEncrypted } from "./keystoreTypes";

const dirs: string[] = [];
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), "portiq-ks-")); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("createLocalEncryptor", () => {
  it("round-trips and produces a tagged, non-plaintext ciphertext", () => {
    const enc = createLocalEncryptor({ dataDir: tempDir() });
    const c = enc.encrypt("sk-secret-123");
    expect(isEncrypted(c)).toBe(true);
    expect(c).not.toContain("sk-secret-123");
    expect(enc.decrypt(c)).toBe("sk-secret-123");
    expect(enc.available).toBe(true);
  });

  it("generates a keyfile with 0600 perms and reuses it across instances", () => {
    const dir = tempDir();
    const a = createLocalEncryptor({ dataDir: dir });
    const c = a.encrypt("value");
    const keyPath = join(dir, KEYSTORE_FILE);
    expect(existsSync(keyPath)).toBe(true);
    if (platform() !== "win32") {
      expect((statSync(keyPath).mode & 0o777).toString(8)).toBe("600");
    }
    const b = createLocalEncryptor({ dataDir: dir }); // reads the same keyfile
    expect(b.decrypt(c)).toBe("value");
  });

  it("honors PORTIQ_KEYSTORE_KEY (base64) without touching a keyfile", () => {
    const dir = tempDir();
    const keyB64 = randomBytes(32).toString("base64");
    const enc = createLocalEncryptor({ dataDir: dir, env: { PORTIQ_KEYSTORE_KEY: keyB64 } });
    const c = enc.encrypt("x");
    expect(existsSync(join(dir, KEYSTORE_FILE))).toBe(false);
    expect(enc.decrypt(c)).toBe("x");
  });

  it("throws on a tampered ciphertext (GCM auth failure)", () => {
    const enc = createLocalEncryptor({ dataDir: tempDir() });
    const c = enc.encrypt("data");
    const tampered = c.slice(0, -2) + (c.endsWith("A") ? "B" : "A");
    expect(() => enc.decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/keystore.test.ts`
Expected: FAIL — cannot find module `./keystore`.

- [ ] **Step 3: Implement `packages/core/src/store/keystore.ts`**

```ts
// Node-only headless encryptor. Uses node:crypto + node:fs, so it MUST stay off
// the browser barrels (exported only from ./index.ts, never ./index.browser.ts).
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { resolveDataDir, type ResolveDataDirOptions } from "./dataDir";
import { tagCipher, untagCipher, type Encryptor } from "./keystoreTypes";

export const KEYSTORE_FILE = "keystore.key";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface LocalEncryptorOptions extends ResolveDataDirOptions {
  /** Inject a 32-byte key directly (tests). */
  key?: Buffer;
}

function parseEnvKey(raw: string): Buffer | null {
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;
  const hex = /^[0-9a-fA-F]{64}$/.test(raw.trim()) ? Buffer.from(raw.trim(), "hex") : null;
  return hex && hex.length === 32 ? hex : null;
}

function resolveKey(opts: LocalEncryptorOptions): Buffer {
  if (opts.key) return opts.key;
  const env = opts.env ?? process.env;
  if (env.PORTIQ_KEYSTORE_KEY) {
    const parsed = parseEnvKey(env.PORTIQ_KEYSTORE_KEY);
    if (parsed) return parsed;
    throw new Error("PORTIQ_KEYSTORE_KEY must be 32 bytes (base64 or hex)");
  }
  const dir = resolveDataDir(opts);
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, KEYSTORE_FILE);
  if (existsSync(keyPath)) return Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best-effort on non-POSIX */ }
  return key;
}

export function createLocalEncryptor(opts: LocalEncryptorOptions = {}): Encryptor {
  const key = resolveKey(opts);
  return {
    available: true,
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return tagCipher(Buffer.concat([iv, tag, enc]).toString("base64"));
    },
    decrypt(ciphertext: string): string {
      const buf = Buffer.from(untagCipher(ciphertext), "base64");
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const data = buf.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/keystore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the Node barrel only and commit**

In `packages/core/src/index.ts`, add after the `keystoreTypes` export:

```ts
export * from "./store/keystore";
```

(Do NOT add to `index.browser.ts` — `keystore.ts` pulls `node:crypto`/`node:fs`.)

```bash
git add packages/core/src/store/keystore.ts packages/core/src/store/keystore.test.ts packages/core/src/index.ts
git commit -m "feat(core): node:crypto AES-256-GCM local encryptor (headless keystore fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B3: Encrypt AI credentials at rest in `configStore.ts`

**Files:**
- Modify: `packages/core/src/ai/config.ts` (add `encryptor?: Encryptor` to `AiConfigOptions`; re-export `Encryptor` type)
- Modify: `packages/core/src/ai/configStore.ts` (`resolveEncryptor`, encrypt-on-save, decrypt-on-read, `migrateAiKeystore`)
- Test: `packages/core/src/ai/config.test.ts` (append)

**Interfaces:**
- Consumes: `Encryptor, isEncrypted` from `../store/keystoreTypes`; `createLocalEncryptor` from `../store/keystore`.
- Produces: `AiConfigOptions.encryptor?: Encryptor`; `function resolveEncryptor(opts: AiConfigOptions): Encryptor` (returns `opts.encryptor` when `available`, else `createLocalEncryptor(opts)`); `function migrateAiKeystore(opts?: AiConfigOptions): number` (encrypts any plaintext values in the stored `aiSettings.keys`, returns count changed). `saveAiConfig` encrypts each `config.keys` value before persisting; `resolveAiConfig` decrypts tagged kv/file key values (untagged values pass through for back-compat). Env-sourced keys are never persisted, so they stay plaintext in memory only.

- [ ] **Step 1: Add `encryptor` to `AiConfigOptions` and re-export the type in `packages/core/src/ai/config.ts`**

Add the import at the top (after the existing type imports):

```ts
import type { Encryptor } from "../store/keystoreTypes";
export type { Encryptor } from "../store/keystoreTypes";
```

Add to `interface AiConfigOptions` (after `kv?: KvStore;`):

```ts
  /** Injected encryptor for at-rest credential encryption (desktop safeStorage; else local keyfile). */
  encryptor?: Encryptor;
```

- [ ] **Step 2: Write the failing tests (append to `packages/core/src/ai/config.test.ts`)**

```ts
import { openKvStore } from "@portiq/core"; // add to the top imports of this file
import { migrateAiKeystore } from "./configStore"; // add to the existing configStore import

describe("AI credential encryption at rest", () => {
  it("stores the kv key encrypted and decrypts it on resolve", () => {
    const dir = tempDir();
    saveAiConfig({ provider: "openai", keys: { openai: "sk-plaintext-value" } }, { dataDir: dir });
    const kv = openKvStore({ dataDir: dir });
    const rawStored = JSON.parse(kv.get("aiSettings")!);
    expect(rawStored.keys.openai).toMatch(/^enc:v1:/);           // encrypted at rest
    expect(rawStored.keys.openai).not.toContain("sk-plaintext-value");
    kv.close();
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.apiKey).toBe("sk-plaintext-value");                // decrypted on read
    expect(cfg.source).toBe("kv");
  });

  it("still reads a legacy plaintext kv key (back-compat)", () => {
    const dir = tempDir();
    const kv = openKvStore({ dataDir: dir });
    kv.set("aiSettings", JSON.stringify({ provider: "openai", keys: { openai: "legacy-plain" } }));
    kv.close();
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.apiKey).toBe("legacy-plain");
  });

  it("migrateAiKeystore encrypts existing plaintext keys in place", () => {
    const dir = tempDir();
    const kv = openKvStore({ dataDir: dir });
    kv.set("aiSettings", JSON.stringify({ provider: "anthropic", keys: { anthropic: "plain", openai: "" } }));
    kv.close();
    expect(migrateAiKeystore({ dataDir: dir })).toBe(1);          // only the non-empty one
    const kv2 = openKvStore({ dataDir: dir });
    expect(JSON.parse(kv2.get("aiSettings")!).keys.anthropic).toMatch(/^enc:v1:/);
    kv2.close();
    expect(migrateAiKeystore({ dataDir: dir })).toBe(0);          // idempotent
    expect(resolveAiConfig({ dataDir: dir, env: {} }).apiKey).toBe("plain");
  });
});
```

- [ ] **Step 3: Run the tests, expect FAIL**

Run: `npm test -- packages/core/src/ai/config.test.ts`
Expected: FAIL — `migrateAiKeystore` is not exported, and the "encrypted at rest" assertion fails (values are still stored plaintext).

- [ ] **Step 4: Implement encryption in `packages/core/src/ai/configStore.ts`**

Add imports at the top (after the existing `./config` import):

```ts
import { isEncrypted, type Encryptor } from "../store/keystoreTypes";
import { createLocalEncryptor } from "../store/keystore";
import type { AiKeys } from "./config";
```

Add a resolver + helpers (after `NATIVE_KEY_ENV`):

```ts
function resolveEncryptor(opts: AiConfigOptions): Encryptor {
  if (opts.encryptor?.available) return opts.encryptor;
  return createLocalEncryptor(opts);
}

function decryptKeys(keys: AiKeys | undefined, enc: Encryptor): AiKeys {
  const out: AiKeys = {};
  for (const [k, v] of Object.entries(keys ?? {})) {
    if (!v) continue;
    out[k as keyof AiKeys] = isEncrypted(v) ? enc.decrypt(v) : v;
  }
  return out;
}
```

In `resolveAiConfig`, replace the plaintext key merge (currently `const keys: AiKeys = { ...(kv.keys ?? {}), ...(file.keys ?? {}) };`) with a decrypting merge:

```ts
  const enc = resolveEncryptor(opts);
  const keys: AiKeys = { ...decryptKeys(kv.keys, enc), ...decryptKeys(file.keys, enc) };
```

Because `keys` is now already decrypted, change the two apiKey branches that read raw `file.keys`/`kv.keys` to read the decrypted `keys` instead:

```ts
  } else if (provider && keys[provider as keyof AiKeys]) {
    apiKey = keys[provider as keyof AiKeys]!;
    source = file.keys?.[provider as keyof AiKeys] ? "file" : "kv";
  }
```

(Delete the two separate `file.keys` / `kv.keys` else-if branches and replace with the single branch above; the `source` still distinguishes file vs kv.)

In `saveAiConfig`, encrypt each provided key value before merging:

```ts
export function saveAiConfig(config: Partial<AiConfig>, opts: AiConfigOptions = {}): void {
  const kv = opts.kv ?? openKvStore(opts);
  try {
    const enc = resolveEncryptor(opts);
    const toStore: Partial<AiConfig> = { ...config };
    if (config.keys) {
      const encKeys: AiKeys = {};
      for (const [k, v] of Object.entries(config.keys)) {
        if (!v) continue;
        encKeys[k as keyof AiKeys] = isEncrypted(v) ? v : enc.encrypt(v);
      }
      toStore.keys = encKeys;
    }
    const existing = kv.get(AI_SETTINGS_KEY);
    const merged = { ...(existing ? JSON.parse(existing) : {}), ...toStore };
    kv.set(AI_SETTINGS_KEY, JSON.stringify(merged));
  } finally {
    if (!opts.kv) kv.close();
  }
}
```

Add `migrateAiKeystore` at the end of the file:

```ts
/** Encrypt any plaintext values in the stored aiSettings.keys. Idempotent. Returns count changed. */
export function migrateAiKeystore(opts: AiConfigOptions = {}): number {
  const kv = opts.kv ?? openKvStore(opts);
  try {
    const raw = kv.get(AI_SETTINGS_KEY);
    if (!raw) return 0;
    const settings = JSON.parse(raw) as Partial<AiConfig>;
    const keys = settings.keys ?? {};
    const enc = resolveEncryptor(opts);
    let changed = 0;
    for (const [k, v] of Object.entries(keys)) {
      if (v && !isEncrypted(v)) {
        keys[k as keyof AiKeys] = enc.encrypt(v);
        changed += 1;
      }
    }
    if (changed > 0) {
      settings.keys = keys;
      kv.set(AI_SETTINGS_KEY, JSON.stringify(settings));
    }
    return changed;
  } finally {
    if (!opts.kv) kv.close();
  }
}
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `npm test -- packages/core/src/ai/config.test.ts`
Expected: PASS — the new encryption tests plus ALL the pre-existing precedence tests (the round-trip `saveAiConfig`→`resolveAiConfig` "kv" test still yields `kv-key` because the same `dataDir` keyfile round-trips; the "file"/env/flag tests are unaffected since those values are plaintext).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/config.ts packages/core/src/ai/configStore.ts packages/core/src/ai/config.test.ts
git commit -m "feat(core): encrypt AI credentials at rest with injected/local encryptor + migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B4: Desktop injects the `safeStorage` encryptor + migrates on startup

**Files:**
- Create: `electron/keystore.cjs`
- Modify: `electron/main.cjs` (`ai:saveConfig` handler `:221-228`; startup migration in `app.whenReady`)

**Interfaces:**
- Produces: `electron/keystore.cjs` exports `createSafeStorageEncryptor()` returning an `Encryptor` backed by Electron `safeStorage` (`available = safeStorage.isEncryptionAvailable()`; `encrypt` → `tagCipher(safeStorage.encryptString(x).toString("base64"))`; `decrypt` → `safeStorage.decryptString(Buffer.from(untagCipher(x), "base64"))`). main.cjs passes `{ encryptor }` to `aiCore.saveAiConfig` and calls `aiCore.migrateAiKeystore({ encryptor })` once on startup.

- [ ] **Step 1: Implement `electron/keystore.cjs`**

```js
const { safeStorage } = require("electron");
const core = require("@portiq/core");

/**
 * Electron safeStorage-backed encryptor (OS keychain: macOS Keychain / Windows
 * DPAPI / Linux libsecret when a keyring is present). When encryption is not
 * available (e.g. a headless Linux desktop without a keyring), `available` is
 * false and @portiq/core's resolveEncryptor falls back to the local keyfile.
 */
function createSafeStorageEncryptor() {
  const available = safeStorage.isEncryptionAvailable();
  return {
    available,
    encrypt(plaintext) {
      return core.tagCipher(safeStorage.encryptString(plaintext).toString("base64"));
    },
    decrypt(ciphertext) {
      return safeStorage.decryptString(Buffer.from(core.untagCipher(ciphertext), "base64"));
    },
  };
}

module.exports = { createSafeStorageEncryptor };
```

- [ ] **Step 2: Wire the encryptor into `electron/main.cjs`**

Add the require near the top (after the `aiCore` require on line 5):

```js
const { createSafeStorageEncryptor } = require("./keystore.cjs");
```

Add a lazily-built encryptor holder (near the `let appStore = null;` from Part A, or after `let kvStore = null;`):

```js
let aiEncryptor = null;
function getAiEncryptor() {
  if (!aiEncryptor) aiEncryptor = createSafeStorageEncryptor();
  return aiEncryptor;
}
```

Replace the `ai:saveConfig` handler (`:221-228`):

```js
ipcMain.handle("ai:saveConfig", (_event, config) => {
  try {
    aiCore.saveAiConfig(config || {}, { encryptor: getAiEncryptor() });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
```

- [ ] **Step 3: Migrate existing plaintext AI secrets once on startup**

Inside `app.whenReady().then(() => { ... })` (starts at `electron/main.cjs:94`), after `initDb()` runs (or after the DB is available), add:

```js
  try {
    aiCore.migrateAiKeystore({ encryptor: getAiEncryptor() });
  } catch (err) {
    console.error("AI keystore migration failed:", err);
  }
```

(Place it after the DB/window setup so `safeStorage` is ready — `safeStorage` is only reliable after `app.ready`, which `app.whenReady()` guarantees.)

- [ ] **Step 4: Manual verification (safeStorage needs a real Electron runtime)**

Run: `npm run rebuild` then `npm run dev`. In the app, open Settings, enter an AI API key, save. Then inspect the DB:

```bash
sqlite3 "$HOME/Library/Application Support/Portiq/appdata.sqlite" "SELECT value FROM kv WHERE key='aiSettings';"
```

Expected: the `keys.*` values are `enc:v1:...` (not the plaintext key). Reload the app and confirm AI assist still works (the renderer receives decrypted keys via the resolved config path). Restore the Node ABI afterward: `npm rebuild better-sqlite3`.

- [ ] **Step 5: Commit**

```bash
git add electron/keystore.cjs electron/main.cjs
git commit -m "feat(electron): inject safeStorage encryptor for AI credentials + startup migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B5 (OPTIONAL): Encrypt the headless GitHub token

> Optional per the brief ("optionally GitHub"). The desktop stores its GitHub token in the renderer's
> `localStorage` (`ui_github_token`) — encrypting THAT is a renderer refactor and is out of scope here.
> This task covers only the headless `<dataDir>/config.json` `.githubToken` path used by CLI/MCP sync.

**Files:**
- Modify: `packages/core/src/sync/auth.ts` (decrypt a tagged token; add `saveGitHubToken`)
- Test: `packages/core/src/sync/auth.test.ts` (append)

**Interfaces:**
- Consumes: `isEncrypted, type Encryptor` from `../store/keystoreTypes`; `createLocalEncryptor` from `../store/keystore`.
- Produces: `resolveGitHubToken` decrypts the `config.json` `.githubToken` when it is `enc:v1:`-tagged (plaintext still works); `function saveGitHubToken(token: string, opts?: ResolveTokenOptions & { encryptor?: Encryptor }): void` writes an encrypted token into `config.json`.

- [ ] **Step 1: Write the failing test (append to `packages/core/src/sync/auth.test.ts`)**

```ts
import { saveGitHubToken } from "./auth";

describe("GitHub token encryption at rest", () => {
  it("saves an encrypted token and resolves it decrypted", () => {
    const dir = tempDir(); // reuse the file's existing temp-dir helper
    saveGitHubToken("ghp_secret", { dataDir: dir });
    const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(raw.githubToken).toMatch(/^enc:v1:/);
    expect(resolveGitHubToken({ dataDir: dir, env: {} })).toBe("ghp_secret");
  });

  it("still resolves a legacy plaintext token", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ githubToken: "ghp_plain" }));
    expect(resolveGitHubToken({ dataDir: dir, env: {} })).toBe("ghp_plain");
  });
});
```

(Ensure `readFileSync`, `writeFileSync`, `join` are imported in the test file; match the file's existing helpers.)

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: FAIL — `saveGitHubToken` not exported; the tampered/encrypted assertions fail.

- [ ] **Step 3: Implement in `packages/core/src/sync/auth.ts`**

Add imports:

```ts
import { writeFileSync } from "node:fs";
import { isEncrypted, type Encryptor } from "../store/keystoreTypes";
import { createLocalEncryptor } from "../store/keystore";
```

Change the `config.json` branch in `resolveGitHubToken` to decrypt when tagged:

```ts
      if (cfg && typeof cfg.githubToken === "string" && cfg.githubToken.trim()) {
        const raw = cfg.githubToken.trim();
        if (isEncrypted(raw)) {
          const enc = opts.encryptor?.available ? opts.encryptor : createLocalEncryptor(opts);
          return enc.decrypt(raw);
        }
        return raw;
      }
```

Add `encryptor?: Encryptor;` to `ResolveTokenOptions`, and add:

```ts
export function saveGitHubToken(token: string, opts: ResolveTokenOptions = {}): void {
  const enc = opts.encryptor?.available ? opts.encryptor : createLocalEncryptor(opts);
  const configPath = join(resolveDataDir(opts), "config.json");
  let cfg: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { cfg = JSON.parse(readFileSync(configPath, "utf8")); } catch { cfg = {}; }
  }
  cfg.githubToken = enc.encrypt(token);
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: PASS (existing auth precedence tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/auth.ts packages/core/src/sync/auth.test.ts
git commit -m "feat(core): encrypt the headless GitHub token in config.json (plaintext back-compat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.**
- Part A implements the design's fast-follow "normalize `appState` into per-entity rows so fine-grained concurrent writes become safe without whole-blob rewrites" (spec ~line 108/161): per-collection/per-environment rows (Task A2), forward migration from the blob (Task A3), a compatibility read/write path (`AppStateStore` facade, Task A4; recompose in Task A2), and updates to every surface — desktop main.cjs (A6), MCP write (A5), CLI (A7). The `setIfVersion`/`ConflictError` contract is preserved per entity (A2) and at the whole-state level (A4). Rollback/back-compat is explicit: the legacy blob is kept + dual-written, plus `recomposeLegacyBlob` (A3) and a `portiq config --recompose-legacy-blob` command (A7).
- Part B implements the design's Phase-4 "optional schema normalization" sibling and the AI Open Question on credential sourcing: encrypted-at-rest secrets (B3), OS-keychain key source via injected `safeStorage` on the desktop (B4) with a documented `node:crypto` headless fallback for CLI/MCP (B2), core stays framework-free (the desktop injects the encryptor; CLI/MCP use `createLocalEncryptor`), and existing plaintext secrets migrate on first run (`migrateAiKeystore`, startup call in B4; `saveAiConfig` re-encrypts on next save). Optional GitHub coverage is B5.

**Two-plans-in-one-file / cross-plan dependency.** Part A and Part B are independent (no ordering dependency) and operate on disjoint kv keys (`ent:*` + `appState` vs `aiSettings` + the `keystore.key` file). They share two files: `packages/core/src/index.ts` (each adds export lines — A adds `entityStore`/`migrate`; B adds `keystoreTypes`/`keystore`) and `electron/main.cjs` (A edits `db:saveState`/`db:loadState` + `initDb`; B edits `ai:saveConfig` + adds a startup migration and a require). If executed as parallel tracks, these are trivial, non-overlapping-region merges — flagged here so implementers coordinate them.

**Migration risk (flagged).** Part A is the highest-risk work in this file. Mitigations baked into the plan: (1) core is built and fully tested (A1–A4) before any surface is touched; (2) the existing `appStateStore.test.ts` and `mcp/src/store/write.test.ts` are retained as parity guards; (3) recompose fidelity — including arbitrary UI/draft `extras` — is asserted in A2/A3 so the desktop blob round-trips semantically identically; (4) the legacy blob is never deleted and is dual-written on every whole-state save, so a downgrade keeps working; (5) a manual GUI smoke (A6 Step 4) and a full-suite gate (A7 Step 8) close the loop. Known accepted limitation (documented, matches the design): a desktop whole-state save still overwrites entities changed concurrently by an MCP per-entity write (whole-blob writer touches everything); the fine-grained win is realized between per-entity writers and is why the desktop live-reload remains the reconciliation mechanism.

**No placeholders / type consistency.** Every step shows real code and exact commands. All referenced types exist or are defined here: `AppState`/`Collection`/`Environment`/`RequestItem`/`FolderItem` (`packages/core/src/model/*`), `KvStore`/`ConflictError` (`kvStore.ts`, extended in A1), `EntityStore`/`EntityIndex` (A2), `Encryptor` (B1), `AiConfig`/`AiKeys`/`AiConfigOptions` (`ai/config.ts`, extended in B3). The `entityStore.ts` ↔ `migrate.ts` import cycle is call-time only (no module-init evaluation), so it is safe under both Bundler (core) and classic (CLI/MCP) resolution.
