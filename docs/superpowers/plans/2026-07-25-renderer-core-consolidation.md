# Renderer/Core Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the renderer's last two parallel copies of core logic — `handleSend`'s inline HTTP-payload assembly and `useEnvironmentState`'s own `getEnvVars`/`interpolate`/`redactSecrets` — by rewiring both to call the canonical `@portiq/core` implementations, fixing one real semantic divergence (`getEnvVars`'s `enabled`/`key` filter) along the way.

**Architecture:** Part A fixes `packages/core/src/exec/interpolate.ts`'s `getEnvVars` to use the codebase-wide `key && enabled !== false` row convention (it was the one outlier using strict-truthy `enabled`), adds a symmetric `getSecretVars` for secret-row derivation, then makes `src/hooks/useEnvironmentState.ts` a thin delegating wrapper (same external call signatures, zero call-site changes in `App.tsx`). Part B adds `src/utils/httpSend.ts` — a tiny renderer wrapper around the already-existing, already-golden-tested `assembleRequest()` (`packages/core/src/exec/assembleRequest.ts`, landed in Phase 0.5) that guarantees `headers` is non-optional for `window.api.sendRequest`'s `RequestConfig` — then rewires `handleSend` (`src/App.tsx:2230-2296`) to call it, deleting the inline body/header/URL assembly while leaving the sibling helpers (`parseHeaders`, `buildUrlWithParams`, `rowsToObject`, `stripJsonComments`) untouched because preview/snippet/export code still calls them directly. Part A must land before Part B so `assembleRequest`'s `resolveVars → getEnvVars` path already has the corrected semantics when `handleSend` starts routing through it.

**Tech Stack:** TypeScript (renderer: ESNext, `moduleResolution: Bundler`; core: same, `"type":"module"`), React 18 (no new React test infra — see Global Constraints), Vitest 4 (`node` environment, project-wide — no jsdom), npm workspaces. No new dependencies.

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

### Subsystem-specific constraints (verified against the real code on this branch)

- **`assembleRequest` already exists and is already golden-tested — do not recreate it.**
  `packages/core/src/exec/assembleRequest.ts` (+ `.test.ts` + `.parity.test.ts`, ~30 passing assertions
  today) landed in Phase 0.5 and is already consumed by the CLI (`packages/cli/src/resolve/httpPayload.ts`,
  a thin wrapper that maps core's `InvalidJsonBodyError` → CLI's `UsageError`). This plan's Part B does the
  **same wrapper pattern** for the renderer — it does not touch `assembleRequest.ts` itself.
- **No barrel edit needed.** Both `packages/core/src/index.ts` (Node-facing) and
  `packages/core/src/index.browser.ts` (Vite-aliased, renderer-facing) already contain
  `export * from "./exec/interpolate";` and `export * from "./exec/assembleRequest";`. Every symbol this
  plan adds (`getSecretVars`) or consumes (`assembleRequest`, `InvalidJsonBodyError`) flows through both
  barrels automatically. `HttpSendPayload`/`AssemblableRequest`/`AssembleRequestOptions` are consumed via
  `import type` only (erased at Vite bundle time), so the fact that `index.browser.ts` deliberately excludes
  `./transport/http`'s runtime value-code (`node:http`) is irrelevant — exactly how `assembleRequest.ts`
  itself already imports `HttpSendPayload`.
- **No renderer component-test harness exists.** `vitest.config.ts` sets `environment: "node"` globally;
  there is no jsdom/RTL setup and no existing test for any file in `src/hooks/**` or for `App.tsx`. This plan
  does not introduce one. The `App.tsx` edit (Task 4) is verified by (a) the existing core golden-parity
  suite staying green, (b) the new pure-function tests in Task 3, (c) `npx tsc --noEmit` (root `tsconfig.json`
  includes `src`), (d) `npm run lint`, and (e) `npm test` for the full suite — not by mounting the component.
- **Order dependency: Part A before Part B.** `assembleRequest`'s `resolveVars(env, overrides)` calls
  `getEnvVars(env)` internally. Fixing `getEnvVars`'s `enabled`/`key` semantics (Task 1) before rewiring
  `handleSend` onto `assembleRequest` (Task 4) avoids a transient regression window where an environment
  variable with `enabled === undefined` (or an empty key) would silently behave differently than it does
  in the renderer today.
- **Baseline verified clean on this branch right now:** `npx tsc --noEmit -p tsconfig.json` → no output
  (zero errors); `npx vitest run packages/core/src/exec/interpolate.test.ts packages/core/src/exec/assembleRequest.test.ts packages/core/src/exec/assembleRequest.parity.test.ts` → 3 files / 26 tests passed. All "expect PASS" steps below are measured against this clean baseline, not "no *new* errors."

