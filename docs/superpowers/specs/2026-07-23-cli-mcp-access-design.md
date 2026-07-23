# CLI + MCP Access for Portiq — Design

**Date:** 2026-07-23
**Status:** Approved (brainstorming)
**Author:** brainstorming session

## Summary

Introduce two new ways to use Portiq alongside the desktop app:

1. **CLI** (`portiq`) — run saved requests, collections, and flows from the terminal; ad-hoc requests; import/export; mock server; git sync.
2. **MCP server** (`portiq-mcp`, stdio) — let AI agents (Claude Code/Desktop, etc.) browse the user's API library, execute requests/flows/tests, and (opt-in) mutate the library.

The goal is **full parity** with the desktop app over time, delivered in phases. Parity is achieved by extracting all business logic into a single framework-free **`@portiq/core`** package that the desktop app, CLI, and MCP server all depend on.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | **Full parity** — everything the desktop app can do, eventually available via CLI and MCP |
| Data source | **Shared store + portable files** — default to the same store the desktop app uses; also support importing/exporting portable collection files (e.g. `portiq.json`) |
| Distribution | **npm package + stdio MCP** — standalone `npx portiq` / global install; MCP over stdio for local agents; the installed desktop app also drops the same binaries on PATH |
| MCP default scope | **Read + execute freely, guarded writes** — browsing/running/tests are ungated; library mutations are opt-in |
| Architecture | **A: Shared `@portiq/core`** headless library used by app, CLI, and MCP |
| Phase order | Core → **MCP** → CLI → parity fill → hardening |

## Current architecture (as-is)

- **Electron + React + Vite** desktop app. `electron/main.cjs` is the Node/main process; `src/` is the React renderer.
- **Persistence:** a single SQLite file `<userData>/appdata.sqlite` with one table `kv (key TEXT PRIMARY KEY, value TEXT)`. The **entire** app state (collections, requests, environments, flows, history, workspaces) is serialized as one JSON blob under the key `appState` (`electron/main.cjs` `db:saveState`/`db:loadState`; written from `src/App.tsx` and `src/services/githubSync.ts`).
- **Execution is split:** protocol handlers in the renderer (`src/protocols/*`) build payloads via `buildRequest`, then the **actual network sends happen in `electron/main.cjs`** (`sendAutoHttpRequest`, `sendHttp1Request`, `sendHttp2Request`, `graphql:sendRequest`, `ws:connect/send/disconnect`, `mock:*`), invoked over IPC.
- **Domain logic in services/utils:** `src/services/testRunner.ts` + `scriptSteps.ts` (pm.* test/script runner), `curlParser.ts`, `format.ts`, `visualize.ts`, `table.ts`, `mockServer.ts`, `githubSync.ts` + `githubAuth.ts` (git-based sync), `ai.ts` (AI assist); `src/utils/autoHeaders.ts`, `headers.ts`, `safeFetch.ts`, `fuzzySearch.ts`.
- **Consequence:** there is **no headless core** today. The data shape lives in the renderer (persisted as an opaque blob) and execution is coupled to Electron IPC. This is the primary thing the design must change.

### Why the alternatives were rejected

- **B — CLI/MCP drive a headless Electron instance over RPC.** Automatic parity, but requires launching Electron per invocation: slow, heavy, fragile in CI, not a real standalone npm binary.
- **C — Reimplement a lightweight Node engine for CLI/MCP.** Fast for HTTP only, but produces two execution engines that drift; "full parity" (flows, scripting, gRPC, mock, sync) becomes a duplicate-maintenance trap.

Approach **A** (shared core) is the only option that makes full parity sustainable.

## Target architecture

### Repo structure (npm workspaces)

Convert the repo into a small monorepo. The desktop app stays at the root and consumes the new core.

```
portiq/
├─ packages/
│  ├─ core/     → @portiq/core   (headless: data + execution + scripting + flows + mock + sync)
│  ├─ cli/      → @portiq/cli     (bin: `portiq`)
│  └─ mcp/      → @portiq/mcp     (bin: `portiq-mcp`, stdio server)
├─ electron/    → thin IPC layer over @portiq/core
├─ src/         → React UI (unchanged behavior; execution delegated to core via IPC)
```

### `@portiq/core` — framework-free TypeScript, runs in plain Node

Each module is extracted from where the logic lives today.

