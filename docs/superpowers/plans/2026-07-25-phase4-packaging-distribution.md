# Phase 4 — Packaging & Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `portiq` (CLI) and `portiq-mcp` (MCP) binaries two ways per the spec's FIXED Distribution decision — (a) published to npm so `npx @portiq/cli` / `npx @portiq/mcp` and global installs work, and (b) dropped on `PATH` by the installed desktop app — while guaranteeing the packaged Electron app correctly bundles and resolves `@portiq/core` (including `dist/sync/index.cjs`, `dist/transport/grpc.js`, `dist/flows/index.js`).

**Architecture:** One esbuild bundle per binary (`portiq.bundle.cjs`, `portiq-mcp.bundle.cjs`) is the single distributable artifact reused by BOTH distribution paths. It inlines `@portiq/core` and all pure-JS deps and marks only the native `better-sqlite3` `--external`. On npm, `better-sqlite3` is a real runtime dependency (npm builds a Node-ABI binary on install). In the desktop app, the same bundles ship via `extraResources` and PATH shims run them through the app's own Electron-as-Node runtime (`ELECTRON_RUN_AS_NODE=1`), reusing the app's Electron-ABI `better-sqlite3` from `app.asar.unpacked`. This makes `@portiq/core` a **bundle**, not a separately published package, sidestepping the dual-consumer `exports` map and native-ABI problems.

**Tech Stack:** npm workspaces, esbuild 0.28.1 (hoisted at root `node_modules/.bin/esbuild`), electron-builder 26.8.1 (`@electron/asar` at `node_modules/.bin/asar`), Changesets 2.31 (`@changesets/cli`), GitHub Actions, Node 20 (CI), `better-sqlite3` (native), `@grpc/grpc-js` (pure JS).

## Global Constraints