---

## Source-of-truth references (verified against the actual code)

- **Renderer's parallel assembly (to delete):** `src/App.tsx` `handleSend()` — the whole function is
  `:2230-2387`; the inline body/header/URL/payload assembly this plan removes is `:2238-2295` (bounded by
  `try {` at `:2237` and `const preOutput: any[] = [];` at `:2297`, both of which stay).
- **Renderer imports to edit:** `src/App.tsx:10-16` (the `@portiq/core` `parseCurl` import block — add
  `InvalidJsonBodyError`); `src/App.tsx:62-63` (utils import cluster — add the new wrapper import).
- **`useEnvironmentState` destructure in `App.tsx` (unchanged, cited for grounding):** `src/App.tsx:477-487`
  pulls `getActiveEnv, getEnvVars, interpolate, redactSecrets` out of `useEnvironmentState()`; ~40 call
  sites across `App.tsx` call `interpolate(x)` / `redactSecrets(x)` / `getEnvVars()` with their CURRENT
  (no-`vars`-argument) signatures — Part A must preserve these signatures exactly.
- **Renderer's diverged copies (to delete):** `src/hooks/useEnvironmentState.ts:29-35` (`getEnvVars`),
  `:52-59` (`interpolate`), `:61-74` (`redactSecrets`).
- **Core's diverged/incomplete counterparts (to fix/extend):** `packages/core/src/exec/interpolate.ts`
  — `getEnvVars` (`:3-9`, the divergence), `interpolate` (`:11-17`, arity-only difference, body already
  correct), `redactSecrets` (`:19-26`, arity-only difference, body already correct — no `getSecretVars`
  companion exists yet).
- **Sibling test file to mirror (style/layout precedent):** `packages/core/src/exec/interpolate.test.ts`
  (already exists, extended by Task 1) and `src/utils/headers.ts` + `src/utils/headers.test.ts` (the
  `src/utils/*.ts` + colocated `*.test.ts` pattern Task 3's new file follows).
- **Wrapper pattern to mirror:** `packages/cli/src/resolve/httpPayload.ts` + `.test.ts` — the CLI's own
  thin wrapper over `assembleRequest` that maps `InvalidJsonBodyError` to its own error convention. Task 3
  does the renderer-side equivalent.
- **`window.api.sendRequest`'s required shape:** `src/types/global.d.ts:26-33` (`RequestConfig`) declares
  `headers: Record<string, string>` as **required** (not optional), while core's
  `HttpSendPayload.headers?: Record<string, string>` (`packages/core/src/transport/http.ts:18`) is optional.
  `assembleRequest`'s `assembleHeaders` always returns an object (never `undefined`), but the TYPE doesn't
  say so — Task 3's wrapper closes this gap so `handleSend`'s `payload` type-checks against `RequestConfig`
  without a cast.

### The `getEnvVars` divergence (why Part A is not just a rename)

`packages/core/src/exec/interpolate.ts:3-9` today:

```ts
export function getEnvVars(env: Environment | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of env?.vars ?? []) {
    if (v.enabled) out[v.key] = v.value;
  }
  return out;
}
```

versus the renderer's `src/hooks/useEnvironmentState.ts:32-34`:

```ts
return env.vars
    .filter((row) => row.key && row.enabled !== false)
    .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
```

Two real differences, confirmed by grepping every other `.enabled` filter in the repo (`assembleRequest.ts`,
`protocols/websocket.ts`, `cli/src/exec/toCurl.ts`, `mcp/src/exec/flow.ts`, and ~15 sites in `App.tsx` itself
all use `row.key && row.enabled !== false`):

1. **`enabled` truthiness.** Core requires `v.enabled` to be strictly truthy; the rest of the codebase treats
   a row as enabled unless `enabled` is explicitly `false` (defends against rows loaded from data that
   predates the `enabled` field). Core's `getEnvVars` is the one outlier — this is the bug Part A fixes.
2. **Missing `key` guard.** Core has no `v.key` check at all, so an empty-key row (`{key:"", enabled:true}`)
   would pollute the vars map with `out[""] = value`; the renderer (and every other row filter in the repo)
   excludes it.

`interpolate` and `redactSecrets` have **no behavioral divergence** — same regex / same escaping-free
`split/join` approach — only an **arity** difference: the renderer's copies take one argument and pull
`vars`/`secrets` from `getActiveEnv()` internally, while core's pure functions take `vars`/`secrets` as an
explicit second argument. Part A resolves this by keeping core's pure two-argument functions as canonical
and making the renderer hook's single-argument functions thin closures over them — no core signature change
needed for `interpolate`/`redactSecrets` themselves. The one new core function, `getSecretVars`, exists to
give the renderer hook something to close over for `redactSecrets`'s secret-map derivation (mirroring
`getEnvVars` for the general vars map), since core's `redactSecrets(value, secrets)` takes a pre-built
`secrets` map, not an `Environment` — the renderer's `redactSecrets(value)` needs both pieces (derive the
map, then redact) and today does both inline.

