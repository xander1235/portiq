# Desktop Live-Reload on External DB Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Electron desktop app watch the shared `appdata.sqlite` for writes it did NOT originate (from the CLI/MCP or a second instance) and live-reload `appState` into the renderer, non-destructively prompting instead of clobbering when the user has un-persisted local edits.

**Architecture:** A framework-free, unit-tested `StateChangeDetector` (pure kv-version comparison + self-write suppression) plus a thin `watchStateFile()` (node:fs `watch` + debounce + fallback poll) land in `@portiq/core`'s Node barrel. `electron/main.cjs` seeds the detector at startup, records every version it writes itself in `db:saveState`, and broadcasts a new `state:externalChange` IPC event to all windows when the on-disk version advances past the last self-written value. `preload.cjs` exposes `onExternalStateChange`; the renderer subscribes, and — driven by a tiny pure `computeExternalReloadAction` helper keyed off a "pending autosave" ref — either silently reloads via the existing `applyPersistedState` path or shows a non-destructive banner.

**Tech Stack:** TypeScript (core, `moduleResolution: Bundler`), Vitest 4 (node env; `vi.useFakeTimers` + real temp-dir SQLite integration), `better-sqlite3` (via `@portiq/core` kv `getVersioned`), Node `fs.watch`, Electron IPC (`ipcMain`/`contextBridge`), React (renderer wiring).

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

- **Node-only barrel placement.** `stateWatcher.ts` imports `node:fs`; it is exported from the Node barrel
  `packages/core/src/index.ts` ONLY, alongside `./store/kvStore`. It must NOT be added to
  `packages/core/src/index.browser.ts` (which deliberately excludes `./store/*` — see that file's header
  comment `:20-24`). The renderer reaches this feature exclusively through `window.api` IPC, never by
  importing the module.
- **Version-based self-write suppression (not fs heuristics).** External-vs-self is decided by the kv
  `version` (a monotonic integer bumped by every `openKvStore().set`/`setIfVersion` — see
  `packages/core/src/store/kvStore.ts:38-50`), NOT by inspecting fs event metadata. `fs.watch` only *wakes*
  the detector cheaply; a low-frequency fallback poll covers WAL writes/checkpoints that `fs.watch` may not
  surface. The main process records every version it writes itself (`noteLocalWrite`) so its own saves are
  never re-broadcast.
- **Best-effort, non-destructive.** `electron/main.cjs`'s `db:saveState` uses unconditional
  `kvStore.set()` today (`:196-200`), NOT `setIfVersion`. This feature therefore SURFACES external changes
  but does not itself prevent the app's next autosave from overwriting a concurrent external write
  (whole-blob last-write-wins). Full protection requires optimistic writes in the save path + schema
  normalization (fast-follow — see spec `:108`, `:161`). Do NOT change the save path to `setIfVersion` in
  this plan; that is the storage-schema-normalization plan's job.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/core/src/store/stateWatcher.ts` | Create | `StateChangeDetector` (pure version-comparison + self-write suppression), `debounce`, `watchStateFile` (fs.watch + fallback poll wiring). |
| `packages/core/src/store/stateWatcher.detector.test.ts` | Create | Unit tests for `StateChangeDetector` + `debounce` (fake timers). |
| `packages/core/src/store/stateWatcher.watch.test.ts` | Create | Integration test: real temp SQLite + second connection proves external-write detection and self-write suppression. |
| `packages/core/src/index.ts` | Modify (`:6` region) | Add `export * from "./store/stateWatcher";` to the Node barrel (NOT the browser barrel). |
| `electron/main.cjs` | Modify (`:23`, `:94-104`, `:196-215`) | Seed detector, start/stop watcher, broadcast `state:externalChange`, record self-writes in `db:saveState`, reset on `db:clearAll`. |
| `electron/preload.cjs` | Modify (`:52`) | Expose `onExternalStateChange(callback)` bridge over the `state:externalChange` channel. |
| `src/types/global.d.ts` | Modify (`:75`) | Type the new `window.api.onExternalStateChange`. |
| `src/utils/externalReload.ts` | Create | Pure `computeExternalReloadAction({ hasPendingLocalEdits })` → `"reload" \| "prompt"`. |
| `src/utils/externalReload.test.ts` | Create | Unit test for the decision helper. |
| `src/App.tsx` | Modify (`:1077`, `:3138`) | `pendingSaveRef`, external-change subscription + reload, non-destructive banner. |
| `.changeset/phase4-live-reload.md` | Create | Changeset for the new core export. |
| `.superpowers/sdd/progress.md` | Modify (append) | Progress ledger entry. |

### Source-of-truth references (current code)