| Module | Responsibility | Extracted from |
|---|---|---|
| `store/` | Resolve the data dir; read/write the `appState` SQLite `kv` store; portable-file import/export; **typed accessors** for collections, requests, environments, flows, history, workspaces | `electron/main.cjs` (`db:*`), `src/App.tsx` blob access |
| `model/` | Domain TypeScript types (the `appState` shape, made explicit) | `src/types`, inferred state shape |
| `protocols/` | Protocol handlers **plus the real senders** (auto / HTTP1.1 / HTTP2, GraphQL, WebSocket, gRPC) | `src/protocols/*` + `main.cjs` `send*Request`, `graphql:*`, `ws:*` |
| `exec/` | Executor: `{{variable}}` interpolation, auth application, auto-headers, timeout/cancel → normalized response | `src/utils/autoHeaders.ts`, `headers.ts`, `safeFetch.ts` |
| `scripting/` | Pre/post scripts + `pm.*` test runner | `src/services/testRunner.ts`, `scriptSteps.ts` |
| `flows/` | DAG executor (reference-based data passing) | renderer flow engine |
| `mock/` | Mock server | `src/services/mockServer.ts` + `main.cjs mock:*` |
| `sync/` | Git-based sync | `src/services/githubSync.ts`, `githubAuth.ts` |
| `import/` | curl parser, format/visualize/table | `src/services/curlParser.ts`, `format.ts`, `visualize.ts`, `table.ts` |
| `ai/` | AI assistance (optional / later) | `src/services/ai.ts` |
| `search/` | Fuzzy search over the library | `src/utils/fuzzySearch.ts` (`fuse.js`) |

After extraction, `electron/main.cjs` becomes a thin wrapper that calls `@portiq/core` — proving parity with **no UI behavior change**. The renderer may progressively delegate `buildRequest`/`validate` to core so there is one source of truth, but that renderer refactor is opportunistic, not required for CLI/MCP.

## Data-location contract

All three surfaces **share one storage location by default, regardless of install order**, because `@portiq/core` owns a single path resolver that every surface computes identically. Nothing re-derives the path independently.

- Canonical store file: `<dataDir>/appdata.sqlite` (+ `-wal` / `-shm`).
- `resolveDataDir()` reproduces Electron's `userData` convention **without** Electron:

  | OS | Default data dir |
  |---|---|
  | macOS | `~/Library/Application Support/Portiq` |
  | Windows | `%APPDATA%\Portiq` |
  | Linux | `~/.config/Portiq` |

- Resolution precedence: `--data-dir` flag → `PORTIQ_DATA_DIR` env → config file → canonical default.
- **Install order is irrelevant.** Whoever runs first creates `appdata.sqlite`; anything installed later discovers the same path and attaches. Install only the CLI now, add the desktop app later, add MCP after — all land on the same DB.
- The desktop app is **pinned** to this path via `app.setName("Portiq")` / `app.setPath("userData", resolveDataDir())` so it agrees with core.

### Latent bug to fix

The app currently never calls `app.setName()`, so in **dev** the path uses `"portiq"` (lowercase, from `package.json` `name`) while **packaged** builds use `"Portiq"` (from `productName`). Dev and installed builds therefore already point at *different* folders. The plan **pins the app name explicitly** so dev, packaged, CLI, and MCP converge on one location; otherwise "shared storage" silently breaks between dev and prod. (A one-time migration/detection of an existing lowercase-`portiq` dev store may be needed.)

## Concurrency model (shared store while the desktop app runs)

Because the whole state is a single `appState` blob, naive concurrent writes can clobber each other.

- Enable **SQLite WAL**; reads are always safe and cheap.
- Writes = read-modify-write of `appState` inside a transaction, guarded by a **version / `updatedAt` check (optimistic concurrency)**. On conflict: reload and retry, or fail with a clear message.
- The desktop app **watches for external DB changes** and live-reloads `appState`, warning if it has unsaved local edits.
- Because "guarded writes" is the default MCP scope, CLI/MCP usage is read/execute-heavy, keeping write contention rare.
- **Fast-follow (flagged, not v1):** normalize `appState` into per-entity rows so fine-grained concurrent writes become safe without whole-blob rewrites.

## CLI design (`portiq`)

### Commands

| Command | Purpose |
|---|---|
| `portiq ls [collections\|requests\|envs\|flows]` | List library contents |
| `portiq get <ref>` | Inspect a resolved request/collection/flow |
| `portiq search <query>` | Fuzzy search the library |
| `portiq run <ref>` | Execute a saved request / collection / flow and run its tests |
| `portiq exec ...` | Ad-hoc request (curl-like flags or `--from-curl`), not saved |
| `portiq import <file>` / `portiq export <ref>` | Portable files (curl, `portiq.json`; Postman/OpenAPI later) |
| `portiq mock <ref>` | Run the mock server |
| `portiq sync push\|pull\|status` | Git-based sync |
| `portiq mcp` | Start the stdio MCP server (alias of `portiq-mcp`) |
| `portiq where` / `portiq config` | Print/resolve the data dir and settings |

### Conventions

