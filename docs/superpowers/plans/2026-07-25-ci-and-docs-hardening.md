# CI & Docs Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `.github/workflows/ci.yml` with a macOS/Windows/Linux test matrix and a headless-renderer smoke job that catches Vite eager-eval/blank-white-screen regressions, and bring `packages/cli/README.md` + root `README.md` up to date with the `portiq` CLI and `portiq-mcp` server that already exist but are undocumented.

**Architecture:** Two `.github/workflows/ci.yml` changes (no new workflow files): the existing `test` job gains an `os` matrix so the full vitest suite — including `packages/core/src/store/dataDir.test.ts` and every test that touches the filesystem, spawns a child process, or loads the `better-sqlite3` native binding — runs for real on `ubuntu-latest`, `macos-latest`, and `windows-latest`; a new `renderer-smoke` job builds the Vite renderer and boots the built `dist/` bundle in headless Chromium (Playwright, already a devDependency) to catch import-time crashes that no jsdom/unit test can see, because unit tests import one module at a time and never execute the real bundled entry graph the way a browser does. Two docs deliverables — `packages/cli/README.md` (new) and `README.md` (updated) — document the CLI/MCP surfaces that Phases 1–3 shipped but never wrote up.

**Tech Stack:** GitHub Actions (`actions/checkout@v5`, `actions/setup-node@v5`), Playwright `^1.58.2` (already a devDependency — no new dependency added), Node's built-in `http`/`fs` (static file server for the smoke test, no new dependency), `js-yaml` (already a transitive devDependency — used only as a local YAML-syntax sanity check, never added to `package.json`), vitest 4, Markdown.

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

### Subsystem-specific constraints (this plan)

- **This is a CI/docs plan, not a core-logic plan.** For every task here a vitest unit test doesn't fit the
  deliverable (a GitHub Actions job, a shell script, or a Markdown file). Per this plan's brief, the
  verification step is instead a concrete command with an expected outcome (a local YAML-syntax check, a
  real run of the new smoke script proving it fails on a reproduced historical bug and passes once reverted,
  or a `grep` content check against the doc). "Push and observe the Actions run" is called out explicitly
  wherever GitHub-side confirmation is the only real proof.
- **Playwright is already installed; don't touch `package.json` dependencies.** Root `package.json:145`
  already lists `"playwright": "^1.58.2"` under `devDependencies` (used previously for headless UI
  screenshots). The new `renderer-smoke` job/script only needs `npx playwright install --with-deps chromium`
  in CI (and `npx playwright install chromium` once locally) to fetch the browser binary — no
  `package.json` dependency edit.
- **The renderer never needs `@portiq/core`'s dist.** `vite.config.js:29` aliases the bare `@portiq/core`
  specifier straight to `packages/core/src/index.browser.ts` (TypeScript source, not `dist/`), and
  `package.json:18`'s `"build": "vite build"` runs no `tsc`/`build:core` step first. The `renderer-smoke`
  job therefore does `npm ci && npm run build` with no `build:core` step — do not add one; it would mask
  the fact that the renderer build has never depended on core's dist.
- **`@portiq/cli` and `@portiq/mcp` are not published to npm today.** Both have `"private": true`
  (`packages/cli/package.json:4`, `packages/mcp/package.json:4`), and root `package.json`'s
  `dependencies` list only `@portiq/core` — neither `@portiq/cli` nor `@portiq/mcp` is a dependency of any
  workspace, so `npm install` creates no `node_modules/.bin/portiq` or `.../portiq-mcp` symlink (verified:
  `node_modules/.bin` has no `portiq*` entries even though `packages/cli/dist` and `packages/mcp/dist` are
  already built). Docs must present **from-source usage** (`node packages/cli/dist/index.js`,
  `npm link`) as what works *today*, and `npx`/global-install as the *intended* distribution once
  published — per `docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md:22`'s "npm package ...
  standalone `npx portiq` / global install" line — never claim the published path already works.
