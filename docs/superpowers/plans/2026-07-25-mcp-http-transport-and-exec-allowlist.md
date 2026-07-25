# MCP Streamable-HTTP Transport + Execution Allow/Deny-List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable streamable-HTTP transport to `portiq-mcp` alongside the existing stdio transport (bind-host + bearer-token basics, mirrored client-harness test), and a config-driven execution allow/deny-list that gates the execute tools (`run_request`/`run_ad_hoc_request`/`run_collection`/`run_flow`) by resolved target host — deny wins — orthogonal to `--allow-writes`.

**Architecture:** `packages/mcp` keeps its additive factory (`createMcpServer(ctx)` invoking independent registrars). `bin.ts` selects the transport from `ServerConfig.transport`: stdio (default, unchanged) via `StdioServerTransport`, or HTTP via a new `startHttpServer(ctx, opts)` module that runs a Node `http.createServer` bound to a configurable host, checks an optional `Authorization: Bearer <token>`, and routes `/mcp` to a single-session stateful `StreamableHTTPServerTransport` connected to one `createMcpServer(ctx)` (sufficient for local single-user use). The execution gate is a pure `hostPolicy.ts` module (`compileHostPolicy(allow, deny)` → `check(url)`; `makeHostGuard`) compiled once in `buildContext` and threaded as an optional `hostGuard(url)` callback into `RunContext`/`FlowRunContext`, called by `exec/run.ts` and `exec/flow.ts` on the resolved URL right before every network send; `tools/exec.ts` builds the guard from `ctx.hostPolicy`.

**Tech Stack:** TypeScript (src `moduleResolution: Bundler`; CJS `dist` via `tsc`), Vitest 4 (`node` env), `@modelcontextprotocol/sdk` 1.29.0 (`StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`, `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`, `Client`, `InMemoryTransport`; already-present `@hono/node-server` powers the Node HTTP wrapper), `zod` v4, Node `http`/`crypto`, `@portiq/core` (read-only via public API).

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

- **Owns only `packages/mcp/**`.** No file outside `packages/mcp/` is modified by this plan — no core edit, no
  root-`package.json` script change (`build:mcp` and `pretest` already build MCP), no `eslint.config.js` change
  (`packages/mcp/tsconfig.json` is already registered). New source files land under existing `include: ["src"]`.
- **Consume `@portiq/core` read-only via its public API.** Import from `"@portiq/core"` / `"@portiq/core/flows"`
  only. The host guard inspects only the already-resolved URL string produced by `assembleRequest`/`buildSendPayload`;
  it does not reach into core internals.
- **better-sqlite3 ABI gotcha.** Every task whose tests open the store (`openAppStateStore` via `buildContext`/
  `seedStore`) or start a server runs on plain-Node. If a test hits `ERR_DLOPEN_FAILED`/`NODE_MODULE_VERSION`,
  run `npm rebuild better-sqlite3` first; `npm run rebuild` returns the binary to Electron.
- **stdio purity is transport-scoped.** The stdio path MUST still write nothing but JSON-RPC to stdout (diagnostics
  → `stderr` via `console.error`). The HTTP path may log its readiness banner to `stderr` too; do not emit to stdout
  in either mode.
- **HTTP transport is single-session + local-first.** `startHttpServer` connects ONE `McpServer` to ONE
  `StreamableHTTPServerTransport` (stateful; `sessionIdGenerator: () => randomUUID()`). This serves one client
  session at a time — sufficient for local single-user use; multi-session pooling is explicitly out of scope.
  Default bind host is loopback `127.0.0.1`; binding elsewhere without `--auth-token` emits a stderr warning.
- **Gate orthogonality (must be documented).** `--allow-writes` gates library-MUTATION tools; the exec host
  allow/deny-list gates EXECUTE tools by resolved target host. They are independent gates over disjoint tool
  categories. Within the host policy, **deny wins**: a host matching any deny pattern is blocked even if it also
  matches the allow-list; an empty allow-list permits all non-denied hosts; a non-empty allow-list default-denies
  unlisted hosts.
- Test convention (match repo): `import { describe, it, expect } from "vitest";` (+ `vi`, `beforeAll`, `afterAll`,
  `afterEach` as needed); co-locate `*.test.ts`; local factory helpers at top; no global setup file. Mirror
  `packages/mcp/src/stdio.e2e.test.ts` for the transport client-harness style and `server.test.ts` for the
  in-process `connectInProcess` style.
- Commit after every task with a Conventional Commit ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (verified real APIs)