- **kv version mechanism:** `packages/core/src/store/kvStore.ts` — `KvStore.getVersioned(key): { value, version }` (`:14`, impl `:57-60`), `set()` returns the new version (`:61-63`, via `writeTxn` `:43-50`), `clear()` deletes `kv`+`kv_version` so version resets to 0 (`:67-70`). WAL enabled (`:25`), so a fresh `.get()` on the main connection sees other processes' committed writes.
- **Data dir / db path:** `packages/core/src/store/dataDir.ts` — `resolveDbPath(opts)` → `<dataDir>/appdata.sqlite` (`:35-37`), `DB_FILE = "appdata.sqlite"` (`:5`).
- **Node barrel:** `packages/core/src/index.ts:5-8` exports `./store/dataDir`, `./store/kvStore`, `./store/appStateStore`, `./store/portable`. **Browser barrel** `packages/core/src/index.browser.ts:20-24` deliberately excludes `./store/*`.
- **Electron main:** `electron/main.cjs` — `let kvStore = null;` (`:23`); `initDb()` opens `kvStore = core.openKvStore({ dataDir: dir })` (`:47-62`); `app.whenReady()` runs `initDb(); createWindow();` (`:94-104`); WS handlers broadcast to all windows via `BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(...))` (`:36-45`) — the pattern this plan mirrors; `db:saveState` = `kvStore.set(key, value)` (`:196-200`); `db:clearAll` = `kvStore.clear()` (`:207-215`).
- **Preload:** `electron/preload.cjs` — `contextBridge.exposeInMainWorld("api", {...})` (`:3`); the event-bridge pattern (`onWsMessage`) registers `ipcRenderer.on(channel, handler)` and returns an unsubscribe (`:23-27`); last property `saveAiConfig` has no trailing comma (`:52`).
- **global.d.ts:** `window.api` shape (`:37-79`); AI section (`:74-75`).
- **Renderer state:** `src/App.tsx` — `loadPersisted()` → `window.api.loadState("appState")` (`:940-949`); `applyPersistedState(state, historyValue?)` `useCallback` that rehydrates every field from a state blob (`:951-1041`, already reused by github-sync pull at `:1166-1169`); debounced 200ms autosave effect (`:1077-1160`); `savePersisted(value)` (`:1043-1051`); root JSX `return (<div className={styles.app}>` (`:3138-3139`); `useRef`/`useCallback`/`useState`/`useEffect` already imported (`:1`).
- **Test conventions (core):** `import { describe, it, expect } from "vitest";` + `afterEach` temp-dir cleanup via `mkdtempSync(join(tmpdir(), ...))` (see `packages/core/src/store/kvStore.test.ts:1-13`). Root `vitest.config.ts` includes `src/**/*.test.ts` and `packages/*/src/**/*.test.ts` (env `node`).

---

## Task 1: `StateChangeDetector` + `debounce` — pure change-detection logic

**Files:**
- Create: `packages/core/src/store/stateWatcher.ts` (detector + debounce portions)
- Test: `packages/core/src/store/stateWatcher.detector.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic; version supplied via an injected `readVersion: () => number`).
- Produces:
  - `interface StateChangeDetectorOptions { readVersion: () => number; onExternalChange: (version: number) => void; initialVersion?: number }`
  - `class StateChangeDetector` with `noteLocalWrite(version: number): void`, `reset(version?: number): void`, `check(): void`, `get version(): number`.
  - `function debounce(fn: () => void, waitMs: number): (() => void) & { cancel(): void }`

- [ ] **Step 1: Write the failing test `packages/core/src/store/stateWatcher.detector.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { StateChangeDetector, debounce } from "./stateWatcher";

describe("StateChangeDetector", () => {
  it("seeds lastKnownVersion from readVersion when no initialVersion is given", () => {
    const d = new StateChangeDetector({ readVersion: () => 5, onExternalChange: () => {} });
    expect(d.version).toBe(5);
  });

  it("fires onExternalChange when the on-disk version advances past last-known", () => {
    let disk = 5;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 5,
    });
    disk = 6;
    d.check();
    expect(seen).toEqual([6]);
    expect(d.version).toBe(6);
  });

  it("does NOT fire for this process's own writes (noteLocalWrite)", () => {
    let disk = 5;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 5,
    });
    disk = 6;
    d.noteLocalWrite(6); // the app itself just saved version 6
    d.check();
    expect(seen).toEqual([]);
  });

  it("does not re-fire when the version is unchanged", () => {
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => 7,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 7,
    });
    d.check();
    d.check();
    expect(seen).toEqual([]);
  });

  it("reset() re-syncs after a local clear so the reset itself is not treated as external", () => {
    let disk = 9;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 9,
    });
    disk = 0; // clear() wiped kv_version → version back to 0
    d.reset(0);
    d.check();
    expect(seen).toEqual([]);
  });
});