- **Reference syntax:** path-style `Collection/Folder/Request`, or `--id <uuid>`.
- **Flags:** `--env <name>`, `--var k=v` (repeatable), `--data-dir <path>`, `--reporter pretty|json|junit`, `-o/--output <file>`, `--timeout <ms>`, `--fail-on-test`, `--dry-run` (print the resolved request without sending), `--no-color`.
- **Exit codes (CI-friendly):** `0` success · `1` runtime error · `2` test/assertion failure · `3` usage error.
- **Reporter default:** `pretty` in a TTY, `json` when piped.

## MCP server design (`portiq-mcp`, stdio)

Host config drop-in (Claude Code/Desktop): `{ "command": "portiq-mcp" }` or `{ "command": "npx", "args": ["-y", "@portiq/mcp"] }`.

### Resources (read)

`portiq://collections`, `portiq://collection/{id}`, `portiq://request/{id}`, `portiq://environments`, `portiq://environment/{id}`, `portiq://flows`, `portiq://flow/{id}`, `portiq://history`.

### Tools — read/execute (ungated)

`list_collections`, `list_requests`, `get_request`, `search`, `list_environments`, `get_environment`, `run_request` (ref/id + env + var overrides → normalized response + test results), `run_flow`, `run_collection` (→ test summary), `run_ad_hoc_request`, `import_curl` (parse-only → request object).

### Tools — mutating / guarded (opt-in)

`create_request`, `update_request`, `delete_request`, `create_collection`, `set_environment_variable`, `save_ad_hoc_as_request`.

- Gated by a server flag: `--allow-writes` / `PORTIQ_MCP_ALLOW_WRITES=1`. When off, these tools are **hidden** and return a clear "writes disabled" message.
- Carry MCP `destructiveHint` / `readOnlyHint` annotations so hosts can prompt for confirmation.
- Optional **execution allow/deny-list** for hosts — a safety knob, since a saved `POST` can have real side-effects even though execution itself is ungated by default.
- Writes go through core's optimistic-concurrency path; the desktop app live-reloads.

## Phased roadmap

- **Phase 0 — Core extraction & data contract.** Set up npm workspaces; build `@portiq/core` with `store/` (`resolveDataDir` + WAL + optimistic writes + portable import/export), `model/`, `protocols/` + senders (HTTP/GraphQL/WS), `exec/`, **and `scripting/`** (needed because MCP's `run_collection` returns test results). Rewire `electron/main.cjs` to call core. **Pin the app name.** Golden parity test proving the desktop app behaves identically. *Unblocks everything.*
- **Phase 1 — MCP server (stdio).** Resources + read/execute tools + guarded writes (opt-in). Host config snippets for Claude Code/Desktop.
- **Phase 2 — CLI.** `ls/get/search/run/exec/import/export/where/config`, env + vars, reporters (pretty/json/junit), exit codes.
- **Phase 3 — Parity fill.** DAG flows executor, mock server command, gRPC, git sync (push/pull/status), AI-assisted tools. Both CLI and MCP gain these as the core modules land.
- **Phase 4 — Hardening & packaging.** Desktop live-reload on external DB change; bundle the `portiq` / `portiq-mcp` binaries with the installed desktop app (drop on PATH) + npm publish; docs and examples; optional schema normalization for fine-grained concurrency.

## Testing strategy

- **Core (vitest, already in repo):** units for `store` (path resolution, read/write, optimistic writes), interpolation, protocol senders (against a local test HTTP server), scripting/test runner. Existing tests (`testRunner.test.ts`, `curlParser.test.ts`, `scriptSteps.test.ts`, `visualize.test.ts`, `autoHeaders.test.ts`, `headers.test.ts`) move into core.
- **Parity:** golden tests asserting the desktop IPC path and the CLI/core path produce identical normalized output for the same request.
- **CLI:** integration tests invoking the built binary against a temp `--data-dir` and a local mock server; assert exit codes and reporter output.
- **MCP:** an stdio MCP-client harness asserting tool schemas, default write-gating (writes hidden unless opted in), and read/execute behavior.
- **CI:** macOS / Windows / Linux matrix specifically to validate `resolveDataDir()` path resolution.

## Out of scope (v1)

- HTTP transport for MCP (stdio only for now).
- Full schema normalization of the store (kept as a fast-follow).
- Postman/OpenAPI import formats (curl + `portiq.json` first).
- Remote/multi-user access; there is no backend and none is introduced.

## Open questions / risks

- **Whole-blob writes** limit safe concurrency until normalization; mitigated by optimistic writes + guarded-writes default.
- **gRPC** is experimental today (native transport not fully enabled); its CLI/MCP parity depends on that maturing.
- **AI assist** in a headless context needs a decision on credential/config sourcing (deferred to Phase 3).
- **Existing dev store migration:** pinning the app name may orphan an existing lowercase-`portiq` dev store; needs a detect-and-migrate step.