- **MCP SDK 1.29.0** (`node_modules/@modelcontextprotocol/sdk`, `exports` includes a `./*` wildcard so subpaths
  resolve):
  - Server: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js` —
    `new StreamableHTTPServerTransport(options?)` where `StreamableHTTPServerTransportOptions` has
    `sessionIdGenerator?: (() => string) | undefined` (a generator → stateful; `undefined` → stateless);
    `async handleRequest(req: IncomingMessage & { auth? }, res: ServerResponse, parsedBody?: unknown): Promise<void>`
    (reads the request stream itself when `parsedBody` is omitted — no body-parser needed);
    `get sessionId`, `async start()` (no-op), `async close()`, `set onclose/onerror/onmessage`. Verified
    `require.resolve("@modelcontextprotocol/sdk/server/streamableHttp.js")` succeeds; `@hono/node-server@1.19.15`
    (the Node wrapper's dependency) is hoisted at repo root.
  - Client: `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js` —
    `new StreamableHTTPClientTransport(url: URL, opts?: { requestInit?: RequestInit; ... })`. Pass the bearer
    token via `{ requestInit: { headers: { Authorization: "Bearer <token>" } } }`. Verified resolvable.
  - Already used by Phase 1: `McpServer`/`ResourceTemplate` (`server/mcp.js`), `StdioServerTransport`
    (`server/stdio.js`), `Client` (`client/index.js`), `StdioClientTransport` (`client/stdio.js`),
    `InMemoryTransport` (`inMemory.js`). `server.connect(transport)`, `server.close()`; `client.connect(transport)`,
    `client.listTools()`, `client.callTool({ name, arguments })` → `{ content: [{ type:"text", text }], isError? }`,
    `client.close()`.
- **Existing `packages/mcp` files this plan builds on (verified):**
  - `src/config.ts` — `interface ServerConfig { dataDir?; allowWrites; appVersion }` + `parseServerConfig(argv, env)`
    (loop over `--allow-writes`/`--data-dir`/`--data-dir=`, env `PORTIQ_MCP_ALLOW_WRITES`/`PORTIQ_MCP_APP_VERSION`).
  - `src/context.ts` — `interface ServerContext { config; store; transport; close() }`; `buildContext(config)` opens
    `openAppStateStore({ dataDir: config.dataDir })` + `new HttpTransport({ appVersion: config.appVersion })`.
  - `src/server.ts` — `createMcpServer(ctx): McpServer` (additive registrars).
  - `src/bin.ts` — parses config, builds ctx, `createMcpServer`, connects `new StdioServerTransport()`, SIGINT/SIGTERM
    close, stderr `[portiq-mcp] ready` banner.
  - `src/exec/run.ts` — `interface RunContext { transport: HttpTransport; env?; vars? }`; `runRequestItem(item, ctx)`.
    HTTP branch: `const payload = assembleRequest(item, { env: ctx.env, vars }); outcome = await ctx.transport.send(payload)`.
    GraphQL branch interpolates `item.url`. `RunContext`/`runRequestItem` are consumed ONLY by `tools/exec.ts`.
  - `src/exec/flow.ts` — `interface FlowRunContext { transport; env; lookupRequest }`; `runSavedFlow(graph, ctx)`;
    `RunDeps.sendRequest` receives `{ method, url, headers, body?, timeoutMs? }` (URL already resolved by core's
    `buildSendPayload`). Consumed ONLY by `tools/exec.ts`.
  - `src/tools/exec.ts` — registers `run_request`/`run_ad_hoc_request`/`run_collection`/`run_flow`; each `try/catch`
    turns a thrown `Error` into `errorToolResult(err.message)` (`{ content:[{text}], isError:true }`).
  - `src/tools/write.ts` — the `--allow-writes` gate: all write tools registered, then `.disable()`d when
    `!ctx.config.allowWrites` (SDK hides disabled tools from `tools/list`).
  - `src/stdio.e2e.test.ts` — the harness to mirror: seeds a temp store (`withTempDataDir`+`seedStore`), starts a
    local echo (`startTestHttpServer`), spawns/connects a `Client`, asserts `listTools`/`callTool`.
  - `src/testkit/` — `tempStore.ts` (`withTempDataDir`, `seedStore`), `httpServer.ts` (`startTestHttpServer` → echo
    returning `{ method, path, headers, body }`), `inProcessClient.ts` (`connectInProcess(server)`).
- **`@portiq/core` (verified real):** `assembleRequest(req, opts?): HttpSendPayload` and `HttpSendPayload { requestId?,
  method, url, headers?, body?, timeoutMs?, httpVersion?, multipartParts? }` (`packages/core/src/exec/assembleRequest.ts`,
  `packages/core/src/transport/http.ts:14`); `resolveVars(env, overrides?)`; `HttpTransport`, `AppState`, `RequestItem`,
  `Collection`, `FolderItem`, `Environment`. `@portiq/core/flows` `RunDeps.sendRequest` payload shape confirmed at
  `packages/core/src/flows/engine.ts:13`.

---

## File Structure

**Created**
- `packages/mcp/src/hostPolicy.ts` — pure allow/deny host-policy compiler + guard factory (no I/O).
- `packages/mcp/src/hostPolicy.test.ts` — unit tests for matching precedence (deny-wins, wildcard, port, unparseable).
- `packages/mcp/src/transport/http.ts` — `startHttpServer(ctx, opts)`: Node HTTP server + bearer auth + single-session `StreamableHTTPServerTransport`.
- `packages/mcp/src/transport/http.test.ts` — HTTP client-harness test (list tools, run request, 401) mirroring `stdio.e2e.test.ts`.
- `packages/mcp/src/tools/exec.hostguard.test.ts` — in-process test proving the exec tools honor the host policy.

**Modified**
- `packages/mcp/src/config.ts` — extend `ServerConfig` (transport/http/auth/exec lists) + parse new flags/env.
- `packages/mcp/src/config.test.ts` — append HTTP + exec allow/deny parsing cases.
- `packages/mcp/src/context.ts` — compile `hostPolicy` in `buildContext`; add it to `ServerContext`.
- `packages/mcp/src/exec/run.ts` — add optional `hostGuard` to `RunContext`; call it on the resolved URL before each send.
- `packages/mcp/src/exec/flow.ts` — add optional `hostGuard` to `FlowRunContext`; call it in the `sendRequest` dep.
- `packages/mcp/src/tools/exec.ts` — build the guard from `ctx.hostPolicy` and pass it into `runRequestItem`/`runSavedFlow`.
- `packages/mcp/src/bin.ts` — branch on `config.transport`; start HTTP server (with loopback/auth warning) or stdio.
- `packages/mcp/src/index.ts` — export `startHttpServer`, `compileHostPolicy`, `makeHostGuard`, `HostPolicy`.
- `packages/mcp/README.md` — document HTTP transport flags, exec allow/deny-list, and gate precedence.

---

## Task 1: Extend `config.ts` — HTTP transport + exec allow/deny flags/env

**Files:**
- Modify: `packages/mcp/src/config.ts`
- Modify (append): `packages/mcp/src/config.test.ts`

**Interfaces:**
- Consumes: `SERVER_VERSION` from `./version`.
- Produces: extended `interface ServerConfig` adding optional `transport?: "stdio" | "http"`, `httpHost?: string`, `httpPort?: number`, `authToken?: string`, `execAllow?: string[]`, `execDeny?: string[]` (new fields OPTIONAL so existing `buildContext({dataDir,allowWrites,appVersion})` literals in other tests keep compiling; `parseServerConfig` always populates them). `parseServerConfig(argv, env)` now also reads: `--http`/`--stdio` and `PORTIQ_MCP_HTTP∈{"1","true"}` → transport; `--host <h>`/`--host=<h>`/`PORTIQ_MCP_HOST` (default `"127.0.0.1"`); `--port <n>`/`--port=<n>`/`PORTIQ_MCP_PORT` (default `3939`); `--auth-token <t>`/`--auth-token=<t>`/`PORTIQ_MCP_AUTH_TOKEN`; `--exec-allow <csv>` and `--exec-deny <csv>` (repeatable, comma-split) merged after env `PORTIQ_MCP_EXEC_ALLOW`/`PORTIQ_MCP_EXEC_DENY`.

- [ ] **Step 1: Append failing tests to `packages/mcp/src/config.test.ts`**

```ts
describe("parseServerConfig — HTTP transport", () => {
  it("defaults to stdio transport", () => {
    expect(parseServerConfig([], {}).transport).toBe("stdio");
  });

  it("selects http via --http and reads host/port/auth-token", () => {
    const c = parseServerConfig(["--http", "--host", "0.0.0.0", "--port", "8080", "--auth-token", "t0k"], {});
    expect(c.transport).toBe("http");
    expect(c.httpHost).toBe("0.0.0.0");
    expect(c.httpPort).toBe(8080);
    expect(c.authToken).toBe("t0k");
  });

  it("selects http via PORTIQ_MCP_HTTP and reads env host/port", () => {
    const c = parseServerConfig([], { PORTIQ_MCP_HTTP: "1", PORTIQ_MCP_HOST: "localhost", PORTIQ_MCP_PORT: "9000" });
    expect(c.transport).toBe("http");
    expect(c.httpHost).toBe("localhost");
    expect(c.httpPort).toBe(9000);
  });

  it("defaults http host/port when unspecified", () => {
    const c = parseServerConfig(["--http"], {});
    expect(c.httpHost).toBe("127.0.0.1");
    expect(c.httpPort).toBe(3939);
  });

  it("honors = forms and lets --stdio override --http", () => {
    const c = parseServerConfig(["--http", "--port=7000", "--stdio"], {});
    expect(c.transport).toBe("stdio");
    expect(c.httpPort).toBe(7000);
  });
});