describe("debounce", () => {
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of calls into a single trailing invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d();
    d.cancel();
    vi.advanceTimersByTime(150);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/stateWatcher.detector.test.ts`
Expected: FAIL — `Failed to resolve import "./stateWatcher"` / `StateChangeDetector is not defined` (module does not exist yet).

- [ ] **Step 3: Create `packages/core/src/store/stateWatcher.ts` with the detector + debounce**

```ts
// @portiq/core state-change watcher (Node-only: uses node:fs `watch`).
//
// Detects appState writes made by OTHER processes (CLI/MCP or a second app
// instance) so the desktop app can live-reload. External-vs-self is decided by
// the kv `version` (monotonic, bumped by every set/setIfVersion — see
// kvStore.ts:38-50), NOT by fs event heuristics: the main process records every
// version it writes itself (noteLocalWrite) so its own saves are never
// re-broadcast. `fs.watch` only wakes the detector cheaply; a low-frequency
// poll covers WAL writes/checkpoints fs.watch may miss.
//
// Framework-free: exported from the Node barrel (src/index.ts) ONLY. NEVER add
// to src/index.browser.ts — node:fs is not renderer-safe.
import { watch, type FSWatcher } from "node:fs";
import { dirname, basename } from "node:path";

export interface StateChangeDetectorOptions {
  /** Reads the current on-disk version of the watched key
   *  (e.g. () => kv.getVersioned("appState").version). */
  readVersion: () => number;
  /** Invoked once per detected EXTERNAL advance, with the new version. */
  onExternalChange: (version: number) => void;
  /** Seed for last-known version (defaults to a single readVersion() call). */
  initialVersion?: number;
}

/**
 * Pure version-comparison state machine — no timers, no fs, fully unit-testable
 * with an injected readVersion. `check()` fires onExternalChange only when the
 * on-disk version has advanced past every version this process wrote itself.
 */
export class StateChangeDetector {
  private lastKnownVersion: number;

  constructor(private readonly opts: StateChangeDetectorOptions) {
    this.lastKnownVersion = opts.initialVersion ?? opts.readVersion();
  }

  /** Record a write THIS process just performed so it is not re-broadcast. */
  noteLocalWrite(version: number): void {
    if (version > this.lastKnownVersion) this.lastKnownVersion = version;
  }

  /** Re-sync after a local clear() (kv_version reset to 0). */
  reset(version = 0): void {
    this.lastKnownVersion = version;
  }

  /** Compare on-disk version to last-known; fire onExternalChange on advance. */
  check(): void {
    const current = this.opts.readVersion();
    if (current > this.lastKnownVersion) {
      this.lastKnownVersion = current;
      this.opts.onExternalChange(current);
    }
  }

  get version(): number {
    return this.lastKnownVersion;
  }
}

/** Trailing-edge debounce over the global timer functions. */
export function debounce(fn: () => void, waitMs: number): (() => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
```

Note: `watch`/`FSWatcher`/`dirname`/`basename` are imported now but consumed in Task 2 (`watchStateFile`). TypeScript will not error on an unused import under the core tsconfig (no `noUnusedLocals` for imports used as types), and this test file exercises only the two exports above. Task 2 adds `watchStateFile` to the same file, consuming them.

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- packages/core/src/store/stateWatcher.detector.test.ts`
Expected: PASS — 7 tests (5 detector + 2 debounce).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/stateWatcher.ts packages/core/src/store/stateWatcher.detector.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add StateChangeDetector + debounce for external-write detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `watchStateFile` — fs.watch + fallback poll wiring, exported from the Node barrel

**Files:**
- Modify: `packages/core/src/store/stateWatcher.ts` (append `watchStateFile`)
- Modify: `packages/core/src/index.ts` (add the Node-barrel export)
- Test: `packages/core/src/store/stateWatcher.watch.test.ts`

**Interfaces:**
- Consumes: `StateChangeDetector` (Task 1); at runtime, `kv.getVersioned("appState").version` supplied via `detector`'s `readVersion`; `resolveDbPath` (from `./dataDir`) used only in the test.
- Produces:
  - `interface WatchHandle { close(): void }`
  - `interface WatchStateFileOptions { dbPath: string; detector: StateChangeDetector; debounceMs?: number; pollMs?: number }`
  - `function watchStateFile(opts: WatchStateFileOptions): WatchHandle`
  - Barrel: `export * from "./store/stateWatcher";` on `packages/core/src/index.ts`.

- [ ] **Step 1: Write the failing test `packages/core/src/store/stateWatcher.watch.test.ts`**

This uses `better-sqlite3` via `openKvStore`, so it runs on the plain-Node ABI (the default for vitest; `pretest` does not rebuild for Electron). A second `openKvStore` connection simulates an external CLI/MCP process. A short `pollMs` makes detection deterministic regardless of `fs.watch` platform timing.

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore } from "./kvStore";
import { resolveDbPath } from "./dataDir";
import { StateChangeDetector, watchStateFile } from "./stateWatcher";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-watch-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("watchStateFile", () => {
  it("fires onExternalChange when a second connection writes appState", async () => {
    const dir = tempDir();
    const main = openKvStore({ dataDir: dir }); // the "desktop app" connection
    const seen: number[] = [];
    const detector = new StateChangeDetector({
      readVersion: () => main.getVersioned("appState").version,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 0,
    });
    const handle = watchStateFile({
      dbPath: resolveDbPath({ dataDir: dir }),
      detector,
      debounceMs: 10,
      pollMs: 20,
    });

    // Simulate an EXTERNAL process (CLI/MCP) writing via a separate connection.
    const external = openKvStore({ dataDir: dir });
    external.set("appState", JSON.stringify({ collections: [] }));
    external.close();

    await new Promise((r) => setTimeout(r, 150)); // allow watch/poll + debounce
    handle.close();
    main.close();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("does NOT fire for the main connection's own writes", async () => {
    const dir = tempDir();
    const main = openKvStore({ dataDir: dir });
    const seen: number[] = [];
    const detector = new StateChangeDetector({
      readVersion: () => main.getVersioned("appState").version,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 0,
    });
    const handle = watchStateFile({
      dbPath: resolveDbPath({ dataDir: dir }),
      detector,
      debounceMs: 10,
      pollMs: 20,
    });

    const version = main.set("appState", JSON.stringify({ collections: [] }));
    detector.noteLocalWrite(version); // main process records its own write

    await new Promise((r) => setTimeout(r, 150));
    handle.close();
    main.close();

    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- packages/core/src/store/stateWatcher.watch.test.ts`
Expected: FAIL — `watchStateFile is not exported by "./stateWatcher"`.

- [ ] **Step 3: Append `watchStateFile` to `packages/core/src/store/stateWatcher.ts`**

Add at the end of the file (the `node:fs`/`node:path` imports from Task 1 Step 3 are now consumed):

```ts
export interface WatchHandle {
  close(): void;
}

export interface WatchStateFileOptions {
  /** Absolute path to appdata.sqlite. */
  dbPath: string;
  detector: StateChangeDetector;
  /** Debounce window collapsing bursts of fs events (default 150ms). */
  debounceMs?: number;
  /** Fallback poll for WAL writes/checkpoints fs.watch may miss (default 2000ms; 0 disables). */
  pollMs?: number;
}

/**
 * Wire node:fs `watch` on the DB's DIRECTORY (SQLite WAL writes land in
 * `<db>-wal` and checkpoints touch the main file, so watching a single file is
 * unreliable — watch the dir and filter by basename), plus a low-frequency
 * fallback poll, both funnelling into a debounced detector.check(). This thin
 * wiring is confirmed in the interactive GUI smoke; the decision logic it drives
 * lives in StateChangeDetector (unit-tested in Task 1).
 */
export function watchStateFile(opts: WatchStateFileOptions): WatchHandle {
  const debounceMs = opts.debounceMs ?? 150;
  const pollMs = opts.pollMs ?? 2000;
  const dir = dirname(opts.dbPath);
  const base = basename(opts.dbPath);
  const fire = debounce(() => opts.detector.check(), debounceMs);

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, (_event, filename) => {
      // filename can be null on some platforms; when present it may be
      // "appdata.sqlite", "...-wal", "...-shm", or "...-journal".
      if (!filename || filename.toString().startsWith(base)) fire();
    });
  } catch {
    // Some platforms/filesystems don't support fs.watch; the poll covers us.
  }

  const interval = pollMs > 0 ? setInterval(() => opts.detector.check(), pollMs) : null;
  if (interval && typeof interval.unref === "function") interval.unref();

  return {
    close() {
      fire.cancel();
      if (watcher) watcher.close();
      if (interval) clearInterval(interval);
    },
  };
}
```

- [ ] **Step 4: Add the Node-barrel export in `packages/core/src/index.ts`**

After the line `export * from "./store/portable";` (`:8`) add:

```ts
export * from "./store/stateWatcher";
```

Do NOT add this to `packages/core/src/index.browser.ts` — it imports `node:fs` and must stay off the renderer bundle (mirrors the `./store/*` exclusion documented in that file's header `:20-24`).

- [ ] **Step 5: Run the tests, expect PASS**

Run: `npm test -- packages/core/src/store/stateWatcher.watch.test.ts`
Expected: PASS — 2 tests (external write detected; self-write suppressed).

Then confirm the barrel export compiles and the renderer barrel is untouched:

Run: `npm run build:core`
Expected: emits `packages/core/dist/store/stateWatcher.js` with no error.

Run: `npm test`
Expected: full suite green (existing tests + Task 1 + Task 2).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/stateWatcher.ts packages/core/src/store/stateWatcher.watch.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add watchStateFile (fs.watch + fallback poll) and export from Node barrel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Electron main — seed detector, broadcast `state:externalChange`, record self-writes

**Files:**
- Modify: `electron/main.cjs` (`:23`, `:94-104`, `:196-215`)

**Interfaces:**
- Consumes: `core.StateChangeDetector`, `core.watchStateFile` (Task 2, via the CJS `.` barrel); the existing `kvStore` (`:23`, opened in `initDb()` `:47-62`); `BrowserWindow.getAllWindows()` broadcast pattern (`:36-45`).
- Produces: a `state:externalChange` IPC push `{ version: number }` to every window; `stateDetector.noteLocalWrite(version)` recorded on every `appState` save; `stateDetector.reset(0)` on `db:clearAll`.
- No automated test (requires a live Electron window). Verified by the core tests (Task 1–2) + a `node -e` barrel smoke below + the interactive GUI smoke at the end.

- [ ] **Step 1: Add module-level watcher/detector handles**

In `electron/main.cjs`, replace line 23:

```js
let kvStore = null;
```

with:

```js
let kvStore = null;
let stateDetector = null;
let stateWatchHandle = null;
```

- [ ] **Step 2: Start the watcher after the DB + window are ready**

In `app.whenReady().then(() => { ... })` (`:94-104`), the body currently is:

```js
  httpTransport = new core.HttpTransport({ appVersion: app.getVersion() });
  initDb();
  createWindow();

  app.on("activate", () => {
```

Insert the watcher setup between `createWindow();` and `app.on("activate", ...)`:

```js
  httpTransport = new core.HttpTransport({ appVersion: app.getVersion() });
  initDb();
  createWindow();

  // Watch appdata.sqlite for writes made by OTHER processes (CLI/MCP or a
  // second instance) and live-reload the renderer. Self-writes are suppressed
  // via the kv version recorded in db:saveState below.
  const dbPath = path.join(app.getPath("userData"), "appdata.sqlite");
  stateDetector = new core.StateChangeDetector({
    readVersion: () => kvStore.getVersioned("appState").version,
    onExternalChange: (version) => {
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("state:externalChange", { version })
      );
    },
  });
  stateWatchHandle = core.watchStateFile({ dbPath, detector: stateDetector });

  app.on("activate", () => {
```

- [ ] **Step 3: Stop the watcher on quit**

Immediately after the existing `app.on("window-all-closed", ...)` block (`:106-110`), add:

```js
app.on("before-quit", () => {
  if (stateWatchHandle) {
    stateWatchHandle.close();
    stateWatchHandle = null;
  }
});
```

- [ ] **Step 4: Record self-writes in `db:saveState` and reset on `db:clearAll`**

Replace the `db:saveState` handler (`:196-200`):

```js
ipcMain.handle("db:saveState", async (_event, key, value) => {
  if (!kvStore) initDb();
  kvStore.set(key, value);
  return { ok: true };
});
```

with:

```js
ipcMain.handle("db:saveState", async (_event, key, value) => {
  if (!kvStore) initDb();
  const version = kvStore.set(key, value);
  // Record the app's own write so the watcher never re-broadcasts it.
  if (key === "appState" && stateDetector) stateDetector.noteLocalWrite(version);
  return { ok: true };
});
```

In the `db:clearAll` handler (`:207-215`), after `kvStore.clear();` add the detector reset:

```js
ipcMain.handle("db:clearAll", async () => {
  try {
    if (!kvStore) initDb();
    kvStore.clear();
    // clear() resets kv_version to 0; re-sync so the reset isn't seen external.
    if (stateDetector) stateDetector.reset(0);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});
```

- [ ] **Step 5: Verify the core barrel exposes the new symbols to the CJS Electron runtime**

The `@portiq/core` barrel pulls in `store/kvStore.ts` (`better-sqlite3`), so `require("@portiq/core")` needs the plain-Node ABI here.

Run:

```bash
npm rebuild better-sqlite3
npm run build:core
node -e "const c=require('@portiq/core'); if(typeof c.StateChangeDetector!=='function'||typeof c.watchStateFile!=='function') throw new Error('missing exports'); const d=new c.StateChangeDetector({readVersion:()=>0,onExternalChange:()=>{}}); if(typeof d.noteLocalWrite!=='function') throw new Error('detector shape'); console.log('ok');"
```

Expected: prints `ok` — proving the CJS `dist/` build exports `StateChangeDetector` and `watchStateFile`.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings unchanged).

- [ ] **Step 7: Commit**

```bash
git add electron/main.cjs
git commit -m "$(cat <<'EOF'
feat(electron): watch appdata.sqlite and broadcast external state changes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

> **Interactive smoke (deferred to user):** `npm run rebuild` (restore Electron ABI) then `npm run dev`. In a second terminal run a CLI write against the same store (e.g. `node -e "const {openKvStore}=require('@portiq/core'); const s=openKvStore(); s.set('appState', JSON.stringify({collections:[]})); s.close();"`), and confirm the app live-reloads (or, with local edits pending, shows the banner from Task 5). Not automatable here (Electron GUI + ABI switch).

---

## Task 4: Preload bridge + `global.d.ts` type for `onExternalStateChange`

**Files:**
- Modify: `electron/preload.cjs` (`:52`)
- Modify: `src/types/global.d.ts` (`:74-75`)

**Interfaces:**
- Consumes: the `state:externalChange` IPC channel (Task 3).
- Produces: `window.api.onExternalStateChange(callback: (data: { version: number }) => void): () => void` (returns an unsubscribe), mirroring `onWsMessage` (`preload.cjs:23-27`).

- [ ] **Step 1: Add the preload bridge**

In `electron/preload.cjs`, the api object's last property is (`:52`):

```js
  // ── AI ──
  saveAiConfig: (config) => ipcRenderer.invoke("ai:saveConfig", config)
});
```

Replace it with (add a trailing comma to `saveAiConfig`, then the new bridge):

```js
  // ── AI ──
  saveAiConfig: (config) => ipcRenderer.invoke("ai:saveConfig", config),

  // ── External DB change (live-reload) ──
  onExternalStateChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("state:externalChange", handler);
    return () => ipcRenderer.removeListener("state:externalChange", handler);
  }
});
```

- [ ] **Step 2: Type it in `src/types/global.d.ts`**

Replace the AI section (`:74-75`):

```ts
      // AI
      saveAiConfig?: (config: any) => Promise<any>;
```

with:

```ts
      // AI
      saveAiConfig?: (config: any) => Promise<any>;

      // External DB change (live-reload)
      onExternalStateChange?: (callback: (data: { version: number }) => void) => () => void;
```

- [ ] **Step 3: Type-check the renderer**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (the optional `onExternalStateChange?` matches the guarded `window.api?.onExternalStateChange` usage added in Task 5).

- [ ] **Step 4: Commit**

```bash
git add electron/preload.cjs src/types/global.d.ts
git commit -m "$(cat <<'EOF'
feat(electron): expose onExternalStateChange preload bridge + type it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Renderer — reload decision helper + subscription + non-destructive banner

**Files:**
- Create: `src/utils/externalReload.ts`
- Test: `src/utils/externalReload.test.ts`
- Modify: `src/App.tsx` (`:1077` autosave effect, new refs/state, subscription effect, banner in the root JSX `:3138`)

**Interfaces:**
- Consumes: `window.api.onExternalStateChange` (Task 4); `loadPersisted()` (`App.tsx:940`), `applyPersistedState()` (`App.tsx:951`).
- Produces:
  - `type ExternalReloadAction = "reload" | "prompt"`
  - `function computeExternalReloadAction(args: { hasPendingLocalEdits: boolean }): ExternalReloadAction`
  - Renderer behavior: on `state:externalChange`, reload silently when no autosave is pending, else show a banner offering "Reload from disk" / "Keep my changes".

> **"Unsaved local edits" is defined precisely here.** The app autosaves the whole `appState` blob on a 200ms debounce (`App.tsx:1077-1160`). "Unsaved local edits" ≡ *an autosave is currently armed but has not yet flushed* — tracked by `pendingSaveRef`, set `true` when the autosave effect body runs (state changed) and cleared `false` inside the debounced write. If nothing is pending, in-memory state equals what was last written to disk, so reloading a newer external write is non-destructive → reload silently. If a save is pending, reloading would discard the just-made edits → prompt instead. (This is the honest signal the current continuous-autosave architecture affords; a coarser "always prompt" would nag on every external write, and a finer per-field dirty model belongs to the schema-normalization plan.)

- [ ] **Step 1: Write the failing test `src/utils/externalReload.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeExternalReloadAction } from "./externalReload";

describe("computeExternalReloadAction", () => {
  it("reloads silently when there are no pending local edits", () => {
    expect(computeExternalReloadAction({ hasPendingLocalEdits: false })).toBe("reload");
  });

  it("prompts when there are pending local edits", () => {
    expect(computeExternalReloadAction({ hasPendingLocalEdits: true })).toBe("prompt");
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm test -- src/utils/externalReload.test.ts`
Expected: FAIL — `Failed to resolve import "./externalReload"`.

- [ ] **Step 3: Create `src/utils/externalReload.ts`**

```ts
export type ExternalReloadAction = "reload" | "prompt";

/**
 * Decide how to react to an external appState write detected by the main
 * process (delivered via window.api.onExternalStateChange).
 *
 * - "reload": no autosave is pending, so in-memory state already matches disk —
 *   silently pick up the newer external state.
 * - "prompt": the user has un-persisted local edits (an autosave is armed);
 *   reloading now would clobber them, so surface a non-destructive prompt.
 */
export function computeExternalReloadAction(args: { hasPendingLocalEdits: boolean }): ExternalReloadAction {
  return args.hasPendingLocalEdits ? "prompt" : "reload";
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm test -- src/utils/externalReload.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Track the pending-autosave signal in `App.tsx`**

Add the import near the other `./utils/*` imports (after `App.tsx:25`):

```tsx
import { computeExternalReloadAction } from "./utils/externalReload";
```

Add the refs/state alongside the other `useState`/`useRef` declarations (e.g. right after `const [hydrated, setHydrated] = useState(false);` at `App.tsx:295`):

```tsx
  // True while a debounced autosave is armed but not yet flushed — the signal
  // for "unsaved local edits" that gates live-reload (see utils/externalReload).
  const pendingSaveRef = useRef(false);
  const [externalReloadPrompt, setExternalReloadPrompt] = useState(false);
```

In the autosave effect (`App.tsx:1077-1121`), mark pending on entry and clear it inside the debounced write. The current effect body is:

```tsx
    const timer = setTimeout(() => {
      const value = JSON.stringify(payload);
      savePersisted(value);
    }, 200);
    return () => clearTimeout(timer);
```

Replace it with:

```tsx
    pendingSaveRef.current = true;
    const timer = setTimeout(() => {
      const value = JSON.stringify(payload);
      savePersisted(value);
      pendingSaveRef.current = false;
    }, 200);
    return () => clearTimeout(timer);
```

- [ ] **Step 6: Subscribe to external changes and reload**

Add this effect immediately after the autosave effect (after `App.tsx:1160`), so `loadPersisted`/`applyPersistedState` are in scope:

```tsx
  // Live-reload when another process (CLI/MCP or a second instance) writes the
  // shared appState. Reload silently when nothing local is pending; otherwise
  // show a non-destructive banner instead of clobbering local edits.
  const reloadFromDisk = useCallback(async () => {
    const value = await loadPersisted();
    if (value) {
      try {
        applyPersistedState(JSON.parse(value));
      } catch {
        // ignore corrupt state
      }
    }
    setExternalReloadPrompt(false);
  }, [applyPersistedState]);

  useEffect(() => {
    if (!window.api?.onExternalStateChange) return;
    const unsubscribe = window.api.onExternalStateChange(() => {
      const action = computeExternalReloadAction({ hasPendingLocalEdits: pendingSaveRef.current });
      if (action === "prompt") {
        setExternalReloadPrompt(true);
        return;
      }
      void reloadFromDisk();
    });
    return unsubscribe;
  }, [reloadFromDisk]);
```

- [ ] **Step 7: Render the non-destructive banner**

In the root JSX, the return opens (`App.tsx:3138-3139`):

```tsx
  return (
    <div className={styles.app}>
      <header className="flex justify-between items-center p-3 bg-panel border-b border-border shadow-sm" style={{ background: "linear-gradient(90deg, var(--panel-2), var(--panel))" }}>
```

Insert the banner as the first child of the root `<div>`, immediately before `<header>`:

```tsx
  return (
    <div className={styles.app}>
      {externalReloadPrompt && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          style={{ background: "rgba(56, 189, 248, 0.12)", color: "#7dd3fc", borderBottom: "1px solid rgba(56, 189, 248, 0.24)" }}
        >
          <span>This library was changed by another process. You have unsaved local edits.</span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { void reloadFromDisk(); }}>
              Reload from disk
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExternalReloadPrompt(false)}>
              Keep my changes
            </Button>
          </span>
        </div>
      )}
      <header className="flex justify-between items-center p-3 bg-panel border-b border-border shadow-sm" style={{ background: "linear-gradient(90deg, var(--panel-2), var(--panel))" }}>
```

("Keep my changes" dismisses the banner; the pending autosave then flushes and wins via last-write — acceptable per the whole-blob concurrency model. `Button` is already imported at `App.tsx:33`.)

- [ ] **Step 8: Verify — helper test, type-check, lint, full suite**

Run: `npm test -- src/utils/externalReload.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings unchanged).

Run: `npm test`
Expected: full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/utils/externalReload.ts src/utils/externalReload.test.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): live-reload appState on external DB change with unsaved-edits guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Gates, changeset, and progress ledger

**Files:**
- Create: `.changeset/phase4-live-reload.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run all gates**

```bash
npm rebuild better-sqlite3
npm run build:core
npm test
npm run lint
npx tsc --noEmit -p tsconfig.json
```

Expected: `build:core` emits `dist/store/stateWatcher.js`; `npm test` green (Task 1: 7 tests, Task 2: 2 tests, Task 5: 2 tests, plus the existing suite); `npm run lint` 0 errors; `tsc --noEmit` no new errors.

- [ ] **Step 2: Add a changeset `.changeset/phase4-live-reload.md`**

```md
---
"@portiq/core": minor
---

Add a Node-only state-change watcher to `@portiq/core`: `StateChangeDetector`
(kv-version comparison + self-write suppression) and `watchStateFile`
(`fs.watch` + fallback poll). The Electron desktop app uses these to detect
`appdata.sqlite` writes from other processes (CLI/MCP or a second instance) and
live-reload `appState`, prompting non-destructively when the user has unsaved
local edits.
```

- [ ] **Step 3: Append a Phase 4 (live-reload) section to `.superpowers/sdd/progress.md`**

Add at the end of the file:

```md
---

# Phase 4 (Hardening) — Desktop live-reload on external DB change — SDD Progress

Plan: docs/superpowers/plans/2026-07-25-desktop-live-reload.md
Spec: docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md (:106, :153, :161 Phase 4)
Branch: feat/portiq-core-phase0 (or a dedicated feat/portiq-live-reload branch)

## Tasks
- Task 1: core StateChangeDetector + debounce (pure, unit-tested with fake timers)
- Task 2: core watchStateFile (fs.watch on dir + fallback poll) + Node-barrel export (NOT browser barrel)
- Task 3: electron/main.cjs — seed detector, broadcast state:externalChange, noteLocalWrite in db:saveState, reset on db:clearAll, close on before-quit
- Task 4: preload onExternalStateChange bridge + global.d.ts type
- Task 5: renderer computeExternalReloadAction helper + subscription + non-destructive banner; pendingSaveRef defines "unsaved local edits"
- Task 6: gates + changeset + ledger

Notes:
- External-vs-self decided by kv version (monotonic), NOT fs heuristics; fs.watch only wakes the detector, a low-freq poll covers WAL writes/checkpoints.
- better-sqlite3 ABI: detector/debounce tests are ABI-agnostic (fake timers); watchStateFile integration test + the electron barrel smoke need plain-Node ABI (`npm rebuild better-sqlite3`); `npm run rebuild` restores Electron ABI for the GUI smoke.
- KNOWN LIMITATION (whole-blob, cross-plan): db:saveState still uses unconditional set() (NOT setIfVersion), so a concurrent app autosave can still clobber an external write before the reload lands. Full protection = optimistic writes in the save path + schema normalization → storage-schema-normalization plan (spec :108, :161).
- Full behavior confirmed in interactive GUI smoke (Electron window required).
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/phase4-live-reload.md .superpowers/sdd/progress.md
git commit -m "$(cat <<'EOF'
chore: changeset + progress ledger for desktop live-reload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage (design `:106` "watches for external DB changes and live-reloads appState, warning if it has unsaved local edits"; `:153`; `:161` Phase 4):**
- Main-process watch of `appdata.sqlite` with debounce + WAL handling — Tasks 1–2 (`watchStateFile` watches the DIR and filters by basename to catch `-wal`/`-shm`/checkpoints; a fallback poll covers events fs.watch misses). ✅
- Detects writes it did NOT originate / no feedback loop — Task 1 `StateChangeDetector` + `noteLocalWrite`, wired in Task 3's `db:saveState`; unit-proven (self-write suppression test) and integration-proven (second-connection test). ✅
- New IPC event to the renderer — `state:externalChange` (Task 3 broadcast, Task 4 preload + type). ✅
- Renderer reloads appState from disk — Task 5 reuses the existing `loadPersisted` → `applyPersistedState` path. ✅
- Non-destructive warning when unsaved edits, with "unsaved local edits" explicitly defined — Task 5 `pendingSaveRef` (armed-but-unflushed autosave) + `computeExternalReloadAction` + banner. ✅
- Tests: main-process change-detection/debounce/self-write-suppression extracted into a testable module — `packages/core/src/store/stateWatcher.ts`, unit-tested without Electron (Tasks 1–2); full behavior noted as confirmed in the GUI smoke (Task 3). ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code block is complete real code. The only forward reference is the `node:fs`/`node:path` import added in Task 1 Step 3 and consumed by `watchStateFile` in Task 2 — flagged inline.

**3. Type consistency:** `StateChangeDetector`, `StateChangeDetectorOptions`, `WatchHandle`, `WatchStateFileOptions`, `watchStateFile`, `debounce`, `ExternalReloadAction`, `computeExternalReloadAction` are used identically across tasks. `readVersion`/`onExternalChange`/`noteLocalWrite`/`reset`/`check`/`version` match between the class, its tests, and the Electron wiring. `onExternalStateChange` has one signature across preload (`:52`), `global.d.ts`, and `App.tsx`. `KvStore.getVersioned` / `.set` return types (used by `readVersion` and `noteLocalWrite(version)`) match `kvStore.ts:14,61`.

**4. Constraint adherence:** Node-only `stateWatcher` exported from `index.ts` only, never `index.browser.ts` (Task 2 Step 4); better-sqlite3 ABI called out on every SQLite-touching step; save path left as unconditional `set()` (the deliberate, flagged boundary vs the schema-normalization plan); commits are Conventional with the required trailer; only task-owned files staged.

---

## Execution Handoff

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between tasks (superpowers:subagent-driven-development). Tasks 1–2 (core) gate Task 3 (they must be built + exported first); Tasks 4–5 depend on Task 3's channel name; Task 6 last.

**2. Inline Execution** — execute in-session with checkpoints (superpowers:executing-plans).