- **Framework-free core.** `@portiq/core` must never import Electron/DOM/React. Node-only modules (better-sqlite3, node:os/http/child_process, @grpc/*, @octokit/rest) must stay OFF the browser barrels (`src/index.browser.ts`, `src/ai/index.browser.ts`) and behind Node-only subpath exports (`./flows`, `./grpc`, `./sync`). The Vite renderer resolves core via `vite.config.js` array/RegExp `resolve.alias` → browser barrels (rolldown-vite ignores the `browser` export condition; the alias is the working mechanism). Any new Node-only capability follows this same pattern or the renderer white-screens.
- **better-sqlite3 native ABI toggle.** One hoisted binary serves EITHER Node (vitest/CLI/MCP) OR Electron (`npm run rebuild`), not both. Tests run on the Node ABI; the GUI smoke needs `npm run rebuild` first.
- **ESM-octokit / CJS-sync boundary.** `@octokit/rest` is ESM-only; the CLI is CommonJS. `./sync` is esbuild-bundled to `dist/sync/index.cjs` (octokit inlined, native/runtime deps `--external`), exposed behind the `require` export condition. octokit must stay OUT of the Electron `.` dist. Any new sync/ESM dep follows this bundling approach.
- **Classic-resolution type wiring.** CLI/MCP builds use classic `moduleResolution:"Node"`, which IGNORES core's `exports` map. Subpath TYPES are supplied via `baseUrl`+`paths`→`../../node_modules/@portiq/core/src/...` in each package's `tsconfig.build.json` (NOT via `types` conditions in core's exports map — that would redirect vitest/renderer to stale dist). Follow this if a task adds a new core subpath the CLI/MCP consume.
- **Shared storage + concurrency.** All surfaces share one `<userData>/appdata.sqlite`; core's `resolveDataDir()` reproduces Electron's userData path (app name pinned to `"Portiq"`). Writes go through core's optimistic-concurrency path (`openKvStore().setIfVersion(key, value, expectedVersion)` → throws `ConflictError`). `assembleRequest()` on the top `@portiq/core` barrel is the CANONICAL rows→payload builder — never reintroduce a parallel copy.
- **Testing.** vitest (Node env for core/cli/mcp; jsdom where a renderer unit exists). TDD: write the failing test first, run it red, implement minimally, run it green, commit. The root `pretest` hook builds core/cli/mcp dists before the suite; CLI integration tests spawn the built binary. Keep the full suite green.
- **Commits.** Conventional Commits, appropriate scope, each ending with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Frequent, one deliverable each. NEVER stage the untracked junk dirs (`.claude/skills/ui-ux-pro-max/scripts/__pycache__/`, `ux-review-visuals/`). Stage only files your task changed.
- DRY, YAGNI, TDD, frequent commits. No placeholders in the plan (see format rules).

### Subsystem-specific constraints (Phase 4)

- **One artifact, two runtimes.** The esbuild bundle for each binary is produced ONCE (Task 2) and consumed by both the npm path (Task 6) and the desktop-drop path (Tasks 4–5). Never fork the bundling. `better-sqlite3` is the ONLY `--external`; everything else (including `@portiq/core`, `commander`, `@modelcontextprotocol/sdk`, `zod`, `fuse.js`, and the transitively-required octokit-inlined `dist/sync/index.cjs`) is inlined.
- **Cross-ABI rule for the desktop-drop path.** CLI/MCP binaries use `#!/usr/bin/env node` and normally run under the user's system Node, whose ABI differs from Electron's. The desktop app therefore does NOT ship a system-Node `better-sqlite3`; instead its PATH shims invoke the bundle through the app's Electron binary with `ELECTRON_RUN_AS_NODE=1` and `NODE_PATH` pointed at `…/app.asar.unpacked/node_modules`, reusing the app's Electron-ABI `better-sqlite3`. Run `npm run rebuild` before ANY packaged-app build so that unpacked binary is the Electron ABI.
- **electron-builder auto-includes only root production deps.** Root `package.json` lists ONLY `@portiq/core` (line 88) as a `@portiq/*` production dep, so electron-builder auto-packs core but NOT `@portiq/cli` / `@portiq/mcp`. The binaries reach the app exclusively via `extraResources` (Task 4), never via dependency auto-inclusion.
- **Publish safety.** `@portiq/core` stays `private:true` and is NEVER published (it is bundled). Only `@portiq/cli` and `@portiq/mcp` are published, `access: public`.

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `package.json` (root) | Modify | Add `build:mcp` + bundle steps to `package:*`/`package`/`package:release`; add `smoke:packaged`; electron-builder `files` (explicit core dist + `!src`), `asarUnpack` (better-sqlite3), `extraResources` (bundles + shims), `afterPack`, nsis `include`, linux `deb`/`rpm` `afterInstall`/`afterRemove`. |
| `packages/cli/package.json` | Modify | Add `bundle` script (esbuild); flip `private:false`; add `publishConfig.access:"public"`, `files:["dist"]`; point `bin.portiq` at `dist/portiq.bundle.cjs`; add real `dependencies` (`better-sqlite3` only); drop bundled workspace/lib deps. |
| `packages/mcp/package.json` | Modify | Same shape as CLI for `portiq-mcp` → `dist/portiq-mcp.bundle.cjs`. |
| `packages/core/package.json` | Modify | Stay `private:true` (explicit comment); add `files:["dist"]` defensively (no publish, but keeps `npm pack` audits clean). |
| `packages/cli/scripts/gen-version.mjs` | Create | Regenerate `packages/cli/src/version.ts` `CLI_VERSION` from the package's own `package.json` version (run in `build`). |
| `packages/mcp/scripts/gen-version.mjs` | Create | Same for `packages/mcp/src/version.ts` `SERVER_VERSION`. |
| `build/afterPack.cjs` | Create | electron-builder `afterPack` hook: writes per-OS PATH launcher scripts into the packaged app's `Resources/bin` (macOS/Linux `sh` launchers; Windows `.cmd`). |
| `build/installer.nsh` | Create | nsis `customInstall`/`customUnInstall` macros: add `resources\bin` to the user PATH on install, remove on uninstall. |
| `build/linux-after-install.sh` | Create | deb/rpm `postinst`: symlink `/usr/bin/portiq` + `/usr/bin/portiq-mcp` → the app's launcher scripts. |
| `build/linux-after-remove.sh` | Create | deb/rpm `postrm`: remove those symlinks. |
| `electron/main.cjs` | Modify | Add a "Install/Uninstall 'portiq' & 'portiq-mcp' commands in PATH" IPC handler + application-menu item (macOS/Linux symlink into `/usr/local/bin`, using `process.resourcesPath` / `process.execPath`). |
| `electron/preload.cjs` | Modify | Expose `installCliShims()` / `uninstallCliShims()`. |
| `src/types/global.d.ts` | Modify | Declare `installCliShims` / `uninstallCliShims` on `window.api`. |
| `scripts/smoke-packaged.mjs` | Create | Packaged-build smoke: `asar list` asserts core dist subpaths present; `ELECTRON_RUN_AS_NODE` require-core smoke; run each PATH launcher `--version`. |
| `.github/workflows/ci.yml` | Modify | Add a job that builds core+cli+mcp+bundles and runs `npm pack --dry-run` for both published packages. |
| `.github/workflows/release.yml` | Modify | Add a `publish-npm` job (Changesets action) publishing `@portiq/cli` + `@portiq/mcp`; ensure installer legs run `build:mcp` + bundles + `npm run rebuild` before packaging. |
| `.changeset/config.json` | Modify | `access: "public"` (line 8). |
| `.changeset/phase4-packaging.md` | Create | Changeset entry bumping `@portiq/cli` + `@portiq/mcp` for the first publish. |

---

## Current-state findings (grounding)

- Root `package.json`: `package`/`package:*` at lines 24–29 run `build:core` + `build:cli` + `vite build` + electron-builder — **`build:mcp` (line 16) is never invoked in any package path.** `build.files` (lines 47–51) = `["dist/**/*","electron/**/*","package.json"]`; no `asarUnpack`, no `extraResources`, no `afterPack`. nsis (71–75) has `deleteAppDataOnUninstall:true` only.
- `electron/main.cjs:4-9` requires `@portiq/core`, `@portiq/core/ai`, `@portiq/core/grpc` at runtime — a bundling miss breaks the installed app.
- `packages/core/dist` already emits `sync/index.cjs`, `transport/grpc.js`, `flows/index.js` (verified on disk). Core `exports` map (`packages/core/package.json:8-33`): `require`→dist, `import`→src, `browser`→browser barrel; `./sync` `require`→`dist/sync/index.cjs`.
- `packages/cli/package.json` + `packages/mcp/package.json` are `private:true`, no `files` field; `bin` → `dist/index.js` / `dist/bin.js`; shebangs are preserved by `tsc` (verified in built `dist`). `npm pack --dry-run -w @portiq/cli` currently ships `src/**` + test files.
- `packages/cli/dist/version.js` hardcodes `CLI_VERSION="0.0.0"`; `packages/mcp/dist/version.js` hardcodes `SERVER_VERSION="0.1.0"` — stale vs any published version.
- `.github/workflows/ci.yml` runs `npm run build` (vite) + lint + `npm test` only. `.github/workflows/release.yml` builds installers on tag (`package:mac|win|linux`) and attaches to the GitHub Release; publishes nothing to npm. `.changeset/config.json:8` = `"access":"restricted"`.
- Only `@portiq/core` is a root production dependency (`package.json:88`); `@portiq/cli`/`@portiq/mcp` are not, confirming they will NOT be auto-packed by electron-builder.

---

## Task 1: Wire `build:mcp` and the bundles into every package/build/CI path

**Files:**
- Modify: `package.json` (root) — `scripts` (lines 24–29), add `bundle:bins`
- Test: verification commands (script-wiring change; no unit test fits)

**Interfaces:**
- Consumes: existing `build:core` (line 15), `build:cli` (line 17), `build:mcp` (line 16).
- Produces: a `bundle:bins` script and updated `package`/`package:*`/`package:release` that run `build:core && build:cli && build:mcp && bundle:bins` before `vite build` + electron-builder, so `packages/{cli,mcp}/dist` and both `*.bundle.cjs` exist before any packaged build. (`bundle:bins` itself is IMPLEMENTED in Task 2; here we only wire the call sites so Task 2's output is exercised.)

- [ ] **Step 1: Add the `bundle:bins` aggregate script and thread `build:mcp` + `bundle:bins` into all packaging scripts**

In `package.json`, replace the `scripts` entries at lines 24–29 with:

```json
    "bundle:bins": "npm --workspace @portiq/cli run bundle && npm --workspace @portiq/mcp run bundle",
    "smoke:packaged": "node scripts/smoke-packaged.mjs",
    "package": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --publish never",
    "package:desktop": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --mac --win --linux --publish never",
    "package:mac": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --mac dmg zip --publish never",
    "package:win": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --win nsis portable --publish never",
    "package:linux": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --linux AppImage deb rpm --publish never",
    "package:release": "npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && electron-builder build --publish never"
```

- [ ] **Step 2: Verify the wiring is present (expect the new tokens in every package script)**

Run: `node -e "const s=require('./package.json').scripts; ['package','package:desktop','package:mac','package:win','package:linux','package:release'].forEach(k=>{if(!/build:mcp/.test(s[k])||!/bundle:bins/.test(s[k]))throw new Error('missing in '+k);}); console.log('ok')"`

Expected: prints `ok`. (If it throws, a script leg is missing `build:mcp` or `bundle:bins`.)

- [ ] **Step 3: Verify `build:mcp` produces the MCP dist**

Run: `npm run build:mcp`
Expected: exits 0; `packages/mcp/dist/bin.js` and `packages/mcp/dist/index.js` exist (`test -f packages/mcp/dist/bin.js && echo present`).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build(package): run build:mcp + bundle:bins in every package path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Self-contained esbuild bundles for `portiq` and `portiq-mcp`

**Files:**
- Modify: `packages/cli/package.json` (add `bundle` script)
- Modify: `packages/mcp/package.json` (add `bundle` script)
- Test: `packages/cli/src/__bundle__/bundle.smoke.test.ts` (vitest, Node env)

**Interfaces:**
- Consumes: built `packages/cli/dist/index.js` and `packages/mcp/dist/bin.js` (CJS, shebang preserved); esbuild at `node_modules/.bin/esbuild`.
- Produces:
  - `packages/cli/dist/portiq.bundle.cjs` — single-file CJS, executable (`0755`), shebang `#!/usr/bin/env node`, inlines `@portiq/core` + all pure-JS deps, marks `better-sqlite3` external.
  - `packages/mcp/dist/portiq-mcp.bundle.cjs` — same for the MCP entry.
  - Both bundles resolve `better-sqlite3` from the ambient `node_modules` at runtime (real dep on npm; `NODE_PATH` in the desktop shim).

- [ ] **Step 1: Write the failing bundle smoke test `packages/cli/src/__bundle__/bundle.smoke.test.ts`**

This asserts the CLI bundle is built, is a self-contained executable, and runs against a temp data dir without a `Cannot find module '@portiq/core'` error (proving core was inlined). Match the existing CLI integration style (spawning the built binary) used in `packages/cli/src/__integration__/cli.integration.test.ts`.

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BUNDLE = resolve(__dirname, "..", "..", "dist", "portiq.bundle.cjs");

describe("portiq.bundle.cjs", () => {
  beforeAll(() => {
    // The bundle is produced by `npm --workspace @portiq/cli run bundle`,
    // which the root `pretest` chain (build:cli) does NOT run — build it here.
    execFileSync("npm", ["--workspace", "@portiq/cli", "run", "bundle"], {
      cwd: resolve(__dirname, "..", "..", "..", ".."),
      stdio: "inherit",
    });
  });

  it("exists and is an executable single file with a node shebang", () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const mode = statSync(BUNDLE).mode;
    expect(mode & 0o111).toBeTruthy(); // any execute bit set
    const first = require("node:fs").readFileSync(BUNDLE, "utf8").slice(0, 20);
    expect(first.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("runs `where` against a temp data dir with @portiq/core inlined (no module-not-found)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "portiq-bundle-"));
    const out = execFileSync(process.execPath, [BUNDLE, "where", "--data-dir", dataDir], {
      encoding: "utf8",
    });
    expect(out).toContain(dataDir);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/cli/src/__bundle__/bundle.smoke.test.ts`
Expected: FAIL — `npm --workspace @portiq/cli run bundle` errors with `Missing script: "bundle"` (the script does not exist yet).

- [ ] **Step 3: Add the `bundle` script to `packages/cli/package.json`**

Replace the `scripts` block (`packages/cli/package.json:10-12`) with:

```json
  "scripts": {
    "build": "node scripts/gen-version.mjs && tsc -p tsconfig.build.json",
    "bundle": "npm run build && esbuild dist/index.js --bundle --platform=node --format=cjs --target=node20 --banner:js=\"#!/usr/bin/env node\" --external:better-sqlite3 --outfile=dist/portiq.bundle.cjs && node -e \"require('fs').chmodSync('dist/portiq.bundle.cjs', 0o755)\""
  },
```

Rationale: bundle from the already-compiled CJS `dist/index.js` (not TS), inlining `@portiq/core` (its `require` condition → `dist`, incl. the octokit-inlined `dist/sync/index.cjs`) and `commander`/`fuse.js`. `--external:better-sqlite3` is the only native module. The `--banner:js` re-adds the shebang esbuild would otherwise drop; `chmodSync` makes it directly executable. (`gen-version.mjs` is added in Task 6 Step 2; until then `build` will fail on the missing script — so this task's Step 5 temporarily runs `bundle` after a plain `tsc`. See Step 5.)

- [ ] **Step 4: Add the identical `bundle` script to `packages/mcp/package.json`**

Replace the `scripts` block (`packages/mcp/package.json:17-19`) with (preserving the existing `dist/package.json` `{type:commonjs}` writer so the bundled CJS is unambiguous):

```json
  "scripts": {
    "build": "node scripts/gen-version.mjs && tsc -p tsconfig.build.json && node -e \"require('fs').writeFileSync('dist/package.json', JSON.stringify({ type: 'commonjs' }))\"",
    "bundle": "npm run build && esbuild dist/bin.js --bundle --platform=node --format=cjs --target=node20 --banner:js=\"#!/usr/bin/env node\" --external:better-sqlite3 --outfile=dist/portiq-mcp.bundle.cjs && node -e \"require('fs').chmodSync('dist/portiq-mcp.bundle.cjs', 0o755)\""
  },
```

- [ ] **Step 5: (interim) provide the version generators so `build` succeeds now**

Task 6 formalizes version codegen, but Tasks 2's `build` already calls `gen-version.mjs`. Create both generators now so this task is self-contained. Create `packages/cli/scripts/gen-version.mjs`:

```js
// Regenerate src/version.ts CLI_VERSION from this package's package.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const src = `export const CLI_NAME = "portiq";\nexport const CLI_VERSION = "${pkg.version}";\n`;
writeFileSync(join(here, "..", "src", "version.ts"), src);
```

Create `packages/mcp/scripts/gen-version.mjs`:

```js
// Regenerate src/version.ts SERVER_VERSION from this package's package.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const src = `export const SERVER_NAME = "portiq-mcp";\nexport const SERVER_VERSION = "${pkg.version}";\n`;
writeFileSync(join(here, "..", "src", "version.ts"), src);
```

(These reproduce the exact constant names in the current `src/version.ts` files — `CLI_NAME`/`CLI_VERSION`, `SERVER_NAME`/`SERVER_VERSION` — verified from the built `dist/version.js`.)

- [ ] **Step 6: Build the bundles and run the smoke test — expect PASS**

Run: `npm run bundle:bins`
Expected: exits 0; `packages/cli/dist/portiq.bundle.cjs` and `packages/mcp/dist/portiq-mcp.bundle.cjs` exist.

Run: `npm test -- packages/cli/src/__bundle__/bundle.smoke.test.ts`
Expected: PASS (2 tests). If a `better-sqlite3` native-module error appears, run `npm rebuild better-sqlite3` (restore Node ABI) and re-run — the bundle marks it external, so it loads from the ambient `node_modules`.

- [ ] **Step 7: Verify the MCP bundle starts as a stdio server (lists tools, then exits on EOF)**

Run: `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | node packages/mcp/dist/portiq-mcp.bundle.cjs --data-dir "$(mktemp -d)" 2>/dev/null | head -c 200`
Expected: a JSON-RPC response line containing `"result"` and `"tools"` (proves `@modelcontextprotocol/sdk` + `@portiq/core` were inlined and the server boots).

- [ ] **Step 8: Full suite + lint + commit**

Run: `npm test` — expected: full suite green.
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/cli/package.json packages/mcp/package.json packages/cli/scripts/gen-version.mjs packages/mcp/scripts/gen-version.mjs packages/cli/src/version.ts packages/mcp/src/version.ts packages/cli/src/__bundle__/bundle.smoke.test.ts
git commit -m "build(cli,mcp): self-contained esbuild bundles (better-sqlite3 external)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Ensure electron-builder bundles core dist + packaged-build smoke

**Files:**
- Modify: `package.json` (root) — `build.files`, add `build.asarUnpack`
- Create: `scripts/smoke-packaged.mjs`
- Test: `scripts/smoke-packaged.mjs` IS the test (packaged-app verification; no unit test fits)

**Interfaces:**
- Consumes: the packaged app produced by `electron-builder --dir` under `release/` (e.g. macOS `release/mac-arm64/Portiq.app`, Linux `release/linux-unpacked`, Windows `release/win-unpacked`); `node_modules/.bin/asar`.
- Produces: guaranteed presence + resolvability of `@portiq/core/dist/{sync/index.cjs, transport/grpc.js, flows/index.js, index.js}` inside `app.asar`, and a require-core smoke via the packaged Electron binary run as Node.

- [ ] **Step 1: Make the core-dist inclusion explicit and unpack the native module in `package.json`**

Replace `build.files` (lines 47–51) and add `asarUnpack` immediately after it:

```json
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json",
      "node_modules/@portiq/core/dist/**/*",
      "node_modules/@portiq/core/package.json",
      "!node_modules/@portiq/core/src/**",
      "!node_modules/@portiq/core/node_modules/**"
    ],
    "asarUnpack": [
      "**/node_modules/better-sqlite3/**",
      "**/*.node"
    ],
```

Rationale: electron-builder already auto-packs the `@portiq/core` symlink (root production dep), but the explicit `dist/**` + `!src/**` entries make the sync/grpc/flows dist inclusion deterministic and strip the unrunnable TS `src` (core's `import` export condition points at `src/*.ts`). `asarUnpack` guarantees the native `better-sqlite3` `.node` binary is extractable and loadable from `app.asar.unpacked` (both by the app and by the Electron-as-Node shims in Task 4).

- [ ] **Step 2: Write the packaged smoke `scripts/smoke-packaged.mjs`**

```js
// Packaged-build smoke: proves @portiq/core (incl. sync/grpc/flows dist) is bundled
// into app.asar and requireable via the packaged Electron binary run as Node.
// Assumes `electron-builder --dir` has produced an unpacked app under release/.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const ASAR = join("node_modules", ".bin", "asar");

// Locate the unpacked app dir + its app.asar + the Electron executable per-OS.
function layout() {
  const p = platform();
  if (p === "darwin") {
    const app = join("release", process.arch === "arm64" ? "mac-arm64" : "mac", "Portiq.app");
    return {
      asar: join(app, "Contents", "Resources", "app.asar"),
      exe: join(app, "Contents", "MacOS", "Portiq"),
    };
  }
  if (p === "win32") {
    return {
      asar: join("release", "win-unpacked", "resources", "app.asar"),
      exe: join("release", "win-unpacked", "Portiq.exe"),
    };
  }
  return {
    asar: join("release", "linux-unpacked", "resources", "app.asar"),
    exe: join("release", "linux-unpacked", "portiq"),
  };
}

const { asar, exe } = layout();
if (!existsSync(asar)) {
  console.error(`smoke: app.asar not found at ${asar}. Run an electron-builder --dir build first.`);
  process.exit(1);
}

// 1) Assert the core dist subpaths the app requires at runtime are inside the asar.
const listing = execFileSync(process.execPath, [ASAR, "list", asar], { encoding: "utf8" });
const required = [
  "node_modules/@portiq/core/dist/index.js",
  "node_modules/@portiq/core/dist/sync/index.cjs",
  "node_modules/@portiq/core/dist/transport/grpc.js",
  "node_modules/@portiq/core/dist/flows/index.js",
];
const missing = required.filter((f) => !listing.includes(f));
if (missing.length) {
  console.error("smoke: MISSING from app.asar:\n" + missing.join("\n"));
  process.exit(1);
}
console.log("smoke: core dist subpaths present in app.asar");

// 2) Require core through the packaged Electron binary run as plain Node,
//    proving the runtime resolution main.cjs relies on (main.cjs:4-9) works.
const probe =
  "const c=require('@portiq/core');" +
  "const g=require('@portiq/core/grpc');" +
  "require('@portiq/core/sync');" +
  "if(typeof c.resolveDataDir!=='function')throw new Error('resolveDataDir missing');" +
  "if(typeof g.GrpcTransport!=='function')throw new Error('GrpcTransport missing');" +
  "console.log('smoke: require @portiq/core + /grpc + /sync OK');";
execFileSync(exe, ["-e", probe], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
```

- [ ] **Step 3: Restore the Electron ABI, build an unpacked app, and run the smoke**

Run: `npm run rebuild` (rebuilds `better-sqlite3` for the Electron ABI — mandatory before any packaged build)
Run: `npm run build:core && npm run build:cli && npm run build:mcp && npm run bundle:bins && vite build && npx electron-builder build --dir --publish never`
Run: `npm run smoke:packaged`

Expected output (macOS/Linux/Windows respectively resolve the right layout):
```
smoke: core dist subpaths present in app.asar
smoke: require @portiq/core + /grpc + /sync OK
```
If it reports MISSING, the `files` globs are wrong; if the require probe throws `Cannot find module`, core was packed without dist. (`--dir` is used for speed — it skips DMG/NSIS compression but produces the identical `app.asar` layout.)

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/smoke-packaged.mjs
git commit -m "build(electron): explicitly bundle @portiq/core dist + asarUnpack native + packaged smoke

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Ship the binaries in the app + macOS/Linux desktop PATH drop (extraResources + afterPack + in-app install)

**Files:**
- Modify: `package.json` (root) — add `build.extraResources`, `build.afterPack`
- Create: `build/afterPack.cjs`
- Modify: `electron/main.cjs` (in-app "install/uninstall CLI commands" IPC + menu)
- Modify: `electron/preload.cjs` (expose `installCliShims`/`uninstallCliShims`)
- Modify: `src/types/global.d.ts` (declare the two methods)
- Test: extend `scripts/smoke-packaged.mjs` (run the launcher `--version`)

**Interfaces:**
- Consumes: `packages/cli/dist/portiq.bundle.cjs`, `packages/mcp/dist/portiq-mcp.bundle.cjs` (Task 2); packaged app `Resources` (Task 3).
- Produces:
  - App resources: `Resources/bin/portiq.bundle.cjs`, `Resources/bin/portiq-mcp.bundle.cjs`, plus generated launchers `Resources/bin/portiq(.cmd)` and `Resources/bin/portiq-mcp(.cmd)` that run the bundle under the app's Electron-as-Node runtime.
  - `window.api.installCliShims(): Promise<{ ok: true, paths: string[] } | { error: string }>` and `uninstallCliShims(): Promise<{ ok: true } | { error: string }>` (macOS/Linux symlink into `/usr/local/bin`).

- [ ] **Step 1: Add `extraResources` + `afterPack` to `package.json`**

Immediately after the `asarUnpack` block from Task 3, add:

```json
    "extraResources": [
      { "from": "packages/cli/dist/portiq.bundle.cjs", "to": "bin/portiq.bundle.cjs" },
      { "from": "packages/mcp/dist/portiq-mcp.bundle.cjs", "to": "bin/portiq-mcp.bundle.cjs" }
    ],
    "afterPack": "build/afterPack.cjs",
```

- [ ] **Step 2: Create the `afterPack` launcher generator `build/afterPack.cjs`**

Writes per-OS launcher scripts next to the bundles inside `Resources/bin`. Each launcher runs the bundle through THIS app's Electron binary with `ELECTRON_RUN_AS_NODE=1`, and sets `NODE_PATH` to the unpacked `node_modules` so the external `better-sqlite3` resolves to the app's Electron-ABI copy. Paths are RELATIVE to the launcher's own location so the app is relocatable.

```js
// electron-builder afterPack hook: emit PATH launcher scripts into Resources/bin.
const fs = require("fs");
const path = require("path");

/** @param {{ appOutDir: string, electronPlatformName: string, packager: any }} context */
exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const exeName = packager.executableName || "Portiq";

  // Resolve Resources/bin and the app executable per platform.
  let resourcesBin;
  let launchers; // { name, contents }[]
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    const appDir = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    resourcesBin = path.join(appDir, "Contents", "Resources", "bin");
    const exeRel = `../../MacOS/${exeName}`;
    const nodePathRel = `../app.asar.unpacked/node_modules`;
    launchers = shLaunchers(exeRel, nodePathRel);
  } else if (electronPlatformName === "linux") {
    resourcesBin = path.join(appOutDir, "resources", "bin");
    const exeRel = `../../${exeName}`;
    const nodePathRel = `../app.asar.unpacked/node_modules`;
    launchers = shLaunchers(exeRel, nodePathRel);
  } else {
    // win32
    resourcesBin = path.join(appOutDir, "resources", "bin");
    const exeRel = `..\\..\\${exeName}.exe`;
    const nodePathRel = `..\\app.asar.unpacked\\node_modules`;
    launchers = cmdLaunchers(exeRel, nodePathRel);
  }

  fs.mkdirSync(resourcesBin, { recursive: true });
  for (const { name, contents, exec } of launchers) {
    const p = path.join(resourcesBin, name);
    fs.writeFileSync(p, contents);
    if (exec) fs.chmodSync(p, 0o755);
  }
};

function shLaunchers(exeRel, nodePathRel) {
  const body = (bundle) =>
    `#!/bin/sh\n` +
    `DIR="$(cd "$(dirname "$0")" && pwd)"\n` +
    `export ELECTRON_RUN_AS_NODE=1\n` +
    `export NODE_PATH="$DIR/${nodePathRel}"\n` +
    `exec "$DIR/${exeRel}" "$DIR/${bundle}" "$@"\n`;
  return [
    { name: "portiq", contents: body("portiq.bundle.cjs"), exec: true },
    { name: "portiq-mcp", contents: body("portiq-mcp.bundle.cjs"), exec: true },
  ];
}

function cmdLaunchers(exeRel, nodePathRel) {
  const body = (bundle) =>
    `@echo off\r\n` +
    `set "ELECTRON_RUN_AS_NODE=1"\r\n` +
    `set "NODE_PATH=%~dp0${nodePathRel}"\r\n` +
    `"%~dp0${exeRel}" "%~dp0${bundle}" %*\r\n`;
  return [
    { name: "portiq.cmd", contents: body("portiq.bundle.cjs"), exec: false },
    { name: "portiq-mcp.cmd", contents: body("portiq-mcp.bundle.cjs"), exec: false },
  ];
}
```

- [ ] **Step 3: Add the in-app install/uninstall IPC to `electron/main.cjs`**

macOS DMG and generic installs have no OS-level post-install script, so the desktop app itself offers to symlink its launchers into `/usr/local/bin` (the VS Code `code` / Docker pattern). Add near the other `ipcMain.handle(...)` registrations in `electron/main.cjs`:

```js
// ── Install/uninstall the `portiq` / `portiq-mcp` commands on PATH ──
// Symlinks the app's Resources/bin launchers into /usr/local/bin (macOS/Linux).
// Windows PATH is handled by the NSIS installer, so this is a no-op there.
const PATH_TARGET_DIR = "/usr/local/bin";
function shimSourceDir() {
  // process.resourcesPath = .../Contents/Resources (mac) or .../resources (linux/win)
  return path.join(process.resourcesPath, "bin");
}
ipcMain.handle("cli:installShims", async () => {
  if (process.platform === "win32") {
    return { error: "On Windows the installer manages PATH automatically." };
  }
  try {
    const src = shimSourceDir();
    const made = [];
    for (const name of ["portiq", "portiq-mcp"]) {
      const from = path.join(src, name);
      const to = path.join(PATH_TARGET_DIR, name);
      try { fs.unlinkSync(to); } catch { /* not present */ }
      fs.symlinkSync(from, to);
      made.push(to);
    }
    return { ok: true, paths: made };
  } catch (err) {
    // EACCES on /usr/local/bin is expected without admin rights.
    return { error: err && err.message ? err.message : String(err) };
  }
});
ipcMain.handle("cli:uninstallShims", async () => {
  if (process.platform === "win32") return { ok: true };
  try {
    for (const name of ["portiq", "portiq-mcp"]) {
      try { fs.unlinkSync(path.join(PATH_TARGET_DIR, name)); } catch { /* absent */ }
    }
    return { ok: true };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
});
```

(`path` and `fs` are already required at `electron/main.cjs:2-3`.)

- [ ] **Step 4: Expose the bridge in `electron/preload.cjs` and declare types**

In `electron/preload.cjs`, add to the exposed `api` object:

```js
  // ── CLI PATH commands ──
  installCliShims: () => ipcRenderer.invoke("cli:installShims"),
  uninstallCliShims: () => ipcRenderer.invoke("cli:uninstallShims"),
```

In `src/types/global.d.ts`, add to the `window.api` interface:

```ts
      // CLI PATH commands
      installCliShims: () => Promise<{ ok: true; paths: string[] } | { error: string }>;
      uninstallCliShims: () => Promise<{ ok: true } | { error: string }>;
```

- [ ] **Step 5: Extend the packaged smoke to exercise the launcher `--version`**

Append to `scripts/smoke-packaged.mjs` (after the require-core probe), so the smoke proves the generated launcher runs the bundle through Electron-as-Node and prints a version:

```js
// 3) Run the generated PATH launcher and assert it prints a version.
import { join as pjoin } from "node:path";
const binDir = pjoin(
  asar.replace(/app\.asar$/, ""), // .../Resources/ or .../resources/
  "bin",
);
const launcher = platform() === "win32" ? pjoin(binDir, "portiq.cmd") : pjoin(binDir, "portiq");
const ver = execFileSync(launcher, ["--version"], { encoding: "utf8" }).trim();
if (!/\d+\.\d+\.\d+/.test(ver)) {
  console.error(`smoke: launcher --version returned unexpected output: ${ver}`);
  process.exit(1);
}
console.log(`smoke: PATH launcher OK (portiq --version -> ${ver})`);
```

- [ ] **Step 6: Rebuild the unpacked app and run the smoke**

Run: `npm run rebuild`
Run: `npm run bundle:bins && vite build && npx electron-builder build --dir --publish never`
Run: `npm run smoke:packaged`
Expected: prints the three `smoke:` OK lines, ending with `smoke: PATH launcher OK (portiq --version -> <semver>)`.

- [ ] **Step 7: Build renderer + lint + full suite + commit**

Run: `npm run build` — expected: Vite build clean (no attempt to bundle `@portiq/core/grpc` or `node:*` into the renderer; the new `window.api` methods are types only).
Run: `npm run lint` — expected: no new errors.
Run: `npm test` — expected: full suite green.

```bash
git add package.json build/afterPack.cjs electron/main.cjs electron/preload.cjs src/types/global.d.ts scripts/smoke-packaged.mjs
git commit -m "feat(desktop): ship portiq/portiq-mcp binaries + macOS/Linux PATH install

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Installer-driven PATH drop + uninstall cleanup (Windows NSIS + Linux deb/rpm)

**Files:**
- Modify: `package.json` (root) — nsis `include`; linux `deb`/`rpm` `afterInstall`/`afterRemove`
- Create: `build/installer.nsh`
- Create: `build/linux-after-install.sh`
- Create: `build/linux-after-remove.sh`
- Test: verification commands (installer packaging — no unit test fits)

**Interfaces:**
- Consumes: the `Resources/bin` launchers from Task 4 (`portiq.cmd`/`portiq-mcp.cmd` on Windows; `portiq`/`portiq-mcp` on Linux).
- Produces: on Windows install, `$INSTDIR\resources\bin` on the user PATH (removed on uninstall); on Linux deb/rpm install, `/usr/bin/portiq` + `/usr/bin/portiq-mcp` symlinks (removed on remove).

- [ ] **Step 1: Wire the installer hooks in `package.json`**

Add `"include": "build/installer.nsh"` to the existing `nsis` block (lines 71–75) and add `afterInstall`/`afterRemove` to the `linux` block (lines 76–85). The updated `nsis` and the additions to `linux`:

```json
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "deleteAppDataOnUninstall": true,
      "include": "build/installer.nsh"
    },
```

Add these two keys inside the `linux` object (alongside `icon`, `category`, `maintainer`, `target`):

```json
      "afterInstall": "build/linux-after-install.sh",
      "afterRemove": "build/linux-after-remove.sh",
```

- [ ] **Step 2: Create `build/installer.nsh` (Windows PATH add/remove)**

Uses HKCU `Environment` registry + a `WM_SETTINGCHANGE` broadcast — no external NSIS plugin required. electron-builder invokes these custom macros during install/uninstall.

```nsis
!macro customInstall
  ; Append the app's bin dir to the per-user PATH (idempotent).
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\resources\bin"
  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$1"
  ${Else}
    ; Only append if not already present.
    ${WordFind} "$0" "$1" "E+1{" $2
    ${If} $2 == "$0"
      WriteRegExpandStr HKCU "Environment" "Path" "$0;$1"
    ${EndIf}
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  ; Remove the app's bin dir from the per-user PATH.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\resources\bin"
  ${WordReplace} "$0" ";$1" "" "+" $2
  ${WordReplace} "$2" "$1" "" "+" $3
  WriteRegExpandStr HKCU "Environment" "Path" "$3"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
```

- [ ] **Step 3: Create the Linux maintainer scripts**

`build/linux-after-install.sh` (deb `postinst` / rpm `%post`; electron-builder installs the app under `/opt/${productName}` = `/opt/Portiq`, executable `portiq`, resources at `/opt/Portiq/resources`):

```sh
#!/bin/bash
set -e
APP_BIN="/opt/Portiq/resources/bin"
if [ -x "$APP_BIN/portiq" ]; then
  ln -sf "$APP_BIN/portiq" /usr/bin/portiq
fi
if [ -x "$APP_BIN/portiq-mcp" ]; then
  ln -sf "$APP_BIN/portiq-mcp" /usr/bin/portiq-mcp
fi
exit 0
```

`build/linux-after-remove.sh` (deb `postrm` / rpm `%postun`):

```sh
#!/bin/bash
set -e
rm -f /usr/bin/portiq /usr/bin/portiq-mcp
exit 0
```

- [ ] **Step 4: Make the Linux scripts executable and verify referenced paths match electron-builder's layout**

Run: `chmod +x build/linux-after-install.sh build/linux-after-remove.sh`
Run: `node -e "const b=require('./package.json').build; if(b.linux.afterInstall!=='build/linux-after-install.sh')throw new Error('afterInstall not wired'); if(b.nsis.include!=='build/installer.nsh')throw new Error('nsis include not wired'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Package Linux and confirm the maintainer scripts are embedded**

Run: `npm run rebuild && npm run package:linux`
Expected: exits 0; a `.deb` is produced under `release/`. Confirm the postinst symlink command is embedded:

Run: `dpkg-deb --info release/*.deb 2>/dev/null | grep -A2 -i "post" || ar p release/*.deb control.tar.gz | tar xzO ./postinst 2>/dev/null | grep -q "ln -sf" && echo "postinst wires /usr/bin symlinks"`
Expected: prints `postinst wires /usr/bin symlinks` (on a Linux runner; on macOS dev this step is CI-only — note it as a CI verification, since `.deb` build requires a Linux host/`fpm`).

- [ ] **Step 6: Commit**

```bash
git add package.json build/installer.nsh build/linux-after-install.sh build/linux-after-remove.sh
git commit -m "feat(installer): drop portiq/portiq-mcp on PATH (NSIS + deb/rpm) with uninstall cleanup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Make `@portiq/cli` + `@portiq/mcp` publishable to npm

**Files:**
- Modify: `packages/cli/package.json` (publishable metadata + bin → bundle + deps)
- Modify: `packages/mcp/package.json` (same)
- Modify: `packages/core/package.json` (stay private; add `files`)
- Modify: `.changeset/config.json` (`access: "public"`)
- Create: `.changeset/phase4-packaging.md`
- Test: `npm pack --dry-run` audits + local tarball install smoke

**Interfaces:**
- Consumes: the bundles from Task 2 (`dist/portiq.bundle.cjs`, `dist/portiq-mcp.bundle.cjs`); `gen-version.mjs` (Task 2 Step 5).
- Produces: publishable `@portiq/cli` / `@portiq/mcp` whose `bin` runs the self-contained bundle with `better-sqlite3` as the sole runtime dependency (npm builds a Node-ABI native binary on install). `@portiq/core` is bundled, NOT published.

**Decision — publish core vs bundle:** BUNDLE. `@portiq/core` uses a dual-consumer `exports` map (`import`→`src/*.ts` for the in-repo renderer/vitest; `require`→`dist` for CJS consumers) that is correct in the monorepo but ships unrunnable `.ts` to external `import` consumers, and it carries a native `better-sqlite3` dependency and Node-only subpath exports. Publishing it as a standalone package would force resolving all of that for external consumers. Since Task 2 already inlines core into each binary via the `require`→`dist` condition (octokit-inlined `dist/sync/index.cjs` included), bundling is the DRY choice and the single artifact already serves the desktop-drop path. Core therefore stays `private:true`.

- [ ] **Step 1: Make `packages/cli/package.json` publishable**

Rewrite it to (keeping `scripts` from Task 2 Step 3):

```json
{
  "name": "@portiq/cli",
  "version": "0.1.0",
  "private": false,
  "type": "commonjs",
  "description": "Portiq CLI — run saved API requests, collections, and flows from the terminal.",
  "license": "AGPL-3.0-only",
  "repository": { "type": "git", "url": "https://github.com/xander1235/portiq.git", "directory": "packages/cli" },
  "publishConfig": { "access": "public" },
  "bin": { "portiq": "dist/portiq.bundle.cjs" },
  "main": "dist/portiq.bundle.cjs",
  "files": ["dist/portiq.bundle.cjs", "README.md"],
  "scripts": {
    "build": "node scripts/gen-version.mjs && tsc -p tsconfig.build.json",
    "bundle": "npm run build && esbuild dist/index.js --bundle --platform=node --format=cjs --target=node20 --banner:js=\"#!/usr/bin/env node\" --external:better-sqlite3 --outfile=dist/portiq.bundle.cjs && node -e \"require('fs').chmodSync('dist/portiq.bundle.cjs', 0o755)\"",
    "prepack": "npm run bundle"
  },
  "dependencies": { "better-sqlite3": "^12.11.1" }
}
```

Rationale: version bumped to `0.1.0` (first published CLI release; `gen-version.mjs` propagates it to `--version`). `files` ships ONLY the bundle + README (not `src`, not the un-bundled `dist/**`). `bin` → the bundle. `@portiq/core`, `commander`, `fuse.js` are dropped from `dependencies` because they are inlined; `better-sqlite3` remains a real dep so `npm i`/`npx` builds a Node-ABI native binary. `prepack` guarantees the bundle exists in the tarball even if a publisher runs `npm publish` directly.

- [ ] **Step 2: Make `packages/mcp/package.json` publishable**

```json
{
  "name": "@portiq/mcp",
  "version": "0.1.0",
  "private": false,
  "type": "commonjs",
  "description": "Portiq MCP server (stdio) — let AI agents browse and run your Portiq API library.",
  "license": "AGPL-3.0-only",
  "repository": { "type": "git", "url": "https://github.com/xander1235/portiq.git", "directory": "packages/mcp" },
  "publishConfig": { "access": "public" },
  "bin": { "portiq-mcp": "dist/portiq-mcp.bundle.cjs" },
  "main": "dist/portiq-mcp.bundle.cjs",
  "files": ["dist/portiq-mcp.bundle.cjs", "README.md"],
  "scripts": {
    "build": "node scripts/gen-version.mjs && tsc -p tsconfig.build.json && node -e \"require('fs').writeFileSync('dist/package.json', JSON.stringify({ type: 'commonjs' }))\"",
    "bundle": "npm run build && esbuild dist/bin.js --bundle --platform=node --format=cjs --target=node20 --banner:js=\"#!/usr/bin/env node\" --external:better-sqlite3 --outfile=dist/portiq-mcp.bundle.cjs && node -e \"require('fs').chmodSync('dist/portiq-mcp.bundle.cjs', 0o755)\"",
    "prepack": "npm run bundle"
  },
  "dependencies": { "better-sqlite3": "^12.11.1" }
}
```

Note the package `type` flips from `module` to `commonjs`: the published artifact is a single CJS bundle, and the old `dist/package.json`-writer trick is no longer needed for the published entry (the `build` script keeps writing it only so the un-bundled `dist/bin.js` used as the esbuild input is treated as CJS during bundling). `@modelcontextprotocol/sdk` and `zod` are dropped from `dependencies` (inlined).

- [ ] **Step 3: Keep core private, add `files` (defensive)**

In `packages/core/package.json`, keep `"private": true` and add a `files` field after `"version"`:

```json
  "files": ["dist"],
```

(No publish; this only keeps `npm pack --dry-run -w @portiq/core` audits honest and prevents accidental `src` inclusion if the private flag is ever flipped by mistake.)

- [ ] **Step 4: Flip changeset access + author the release changeset**

In `.changeset/config.json` change line 8 `"access": "restricted"` → `"access": "public"`.

Create `.changeset/phase4-packaging.md`:

```md
---
"@portiq/cli": minor
"@portiq/mcp": minor
---

First public release of the Portiq CLI (`portiq`) and MCP server (`portiq-mcp`): run saved requests/collections/flows from the terminal and expose your API library to MCP-aware agents. Both ship as self-contained bundles; install via `npx @portiq/cli` / `npx @portiq/mcp` or globally.
```

- [ ] **Step 5: Audit the publish tarballs (`npm pack --dry-run`) — expect ONLY the bundle + README**

Run: `npm run bundle:bins`
Run: `npm pack --dry-run -w @portiq/cli`
Expected: Tarball Contents list = exactly `dist/portiq.bundle.cjs`, `package.json`, and `README.md` if present — NO `src/**`, NO `*.test.ts`, NO un-bundled `dist/commands/*`.

Run: `npm pack --dry-run -w @portiq/mcp`
Expected: exactly `dist/portiq-mcp.bundle.cjs`, `package.json` (+ README) — nothing else.

Run: `node -e "const c=require('./packages/core/package.json'); if(c.private!==true)throw new Error('core must stay private'); console.log('core private ok')"`
Expected: prints `core private ok`.

- [ ] **Step 6: Local install smoke — prove `npx`/global-install semantics work off the tarball**

Pack real tarballs and install the CLI into a throwaway dir (this exercises the exact bytes npm would publish, including the `better-sqlite3` native install):

```bash
CLI_TGZ=$(npm pack -w @portiq/cli | tail -1)
TMP=$(mktemp -d)
cd "$TMP" && npm init -y >/dev/null && npm i "$OLDPWD/$CLI_TGZ" >/dev/null
./node_modules/.bin/portiq --version
./node_modules/.bin/portiq where --data-dir "$TMP/data"
cd "$OLDPWD"
```

Expected: `--version` prints `0.1.0`; `where` prints the resolved `$TMP/data` path. This confirms the bundle is self-contained (core inlined) and `better-sqlite3` resolved from the freshly-installed Node-ABI copy. (If `better-sqlite3` fails to load, the host lacks build tools — note as an environment prerequisite, not a plan defect.)

- [ ] **Step 7: Full suite + lint + commit**

Run: `npm test` — expected: green (CLI/MCP integration tests spawn `dist/index.js`/`dist/bin.js`, which still exist alongside the bundle).
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/cli/package.json packages/mcp/package.json packages/core/package.json .changeset/config.json .changeset/phase4-packaging.md
git commit -m "chore(release): make @portiq/cli and @portiq/mcp publishable (bundle core, public access)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: CI + release workflow for npm publish

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `packaging` job)
- Modify: `.github/workflows/release.yml` (build:mcp + bundles + rebuild in installer legs; add `publish-npm` job)
- Test: workflow YAML validity + dry-run job semantics (verification commands)

**Interfaces:**
- Consumes: the `bundle:bins`, `smoke:packaged`, and `npm pack` machinery from Tasks 1–6; `NPM_TOKEN` repo secret; the Changesets action.
- Produces: PR-time verification that both packages pack cleanly, and a tag-time (or Changesets version-PR merge) publish of `@portiq/cli` + `@portiq/mcp` to npm.

- [ ] **Step 1: Add a `packaging` job to `.github/workflows/ci.yml`**

Append after the existing `test` job (same indentation as `build`/`lint`/`test`):

```yaml
  packaging:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v5

    - name: Use Node.js
      uses: actions/setup-node@v5
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Build core + CLI + MCP bundles
      run: npm run bundle:bins

    - name: Audit publish tarballs (no src/tests leak)
      run: |
        npm pack --dry-run -w @portiq/cli 2>&1 | tee /tmp/cli.txt
        npm pack --dry-run -w @portiq/mcp 2>&1 | tee /tmp/mcp.txt
        grep -q "portiq.bundle.cjs" /tmp/cli.txt
        grep -q "portiq-mcp.bundle.cjs" /tmp/mcp.txt
        ! grep -qE "src/|\.test\." /tmp/cli.txt
        ! grep -qE "src/|\.test\." /tmp/mcp.txt

    - name: Bundle self-containment smoke (core inlined)
      run: node packages/cli/dist/portiq.bundle.cjs where --data-dir "$(mktemp -d)"
```

- [ ] **Step 2: Update the installer legs of `.github/workflows/release.yml`**

The three matrix legs (`release.yml:19-40`) call `npm run package:mac|win|linux`, which (after Task 1) already run `build:mcp` + `bundle:bins`. Add an explicit Electron-ABI rebuild step so `better-sqlite3` in the unpacked app matches Electron. Insert BEFORE the existing `Build @portiq/core workspace package` step (line 55):

```yaml
      - name: Rebuild native modules for Electron ABI
        run: npm run rebuild
```

(Leave the existing `Build @portiq/core workspace package` step; `package:*` re-runs `build:core` anyway, but the explicit step keeps the log readable.)

- [ ] **Step 3: Add the `publish-npm` job to `.github/workflows/release.yml`**

Append as a new top-level job (peer of `build-release` / `release-notes`). It runs on tag pushes, builds the bundles, and publishes via the Changesets action (which reads `publishConfig.access: public` and skips already-published versions):

```yaml
  publish-npm:
    name: Publish CLI + MCP to npm
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Check out repository
        uses: actions/checkout@v5

      - name: Use Node.js 20
        uses: actions/setup-node@v5
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build publishable bundles
        run: npm run bundle:bins

      - name: Publish @portiq/cli and @portiq/mcp
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          npm publish -w @portiq/cli --access public
          npm publish -w @portiq/mcp --access public
```

(Using `npm publish -w` directly — deterministic on a tag and independent of the Changesets version-PR flow the repo already uses for the desktop app CHANGELOG. `--access public` is redundant with `publishConfig` but explicit. `npm publish` is idempotent-safe: re-running a tag whose version already exists fails that leg loudly, which is the desired signal.)

- [ ] **Step 4: Validate the workflow YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!/publish-npm:/.test(y))throw new Error('publish job missing'); if(!/npm run rebuild/.test(y))throw new Error('rebuild step missing'); console.log('release.yml ok')"`
Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/packaging:/.test(y))throw new Error('packaging job missing'); console.log('ci.yml ok')"`
Expected: prints `release.yml ok` then `ci.yml ok`.

(If `actionlint` is available: `actionlint .github/workflows/release.yml .github/workflows/ci.yml` — expected: no errors. Optional; the node grep above is the required gate.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci(release): audit packaging on PR and publish @portiq/cli + @portiq/mcp on tag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Open Questions & Decisions for the user

1. **npm scope/org ownership + `NPM_TOKEN`.** Publishing `@portiq/cli` / `@portiq/mcp` requires the `@portiq` org to exist on npm with publish rights for the CI token, plus an `NPM_TOKEN` repo secret (an automation token). This plan assumes both. If the org is unavailable, the package names change.
2. **`npx portiq` (unscoped) vs `npx @portiq/cli`.** The spec's literal `npx portiq` requires owning the unscoped `portiq` name on npm — which collides with the private ROOT package already named `portiq`. This plan publishes `@portiq/cli` (bin `portiq`, so global/`npx @portiq/cli` gives a `portiq` command) and `@portiq/mcp`. If the user wants literal `npx portiq` to resolve an unscoped package, they must claim the `portiq` name and the CLI package must be renamed `portiq` — a naming decision only the user can make.
3. **macOS code-signing / notarization.** `release.yml` currently ad-hoc signs (no Apple Developer cert). Symlinking into `/usr/local/bin` from an unsigned app works, but a notarized build is needed to avoid Gatekeeper friction for a broadly-distributed "install command in PATH" feature. Out of scope here; flagged.
4. **`/usr/local/bin` permissions (macOS/Linux in-app install).** The in-app symlink may hit `EACCES` without admin rights; Task 4 returns a clear error rather than escalating. A privileged-helper/`osascript` escalation path is deferred — confirm whether that UX is wanted.

## Cross-plan dependencies

- **This is the capstone plan and must land AFTER the Phase 1 (MCP), Phase 2 (CLI), and Phase 3 (gRPC / git-sync / mock / AI) tracks are merged** — it packages their built outputs. In particular it assumes `packages/mcp` and `packages/cli` build green and `packages/core/dist` emits `sync/index.cjs`, `transport/grpc.js`, `flows/index.js` (verified present today).
- **Touches files owned by earlier plans:** `packages/cli/src/version.ts` + `packages/mcp/src/version.ts` (now codegen'd from package.json), and `electron/main.cjs` / `preload.cjs` / `src/types/global.d.ts` (the gRPC-parity plan also edits these — coordinate the additive IPC handlers to avoid merge overlap).
- **Changeset `access` flip** affects the repo-wide Changesets flow the desktop app already uses for CHANGELOG generation; confirm the desktop root package (`portiq`, `private:true`) is unaffected (it is — private packages are never published by Changesets).

---

## Self-Review

**Spec coverage.**
- Scope 1 (wire `build:mcp` into `package:*`/`build`/CI): Task 1 (all six package scripts) + Task 7 (CI `packaging` job, release legs). Covered.
- Scope 2 (electron-builder bundles core dist incl. `sync/index.cjs`, grpc, flows + REAL packaged smoke + `npm run rebuild` ABI call-out): Task 3 (`files`/`asarUnpack` + `scripts/smoke-packaged.mjs` asserting the exact subpaths and a require-core probe via the packaged Electron binary). Covered.
- Scope 3 (bundle `portiq`/`portiq-mcp` with the app, drop on PATH per-OS via `extraResources` + afterPack/afterInstall, uninstall cleanup): Task 4 (extraResources + afterPack launchers + macOS/Linux in-app symlink) and Task 5 (Windows NSIS PATH + Linux deb/rpm postinst/postrm with removal). Covered.
- Scope 4 (npm publish: publishable `@portiq/cli` + `@portiq/mcp` with publishConfig/access/bin/files, changeset access public, verify `npx`/global install, publish workflow, and the core publish-vs-bundle decision): Task 6 (publishable metadata + BUNDLE-core decision + tarball audit + local install smoke) and Task 7 (`publish-npm` job). Covered.

**No placeholders.** Every step shows real JSON/JS/sh/nsis/YAML; verification steps give exact commands and expected output. Deferred items (notarization, unscoped `portiq`, privilege escalation) live in Open Questions, not as stub tasks.

**Type / artifact consistency.** The two bundle paths (`packages/cli/dist/portiq.bundle.cjs`, `packages/mcp/dist/portiq-mcp.bundle.cjs`) are produced once in Task 2 and referenced verbatim by Tasks 3–7. `better-sqlite3` is the single `--external` everywhere (bundle scripts, `asarUnpack`, cli/mcp `dependencies`). The `Resources/bin` layout emitted by `afterPack` (Task 4) is exactly what the NSIS/Linux installers (Task 5) and the smoke launcher check (Task 4 Step 5) reference. `gen-version.mjs` constant names (`CLI_NAME`/`CLI_VERSION`, `SERVER_NAME`/`SERVER_VERSION`) match the existing `version.ts`. Core stays `private:true` and is bundled, never published — consistent across Tasks 3 and 6.