describe("parseServerConfig — exec allow/deny", () => {
  it("defaults to empty lists", () => {
    const c = parseServerConfig([], {});
    expect(c.execAllow).toEqual([]);
    expect(c.execDeny).toEqual([]);
  });

  it("accumulates repeated and comma-separated flags", () => {
    const c = parseServerConfig(["--exec-allow", "a.com,b.com", "--exec-deny=c.com", "--exec-deny", "d.com"], {});
    expect(c.execAllow).toEqual(["a.com", "b.com"]);
    expect(c.execDeny).toEqual(["c.com", "d.com"]);
  });

  it("merges env lists before flag lists", () => {
    const c = parseServerConfig(["--exec-deny", "flag.com"], { PORTIQ_MCP_EXEC_DENY: "env1.com, env2.com" });
    expect(c.execDeny).toEqual(["env1.com", "env2.com", "flag.com"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- packages/mcp/src/config.test.ts`
Expected: FAIL — `transport`/`httpHost`/`execAllow` are `undefined` (properties not produced yet).

- [ ] **Step 3: Rewrite `packages/mcp/src/config.ts`**

```ts
import { SERVER_VERSION } from "./version";

export interface ServerConfig {
  dataDir?: string;
  allowWrites: boolean;
  appVersion: string;
  transport?: "stdio" | "http";
  httpHost?: string;
  httpPort?: number;
  authToken?: string;
  execAllow?: string[];
  execDeny?: string[];
}

const DATA_DIR_PREFIX = "--data-dir=";
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3939;

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

function splitHosts(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseServerConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  let allowWrites = truthy(env.PORTIQ_MCP_ALLOW_WRITES);
  let dataDir: string | undefined;
  let transport: "stdio" | "http" = truthy(env.PORTIQ_MCP_HTTP) ? "http" : "stdio";
  let httpHost = env.PORTIQ_MCP_HOST || DEFAULT_HTTP_HOST;
  let httpPort = env.PORTIQ_MCP_PORT ? Number(env.PORTIQ_MCP_PORT) : DEFAULT_HTTP_PORT;
  let authToken = env.PORTIQ_MCP_AUTH_TOKEN || undefined;
  const execAllow = splitHosts(env.PORTIQ_MCP_EXEC_ALLOW);
  const execDeny = splitHosts(env.PORTIQ_MCP_EXEC_DENY);

  // Reads a `--flag value` or `--flag=value` option; returns null if `arg` is not this flag.
  const takeValue = (arg: string, flag: string, i: number): { value: string; next: number } | null => {
    if (arg === flag) return { value: argv[i + 1] ?? "", next: i + 1 };
    if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), next: i };
    return null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-writes") { allowWrites = true; continue; }
    if (arg === "--http") { transport = "http"; continue; }
    if (arg === "--stdio") { transport = "stdio"; continue; }
    if (arg === "--data-dir") { dataDir = argv[i + 1]; i += 1; continue; }
    if (arg.startsWith(DATA_DIR_PREFIX)) { dataDir = arg.slice(DATA_DIR_PREFIX.length); continue; }

    const host = takeValue(arg, "--host", i);
    if (host) { httpHost = host.value; i = host.next; continue; }
    const port = takeValue(arg, "--port", i);
    if (port) { httpPort = Number(port.value); i = port.next; continue; }
    const token = takeValue(arg, "--auth-token", i);
    if (token) { authToken = token.value; i = token.next; continue; }
    const allow = takeValue(arg, "--exec-allow", i);
    if (allow) { execAllow.push(...splitHosts(allow.value)); i = allow.next; continue; }
    const deny = takeValue(arg, "--exec-deny", i);
    if (deny) { execDeny.push(...splitHosts(deny.value)); i = deny.next; continue; }
  }

  return {
    dataDir,
    allowWrites,
    appVersion: env.PORTIQ_MCP_APP_VERSION || SERVER_VERSION,
    transport,
    httpHost,
    httpPort,
    authToken,
    execAllow,
    execDeny,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- packages/mcp/src/config.test.ts`
Expected: PASS (5 original + 8 new = 13 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/config.ts packages/mcp/src/config.test.ts
git commit -m "feat(mcp): parse --http/--host/--port/--auth-token and --exec-allow/--exec-deny"
```

---

## Task 2: `hostPolicy.ts` — compile allow/deny into a host predicate (deny wins)

**Files:**
- Create: `packages/mcp/src/hostPolicy.ts`
- Create: `packages/mcp/src/hostPolicy.test.ts`

**Interfaces:**
- Consumes: nothing (pure; uses global `URL`).
- Produces: `interface HostPolicy { check(url: string): { allowed: boolean; reason?: string } }`;
  `compileHostPolicy(allow: string[], deny: string[]): HostPolicy`; `makeHostGuard(policy: HostPolicy): (url: string) => void`
  (throws `Error(reason)` when denied). Pattern grammar: `host` (exact, case-insensitive), `*.host` (bare host or any
  subdomain), optional `:port` suffix (matched against `URL.port`; absent port in pattern = any port). Deny wins; empty
  allow-list permits all non-denied hosts; a non-empty allow-list default-denies unlisted hosts; an unparseable URL is
  denied only when an allow-list is active.

- [ ] **Step 1: Write the failing test `packages/mcp/src/hostPolicy.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { compileHostPolicy, makeHostGuard } from "./hostPolicy";

describe("compileHostPolicy", () => {
  it("allows any host when both lists are empty", () => {
    expect(compileHostPolicy([], []).check("https://anything.example.com/x").allowed).toBe(true);
  });

  it("deny-list blocks matching hosts even if allow-listed (deny wins)", () => {
    const p = compileHostPolicy(["api.example.com"], ["api.example.com"]);
    const r = p.check("https://api.example.com/users");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/deny-list/i);
  });

  it("non-empty allow-list default-denies unlisted hosts", () => {
    const p = compileHostPolicy(["api.example.com"], []);
    expect(p.check("https://api.example.com/x").allowed).toBe(true);
    const r = p.check("https://evil.test/x");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/allow-list/i);
  });

  it("supports wildcard subdomains", () => {
    const p = compileHostPolicy(["*.example.com"], []);
    expect(p.check("https://a.example.com/x").allowed).toBe(true);
    expect(p.check("https://example.com/x").allowed).toBe(true);
    expect(p.check("https://other.test/x").allowed).toBe(false);
  });

  it("matches port only when the pattern specifies one", () => {
    const p = compileHostPolicy([], ["localhost:3000"]);
    expect(p.check("http://localhost:3000/x").allowed).toBe(false);
    expect(p.check("http://localhost:4000/x").allowed).toBe(true);
  });

  it("denies unparseable targets only when an allow-list is active", () => {
    expect(compileHostPolicy(["a.com"], []).check("not a url").allowed).toBe(false);
    expect(compileHostPolicy([], []).check("not a url").allowed).toBe(true);
  });
});

describe("makeHostGuard", () => {
  it("throws with the deny reason", () => {
    const guard = makeHostGuard(compileHostPolicy([], ["api.example.com"]));
    expect(() => guard("https://api.example.com/x")).toThrow(/deny-list/i);
  });

  it("does not throw for allowed hosts", () => {
    const guard = makeHostGuard(compileHostPolicy([], []));
    expect(() => guard("https://ok.test/x")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/hostPolicy.test.ts`
Expected: FAIL — `./hostPolicy` module not found.

- [ ] **Step 3: Implement `packages/mcp/src/hostPolicy.ts`**

```ts
export interface HostPolicy {
  check(url: string): { allowed: boolean; reason?: string };
}

interface HostPattern {
  /** Bare host, or the suffix ".example.com" when `wildcard` is true. */
  host: string;
  port?: string;
  wildcard: boolean;
}

function parsePattern(raw: string): HostPattern | null {
  const p = raw.trim().toLowerCase();
  if (!p) return null;
  let host = p;
  let port: string | undefined;
  const colon = p.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(p.slice(colon + 1))) {
    host = p.slice(0, colon);
    port = p.slice(colon + 1);
  }
  const wildcard = host.startsWith("*.");
  return { host: wildcard ? host.slice(1) : host, port, wildcard }; // wildcard host stored as ".example.com"
}

function hostFromUrl(url: string): { host: string; port: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

function matches(pat: HostPattern, host: string, port: string): boolean {
  if (pat.port !== undefined && pat.port !== port) return false;
  if (pat.wildcard) {
    // pat.host is ".example.com" → matches the bare host and any subdomain.
    return host === pat.host.slice(1) || host.endsWith(pat.host);
  }
  return host === pat.host;
}

export function compileHostPolicy(allow: string[], deny: string[]): HostPolicy {
  const allowPatterns = allow.map(parsePattern).filter((p): p is HostPattern => p !== null);
  const denyPatterns = deny.map(parsePattern).filter((p): p is HostPattern => p !== null);

  return {
    check(url: string) {
      const parsed = hostFromUrl(url);
      if (!parsed) {
        if (allowPatterns.length > 0) {
          return { allowed: false, reason: `Cannot determine host of '${url}' (exec allow-list active)` };
        }
        return { allowed: true };
      }
      const { host, port } = parsed;
      for (const pat of denyPatterns) {
        if (matches(pat, host, port)) {
          return { allowed: false, reason: `Host '${host}' is blocked by the exec deny-list` };
        }
      }
      if (allowPatterns.length === 0) return { allowed: true };
      for (const pat of allowPatterns) {
        if (matches(pat, host, port)) return { allowed: true };
      }
      return { allowed: false, reason: `Host '${host}' is not in the exec allow-list` };
    },
  };
}

export function makeHostGuard(policy: HostPolicy): (url: string) => void {
  return (url: string) => {
    const result = policy.check(url);
    if (!result.allowed) throw new Error(result.reason ?? `Host for '${url}' is not permitted`);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/mcp/src/hostPolicy.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/hostPolicy.ts packages/mcp/src/hostPolicy.test.ts
git commit -m "feat(mcp): host allow/deny policy compiler with deny-wins precedence"
```

---

## Task 3: Wire the host guard into the exec path (`context` + `run` + `flow` + `tools/exec`)

**Files:**
- Modify: `packages/mcp/src/context.ts`
- Modify: `packages/mcp/src/exec/run.ts`
- Modify: `packages/mcp/src/exec/flow.ts`
- Modify: `packages/mcp/src/tools/exec.ts`
- Create: `packages/mcp/src/tools/exec.hostguard.test.ts`

**Interfaces:**
- Consumes: `compileHostPolicy`, `makeHostGuard`, `HostPolicy` from `./hostPolicy`; existing `ServerContext`,
  `RunContext`, `FlowRunContext`, `assembleRequest`, `resolveVars`, `resolveEnvironment`.
- Produces: `ServerContext` gains `hostPolicy: HostPolicy` (compiled in `buildContext` from `config.execAllow ?? []`,
  `config.execDeny ?? []`). `RunContext` gains optional `hostGuard?: (url: string) => void`, called on the resolved
  URL immediately before `transport.send`/`sendGraphQL`. `FlowRunContext` gains optional `hostGuard?`, called on
  `payload.url` inside the `sendRequest` dep. `tools/exec.ts` builds `const hostGuard = makeHostGuard(ctx.hostPolicy)`
  once and passes it into every `runRequestItem`/`runSavedFlow` call; a thrown guard error is converted by the existing
  `try/catch` to `errorToolResult(message)`.

- [ ] **Step 1: Write the failing test `packages/mcp/src/tools/exec.hostguard.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AppState } from "@portiq/core";
import type { ServerConfig } from "../config";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let echo: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void> = [];

beforeAll(async () => { echo = await startTestHttpServer(); });
afterAll(async () => { while (cleanups.length) cleanups.pop()!(); await echo.close(); });

function serverWith(overrides: Partial<ServerConfig>) {
  const { dir, cleanup } = withTempDataDir();
  cleanups.push(cleanup);
  const state: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${echo.url}/ping` },
    ] }],
    activeCollectionId: "c1",
    environments: [{ id: "e1", name: "Local", vars: [] }],
    activeEnvId: "e1",
    historyRetentionDays: 7,
  };
  seedStore(dir, state);
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test", ...overrides });
  cleanups.push(() => ctx.close());
  return createMcpServer(ctx);
}

