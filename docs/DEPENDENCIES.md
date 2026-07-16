# Dependency Watchlist

Deliberately-held-back dependencies and the workarounds keeping the toolchain
green. Each entry has a clear **exit condition** — revisit when it's met.

_Last reviewed: 2026-07-16._

## 1. TypeScript pinned to 6.x (7 is blocked)

- **Held at:** `typescript@^6.0.3`
- **Target:** `typescript@7`
- **Why blocked:** TypeScript 7 is the native (Go) rewrite and ships **without
  the JS programmatic API** that tooling links against. `typescript-eslint`'s
  parser (`@typescript-eslint/typescript-estree`) crashes against TS 7 because
  APIs like `ts.Extension.Cjs` are no longer exposed. All `@typescript-eslint/*`
  packages peer-cap at `typescript@">=4.8.4 <6.1.0"`, and there is no
  typescript-eslint release (stable or canary) that lifts it.
- **Upstream:**
  - https://github.com/typescript-eslint/typescript-eslint/issues/12518 (exact repro, closed as "no TS 7 API yet")
  - https://github.com/typescript-eslint/typescript-eslint/issues/10940 (tracking issue for tsgo support)
- **Exit condition:** TypeScript **7.1** ships the stable programmatic API **and**
  `typescript-eslint` publishes a release supporting it. Then bump `typescript`
  and the `@typescript-eslint/*` stack together.
- **Not doing (decided 2026-07-16):** the npm-alias side-by-side setup (TS 6 for
  lint, TS 7 for builds). It only buys compile speed while keeping type-checking
  on TS 6, and adds split-brain config. Wait for real support instead.

## 2. `eslint-plugin-react` forced onto ESLint 10 via override

- **Held at:** `eslint-plugin-react@7.37.5` (latest) under ESLint `10.x`
- **Why a workaround:** `eslint-plugin-react` peer-caps at `eslint@"...^9.7"` — it
  has no declared ESLint 10 support. We pin the peer through an override in
  `package.json`:
  ```json
  "overrides": { "eslint-plugin-react": { "eslint": "$eslint" } }
  ```
- **Status:** **Working** — unlike TS 7, the plugin runs fine at runtime; `npm run
  lint` is clean on ESLint 10. This is a version-assertion override, not a
  broken API.
- **Exit condition:** `eslint-plugin-react` ships a release whose peer range
  includes `eslint@^10`. Then remove the `overrides` entry and confirm lint still
  passes.

## Post-upgrade manual verification (not automated)

Build, unit tests, and a runtime embedding smoke test all pass, but these
DOM-interaction-heavy paths aren't fully covered headlessly — eyeball them after
major React / transformers bumps:

- **DAG canvas** (React 19 / `@xyflow/react`): node drag, handle-to-handle
  connect, action bar.
- **Semantic request search** (`@huggingface/transformers`): index + query,
  relevance ordering.