- **`ls`/`get`/`run`/`exec`/`import`/`mock`/`sync`/`mcp` is not the full command list.** The task brief
  names 8 commands, but `packages/cli/src/commands/index.ts:15-28`'s `builtinCommands` array actually
  registers 12: `ls, get, search, run, exec, import, export, where, config, mcp, mock, sync`. The CLI README
  documents all 12 (source of truth, not the brief's abbreviated list).

---

## File Structure

- **Modify:** `.github/workflows/ci.yml` — turn the `test` job into a 3-OS matrix; add a new `renderer-smoke` job.
- **Create:** `scripts/smoke-renderer.mjs` — headless-Chromium (Playwright) script that serves the built `dist/` bundle over a local static HTTP server and fails if the page throws or `#root` never mounts a child within 15s.
- **Modify:** `package.json` — add a `"smoke:renderer"` script that runs the new script.
- **Create:** `packages/cli/README.md` — full `portiq` CLI reference (install, global flags, all 12 commands, exit codes, reporters, limitations).
- **Modify:** `README.md` — new "CLI & MCP Server" section, an updated "Useful scripts" block, and an updated "Repository Structure" block.

---

## Task 1: macOS/Windows/Linux test matrix in CI

**Files:**
- Modify: `.github/workflows/ci.yml:46-62` (the `test` job)
- Test: none (workflow YAML) — verified via a local syntax check + an existing vitest file re-run + "push and observe"

**Interfaces:**
- Consumes: the existing `test` job's steps (`actions/checkout@v5`, `actions/setup-node@v5` pinned to Node 20, `npm ci`, `npm test`) — unchanged; `npm test` already runs `pretest` (`npm run build:core && npm --workspace @portiq/cli run build && npm --workspace @portiq/mcp run build`) then `vitest run` per `package.json:21-22`.
- Produces: the same job, id `test`, now fanned out across `runs-on: ${{ matrix.os }}` for `[ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false` (mirrors `.github/workflows/release.yml:19`'s existing matrix convention), each leg independently green/red in the PR checks list as `test (ubuntu-latest)` / `test (macos-latest)` / `test (windows-latest)`.

Why a full-suite matrix (not just `dataDir.test.ts`): `packages/core/src/store/dataDir.test.ts:6-32` already parameterizes `platform`/`home`/`env` as function arguments (`resolveDataDir({ platform: "win32", home: "C:\\Users\\u", ... })`), so it exercises all three OS branches of `packages/core/src/store/dataDir.ts:16-33` identically on whichever single OS runs it today — a matrix adds nothing to *that* test's coverage. The real cross-platform gap is everything downstream of it that a single-OS `ubuntu-latest` run can't validate: the `better-sqlite3` native binding loading correctly on each OS's Node ABI, real `os.homedir()`/`process.env.APPDATA` values, path-separator handling in `resolveConfigPath`/`resolveEffectiveDataDir` (`packages/cli/src/config.ts:12-21,36-45`), and `child_process`/signal handling in the CLI integration suite (`packages/cli/src/__integration__/cli.integration.test.ts`) and `mock`/`sync` command tests. Running the **whole** suite on all three OSes is what actually validates the shared-storage path contract end-to-end, so this task changes the `test` job itself rather than adding a narrower, separate job.

- [ ] **Step 1: Turn the `test` job into a 3-OS matrix**

Current job (`.github/workflows/ci.yml:46-62`):

```yaml
  test:
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

    - name: Test
      run: npm test
```

Replace it with:

```yaml
  test:
    name: test (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}

    steps:
    - uses: actions/checkout@v5

    - name: Use Node.js
      uses: actions/setup-node@v5
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Test
      run: npm test
```

No other job (`build`, `lint`) changes; they stay `ubuntu-latest`-only, matching this plan's scope (path-resolution/native-binding validation, not a general "run everything thrice" policy).

- [ ] **Step 2: Validate the edited YAML parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('valid yaml')"`
Expected: prints `valid yaml` with no exception. (`js-yaml` is already resolvable at the repo root as a transitive devDependency — confirmed by running `node -e "console.log(require.resolve('js-yaml'))"` before making this edit, which printed a path under `node_modules/js-yaml`.)

- [ ] **Step 3: Confirm the test this matrix protects is real and currently green**

Run: `npx vitest run packages/core/src/store/dataDir.test.ts`
Expected: `5 passed` (the 5 `it(...)` cases in that file — explicit dataDir, `PORTIQ_DATA_DIR` env, macOS, Linux, Windows paths). This is the existing, already-passing test the matrix is protecting; Step 4 pushes it onto three real OS runners instead of one.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the test job on a macOS/Windows/Linux matrix

Validates the resolveDataDir()/shared-storage path contract, the
better-sqlite3 native binding, and process-spawning CLI/mock/sync tests
on all three real OSes instead of ubuntu-latest only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Deployment verification (cannot be done locally):** push this commit (or open the PR) and observe the Actions run for the `test` job: three checks — `test (ubuntu-latest)`, `test (macos-latest)`, `test (windows-latest)` — each installing dependencies and running `npm test` independently, all green. `fail-fast: false` means a Windows-specific failure (if the suite has one, e.g. a `child_process` signal-handling difference in `mock.test.ts`/`sync.test.ts`) surfaces without hiding the macOS/Linux results — note any such failure as a follow-up, it is out of scope for this plan to fix pre-existing OS-specific test bugs.

---

## Task 2: Headless-renderer smoke job

**Files:**
- Create: `scripts/smoke-renderer.mjs`
- Modify: `package.json:19` (add `"smoke:renderer"` script)
- Modify: `.github/workflows/ci.yml` (new `renderer-smoke` job, appended after the `test` job)
- Modify (temporarily, reverted before commit): `vite.config.js:29` — used only to reproduce the historical bug this script targets, proving it fails loudly; never committed
- Test: none (headless browser script) — verified by making it fail against a reproduced historical regression, then pass once reverted, then via a local YAML-syntax check

**Interfaces:**
- Consumes: the built renderer at `dist/index.html` + `dist/assets/**` (produced by `npm run build`, i.e. `vite build` per `package.json:18` — no `build:core` dependency, see Global Constraints); Playwright's `chromium` launcher (`import { chromium } from "playwright"`, already resolvable — `playwright: ^1.58.2` in `package.json`'s `devDependencies`).
- Produces: `node scripts/smoke-renderer.mjs` — exits `0` and prints `renderer smoke: OK (root mounted, 0 page errors, N console.error call(s))` on success; exits `1` and prints the collected `pageerror`/`console.error` text on failure. Wired into CI as `npm run smoke:renderer`.

Why headless Playwright over a jsdom harness: this repo already hit exactly the bug class this job exists to catch — commit `c3fe2371` ("fix(renderer): isolate Node-only core modules from the Chromium bundle") — where `@portiq/core`'s full barrel got pulled into the Vite bundle, and it threw **at module-init time**, before `createRoot(...).render(...)` in `src/main.tsx:8-14` ever ran, producing a blank white screen. `packages/core/src/index.browser.ts:9-13` documents why: "Vite evaluates a re-export barrel eagerly (dev) ... pulling the full barrel into the renderer drags `node:os` etc. in and throws at module init against Vite's browser stubs (blank screen)." A jsdom unit test imports one module directly and would never reproduce this — it never executes the real Rollup/Vite-bundled entry graph, never hits the module-init ordering that made this crash, and `src/components/ErrorBoundary.tsx`'s `componentDidCatch` (lines 33-37) can't help either: it only catches errors *during React's render/lifecycle*, not an exception thrown while evaluating `<script type="module">` before React is ever invoked. Playwright is already a devDependency (per this project's own prior use of it for headless UI screenshots), needs no new install, and loading the actual built bundle in a real browser engine is the only way to reproduce the exact failure mode.

- [ ] **Step 1: Write `scripts/smoke-renderer.mjs`**

```javascript
#!/usr/bin/env node
// Headless-renderer smoke test.
//
// vitest/jsdom unit tests import one module at a time and never execute the
// full Vite/Rollup-bundled entry graph the way a real browser does. That gap
// let a real regression slip past the whole suite (see commit c3fe2371,
// "fix(renderer): isolate Node-only core modules from the Chromium bundle"):
// the "@portiq/core" barrel eagerly re-exported Node-only modules
// (better-sqlite3, node:os, ...), so Vite's browser build threw at MODULE
// INIT time -- before React ever called `.render()` -- producing a blank
// white screen that no unit test could see (nothing "renders" wrong;
// nothing ever mounts). This script instead boots the actual built dist/
// bundle in headless Chromium and fails if the page ever throws or #root
// never gets a child.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../dist", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function serveDist() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = join(ROOT, rel);
        const body = await readFile(filePath);
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const server = await serveDist();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const fail = async (reason) => {
    console.error(`renderer smoke FAILED: ${reason}`);
    console.error(`  page error(s): ${pageErrors.length ? pageErrors.join("; ") : "(none)"}`);
    console.error(`  console error(s): ${consoleErrors.length ? consoleErrors.join("; ") : "(none)"}`);
    await browser.close();
    server.close();
    process.exit(1);
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(
      () => !!document.querySelector("#root") && document.querySelector("#root").childElementCount > 0,
      { timeout: 15000 }
    );
  } catch (err) {
    await fail(`#root never mounted a child within 15s (${err.message})`);
    return;
  }

  if (pageErrors.length > 0) {
    await fail(`${pageErrors.length} uncaught page error(s) during load`);
    return;
  }

  await browser.close();
  server.close();
  console.log(`renderer smoke: OK (root mounted, 0 page errors, ${consoleErrors.length} console.error call(s))`);
}