describe("exec tools honor the host policy", () => {
  it("blocks run_request to a denied host", async () => {
    const client = await connectInProcess(serverWith({ execDeny: ["127.0.0.1"] }));
    const res = await client.callTool({ name: "run_request", arguments: { id: "r1" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text as string).toMatch(/deny-list/i);
    await client.close();
  });

  it("permits run_request to an allow-listed host", async () => {
    const client = await connectInProcess(serverWith({ execAllow: ["127.0.0.1"] }));
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    await client.close();
  });

  it("blocks hosts outside a non-empty allow-list", async () => {
    const client = await connectInProcess(serverWith({ execAllow: ["example.com"] }));
    const res = await client.callTool({ name: "run_request", arguments: { id: "r1" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text as string).toMatch(/allow-list/i);
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3` (plain-Node ABI to open the store).
Run: `npm test -- packages/mcp/src/tools/exec.hostguard.test.ts`
Expected: FAIL — `buildContext` has no `hostPolicy` / guard not wired, so denied hosts still return status 200.

- [ ] **Step 3: Add `hostPolicy` to `packages/mcp/src/context.ts`**

Replace the file body with (adds the import, the field, and the compiled policy):

```ts
import { openAppStateStore, HttpTransport, type AppStateStore } from "@portiq/core";
import type { ServerConfig } from "./config";
import { compileHostPolicy, type HostPolicy } from "./hostPolicy";

export interface ServerContext {
  config: ServerConfig;
  store: AppStateStore;
  transport: HttpTransport;
  hostPolicy: HostPolicy;
  close(): void;
}

export function buildContext(config: ServerConfig): ServerContext {
  const store = openAppStateStore({ dataDir: config.dataDir });
  const transport = new HttpTransport({ appVersion: config.appVersion });
  const hostPolicy = compileHostPolicy(config.execAllow ?? [], config.execDeny ?? []);
  return {
    config,
    store,
    transport,
    hostPolicy,
    close() {
      store.close();
    },
  };
}
```

- [ ] **Step 4: Thread `hostGuard` through `packages/mcp/src/exec/run.ts`**

Add the field to `RunContext`:

```ts
export interface RunContext {
  transport: HttpTransport;
  env?: Environment | null;
  vars?: Record<string, string>;
  hostGuard?: (url: string) => void;
}
```

In `runRequestItem`, guard the resolved URL right before each send. Change the HTTP branch:

```ts
  if (protocol === "http" || protocol === "") {
    const payload = assembleRequest(item, { env: ctx.env, vars });
    ctx.hostGuard?.(payload.url);
    outcome = await ctx.transport.send(payload);
  } else if (protocol === "graphql") {
    const gql = item.graphqlConfig;
    const gqlUrl = interpolate(item.url ?? "", vars);
    ctx.hostGuard?.(gqlUrl);
    outcome = await sendGraphQL({
      url: gqlUrl,
      headers: { ...compileGraphqlHeaders(item, vars) },
      query: interpolate(gql?.query ?? "", vars),
      variables: interpolate(gql?.variables ?? "", vars),
      operationName: gql?.operationName || undefined,
    });
  } else {
```

(`assembleRequest`/`interpolate` already imported; `payload.url` is the resolved final URL per `HttpSendPayload`.)

- [ ] **Step 5: Thread `hostGuard` through `packages/mcp/src/exec/flow.ts`**

Add the field to `FlowRunContext`:

```ts
export interface FlowRunContext {
  transport: HttpTransport;
  env: Record<string, string>;
  lookupRequest: (id: string) => RequestItem | undefined;
  hostGuard?: (url: string) => void;
}
```

In `runSavedFlow`, guard inside the `sendRequest` dep before sending (`payload.url` is resolved by core's `buildSendPayload`):

```ts
    sendRequest: async (payload): Promise<SendResult> => {
      ctx.hostGuard?.(payload.url);
      const r = await ctx.transport.send({
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        timeoutMs: payload.timeoutMs,
      });
```

- [ ] **Step 6: Build the guard in `packages/mcp/src/tools/exec.ts` and pass it to every executor**

Add the import at the top:

```ts
import { makeHostGuard } from "../hostPolicy";
```

Inside `registerExecTools`, build the guard once at the top of the function body:

```ts
export function registerExecTools(server: McpServer, ctx: ServerContext): void {
  const hostGuard = makeHostGuard(ctx.hostPolicy);
```

Then add `hostGuard` to each executor context — the four call sites become:

```ts
// run_request
return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars, hostGuard }));
// run_ad_hoc_request
return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars, hostGuard }));
// run_collection (inside the loop)
const { tests } = await runRequestItem(item, { transport: ctx.transport, env: environment, vars: shared, hostGuard });
// run_flow
const steps = await runSavedFlow(item.dagGraph, {
  transport: ctx.transport,
  env: resolveVars(environment, vars),
  lookupRequest: (rid) => ctx.store.flattenRequests().find((r) => r.id === rid),
  hostGuard,
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (if not already plain-Node ABI).
Run: `npm test -- packages/mcp/src/tools/exec.hostguard.test.ts`
Expected: PASS (3 tests).
Run: `npm test -- packages/mcp/src/exec/run.test.ts packages/mcp/src/exec/flow.test.ts packages/mcp/src/tools/exec.test.ts`
Expected: PASS (existing suites unaffected — `hostGuard` is optional).

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src/context.ts packages/mcp/src/exec/run.ts packages/mcp/src/exec/flow.ts packages/mcp/src/tools/exec.ts packages/mcp/src/tools/exec.hostguard.test.ts
git commit -m "feat(mcp): gate execute tools by resolved target host (deny wins)"
```

---

## Task 4: `transport/http.ts` — streamable-HTTP server + bearer auth + HTTP client harness

**Files:**
- Create: `packages/mcp/src/transport/http.ts`
- Create: `packages/mcp/src/transport/http.test.ts`

**Interfaces:**
- Consumes: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`; `randomUUID`
  from `node:crypto`; `createServer`/`IncomingMessage`/`ServerResponse`/`Server` from `node:http`; `AddressInfo`
  from `node:net`; `ServerContext` from `../context`; `createMcpServer` from `../server`.
- Produces: `interface HttpTransportOptions { host: string; port: number; authToken?: string; path?: string }`
  (`path` default `/mcp`); `interface HttpServerHandle { url: string; port: number; close: () => Promise<void> }`;
  `startHttpServer(ctx: ServerContext, opts: HttpTransportOptions): Promise<HttpServerHandle>`. Connects ONE
  `createMcpServer(ctx)` to ONE stateful `StreamableHTTPServerTransport` (`sessionIdGenerator: () => randomUUID()`).
  Per request: rejects non-`/mcp` paths with 404; when `authToken` is set, rejects a missing/mismatched
  `Authorization: Bearer <token>` with 401; otherwise delegates to `transport.handleRequest(req, res)`. `close()`
  tears down transport, server, and the HTTP listener.
- Test consumes: `Client` (`@modelcontextprotocol/sdk/client/index.js`), `StreamableHTTPClientTransport`
  (`@modelcontextprotocol/sdk/client/streamableHttp.js`), `buildContext`, `withTempDataDir`/`seedStore`,
  `startTestHttpServer`, `ServerConfig`.

- [ ] **Step 1: Write the failing test `packages/mcp/src/transport/http.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AppState } from "@portiq/core";
import type { ServerConfig } from "../config";
import { buildContext } from "../context";
import { startHttpServer } from "./http";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";

let echo: { url: string; close: () => Promise<void> };
const cleanups: Array<() => void | Promise<void>> = [];

beforeAll(async () => { echo = await startTestHttpServer(); });
afterAll(async () => { for (const c of cleanups.reverse()) await c(); await echo.close(); });

function seededDir(): string {
  const { dir, cleanup } = withTempDataDir();
  cleanups.push(cleanup);
  const state: AppState = {
    collections: [{ id: "c1", name: "API", items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${echo.url}/ping` },
    ] }],
    activeCollectionId: "c1",
    environments: [{ id: "e1", name: "Local", vars: [] }],
    activeEnvId: "e1",
    historyRetentionDays: 7,
  };
  seedStore(dir, state);
  return dir;
}

async function startServer(overrides: Partial<ServerConfig> = {}): Promise<string> {
  const config: ServerConfig = {
    dataDir: seededDir(), allowWrites: false, appVersion: "test",
    transport: "http", httpHost: "127.0.0.1", httpPort: 0, execAllow: [], execDeny: [], ...overrides,
  };
  const ctx = buildContext(config);
  const handle = await startHttpServer(ctx, {
    host: config.httpHost ?? "127.0.0.1", port: config.httpPort ?? 0, authToken: config.authToken,
  });
  cleanups.push(async () => { await handle.close(); ctx.close(); });
  return handle.url;
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: "e2e-http", version: "0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

describe("portiq-mcp streamable HTTP", () => {
  it("lists read/exec tools and hides write tools over HTTP", async () => {
    const client = await connect(await startServer());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_collections");
    expect(names).toContain("run_request");
    expect(names).not.toContain("create_request");
  });

  it("runs a saved request over HTTP against a local server", async () => {
    const client = await connect(await startServer());
    const out = JSON.parse((await client.callTool({ name: "run_request", arguments: { id: "r1" } })).content[0].text as string);
    expect(out.response.status).toBe(200);
    expect(out.response.json.path).toBe("/ping");
  });

  it("rejects a connection without the bearer token", async () => {
    const url = await startServer({ authToken: "s3cret" });
    const client = new Client({ name: "e2e-http", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(url)); // no Authorization header
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it("accepts a connection with the correct bearer token", async () => {
    const client = await connect(await startServer({ authToken: "s3cret" }), "s3cret");
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/transport/http.test.ts`
Expected: FAIL — `./http` module not found.

- [ ] **Step 3: Implement `packages/mcp/src/transport/http.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ServerContext } from "../context";
import { createMcpServer } from "../server";

export interface HttpTransportOptions {
  host: string;
  port: number;
  authToken?: string;
  path?: string;
}

export interface HttpServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function jsonError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

export async function startHttpServer(ctx: ServerContext, opts: HttpTransportOptions): Promise<HttpServerHandle> {
  const path = opts.path ?? "/mcp";

  // Single-session stateful transport: one client at a time (local single-user use).
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== path) return jsonError(res, 404, -32601, "Not found");

      if (opts.authToken) {
        const header = req.headers.authorization ?? "";
        if (header !== `Bearer ${opts.authToken}`) return jsonError(res, 401, -32001, "Unauthorized");
      }

      try {
        await transport.handleRequest(req, res); // handles POST / GET(SSE) / DELETE; reads the body stream itself
      } catch (err) {
        if (!res.headersSent) jsonError(res, 500, -32603, (err as Error).message);
      }
    })();
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port, opts.host, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    url: `http://${opts.host}:${port}${path}`,
    port,
    close: async () => {
      await transport.close();
      await server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm rebuild better-sqlite3` (plain-Node ABI to open the store).
Run: `npm test -- packages/mcp/src/transport/http.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/transport/http.ts packages/mcp/src/transport/http.test.ts
git commit -m "feat(mcp): streamable-HTTP transport with bind host + bearer auth"
```

---

## Task 5: Select the transport in `bin.ts`, export the new API, and document

**Files:**
- Modify: `packages/mcp/src/bin.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/README.md`

**Interfaces:**
- Consumes: `startHttpServer` from `./transport/http`; existing `parseServerConfig`, `buildContext`, `createMcpServer`,
  `StdioServerTransport`.
- Produces: `bin.ts` branches on `config.transport`; `index.ts` re-exports `startHttpServer`, `HttpTransportOptions`,
  `HttpServerHandle`, `compileHostPolicy`, `makeHostGuard`, `HostPolicy`; README documents the HTTP transport, the exec
  allow/deny-list, and gate precedence.

- [ ] **Step 1: Rewrite `packages/mcp/src/bin.ts` to select the transport**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerConfig } from "./config";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { startHttpServer } from "./transport/http";

async function main(): Promise<void> {
  const config = parseServerConfig(process.argv.slice(2), process.env);
  const ctx = buildContext(config);

  if (config.transport === "http") {
    const host = config.httpHost ?? "127.0.0.1";
    const port = config.httpPort ?? 3939;
    if (host !== "127.0.0.1" && host !== "localhost" && !config.authToken) {
      console.error(`[portiq-mcp] WARNING: binding to ${host} without --auth-token; anyone who can reach this host can use the server.`);
    }
    const handle = await startHttpServer(ctx, { host, port, authToken: config.authToken });
    const shutdown = (): void => { void handle.close().then(() => ctx.close()).finally(() => process.exit(0)); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    console.error(`[portiq-mcp] HTTP transport ready on ${handle.url} (writes ${config.allowWrites ? "ENABLED" : "disabled"}${config.authToken ? ", auth REQUIRED" : ""})`);
    return;
  }

  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", () => { ctx.close(); process.exit(0); });
  process.on("SIGTERM", () => { ctx.close(); process.exit(0); });
  console.error(`[portiq-mcp] ready (writes ${config.allowWrites ? "ENABLED" : "disabled"})`);
}

main().catch((err) => {
  console.error("[portiq-mcp] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Extend `packages/mcp/src/index.ts` barrel**

```ts
// @portiq/mcp public API. Populated task-by-task in Phase 1.
export { SERVER_NAME, SERVER_VERSION } from "./version";
export { parseServerConfig, type ServerConfig } from "./config";
export { buildContext, type ServerContext } from "./context";
export { createMcpServer } from "./server";
export { compileHostPolicy, makeHostGuard, type HostPolicy } from "./hostPolicy";
export { startHttpServer, type HttpTransportOptions, type HttpServerHandle } from "./transport/http";
```

- [ ] **Step 3: Build to prove the bin + barrel compile and resolve at runtime**

Run: `npm run build:mcp`
Expected: emits `packages/mcp/dist/bin.js`, `dist/transport/http.js`, `dist/hostPolicy.js`, `dist/index.js` with no TS errors.
Run: `node -e "require('@modelcontextprotocol/sdk/server/streamableHttp.js'); require('@modelcontextprotocol/sdk/client/streamableHttp.js')"`
Expected: resolves with no `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- [ ] **Step 4: Document the HTTP transport, exec allow/deny-list, and precedence in `packages/mcp/README.md`**

Under `## Run`, append:

````md
### HTTP transport (streamable HTTP)

```bash
# Serve over HTTP instead of stdio (default host 127.0.0.1, port 3939, endpoint /mcp):
portiq-mcp --http
# or: PORTIQ_MCP_HTTP=1 portiq-mcp

# Custom bind host/port and a required bearer token:
portiq-mcp --http --host 127.0.0.1 --port 8080 --auth-token my-secret
# env equivalents: PORTIQ_MCP_HOST, PORTIQ_MCP_PORT, PORTIQ_MCP_AUTH_TOKEN
```

Clients connect to `http://<host>:<port>/mcp` and send `Authorization: Bearer <token>` when a token is set.
The HTTP server is **single-session** (one client at a time) and defaults to the **loopback** interface;
binding to a non-loopback host without `--auth-token` prints a warning. HTTP host-config drop-in:

```json
{ "mcpServers": { "portiq": { "url": "http://127.0.0.1:3939/mcp" } } }
```

### Execution allow/deny-list (host safety knob)

```bash
# Only permit executions targeting these hosts (repeatable; comma lists; supports *.example.com and host:port):
portiq-mcp --exec-allow api.example.com --exec-allow '*.internal.test'
# Always block these hosts (deny wins over allow):
portiq-mcp --exec-deny 169.254.169.254 --exec-deny localhost:5432
# env equivalents: PORTIQ_MCP_EXEC_ALLOW, PORTIQ_MCP_EXEC_DENY (comma-separated)
```

The list gates the execute tools (`run_request`, `run_ad_hoc_request`, `run_collection`, `run_flow`) by the
resolved target host of each network send; a blocked host returns a tool error naming the deny- or allow-list.
````

Under `## Notes & limitations`, replace the `**stdio only** (no HTTP transport in this phase).` bullet with:

````md
- **Transports:** stdio (default) or streamable HTTP (`--http`). The HTTP server is single-session and
  loopback-first; multi-session pooling is out of scope.
- **Gate precedence (independent gates over disjoint tool categories):**
  - `--allow-writes` gates library-MUTATION tools (`create_*`, `update_*`, `delete_*`,
    `set_environment_variable`, `save_ad_hoc_as_request`) — unrelated to transport and to host policy.
  - The exec allow/deny-list gates EXECUTE tools by resolved target host. **Deny wins**: a denied host is
    blocked even if allow-listed; an empty allow-list permits all non-denied hosts; a non-empty allow-list
    default-denies unlisted hosts.
  - A mutating tool is never subject to the host policy; an execute tool is never subject to `--allow-writes`.
  - HTTP bind-host + `--auth-token` act at the transport layer, before any tool gate.
````

- [ ] **Step 5: Full suite green + lint**

Run: `npm rebuild better-sqlite3`
Run: `npm test -- packages/mcp`
Expected: all `packages/mcp` suites PASS (config, hostPolicy, exec.hostguard, transport/http, plus existing stdio.e2e/server/etc.).
Run: `npm run lint`
Expected: no new errors under `packages/mcp`.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/bin.ts packages/mcp/src/index.ts packages/mcp/README.md
git commit -m "feat(mcp): select stdio/http transport in bin + document HTTP and exec allow/deny gates"
```

---

## Self-Review

- **Spec coverage.** (1) Streamable-HTTP transport ALONGSIDE stdio, selected by `--http`/`PORTIQ_MCP_HTTP`
  (Task 1, Task 5 bin branch), reusing the same `createMcpServer(ctx)` registration (Task 4); bind host
  (`--host`, loopback default + non-loopback warning) and auth token (`--auth-token`/`PORTIQ_MCP_AUTH_TOKEN`,
  401 on mismatch) addressed (Task 4/5); a client harness test over HTTP mirroring `stdio.e2e.test.ts`
  (Task 4 `transport/http.test.ts`: list tools, run request, auth accept/reject). (2) Config-driven execution
  allow/deny-list gating `run_request`/`run_ad_hoc_request`/`run_collection`/`run_flow` by resolved target host,
  deny-wins, wired at every send site (Task 2 policy, Task 3 wiring + tests), precedence vs `--allow-writes`
  documented (Task 5 README). Matches design spec ~line 136 (host config), ~line 152 (optional execution
  allow/deny-list), and consciously supersedes ~line 216 (HTTP out of scope v1).
- **No placeholders.** Every task ships real, runnable code and exact commands; no "TBD"/"similar to".
- **Type consistency.** New `ServerConfig` fields are optional so existing `buildContext(...)` literals across
  the suite keep compiling; `parseServerConfig` always populates them. `hostGuard` is optional on `RunContext`/
  `FlowRunContext`, so existing `run.test.ts`/`flow.test.ts`/`exec.test.ts` are unaffected. `HostPolicy`,
  `HttpTransportOptions`, `HttpServerHandle` are defined in Task 2/4 and re-exported in Task 5. SDK subpaths
  (`server/streamableHttp.js`, `client/streamableHttp.js`) verified resolvable via the package's `./*` wildcard
  export with `@hono/node-server` hoisted. `HttpSendPayload.url` (Task 3 guard input) and the flows `sendRequest`
  payload `url` field are verified against core sources.
- **Constraint adherence.** All changes confined to `packages/mcp/**`; no core/root/eslint edits required.
  better-sqlite3 ABI rebuild noted before every store-opening test. stdio stdout purity preserved; HTTP diagnostics
  to stderr. Single-session/local-first HTTP limitation stated in constraints and README.