---

## File Structure

| File | Change |
|---|---|
| `packages/core/src/exec/interpolate.ts` | Modify: fix `getEnvVars`'s `enabled`/`key` filter; add `getSecretVars`. |
| `packages/core/src/exec/interpolate.test.ts` | Modify: add coverage for the fixed filter + `getSecretVars`. |
| `src/hooks/useEnvironmentState.ts` | Modify: delete the 3 diverged function bodies; delegate to core. |
| `src/utils/httpSend.ts` | Create: renderer wrapper over core `assembleRequest` (non-optional `headers`). |
| `src/utils/httpSend.test.ts` | Create: tests for the wrapper. |
| `src/App.tsx` | Modify: import additions (`:10-16`, `:62-63`); rewire `handleSend`'s assembly block (`:2238-2295`). |

---

## Part A — Env helper reconciliation

## Task 1: Fix `getEnvVars` + add `getSecretVars` in `@portiq/core`

**Files:**
- Modify: `packages/core/src/exec/interpolate.ts`
- Modify: `packages/core/src/exec/interpolate.test.ts`

**Interfaces:**
- Consumes: `Environment`, `EnvVar` (type) from `../model` (already imported by the test file; `EnvVar` is
  newly imported by this task).
- Produces (re-exported from `@portiq/core` and `@portiq/core` browser barrel automatically, via the
  existing `export * from "./exec/interpolate"` line in both `index.ts` and `index.browser.ts` — no barrel
  edit needed):
  - `getEnvVars(env): Record<string,string>` — same signature, corrected filter (`v.key && v.enabled !== false`).
  - `getSecretVars(env): Record<string,string>` — new: `v.key && v.secret && v.enabled !== false && v.value`.
  - `interpolate`, `redactSecrets` — unchanged (no divergence in their bodies).

- [ ] **Step 1: Write the failing tests — append to `packages/core/src/exec/interpolate.test.ts`**

Change the top import line from:

```ts
import type { Environment } from "../model";
```

to:

```ts
import type { Environment, EnvVar } from "../model";
```

and add `getSecretVars` to the `getEnvVars, interpolate` import. Then append these two `describe` blocks
after the existing `describe("interpolation", ...)` block (do not touch the existing block):

```ts
describe("getEnvVars — enabled/key edge cases (renderer parity)", () => {
  it("treats a row with enabled left undefined as enabled (matches the row-filter convention used everywhere else in the app)", () => {
    const withImplicit: Environment = {
      id: "e2", name: "Implicit",
      vars: [{ key: "implicit", value: "v", comment: "" } as unknown as EnvVar],
    };
    expect(getEnvVars(withImplicit)).toEqual({ implicit: "v" });
  });

  it("excludes a row with an empty key even when enabled", () => {
    const withEmptyKey: Environment = {
      id: "e3", name: "EmptyKey",
      vars: [{ key: "", value: "x", comment: "", enabled: true }],
    };
    expect(getEnvVars(withEmptyKey)).toEqual({});
  });
});

describe("getSecretVars", () => {
  it("includes only enabled vars marked secret with a non-empty value", () => {
    const env: Environment = {
      id: "e4", name: "Secrets",
      vars: [
        { key: "apiKey", value: "sekret", comment: "", enabled: true, secret: true },
        { key: "plain", value: "visible", comment: "", enabled: true },
        { key: "disabledSecret", value: "nope", comment: "", enabled: false, secret: true },
        { key: "emptySecret", value: "", comment: "", enabled: true, secret: true },
      ],
    };
    expect(getSecretVars(env)).toEqual({ apiKey: "sekret" });
  });

  it("treats a secret row with enabled left undefined as enabled", () => {
    const env: Environment = {
      id: "e5", name: "ImplicitSecret",
      vars: [{ key: "implicitSecret", value: "abc", comment: "", secret: true } as unknown as EnvVar],
    };
    expect(getSecretVars(env)).toEqual({ implicitSecret: "abc" });
  });

  it("returns an empty map for a null environment", () => {
    expect(getSecretVars(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/src/exec/interpolate.test.ts`
Expected: FAIL — `getSecretVars` is not exported from `./interpolate`, and the "implicit enabled" /
"empty key" `getEnvVars` assertions fail against the current strict-truthy, no-key-guard implementation.