main().catch((err) => {
  console.error("renderer smoke FAILED with an unexpected error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `smoke:renderer` npm script**

In `package.json`, add a line after `"preview": "vite preview",` (`package.json:19`):

```json
    "preview": "vite preview",
    "smoke:renderer": "node scripts/smoke-renderer.mjs",
```

- [ ] **Step 3: Install Playwright's Chromium binary locally (one-time, cached)**

Run: `npx playwright install chromium`
Expected: downloads (or confirms already cached) the Chromium build Playwright's `^1.58.2` pin expects; exits `0`.

- [ ] **Step 4: Build the renderer**

Run: `npm run build`
Expected: `dist/index.html` and `dist/assets/*.js` are created (this is the existing `vite build`; no `build:core` step runs first, per the Global Constraints note above).

- [ ] **Step 5 (RED): Reproduce the historical regression and confirm the script catches it**

Temporarily edit `vite.config.js:29` from:

```javascript
      { find: /^@portiq\/core$/, replacement: path.resolve(__dirname, "./packages/core/src/index.browser.ts") },
```

to (the exact bug from commit `c3fe2371` — aliasing to the full Node-aware barrel instead of the renderer-safe one):

```javascript
      { find: /^@portiq\/core$/, replacement: path.resolve(__dirname, "./packages/core/src/index.ts") },
```

Run: `npm run build && npm run smoke:renderer`
Expected: `npm run build` still SUCCEEDS (Vite happily bundles the Node-only imports; this is exactly why a build-only CI check would miss the bug). `npm run smoke:renderer` FAILS with exit code `1` and a `renderer smoke FAILED` message whose `page error(s)` mention a Node built-in stub failure (e.g. referencing `node:os`, `better-sqlite3`, or `require is not defined`) — proving this script catches what neither the build nor a per-module unit test would.

- [ ] **Step 6 (GREEN): Revert the reproduction and confirm the script passes**

```bash
git checkout -- vite.config.js
```

Run: `npm run build && npm run smoke:renderer`
Expected: exit code `0`, final line `renderer smoke: OK (root mounted, 0 page errors, N console.error call(s))`.

- [ ] **Step 7: Add the `renderer-smoke` job to CI**

Append to `.github/workflows/ci.yml`, after the `test` job:

```yaml
  renderer-smoke:
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

    - name: Install Playwright Chromium
      run: npx playwright install --with-deps chromium

    - name: Build renderer
      run: npm run build

    - name: Renderer smoke test
      run: npm run smoke:renderer
```

This job runs on `ubuntu-latest` only (one platform is enough — it's catching a bundling/eager-evaluation bug in the shared JS bundle, not an OS-specific path bug, which is what Task 1's matrix is for).

- [ ] **Step 8: Validate the edited YAML parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('valid yaml')"`
Expected: prints `valid yaml` with no exception.

- [ ] **Step 9: Commit**

```bash
git add scripts/smoke-renderer.mjs package.json .github/workflows/ci.yml
git commit -m "ci(renderer): add a headless Playwright smoke test for the built bundle

Boots the vite-built dist/ in headless Chromium and fails on any page
error or if #root never mounts a child, catching import-time/eager-eval
crashes (the blank-white-screen class fixed in c3fe2371) that jsdom unit
tests cannot see because they never execute the real bundled entry graph.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Deployment verification:** push and observe the Actions run: a new `renderer-smoke` check appears alongside `build`/`lint`/`test (*)`, installs a Chromium binary, builds the renderer, and prints `renderer smoke: OK ...` before going green.

---

## Task 3: `packages/cli/README.md`

**Files:**
- Create: `packages/cli/README.md`
- Test: none (Markdown) — verified via `grep` content checks against the actual command/flag source

**Interfaces:**
- Consumes (source of truth, cited exactly, no invented flags):
  - `packages/cli/src/commands/index.ts:15-28` — the 12 registered commands (`ls, get, search, run, exec, import, export, where, config, mcp, mock, sync`).
  - `packages/cli/src/registry.ts:40-54` — global flags (`--data-dir`, `--env`, `--var`, `--reporter`, `-o/--output`, `--timeout`, `--fail-on-test`, `--dry-run`, `--no-color`).
  - `packages/cli/src/errors.ts:1` — exit codes (`SUCCESS: 0, RUNTIME: 1, TEST: 2, USAGE: 3`).
  - `packages/cli/src/reporters/index.ts:81-90` — reporter selection (`pretty` default on TTY, `json` default when piped, `junit`).
  - `packages/cli/src/config.ts:36-45` — data-dir precedence (`--data-dir` → `PORTIQ_DATA_DIR` → config file `dataDir` → OS default).
  - Each command's own file for its flags: `ls.ts:10` (kinds), `get.ts:14`, `search.ts:12`, `run.ts:28-30`, `exec.ts:52-60`, `import.ts:58-60`, `export.ts:14-19`, `where.ts:11`, `config.ts:12-14,21-24`, `mcp.ts:17-22`, `mock.ts:48-50`, `sync.ts:69-72,74-98`.
- Produces: a README any contributor or user can follow standalone; linked from the root `README.md` in Task 4.

- [ ] **Step 1: Write `packages/cli/README.md`**

````markdown
# @portiq/cli — `portiq` command-line client

A standalone terminal client for your Portiq API library. It reads and writes
the same shared store as the desktop app (`<dataDir>/appdata.sqlite`), resolved
via `@portiq/core`'s `resolveDataDir()`, and executes requests through the same
`@portiq/core` transport/scripting engine the desktop app uses — so `portiq run`
and clicking "Send" in the app produce the same request/response/tests.

## Install

`@portiq/cli` is not yet published to npm — it currently ships only from this
repository. From a checkout:

```bash
npm install
npm run build:cli
node packages/cli/dist/index.js --help
```

To get a `portiq` binary on your `PATH` without publishing:

```bash
cd packages/cli && npm link
portiq --help
```

Once published (see the distribution model in
`docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md`), the intended
usage is:

```bash
npx -y @portiq/cli ls
# or
npm install -g @portiq/cli
portiq ls
```

## Global flags

These apply to every command:

| Flag | Description |
| --- | --- |
| `--data-dir <path>` | override the Portiq data directory |
| `--env <name>` | environment to interpolate `{{variable}}`s from (else the app's active environment) |
| `--var <k=v>` | override/add one variable (repeatable) |
| `--reporter <pretty\|json\|junit>` | output format (default: `pretty` on a TTY, `json` when piped) |
| `-o, --output <file>` | write the report to a file instead of stdout |
| `--timeout <ms>` | request timeout in milliseconds |
| `--fail-on-test` | exit `2` when any test fails (see Exit codes) |
| `--dry-run` | resolve the request (headers/URL/body) without sending it |
| `--no-color` | disable ANSI color in the `pretty` reporter |

Data-dir resolution precedence: `--data-dir` → `PORTIQ_DATA_DIR` env → CLI config
file `dataDir` (see `config`, below) → OS default
(`~/Library/Application Support/Portiq` on macOS, `%APPDATA%/Portiq` on Windows,
`~/.config/Portiq` on Linux).

## Commands

### `ls [kind]`

List `collections` (default), `requests`, `envs`, or `flows` as a table.

```bash
portiq ls
portiq ls requests
```

### `get <ref>`

Inspect a resolved request, collection, environment, or flow.

```bash
portiq get "API/Ping"
portiq get --id <uuid>
```

Flags: `--id <uuid>` (resolve by id instead of a `Collection/Folder/Request` path).

### `search <query>`

Fuzzy-search request paths, names, and URLs across the whole library.

```bash
portiq search ping
```

### `run <ref>`

Execute a saved request, collection, or flow and run its tests through the
shared `@portiq/core` engine.

```bash
portiq run "API/Ping"
portiq run "API" --fail-on-test
portiq run "API/Ping" --dry-run
```

Flags: `--id <uuid>`. Collections run every non-`dag`/`websocket`/`grpc` request
in the tree and aggregate test results; flows run through `@portiq/core/flows`.

### `exec [url]`

Send an ad-hoc request — curl-like flags or `--from-curl` — without saving it.

```bash
portiq exec https://api.example.com/ping
portiq exec https://api.example.com/users -X POST -H "Content-Type: application/json" -d '{"name":"a"}'
portiq exec --from-curl "curl -H 'Authorization: Bearer x' https://api.example.com"
```

Flags: `-X, --method <method>`, `-H, --header <header>` (repeatable, `"Key: Value"`),
`-d, --data <body>`, `--from-curl <command>`. Requires a `<url>` or `--from-curl`.

### `import <file>`

Import a curl command or a `portiq.json` portable file into the shared store.

```bash
portiq import ./request.curl --collection "Imported"
portiq import ./export.portiq.json
```

Flags: `--collection <name>` (default `Imported`; only used for curl imports).
Retries once on an optimistic-concurrency conflict (`ConflictError`), then fails.

### `export [ref]`

Export a request as curl, or a collection/the whole library as `portiq.json`.

```bash
portiq export "API/Ping" --format curl
portiq export "API" --format portiq
portiq export --all --format portiq -o library.portiq.json
```

Flags: `--format <curl|portiq>` (default `portiq`), `--id <uuid>`, `--all`
(export the entire library; `portiq` format only).

### `where`

Print the resolved data directory, database path, and CLI config path.

```bash
portiq where
```

### `config [path|set <key> <value>]`

View or edit CLI configuration (`<dataDir>/cli-config.json`).

```bash
portiq config              # print current config
portiq config path         # print the config file path
portiq config set dataDir /custom/path
portiq config set reporter json
```

Settable keys: `dataDir`, `reporter`, `env`.

### `mcp [args...]`

Start the stdio MCP server by spawning the `portiq-mcp` binary from `@portiq/mcp`
and forwarding stdio + any extra args.

```bash
portiq mcp
portiq mcp --allow-writes
```

Prints an install hint (`portiq-mcp is not installed. Install it with: npm i -g @portiq/mcp`)
if `portiq-mcp` isn't resolvable on `PATH`.

### `mock <ref>`

Start an in-process HTTP mock server from a saved collection (routes are
generated from the collection's requests).

```bash
portiq mock "API"
portiq mock "API" --port 8080
```

Flags: `--port <number>` (default `3000`; `0` picks an OS-assigned ephemeral
port; range `0`–`65535`). Press `Ctrl-C` to stop.

### `sync push | pull | status`

Sync your workspace with a git remote (GitHub or a local bare/working repo).

```bash
portiq sync push
portiq sync pull
portiq sync status
portiq sync push --local /path/to/repo
```

Flags (on `sync` itself, before the subcommand): `--token <token>` (else
`PORTIQ_GITHUB_TOKEN` / `GITHUB_TOKEN` / CLI config), `--local <dir>` (sync to a
local git repo instead of GitHub). **`sync push` sends variable values
unmasked** — no desktop-style secret redaction — do not push to shared or
untrusted remotes.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | runtime error (e.g. no store found, mock/sync failure) |
| `2` | test failure (only with `--fail-on-test`) |
| `3` | usage error (bad flags/args) |

## Reporters

- `pretty` (default on a TTY) — colorized human-readable output; `--no-color` disables ANSI.
- `json` (default when piped) — `JSON.stringify` of the structured command output.
- `junit` — JUnit XML for `run`'s test results (CI-friendly).

`-o, --output <file>` writes the chosen reporter's output to a file instead of stdout.

## Notes & limitations

- Runs on plain Node. If you also run the Electron app from source, remember the
  `better-sqlite3` ABI split: `npm rebuild better-sqlite3` for Node/CLI,
  `npm run rebuild` for Electron.
- `exec` works without an existing store (best-effort `--var` interpolation only);
  every other command requires a store to already exist — run the desktop app
  once, or `portiq import`, first.
- **Concurrency:** while the desktop app is running, its writes do not bump the
  optimistic `kv_version` counter yet, so the CLI cannot detect a concurrent app
  edit (last-writer-wins). Prefer running write commands (`import`) with the
  desktop app closed until version reconciliation lands.
````

- [ ] **Step 2: Verify command coverage matches the source exactly**

Run: `grep -c '^### `' packages/cli/README.md`
Expected: `12` (one heading per entry in `packages/cli/src/commands/index.ts:15-28`'s `builtinCommands` array).

Run: `grep -oE '"[a-z]+Command' packages/cli/src/commands/index.ts | sort -u | wc -l`
Expected: `12` — same count from the source side, confirming no command was invented or omitted.

- [ ] **Step 3: Spot-check flag strings against source (catch drift/typos)**

Run: `grep -n "fail-on-test\|dry-run\|from-curl\|allow-writes" packages/cli/README.md packages/cli/src/registry.ts packages/cli/src/commands/exec.ts packages/cli/src/commands/mcp.ts`
Expected: every flag mentioned in the README (`--fail-on-test`, `--dry-run`, `--from-curl`, `--allow-writes`) also appears in the corresponding source file — `--fail-on-test`/`--dry-run` in `registry.ts`, `--from-curl` in `exec.ts`, `--allow-writes` in the README's `mcp` example (a `portiq-mcp` flag forwarded transparently by `mcp.ts:17-22`'s passthrough, not parsed by the CLI itself — confirm this distinction reads correctly in the "mcp" section above).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(cli): write packages/cli/README.md

Document all 12 portiq commands (ls/get/search/run/exec/import/export/
where/config/mcp/mock/sync), global flags, exit codes, and reporters —
none of this existed before despite Phases 1-3 shipping it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Root `README.md` — document the CLI/MCP surfaces

**Files:**
- Modify: `README.md:81-83` (insert a new "CLI & MCP Server" section between "Protocol Support" and "Features")
- Modify: `README.md:389-402` (extend "Useful scripts")
- Modify: `README.md:474-493` (extend "Repository Structure")
- Test: none (Markdown) — verified via `grep` content checks

**Interfaces:**
- Consumes: `packages/cli/README.md` (Task 3, linked from the new section), `packages/mcp/README.md` (already exists, linked), `package.json:10-30` (scripts being documented), the private-package reality documented in this plan's Global Constraints.
- Produces: a root README where "the actual CLI commands" and "npx/global install usage" are documented, closing the gap called out in this plan's brief (today the only "MCP" mention in `README.md` is the desktop app's MCP-*client* feature at `README.md:76`, not `portiq-mcp`).

- [ ] **Step 1: Insert the "CLI & MCP Server" section**

Insert after `README.md:81` (the `gRPC` note bullet) and before `README.md:83`'s `## 🧩 Features`:

```markdown

## ⌨️ CLI & MCP Server

Alongside the desktop app, Portiq ships a terminal client and an MCP server —
both built on the same `@portiq/core` engine, reading the same shared store:

- **`portiq`** (`@portiq/cli`) — list/inspect/search your library, run saved
  requests/collections/flows with tests, send ad-hoc requests, import/export,
  start a mock server, and sync to a git remote. Full command reference:
  [`packages/cli/README.md`](packages/cli/README.md).
- **`portiq-mcp`** (`@portiq/mcp`) — a stdio [MCP](https://modelcontextprotocol.io)
  server so AI agents (Claude Code, Claude Desktop, etc.) can browse, run, and
  (opt-in) mutate your API library. Full reference:
  [`packages/mcp/README.md`](packages/mcp/README.md).

Neither package is published to npm yet, so today they run from a checkout:

```bash
npm install
npm run build:cli && npm run build:mcp
node packages/cli/dist/index.js ls
node packages/mcp/dist/bin.js
```

or linked onto your `PATH`:

```bash
cd packages/cli && npm link   # portiq
cd packages/mcp && npm link   # portiq-mcp
```

The intended distribution once published is `npx`/global install (see the
[CLI+MCP design doc](docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md)):

```bash
npx -y @portiq/cli ls
npx -y @portiq/mcp
```
```

- [ ] **Step 2: Extend the "Useful scripts" block**

Replace the block at `README.md:389-402`:

```bash
npm run dev            # run renderer + Electron in development
npm run dev:nix        # same, for Nix environments
npm run build          # build the renderer
npm run preview        # preview the built renderer
npm run lint           # lint the codebase
npm run rebuild        # rebuild native modules
npm run package        # package a desktop build
npm run package:desktop # package all desktop targets
npm run package:mac    # package macOS artifacts
npm run package:win    # package Windows artifacts
npm run package:linux  # package Linux artifacts
npm run package:release # package release artifacts without publishing
```

with:

```bash
npm run dev            # run renderer + Electron in development
npm run dev:nix        # same, for Nix environments
npm run build          # build the renderer
npm run build:core     # build the @portiq/core workspace package
npm run build:cli      # build the @portiq/cli workspace package (portiq)
npm run build:mcp      # build the @portiq/mcp workspace package (portiq-mcp)
npm run preview        # preview the built renderer
npm test               # run the full vitest suite (core + cli + mcp + renderer)
npm run test:watch     # run vitest in watch mode
npm run lint           # lint the codebase
npm run rebuild        # rebuild native modules
npm run package        # package a desktop build
npm run package:desktop # package all desktop targets
npm run package:mac    # package macOS artifacts
npm run package:win    # package Windows artifacts
npm run package:linux  # package Linux artifacts
npm run package:release # package release artifacts without publishing
```

- [ ] **Step 3: Extend "Repository Structure"**

Replace the block at `README.md:474-483`:

```text
src/
  components/
  hooks/
  protocols/
  services/
  utils/
electron/
docs/
```

with:

```text
packages/
  core/
  cli/
  mcp/
src/
  components/
  hooks/
  protocols/
  services/
  utils/
electron/
docs/
```

and append to the "Key areas" list at `README.md:487-493`:

```markdown
- `packages/core/` - `@portiq/core`, framework-free business logic shared by the app, CLI, and MCP server
- `packages/cli/` - `@portiq/cli`, the `portiq` terminal client ([README](packages/cli/README.md))
- `packages/mcp/` - `@portiq/mcp`, the `portiq-mcp` stdio MCP server ([README](packages/mcp/README.md))
```

- [ ] **Step 4: Verify the doc edits landed**

Run: `grep -n "portiq-mcp\|npx -y @portiq/cli\|packages/cli/README.md\|packages/mcp/README.md" README.md`
Expected: at least 4 matches, including the new section's links to both package READMEs and both `npx -y @portiq/...` lines.

Run: `grep -n "build:cli\|build:mcp\|test:watch" README.md`
Expected: 3 matches, confirming the "Useful scripts" block now lists the CLI/MCP build scripts and `test:watch`.

Run: `grep -n "packages/cli/\|packages/mcp/\|packages/core/" README.md`
Expected: at least 3 matches from the updated "Repository Structure" section (plus the 2 links already counted above, if they overlap).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the portiq CLI and portiq-mcp server in the root README

Adds a CLI & MCP Server section (from-source usage today, npx/global
install once published), and lists the new packages/{core,cli,mcp}
scripts and directories that were never documented after Phases 1-3.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (OS matrix): Task 1 turns the existing `.github/workflows/ci.yml` `test` job into a `[ubuntu-latest, macos-latest, windows-latest]` matrix running the full suite (which includes `dataDir.test.ts`'s per-platform-parameterized assertions), with the rationale for why the *whole* suite — not just that one file — is the right matrix scope written into the task.
- Item 2 (headless-renderer smoke): Task 2 adds `scripts/smoke-renderer.mjs` (headless Playwright, already a devDependency) + a `renderer-smoke` CI job, justified against the concrete historical regression (`c3fe2371`) it targets, and proven with a real red/green cycle (temporarily reproducing that exact bug, observing the script fail, reverting, observing it pass) rather than an assertion of intent.
- Item 3 (docs): Task 3 writes `packages/cli/README.md` covering all 12 real commands (not the brief's abbreviated 8) with flags sourced line-by-line from `packages/cli/src/**`; Task 4 updates the root `README.md` with a CLI & MCP section, corrected `npm run` script list, and repository structure, honestly distinguishing today's from-source usage from the not-yet-published `npx`/global-install path.

**No placeholders:** every YAML block, script, and README is shown in full (not "similar to the existing job" or "add the rest of the commands"); every verification step is a real command with a stated expected outcome.

**Consistency:** the CLI README's flags/commands were cross-checked against `packages/cli/src/registry.ts`, `commands/index.ts`, and each command file (Task 3, Steps 2-3); the root README's new script list matches `package.json`'s actual `scripts` block; the Global Constraints' "private, unpublished packages" note is honored consistently in both README edits (Task 3's Install section and Task 4's new section both lead with from-source usage, not `npx`).