- [ ] **Step 3: Implement the fix in `packages/core/src/exec/interpolate.ts`**

Replace the whole file with:

```ts
import type { Environment } from "../model";

export function getEnvVars(env: Environment | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of env?.vars ?? []) {
    if (v.key && v.enabled !== false) out[v.key] = v.value;
  }
  return out;
}

/** Env vars marked `secret` (and enabled), keyed for redactSecrets. Mirrors
 *  getEnvVars's row-enabled convention: a var counts as enabled unless
 *  `enabled` is explicitly `false` (covers rows loaded from data that
 *  predates the `enabled` field). */
export function getSecretVars(env: Environment | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of env?.vars ?? []) {
    if (v.key && v.secret && v.enabled !== false && v.value) out[v.key] = v.value;
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/src/exec/interpolate.test.ts`
Expected: PASS (11 tests: 4 existing + 7 new).

- [ ] **Step 5: Verify no regression in the consumers of `getEnvVars`**

Run: `npx vitest run packages/core/src/exec/assembleRequest.test.ts packages/core/src/exec/assembleRequest.parity.test.ts packages/cli/src/resolve/refs.test.ts`
Expected: PASS, unchanged counts — every existing fixture uses explicit `enabled: true/false` and non-empty
keys, so the corrected filter changes nothing for them (confirmed by inspection of both test files).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/exec/interpolate.ts packages/core/src/exec/interpolate.test.ts
git commit -m "$(cat <<'EOF'
fix(core): getEnvVars honors enabled!==false + empty-key exclusion; add getSecretVars

getEnvVars was the one row-filter in the codebase using strict-truthy
`enabled` with no `key` guard, diverging from the renderer and every other
row filter (assembleRequest, protocols/websocket, cli/toCurl, mcp/flow) which
all treat enabled as true unless explicitly false. getSecretVars gives
redactSecrets callers a way to derive the secret-value map from an
Environment without re-deriving it themselves.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Delegate `useEnvironmentState` to core's canonical helpers

**Files:**
- Modify: `src/hooks/useEnvironmentState.ts`

**Interfaces:**
- Consumes: `getEnvVars as coreGetEnvVars`, `getSecretVars`, `interpolate as coreInterpolate`,
  `redactSecrets as coreRedactSecrets` from `@portiq/core` (all four already flow through the Vite-aliased
  browser barrel per the Global Constraints note above).
- Produces: **unchanged** external shape — `useEnvironmentState()` still returns
  `getEnvVars(): Record<string,string>`, `interpolate(value): any`, `redactSecrets(value): any` with the
  exact same zero/one-argument call signatures the ~40 call sites in `src/App.tsx` and the props passed to
  `DagFlowPane`/other panes (`App.tsx:3356,3432-3433,3668`) already use. No caller of `useEnvironmentState()`
  changes in this task.

- [ ] **Step 1: Edit the imports in `src/hooks/useEnvironmentState.ts`**

Replace:

```ts
import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type { EnvVar, Environment } from "@portiq/core";
import type { EnvVar, Environment } from "@portiq/core";
```

with:

```ts
import { useState } from "react";
import { useLocalStorage } from "./useLocalStorage";
import {
    getEnvVars as coreGetEnvVars,
    getSecretVars,
    interpolate as coreInterpolate,
    redactSecrets as coreRedactSecrets,
} from "@portiq/core";

export type { EnvVar, Environment } from "@portiq/core";
import type { EnvVar, Environment } from "@portiq/core";
```

- [ ] **Step 2: Delegate `getEnvVars`**

Replace:

```ts
    function getEnvVars(): Record<string, string> {
        const env = getActiveEnv();
        if (!env) return {};
        return env.vars
            .filter((row) => row.key && row.enabled !== false)
            .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    }
```

with:

```ts
    function getEnvVars(): Record<string, string> {
        return coreGetEnvVars(getActiveEnv());
    }
```

- [ ] **Step 3: Delegate `interpolate` and `redactSecrets`**

Replace:

```ts
    function interpolate(value: string | any): string | any {
        if (typeof value !== "string") return value;
        const vars = getEnvVars();
        return value.replace(/\{\{(.*?)\}\}/g, (_match, key) => {
            const trimmed = String(key).trim();
            return Object.prototype.hasOwnProperty.call(vars, trimmed) ? vars[trimmed] : "";
        });
    }

    function redactSecrets(value: string | any): string | any {
        if (typeof value !== "string") return value;
        const env = getActiveEnv();
        if (!env || !env.vars) return value;
        let redacted = value;
        env.vars.forEach(v => {
            if (v.secret && v.enabled && v.value) {
                // Replace any occurrence of the secret value with its placeholder
                const escapedValue = v.value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
                redacted = redacted.replace(new RegExp(escapedValue, 'g'), `{{${v.key}}}`);
            }
        });
        return redacted;
    }
```

with:

```ts
    function interpolate(value: string | any): string | any {
        return coreInterpolate(value, getEnvVars());
    }

    function redactSecrets(value: string | any): string | any {
        return coreRedactSecrets(value, getSecretVars(getActiveEnv()));
    }
```

Note this is also a deliberate behavior fix, not just a delegation: the old `redactSecrets` gated on
`v.secret && v.enabled && v.value` (strict-truthy `enabled`, same bug class as Task 1's `getEnvVars` fix);
`getSecretVars` gates on `v.enabled !== false`, so a secret var with `enabled` left `undefined` is now
correctly redacted from history/logs instead of silently leaking. This widens redaction — the safe direction
for a function whose entire purpose is hiding secrets.

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (verified clean baseline before this task; `coreInterpolate`/`coreRedactSecrets`'s
generic/loose signatures accept the hook's `string | any` parameter without a cast).

Run: `npm run build`
Expected: success — confirms the Vite alias resolves `getSecretVars`/`getEnvVars`/`interpolate`/
`redactSecrets` from `index.browser.ts` (all four are exported via that barrel's existing
`export * from "./exec/interpolate";` line; no alias/barrel change needed).

- [ ] **Step 5: Full suite still green**

Run: `npm test`
Expected: PASS, same count as baseline plus Task 1's 7 new core tests (no renderer test exercises this hook
directly — see Global Constraints — so this step's job is proving nothing *else* broke).

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useEnvironmentState.ts
git commit -m "$(cat <<'EOF'
refactor(renderer): delegate useEnvironmentState env helpers to @portiq/core

getEnvVars/interpolate/redactSecrets were divergent local copies of the core
exec/interpolate.ts primitives (different enabled/key semantics — see the
prior commit). They now close over the corrected core implementations
instead of re-deriving vars/secrets inline. External call signatures are
unchanged, so no caller in App.tsx needs to change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Part B — `handleSend` rewire onto core `assembleRequest`

## Task 3: `src/utils/httpSend.ts` — renderer wrapper over core `assembleRequest`

**Files:**
- Create: `src/utils/httpSend.ts`
- Create: `src/utils/httpSend.test.ts`

**Interfaces:**
- Consumes: `assembleRequest`, `type AssemblableRequest`, `type AssembleRequestOptions`,
  `type HttpSendPayload` from `@portiq/core` (all already exported from both barrels; `HttpSendPayload`/
  `AssemblableRequest`/`AssembleRequestOptions` are `import type`-only, erased at Vite bundle time).
- Produces: `interface RendererHttpSendPayload extends HttpSendPayload { headers: Record<string,string> }`;
  `function buildHttpSendPayload(req: AssemblableRequest, opts?: AssembleRequestOptions): RendererHttpSendPayload`
  — throws core's `InvalidJsonBodyError` unchanged on a malformed JSON body (Task 4's caller catches it).
  This is the exact seam Task 4 imports.

- [ ] **Step 1: Write the failing test `src/utils/httpSend.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildHttpSendPayload } from "./httpSend";
import { InvalidJsonBodyError, type AssemblableRequest, type Environment } from "@portiq/core";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [{ key: "baseUrl", value: "https://api.test", comment: "", enabled: true }],
};

const base = (over: Partial<AssemblableRequest> = {}): AssemblableRequest => ({
  protocol: "http", method: "get", url: "{{baseUrl}}/users", bodyType: "none",
  ...over,
});

describe("buildHttpSendPayload", () => {
  it("delegates to core assembleRequest (url interpolated, method uppercased)", () => {
    const payload = buildHttpSendPayload(base(), { env });
    expect(payload.method).toBe("GET");
    expect(payload.url).toBe("https://api.test/users");
  });

  it("guarantees headers is always a plain object, never undefined", () => {
    const payload = buildHttpSendPayload(base(), { env });
    expect(payload.headers).toEqual({});
  });

  it("passes requestId through so cancellation can correlate the send", () => {
    const payload = buildHttpSendPayload(base(), { env, requestId: "http-abc" });
    expect(payload.requestId).toBe("http-abc");
  });

  it("propagates InvalidJsonBodyError for a malformed json body (caller maps it to UI error state)", () => {
    const req = base({ method: "post", bodyType: "json", bodyText: "{ not json" });
    expect(() => buildHttpSendPayload(req, { env })).toThrow(InvalidJsonBodyError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/httpSend.test.ts`
Expected: FAIL — cannot find module `./httpSend`.

- [ ] **Step 3: Implement `src/utils/httpSend.ts`**

```ts
import {
  assembleRequest,
  type AssemblableRequest,
  type AssembleRequestOptions,
  type HttpSendPayload,
} from "@portiq/core";

/** Same shape core returns, but `headers` is guaranteed present. assembleRequest
 *  always populates it (even as `{}`); the core type leaves it optional because
 *  other HttpSendPayload producers may omit it. window.api.sendRequest's
 *  RequestConfig (src/types/global.d.ts) requires headers, so this is the type
 *  the renderer actually needs. */
export interface RendererHttpSendPayload extends HttpSendPayload {
  headers: Record<string, string>;
}

/**
 * Renderer-side wrapper around the canonical core assembler
 * (@portiq/core assembleRequest). Mirrors packages/cli/src/resolve/httpPayload.ts's
 * role: one call site translating a stored/edited request + active environment
 * into the wire payload. Throws core's InvalidJsonBodyError unchanged for a
 * malformed JSON body — callers (App.tsx handleSend) catch it and map it to
 * their own UI error state, exactly like the CLI maps it to UsageError.
 */
export function buildHttpSendPayload(
  req: AssemblableRequest,
  opts: AssembleRequestOptions = {},
): RendererHttpSendPayload {
  const payload = assembleRequest(req, opts);
  return { ...payload, headers: payload.headers ?? {} };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/httpSend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/httpSend.ts src/utils/httpSend.test.ts
git commit -m "$(cat <<'EOF'
feat(renderer): add buildHttpSendPayload wrapper over core assembleRequest

Thin renderer-side seam mirroring packages/cli/src/resolve/httpPayload.ts:
delegates to @portiq/core's assembleRequest and guarantees `headers` is a
plain object (never undefined) so the result type-checks against
window.api.sendRequest's RequestConfig without a cast. No assembly logic
lives here — it's the single call site handleSend will use next.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewire `handleSend` (`src/App.tsx`) onto `buildHttpSendPayload`

**Files:**
- Modify: `src/App.tsx:10-16` (import), `src/App.tsx:62-63` (import), `src/App.tsx:2238-2295` (assembly block)

**Interfaces:**
- Consumes: `buildHttpSendPayload`, `type RendererHttpSendPayload` from `./utils/httpSend` (Task 3);
  `InvalidJsonBodyError` from `@portiq/core`; `getActiveEnv` (already destructured at `App.tsx:482` from
  `useEnvironmentState()`, untouched by this task).
- Produces: no new exports — `handleSend`'s observable behavior (payload shape, error message text,
  `setError`/`setResponseSummary` calls, `requestId`/cancel wiring, everything from `preOutput` onward)
  stays byte-identical, now produced by delegation instead of inline duplication.

- [ ] **Step 1: Add `InvalidJsonBodyError` to the existing `@portiq/core` import**

In `src/App.tsx`, replace (lines 10-16):

```ts
import {
  parseCurl,
  inferRequestNameFromUrl,
  looksLikeCurl,
  parameterizeParsedCurl,
  type ParsedCurl,
} from "@portiq/core";
```

with:

```ts
import {
  parseCurl,
  inferRequestNameFromUrl,
  looksLikeCurl,
  parameterizeParsedCurl,
  InvalidJsonBodyError,
  type ParsedCurl,
} from "@portiq/core";
```

- [ ] **Step 2: Import the wrapper**

In `src/App.tsx`, replace (lines 62-63):

```ts
import { applyBodyContentType } from "./utils/headers";
import { computeAutoHeaders, type AutoHeader } from "./utils/autoHeaders";
```

with:

```ts
import { applyBodyContentType } from "./utils/headers";
import { computeAutoHeaders, type AutoHeader } from "./utils/autoHeaders";
import { buildHttpSendPayload, type RendererHttpSendPayload } from "./utils/httpSend";
```

- [ ] **Step 3: Replace `handleSend`'s inline assembly (lines 2238-2295) with a single `buildHttpSendPayload` call**

Replace this block (the body between `try {` at `:2237` and `const preOutput: any[] = [];` at `:2297`,
both of which stay unchanged):

```ts
      const headers = parseHeaders();
      if (headers === null) return;
      let body = bodyType === "none" ? undefined : bodyText;
      let multipartParts;
      if (bodyType === "json") {
        const strippedJson = stripJsonComments(interpolate(bodyText));
        if (strippedJson.trim()) {
          try {
            body = JSON.stringify(JSON.parse(strippedJson));
          } catch (err: any) {
            setError(`Invalid JSON body: ${err.message}`);
            setResponseSummary({ summary: "Invalid JSON body.", hints: ["Fix the JSON syntax before sending."] });
            return;
          }
        } else {
          body = "";
        }
      }
      if (bodyType === "form") {
        const data = rowsToObject(bodyRows);
        body = new URLSearchParams(data).toString();
      }
      if (bodyType === "multipart") {
        multipartParts = (bodyRows || [])
          .filter((row) => row.key && row.enabled !== false)
          .map((row) => (
            row.kind === "file"
              ? {
                  kind: "file",
                  name: interpolate(row.key),
                  filename: row.fileName || "upload.bin",
                  contentType: row.mimeType || "application/octet-stream",
                  dataBase64: row.fileBase64 || ""
                }
              : {
                  kind: "text",
                  name: interpolate(row.key),
                  value: interpolate(row.value || "")
                }
          ));
        body = undefined;
      }
      if (bodyType === "xml") {
        body = interpolate(bodyText);
      }
      if (bodyType === "raw") {
        body = interpolate(bodyText);
      }
      const payload = {
        requestId,
        method,
        url: buildUrlWithParams(),
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v)])),
        body,
        multipartParts,
        timeoutMs: requestTimeoutMs,
        httpVersion
      };
```

with:

```ts
      let payload: RendererHttpSendPayload;
      try {
        payload = buildHttpSendPayload(
          {
            protocol: "http",
            method,
            url,
            headersText,
            headersRows,
            paramsRows,
            authType,
            authConfig,
            authRows,
            bodyType,
            bodyText,
            bodyRows,
            httpVersion,
            requestTimeoutMs
          },
          { env: getActiveEnv(), requestId }
        );
      } catch (err: any) {
        if (err instanceof InvalidJsonBodyError) {
          setError(err.message);
          setResponseSummary({ summary: "Invalid JSON body.", hints: ["Fix the JSON syntax before sending."] });
          return;
        }
        throw err;
      }
```

Two things to get right here (both already verified against the real code, not assumptions):

1. `err.message` is used directly (NOT `` `Invalid JSON body: ${err.message}` ``) — core's
   `InvalidJsonBodyError` message is already built as
   `` `Invalid JSON body: ${originalErr.message}` `` inside `assembleRequest.ts`'s `assembleBody`
   (`packages/core/src/exec/assembleRequest.ts:142`). Re-prefixing here would double it.
2. Every field named in the request object (`method, url, headersText, headersRows, paramsRows, authType,
   authConfig, authRows, bodyType, bodyText, bodyRows, httpVersion, requestTimeoutMs`) is an existing local
   variable destructured from `useRequestState()` at `App.tsx:183-199`, and each name matches
   `AssemblableRequest`'s `Pick<RequestItem, ...>` field names exactly (`packages/core/src/model/request.ts`)
   — no renaming/mapping needed.

Everything from `const preOutput: any[] = [];` (`:2297`) onward is untouched: it already only reads
`payload.method`, `payload.url`, `payload.headers`, `payload.body`, spreads `payload` into `window.api.sendRequest`
and the history entry, and reassigns `payload.method/url/headers/body` from the pre-script context — all of
which `RendererHttpSendPayload` still supports (it's `HttpSendPayload` plus non-optional `headers`).

Do **not** touch `parseHeaders`, `getCompiledAuthHeaders`, `getCompiledAuthParams`, `rowsToObject`,
`stripJsonComments`, or `buildUrlWithParams` — they are still called by the preview pane (`:1893-1909`),
code-snippet generation (`:1960-1978`), and curl export (`:1443`), none of which route through `handleSend`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors — in particular, `payload` (typed `RendererHttpSendPayload`, `headers` non-optional)
must satisfy `window.api.sendRequest(payload: RequestConfig)`'s required `headers: Record<string,string>`
(`src/types/global.d.ts:26-33,42`) without a cast; this is exactly what Task 3's `headers ?? {}` guarantee
was built for.

- [ ] **Step 5: Full regression pass**

Run: `npx vitest run packages/core/src/exec/interpolate.test.ts packages/core/src/exec/assembleRequest.test.ts packages/core/src/exec/assembleRequest.parity.test.ts src/utils/httpSend.test.ts`
Expected: PASS. The golden parity suite (`assembleRequest.parity.test.ts`) is the drift guard called for by
this plan's brief: it already proves `assembleRequest` reproduces the pre-rewire renderer `handleSend`
byte-for-byte, and `handleSend` now calls that exact function through a pure passthrough (Task 3), so parity
holds by construction — no new parity assertions are needed inside `App.tsx` itself.

Run: `npm test`
Expected: full suite green (same count as after Task 2, plus Task 3's 4 new tests).

Run: `npm run lint`
Expected: no new errors.

Run: `npm run build`
Expected: success (Vite build; proves the renderer bundle still resolves `@portiq/core` via the
`index.browser.ts` alias with the new import added).

- [ ] **Step 6: Manual smoke check (App.tsx has no component-mount test harness — see Global Constraints)**

Run the app (`npm run dev` or the project's `run` skill) and send one real HTTP request from the request
pane (e.g. a GET against a public endpoint, or the mock server) to confirm: the response renders, the
history entry is recorded with redacted secrets, and cancelling an in-flight request still works
(`activeHttpRequestId`/`handleCancelHttpSend` path is untouched by this task, but confirm end-to-end).
Per this project's established convention (headless Playwright screenshot capture when the interactive
browser doesn't paint frames), a headless Playwright screenshot of the response pane after sending is
acceptable evidence in place of an interactive session.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
refactor(renderer): rewire handleSend to build its payload via core assembleRequest

handleSend's inline header/body/URL assembly duplicated the exact logic
@portiq/core's assembleRequest already implements and golden-tests against
(packages/core/src/exec/assembleRequest.parity.test.ts). It now delegates to
buildHttpSendPayload (src/utils/httpSend.ts), which wraps assembleRequest and
guarantees a non-optional headers object. Sibling helpers (parseHeaders,
buildUrlWithParams, rowsToObject, stripJsonComments) are untouched — preview,
snippet-export, and curl-export still call them directly. Behavior,
cancellation, and error-message text are unchanged; the golden parity suite
is the ongoing drift guard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage.** Both mandated scope items are covered end to end: (1) `handleSend` now builds its
outgoing payload via core `assembleRequest` (Task 4, through the Task 3 wrapper), with the parallel
assembly deleted and byte-parity guarded by the pre-existing golden test plus new wrapper-level tests; (2)
the diverged env helpers are reconciled into one canonical `@portiq/core` implementation (Task 1 fixes the
real semantic divergence in `getEnvVars` and adds `getSecretVars`; Task 2 deletes the renderer's copies and
delegates), with new tests covering exactly the previously-diverged cases (`enabled === undefined`, empty
key, secret-var derivation). Order (Part A before Part B) is chosen deliberately and justified in the Global
Constraints so `assembleRequest`'s `resolveVars` never runs against the unfixed `getEnvVars`.

**2. Placeholder scan.** No "TBD"/"add error handling"/"similar to Task N". Every step shows full code (the
complete new `interpolate.ts`, the complete new `httpSend.ts`, the complete before/after for
`useEnvironmentState.ts`'s three functions, and the complete before/after for `handleSend`'s assembly
block). Every referenced type/function is either defined in this plan's own tasks or already exists in the
codebase at a cited path/line (`RequestItem`/`RequestRow`/`AuthConfig` in `packages/core/src/model/request.ts`;
`HttpSendPayload` in `packages/core/src/transport/http.ts`; `RequestConfig`/`Window.api.sendRequest` in
`src/types/global.d.ts`; `assembleRequest`/`InvalidJsonBodyError` already implemented in
`packages/core/src/exec/assembleRequest.ts`).

**3. Type consistency.** `getEnvVars`/`getSecretVars` keep the same `(env: Environment | null | undefined) =>
Record<string,string>` shape used elsewhere in core (`resolveVars`, `cli/src/resolve/refs.ts`).
`RendererHttpSendPayload` is `HttpSendPayload & { headers: Record<string,string> }`, verified against the
real `HttpSendPayload` (`method, url, headers?, body?, timeoutMs?, httpVersion?, multipartParts?, requestId?`)
and the real `RequestConfig` (`method, url, headers` required, `body?`, index signature) — no excess-property
or missing-required-property mismatch when `payload` is passed to `window.api.sendRequest`. Every field name
used in the `AssemblableRequest` literal built in `handleSend` (`method, url, headersText, headersRows,
paramsRows, authType, authConfig, authRows, bodyType, bodyText, bodyRows, httpVersion, requestTimeoutMs`) was
verified against both `useRequestState()`'s actual destructured local variables (`App.tsx:183-199`) and
`RequestItem`'s actual field names (`packages/core/src/model/request.ts`) — an exact 1:1 match, no renaming.

**4. Risk called out to the caller.** `App.tsx` has no jsdom/component-mount test harness (verified:
`vitest.config.ts` is `environment: "node"` project-wide, and no hook or `App.tsx` test file exists today).
Task 4's byte-parity guarantee therefore rests on (a) the pre-existing core golden-parity suite, which
already proves `assembleRequest` matches the pre-rewire renderer logic exactly, plus (b) the fact that the
rewire is a pure delegation with no new assembly logic on the renderer side (Task 3's wrapper only normalizes
`headers`), rather than on a new renderer-level test asserting the same thing twice. This is flagged
explicitly rather than silently assumed.
