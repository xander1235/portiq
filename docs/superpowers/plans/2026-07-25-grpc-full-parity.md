# gRPC Full Parity (CLI + MCP surfaces, core streaming/reflection/auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring gRPC to full CLI + MCP parity — dispatch the existing core gRPC engine (unary + server-streaming) through `run_request`/`run_ad_hoc_request` (MCP) and `run`/`exec` (CLI), then extend the engine with client-streaming, bidi-streaming, server reflection, and advanced TLS/call-credential auth, exposed through both surfaces.

**Architecture:** The core `GrpcTransport` (`packages/core/src/transport/grpc.ts`) already implements UNARY + SERVER_STREAM and is exported ONLY via the Node-only `@portiq/core/grpc` subpath (it is intentionally not on the `.` barrel because `@grpc/grpc-js` has un-treeshakeable module side effects — see `src/index.ts:19-26`). This plan first adds a persisted `grpcConfig` to the `RequestItem` model plus a canonical `buildGrpcPayload`/`normalizeGrpcResult` pair on the top barrel (renderer-safe: type-only import of the transport, runtime import of the already-barreled `GrpcProtocol`). MCP (`packages/mcp`, stdio/Node) and CLI (`packages/cli`, Node) then import `GrpcTransport` from `@portiq/core/grpc` and dispatch by `RequestItem.protocol`, mirroring the existing HTTP/GraphQL branches. The engine is then extended (CLIENT_STREAM/BIDI_STREAM as batch send-all-then-collect, reflection via `grpc-reflection-js`, advanced auth via `grpc.credentials.createSsl` + `combineChannelCredentials`), with each new capability surfaced through the ad-hoc MCP tool and CLI `exec` flags. Saved requests inherit every capability for free via `grpcConfig` → `buildGrpcPayload`.

**Tech Stack:** TypeScript (core: ESNext/`moduleResolution:Bundler`; cli/mcp: classic `Node`), Vitest 4 (node env), `@grpc/grpc-js` + `@grpc/proto-loader` (pure JS, already deps), `grpc-reflection-js` (client reflection) + `@grpc/reflection` (test-server reflection), Commander@12 (CLI), `@modelcontextprotocol/sdk` (MCP), npm workspaces.

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

- **`@portiq/core/grpc` is the ONLY entrypoint to the native transport.** MCP and CLI import `GrpcTransport`
  from `"@portiq/core/grpc"` (Node-only subpath), NEVER from the `.` barrel — the barrel deliberately omits
  it (`packages/core/src/index.ts:19-26`). The `./grpc` subpath already exists in `packages/core/package.json`
  (`import`→`./src/transport/grpc.ts`, `require`→`./dist/transport/grpc.js`); this plan adds only the CLI/MCP
  `tsconfig.build.json` `paths` type-wiring.
- **`buildGrpcPayload`/`normalizeGrpcResult` stay renderer-safe.** They live in `packages/core/src/exec/grpcExec.ts`,
  type-only-import (`import type`) the transport payload/result interfaces, and runtime-import only the
  already-renderer-safe `GrpcProtocol` (`protocols/grpc.ts`) and `interpolate`. They go on the `.` barrel
  (`index.ts`) only — NOT the browser barrel — so no `@grpc/*` runtime is ever pulled into either barrel.
- **`@grpc/grpc-js`, `@grpc/proto-loader`, `grpc-reflection-js`, `@grpc/reflection` are pure JS (CJS).** No
  native ABI, no octokit-style ESM/CJS bundling needed — CLI/MCP `require()` them transitively through core's
  dist. They must never be re-exported from any browser barrel.
- **gRPC has no `pm.*` scripting today.** gRPC runs return an empty `TestSummary` (`summarizeTests([])`); tests
  are not evaluated against a gRPC response in this plan (matches the desktop, which never wired gRPC scripting).
- **Streaming is one-shot batch.** CLIENT_STREAM/BIDI_STREAM fit the `send(payload) → result` contract by
  sending ALL request messages up front (`payload.messages[]`, default `[body]`), then collecting replies —
  no interactive send-loop (that would need a WS-manager-style stateful surface, out of scope). The
  `requestId`/`cancel` path already exists (`transport/grpc.ts:104,168-172`) and covers all four call types.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/core/src/model/request.ts` | Modify | Add `GrpcConfig` interface + `grpcConfig?: GrpcConfig` on `RequestItem`; extended in Tasks 4/6/7. |
| `packages/core/src/exec/grpcExec.ts` | Create | Canonical `buildGrpcPayload(item,vars,requestId?)` + `NormalizedGrpcResponse` + `normalizeGrpcResult(raw,callType)`. Renderer-safe. |
| `packages/core/src/exec/grpcExec.test.ts` | Create | Unit tests for the two helpers. |
| `packages/core/src/index.ts` | Modify | `export * from "./exec/grpcExec"` on the `.` barrel only. |
| `packages/core/src/transport/grpc.ts` | Modify | Add CLIENT_STREAM (Task 4), BIDI_STREAM (Task 5), reflection fallback (Task 6), advanced-auth credentials (Task 7); extend `GrpcSendPayload`. |
| `packages/core/src/transport/grpc.test.ts` | Modify | Append streaming/reflection/auth cases. |
| `packages/core/src/transport/grpcReflection.ts` | Create | `loadProtoViaReflection(target,creds)` → `grpc.GrpcObject` (Task 6). |
| `packages/core/src/transport/grpcReflection.test.ts` | Create | Reflection resolver test against an in-process reflection-enabled server (Task 6). |
| `packages/core/src/transport/fixtures/echo.proto` | Modify | Add `ClientStream` + `BidiStream` rpcs (Task 4). |
| `packages/core/src/transport/fixtures/tls/*.crt,*.key` | Create | Self-signed CA + server + client PEMs for the mTLS/auth test (Task 7). |
| `packages/core/package.json` | Modify | Add `grpc-reflection-js` dep + `@grpc/reflection` devDep (Task 6). |
| `packages/mcp/src/exec/run.ts` | Modify | gRPC dispatch branch in `runRequestItem`; widen `RunResult`/`RunContext`. |
| `packages/mcp/src/exec/run.test.ts` | Modify | gRPC unary/server-stream dispatch cases. |
| `packages/mcp/src/tools/exec.ts` | Modify | Extend `run_ad_hoc_request` schema with gRPC fields (base in Task 2, advanced in Task 8). |
| `packages/mcp/src/tools/exec.test.ts` | Modify | gRPC ad-hoc + saved-request tool cases. |
| `packages/mcp/src/testkit/grpcServer.ts` | Create | In-process echo gRPC server helper (all four call types + reflection + TLS). |
| `packages/mcp/tsconfig.build.json` | Modify | Add `@portiq/core/grpc` to `paths`. |
| `packages/cli/src/exec/runRequest.ts` | Modify | Replace grpc hard-throw with dispatch; add `grpc` to `RunOutcome`; add `grpcTransport` to `RunDeps`. |
| `packages/cli/src/exec/runRequest.test.ts` | Modify | gRPC dispatch unit cases (fake transport). |
| `packages/cli/src/reporters/types.ts` | Modify | Add `grpc?: NormalizedGrpcResponse \| null` to the `execution` output. |
| `packages/cli/src/reporters/index.ts` | Modify | Pretty rendering of a gRPC (streamed) response. |
| `packages/cli/src/reporters/reporters.test.ts` | Modify | gRPC pretty/json render cases. |
| `packages/cli/src/commands/run.ts` | Modify | Carry `outcome.grpc` into the execution output; grpc dry-run branch. |
| `packages/cli/src/commands/exec.ts` | Modify | gRPC flags (`--grpc`, `--service`, `--proto`, `--call-type`; advanced in Task 8). |
| `packages/cli/src/commands/exec.test.ts` | Modify | gRPC `exec` cases (fake transport via injected deps or in-process server). |
| `packages/cli/tsconfig.build.json` | Modify | Add `@portiq/core/grpc` to `paths`. |

---

## Task 1: Persisted `grpcConfig` model + canonical payload/normalize helpers

**Files:**
- Modify: `packages/core/src/model/request.ts:47` (add `GrpcConfig` + `RequestItem.grpcConfig`)
- Create: `packages/core/src/exec/grpcExec.ts`
- Create: `packages/core/src/exec/grpcExec.test.ts`
- Modify: `packages/core/src/index.ts:12` (barrel export)

**Interfaces:**
- Consumes: `GrpcProtocol` (`../protocols/grpc`), `interpolate` (`./interpolate`); type-only `GrpcSendPayload`, `GrpcSendResult` (`../transport/grpc`); `RequestItem` (`../model/request`).
- Produces:
  - `interface GrpcConfig { service: string; method: string; requestBody?: string; metadata?: Record<string,string>; callType?: "UNARY"|"SERVER_STREAM"|"CLIENT_STREAM"|"BIDI_STREAM"; deadline?: number; tls?: boolean; protoContent?: string; protoPath?: string }` (extended in Tasks 4/6/7)
  - `RequestItem.grpcConfig?: GrpcConfig`
  - `buildGrpcPayload(item: RequestItem, vars: Record<string,string>, requestId?: string): GrpcSendPayload`
  - `interface NormalizedGrpcResponse { protocol: "grpc"; callType: string; statusCode: number; statusMessage: string; duration: number; metadata: Record<string,string>; trailers: Record<string,string>; messages: unknown[]; json: unknown; body: string; streamed: boolean; error: string | null }`
  - `normalizeGrpcResult(raw: GrpcSendResult, callType: string): NormalizedGrpcResponse`

- [ ] **Step 1: Add `GrpcConfig` + `grpcConfig` to the model**

In `packages/core/src/model/request.ts`, immediately after the `GraphqlConfig` interface (ends at line 26), add:

```ts
export interface GrpcConfig {
  service: string;
  method: string;
  requestBody?: string;
  metadata?: Record<string, string>;
  callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM";
  deadline?: number;
  tls?: boolean;
  protoContent?: string;
  protoPath?: string;
}
```

Then in `interface RequestItem`, after `graphqlConfig?: GraphqlConfig;` (line 73), add:

```ts
  grpcConfig?: GrpcConfig;
```

- [ ] **Step 2: Write the failing test `packages/core/src/exec/grpcExec.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildGrpcPayload, normalizeGrpcResult } from "./grpcExec";
import type { RequestItem } from "../model/request";
import type { GrpcSendResult } from "../transport/grpc";

const item = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "g1", name: "grpc", description: "", tags: [],
  protocol: "grpc", method: "", url: "grpc://{{host}}:50051",
  grpcConfig: {
    service: "echo.EchoService", method: "Unary",
    requestBody: '{"message":"{{who}}"}',
    metadata: { "x-token": "{{tok}}" },
    callType: "UNARY", deadline: 5000, tls: false, protoContent: 'syntax="proto3";',
  },
  ...over,
});

describe("buildGrpcPayload", () => {
  it("interpolates url, body, and metadata and forwards proto content", () => {
    const p = buildGrpcPayload(item(), { host: "127.0.0.1", who: "world", tok: "abc" }, "rq-1");
    expect(p.url).toBe("grpc://127.0.0.1:50051");
    expect(p.body).toEqual({ message: "world" });
    expect(p.metadata).toEqual({ "x-token": "abc" });
    expect(p.service).toBe("echo.EchoService");
    expect(p.method).toBe("Unary");
    expect(p.callType).toBe("UNARY");
    expect(p.protoContent).toBe('syntax="proto3";');
    expect(p.requestId).toBe("rq-1");
  });

  it("defaults an empty grpcConfig to UNARY + empty body", () => {
    const p = buildGrpcPayload(item({ grpcConfig: { service: "S", method: "M" } }), {});
    expect(p.callType).toBe("UNARY");
    expect(p.body).toEqual({});
    expect(p.deadline).toBe(30000);
  });
});

describe("normalizeGrpcResult", () => {
  const raw: GrpcSendResult = {
    statusCode: 0, statusMessage: "OK", duration: 12,
    metadata: { a: "1" }, trailers: { b: "2" },
    body: '{"message":"hi"}', json: { message: "hi" }, error: null, messages: [],
  };
  it("maps a unary result (streamed=false)", () => {
    const n = normalizeGrpcResult(raw, "UNARY");
    expect(n.protocol).toBe("grpc");
    expect(n.streamed).toBe(false);
    expect(n.json).toEqual({ message: "hi" });
    expect(n.statusCode).toBe(0);
    expect(n.callType).toBe("UNARY");
  });
  it("maps a streamed result (streamed=true, messages carried)", () => {
    const n = normalizeGrpcResult({ ...raw, json: null, messages: [{ n: 1 }, { n: 2 }] }, "SERVER_STREAM");
    expect(n.streamed).toBe(true);
    expect(n.messages).toHaveLength(2);
    expect(n.json).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/exec/grpcExec.test.ts`
Expected: FAIL — module `./grpcExec` not found.

- [ ] **Step 4: Implement `packages/core/src/exec/grpcExec.ts`**

```ts
import { GrpcProtocol } from "../protocols/grpc";
import { interpolate } from "./interpolate";
import type { RequestItem } from "../model/request";
// Type-only: erased at runtime, so this module never pulls @grpc/* into the barrel.
import type { GrpcSendPayload, GrpcSendResult } from "../transport/grpc";

/**
 * Canonical gRPC payload builder (peer to assembleRequest for HTTP): interpolate the
 * saved request's dynamic fields against `vars`, then reuse the renderer-safe
 * GrpcProtocol.buildRequest so there is exactly one gRPC payload shape in the codebase.
 */
export function buildGrpcPayload(
  item: RequestItem,
  vars: Record<string, string>,
  requestId?: string
): GrpcSendPayload {
  const cfg = item.grpcConfig ?? { service: "", method: "" };
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.metadata ?? {})) metadata[k] = interpolate(String(v), vars);
  const built = GrpcProtocol.buildRequest({
    url: interpolate(item.url ?? "", vars),
    service: cfg.service,
    method: cfg.method,
    requestBody: interpolate(cfg.requestBody ?? "{}", vars),
    metadata,
    callType: cfg.callType || "UNARY",
    deadline: cfg.deadline || 30000,
    tls: cfg.tls,
    protoContent: cfg.protoContent || "",
    protoPath: cfg.protoPath,
  });
  return { ...built, requestId } as GrpcSendPayload;
}

export interface NormalizedGrpcResponse {
  protocol: "grpc";
  callType: string;
  statusCode: number;
  statusMessage: string;
  duration: number;
  metadata: Record<string, string>;
  trailers: Record<string, string>;
  messages: unknown[];
  json: unknown;
  body: string;
  streamed: boolean;
  error: string | null;
}

/** Normalize a raw GrpcSendResult into the headless response shape CLI/MCP return. */
export function normalizeGrpcResult(raw: GrpcSendResult, callType: string): NormalizedGrpcResponse {
  return {
    protocol: "grpc",
    callType,
    statusCode: raw.statusCode,
    statusMessage: raw.statusMessage,
    duration: raw.duration,
    metadata: raw.metadata ?? {},
    trailers: raw.trailers ?? {},
    messages: raw.messages ?? [],
    json: raw.json ?? null,
    body: raw.body ?? "",
    streamed: callType !== "UNARY",
    error: raw.error ?? null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/exec/grpcExec.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the barrel export**

In `packages/core/src/index.ts`, after line 12 (`export * from "./exec/assembleRequest";`), add:

```ts
export * from "./exec/grpcExec";
```

Do NOT add it to `src/index.browser.ts` — the renderer never runs gRPC (it goes through `window.api`), and keeping it off the browser barrel guarantees no accidental `@grpc/*` pull.

- [ ] **Step 7: Full suite + lint + commit**

Run: `npm test` — expected: full suite passes (prior tests + 4 new).
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/core/src/model/request.ts packages/core/src/exec/grpcExec.ts packages/core/src/exec/grpcExec.test.ts packages/core/src/index.ts
git commit -m "feat(core): persist grpcConfig on RequestItem + canonical gRPC payload/normalize helpers"
```

---

## Task 2: Dispatch gRPC through the MCP surface (`run_request` + `run_ad_hoc_request`)

**Files:**
- Create: `packages/mcp/src/testkit/grpcServer.ts`
- Modify: `packages/mcp/src/exec/run.ts:30` (`RunContext`), `:36` (`RunResult`), `:85-101` (dispatch)
- Modify: `packages/mcp/src/tools/exec.ts:47-77` (`run_ad_hoc_request` schema + handler)
- Modify: `packages/mcp/tsconfig.build.json` (`paths`)
- Modify: `packages/mcp/src/exec/run.test.ts`, `packages/mcp/src/tools/exec.test.ts`

**Interfaces:**
- Consumes: `GrpcTransport` from `@portiq/core/grpc`; `buildGrpcPayload`, `normalizeGrpcResult`, `summarizeTests`, type `NormalizedGrpcResponse`, type `GrpcConfig` from `@portiq/core`.
- Produces:
  - `RunContext.grpcTransport?: GrpcTransport`
  - `RunResult.response: NormalizedResponse | NormalizedGrpcResponse`
  - `run_ad_hoc_request` gains optional inputs `service`, `protoContent`, `protoPath`, `callType`, `deadline`, `tls` (used only when `protocol === "grpc"`).

- [ ] **Step 1: Add the `@portiq/core/grpc` type path**

In `packages/mcp/tsconfig.build.json`, extend `compilerOptions.paths` so it reads:

```json
    "paths": {
      "@portiq/core/flows": ["../../node_modules/@portiq/core/src/flows/index.ts"],
      "@portiq/core/grpc": ["../../node_modules/@portiq/core/src/transport/grpc.ts"]
    }
```

- [ ] **Step 2: Create the in-process gRPC test server `packages/mcp/src/testkit/grpcServer.ts`**

```ts
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ECHO_PROTO = `syntax = "proto3";
package echo;
message EchoRequest { string message = 1; }
message EchoReply { string message = 1; }
service EchoService {
  rpc Unary (EchoRequest) returns (EchoReply);
  rpc ServerStream (EchoRequest) returns (stream EchoReply);
}`;

export interface GrpcTestServer {
  target: string;
  protoContent: string;
  close: () => Promise<void>;
}

/** Start an in-process echo gRPC server on an ephemeral port. */
export function startEchoGrpcServer(): Promise<GrpcTestServer> {
  const dir = mkdtempSync(join(tmpdir(), "mcp-grpc-"));
  const file = join(dir, "echo.proto");
  writeFileSync(file, ECHO_PROTO, "utf8");
  const def = protoLoader.loadSync(file, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const server = new grpc.Server();
  server.addService(pkg.echo.EchoService.service, {
    Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
    ServerStream: (call: any) => {
      for (let i = 0; i < 3; i++) call.write({ message: "chunk-" + i });
      call.end();
    },
  });
  return new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve({
        target: `127.0.0.1:${port}`,
        protoContent: ECHO_PROTO,
        close: () => new Promise<void>((r) => server.tryShutdown(() => r())),
      });
    });
  });
}
```

- [ ] **Step 3: Write the failing dispatch test — append to `packages/mcp/src/exec/run.test.ts`**

Add these imports at the top (after the existing imports):

```ts
import { GrpcTransport } from "@portiq/core/grpc";
import { startEchoGrpcServer, type GrpcTestServer } from "../testkit/grpcServer";
```

Then append this describe block at the end of the file:

```ts
describe("runRequestItem gRPC", () => {
  let grpcServer: GrpcTestServer;
  beforeAll(async () => { grpcServer = await startEchoGrpcServer(); });
  afterAll(async () => { await grpcServer.close(); });

  const grpcItem = (over: Partial<import("@portiq/core").GrpcConfig> = {}): RequestItem => ({
    type: "request", id: "g1", name: "echo", description: "", tags: [],
    protocol: "grpc", method: "", url: grpcServer.target,
    grpcConfig: { service: "echo.EchoService", method: "Unary", requestBody: '{"message":"world"}',
      callType: "UNARY", tls: false, protoContent: grpcServer.protoContent, ...over },
  });

  it("dispatches a unary gRPC call and normalizes the response", async () => {
    const { response } = await runRequestItem(grpcItem(), { transport, grpcTransport: new GrpcTransport() });
    const r = response as import("@portiq/core").NormalizedGrpcResponse;
    expect(r.protocol).toBe("grpc");
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "hi world" });
    expect(r.streamed).toBe(false);
  });

  it("aggregates a server-streaming gRPC call into messages[]", async () => {
    const { response } = await runRequestItem(
      grpcItem({ method: "ServerStream", callType: "SERVER_STREAM" }),
      { transport, grpcTransport: new GrpcTransport() }
    );
    const r = response as import("@portiq/core").NormalizedGrpcResponse;
    expect(r.statusCode).toBe(0);
    expect(r.streamed).toBe(true);
    expect(r.messages).toEqual([{ message: "chunk-0" }, { message: "chunk-1" }, { message: "chunk-2" }]);
  });
});
```

Add `beforeAll, afterAll` to the vitest import at the top of the file (currently `import { describe, it, expect, beforeAll, afterAll } from "vitest";` — already present).

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- packages/mcp/src/exec/run.test.ts`
Expected: FAIL — `RunContext` has no `grpcTransport`, and `runRequestItem` throws `Protocol 'grpc' is not supported headlessly yet`.

- [ ] **Step 5: Wire gRPC dispatch in `packages/mcp/src/exec/run.ts`**

Add these imports (top of file, extend the existing `@portiq/core` import and add the subpath import):

```ts
import { GrpcTransport } from "@portiq/core/grpc";
```

Extend the existing named import from `@portiq/core` to also pull `buildGrpcPayload`, `normalizeGrpcResult`, and the types `GrpcConfig`, `NormalizedGrpcResponse` (add them to the destructured list at lines 1-15).

Widen `RunContext` (line 30-34):

```ts
export interface RunContext {
  transport: HttpTransport;
  grpcTransport?: GrpcTransport;
  env?: Environment | null;
  vars?: Record<string, string>;
}
```

Widen `RunResult` (line 36-39):

```ts
export interface RunResult {
  response: NormalizedResponse | NormalizedGrpcResponse;
  tests: TestSummary;
}
```

Replace the dispatch tail of `runRequestItem` — the block from `const protocol = (item.protocol || "http").toLowerCase();` (line 85) through the `} else { throw ... }` (line 101) — with:

```ts
  const protocol = (item.protocol || "http").toLowerCase();

  if (protocol === "grpc") {
    const transport = ctx.grpcTransport ?? new GrpcTransport();
    const raw = await transport.send(buildGrpcPayload(item, vars));
    const callType = item.grpcConfig?.callType || "UNARY";
    return { response: normalizeGrpcResult(raw, callType), tests: summarizeTests([]) };
  }

  let outcome: SendOutcome;
  if (protocol === "http" || protocol === "") {
    const payload = assembleRequest(item, { env: ctx.env, vars });
    outcome = await ctx.transport.send(payload);
  } else if (protocol === "graphql") {
    const gql = item.graphqlConfig;
    outcome = await sendGraphQL({
      url: interpolate(item.url ?? "", vars),
      headers: { ...compileGraphqlHeaders(item, vars) },
      query: interpolate(gql?.query ?? "", vars),
      variables: interpolate(gql?.variables ?? "", vars),
      operationName: gql?.operationName || undefined,
    });
  } else {
    throw new Error(`Protocol '${protocol}' is not supported headlessly yet`);
  }
```

(The gRPC branch returns early, so the post-script block below is skipped — intentional, gRPC has no scripting. `GrpcConfig` is imported only for the test's inline type reference; if eslint flags it unused in `run.ts`, drop it from `run.ts`'s import — it is used in the test file's own inline import.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- packages/mcp/src/exec/run.test.ts`
Expected: PASS (prior http cases + 2 new gRPC cases).

- [ ] **Step 7: Extend `run_ad_hoc_request` for gRPC in `packages/mcp/src/tools/exec.ts`**

Add `type GrpcConfig` to the `@portiq/core` import (line 3). Replace the `run_ad_hoc_request` registration (lines 47-77) with:

```ts
  server.registerTool(
    "run_ad_hoc_request",
    {
      title: "Run ad-hoc request",
      description: "Execute an inline request (http, graphql, or grpc) that is not saved to the library.",
      inputSchema: {
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        bodyType: z.string().optional(),
        protocol: z.string().optional(),
        // gRPC-only fields (used when protocol === "grpc"): method=RPC name, url=target, headers=metadata, body=request JSON.
        service: z.string().optional(),
        protoContent: z.string().optional(),
        protoPath: z.string().optional(),
        callType: z.enum(["UNARY", "SERVER_STREAM", "CLIENT_STREAM", "BIDI_STREAM"]).optional(),
        deadline: z.number().optional(),
        tls: z.boolean().optional(),
        env: z.string().optional(),
        vars: varsSchema,
      },
      annotations: EXECUTES,
    },
    async (args) => {
      const { method, url, headers, body, bodyType, protocol, env, vars } = args;
      const proto = (protocol || "http").toLowerCase();
      const item: RequestItem = {
        type: "request", id: "ad-hoc", name: "ad-hoc", description: "", tags: [],
        protocol: proto, method, url,
        bodyType: bodyType || (body ? "raw" : "none"), bodyText: body ?? "",
        headersRows: Object.entries(headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
      };
      if (proto === "grpc") {
        const grpcConfig: GrpcConfig = {
          service: args.service ?? "", method,
          requestBody: body ?? "{}",
          metadata: headers ?? {},
          callType: args.callType ?? "UNARY",
          deadline: args.deadline, tls: args.tls,
          protoContent: args.protoContent, protoPath: args.protoPath,
        };
        item.grpcConfig = grpcConfig;
      }
      try {
        return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars }));
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );
```

- [ ] **Step 8: Write the failing tool test — append gRPC cases to `packages/mcp/src/tools/exec.test.ts`**

Add imports at top:

```ts
import { startEchoGrpcServer, type GrpcTestServer } from "../testkit/grpcServer";
```

Append this describe block:

```ts
describe("exec tools gRPC", () => {
  let grpcServer: GrpcTestServer;
  beforeAll(async () => { grpcServer = await startEchoGrpcServer(); });
  afterAll(async () => { await grpcServer.close(); });

  it("run_ad_hoc_request performs a unary gRPC call", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", {
      protocol: "grpc", url: grpcServer.target, method: "Unary",
      service: "echo.EchoService", body: '{"message":"world"}',
      protoContent: grpcServer.protoContent, tls: false, callType: "UNARY",
    });
    expect(out.response.protocol).toBe("grpc");
    expect(out.response.json).toEqual({ message: "hi world" });
  });

  it("run_request runs a SAVED gRPC request", async () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    seedStore(dir, {
      collections: [{ id: "c1", name: "gRPC", items: [
        { type: "request", id: "gr1", name: "Echo", description: "", tags: [],
          protocol: "grpc", method: "", url: grpcServer.target,
          grpcConfig: { service: "echo.EchoService", method: "Unary",
            requestBody: '{"message":"saved"}', callType: "UNARY", tls: false, protoContent: grpcServer.protoContent } },
      ] }],
      activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
    });
    const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
    dirs.push(() => ctx.close());
    const c = await connectInProcess(createMcpServer(ctx));
    dirs.push(() => { void c.close(); });
    const out = await call(c, "run_request", { id: "gr1" });
    expect(out.response.json).toEqual({ message: "hi saved" });
  });
});
```

Ensure `beforeAll, afterAll` are in the vitest import (line 1 already includes them).

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- packages/mcp/src/tools/exec.test.ts`
Expected: PASS (prior tool cases + 2 new gRPC cases).

- [ ] **Step 10: Build MCP dist + full suite + lint**

Run: `npm run build --workspace portiq-mcp` (confirms the `@portiq/core/grpc` path resolves under classic `moduleResolution:Node`; expected: clean emit).
Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 11: Commit**

```bash
git add packages/mcp/src/exec/run.ts packages/mcp/src/exec/run.test.ts packages/mcp/src/tools/exec.ts packages/mcp/src/tools/exec.test.ts packages/mcp/src/testkit/grpcServer.ts packages/mcp/tsconfig.build.json
git commit -m "feat(mcp): dispatch gRPC (unary + server-stream) through run_request/run_ad_hoc_request"
```

---

## Task 3: Wire gRPC into the CLI `run`/`exec` path + streamed-response reporter

**Files:**
- Modify: `packages/cli/tsconfig.build.json` (`paths`)
- Modify: `packages/cli/src/exec/runRequest.ts:9-24` (deps), `:36-39` (throw), add grpc branch
- Modify: `packages/cli/src/reporters/types.ts:14-21` (execution output)
- Modify: `packages/cli/src/reporters/index.ts` (Pretty gRPC rendering)
- Modify: `packages/cli/src/commands/run.ts:73-76` (carry grpc)
- Modify: `packages/cli/src/commands/exec.ts` (gRPC flags)
- Modify: `packages/cli/src/exec/runRequest.test.ts`, `packages/cli/src/reporters/reporters.test.ts`, `packages/cli/src/commands/exec.test.ts`

**Interfaces:**
- Consumes: `GrpcTransport` from `@portiq/core/grpc`; `buildGrpcPayload`, `normalizeGrpcResult`, type `NormalizedGrpcResponse` from `@portiq/core`.
- Produces:
  - `RunDeps.grpcTransport: Pick<GrpcTransport, "send" | "cancel">`
  - `RunOutcome.grpc?: NormalizedGrpcResponse | null`
  - `CommandOutput` (`execution` variant) gains `grpc?: NormalizedGrpcResponse | null`
  - `exec` flags: `--grpc`, `--service <name>`, `--proto <file>`, `--call-type <type>` (RPC method via `-X`, target via `[url]`, metadata via `-H`, body via `-d`).

- [ ] **Step 1: Add the `@portiq/core/grpc` type path**

In `packages/cli/tsconfig.build.json`, extend `compilerOptions.paths`:

```json
    "paths": {
      "@portiq/core/flows": ["../../node_modules/@portiq/core/src/flows/index.ts"],
      "@portiq/core/sync": ["../../node_modules/@portiq/core/src/sync/index.ts"],
      "@portiq/core/grpc": ["../../node_modules/@portiq/core/src/transport/grpc.ts"]
    }
```

- [ ] **Step 2: Write the failing unit test — append to `packages/cli/src/exec/runRequest.test.ts`**

Add to the `@portiq/core` type import (line 3) the types `GrpcSendResult`, and append:

```ts
const grpcResult: GrpcSendResult = {
  statusCode: 0, statusMessage: "OK", duration: 7, metadata: {}, trailers: {},
  body: '{"message":"hi world"}', json: { message: "hi world" }, error: null, messages: [],
};

function grpcDeps(sendImpl: () => Promise<unknown>): RunDeps {
  return { ...deps(async () => okResult), grpcTransport: { send: vi.fn(sendImpl), cancel: vi.fn() } as unknown as RunDeps["grpcTransport"] };
}

const grpcReq = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "g1", name: "Echo", description: "", tags: [],
  protocol: "grpc", method: "", url: "grpc://127.0.0.1:50051",
  grpcConfig: { service: "echo.EchoService", method: "Unary", requestBody: '{"message":"world"}', callType: "UNARY", tls: false, protoContent: 'x' },
  ...over,
});

describe("runRequest gRPC", () => {
  it("dispatches a gRPC request and returns a normalized grpc result", async () => {
    const outcome = await runRequest(grpcReq(), {}, grpcDeps(async () => grpcResult));
    expect(outcome.error).toBeNull();
    expect(outcome.response).toBeNull();
    expect(outcome.grpc?.protocol).toBe("grpc");
    expect(outcome.grpc?.json).toEqual({ message: "hi world" });
    expect(outcome.request.protocol).toBe("grpc");
    expect(outcome.request.method).toBe("UNARY");
  });

  it("surfaces a gRPC error status via the grpc result", async () => {
    const outcome = await runRequest(grpcReq(), {}, grpcDeps(async () => ({ ...grpcResult, statusCode: 5, statusMessage: "NOT_FOUND", json: null, error: "nope" })));
    expect(outcome.grpc?.statusCode).toBe(5);
    expect(outcome.grpc?.error).toBe("nope");
  });

  it("still rejects websocket with a RuntimeError", async () => {
    await expect(runRequest(grpcReq({ protocol: "websocket" }), {}, grpcDeps(async () => grpcResult))).rejects.toThrow(/websocket/i);
  });
});
```

Also update the existing `deps()` helper (lines 10-16) to include a `grpcTransport` so it type-checks — change its return object to end with:

```ts
    now: () => 0,
    grpcTransport: { send: vi.fn(async () => grpcResult), cancel: vi.fn() } as unknown as RunDeps["grpcTransport"],
  };
```

(Declare `grpcResult` above `deps` — move the `const grpcResult` declaration to just under `okResult` at the top of the file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/cli/src/exec/runRequest.test.ts`
Expected: FAIL — `RunDeps` has no `grpcTransport`; `runRequest` throws for `grpc`.

- [ ] **Step 4: Implement the gRPC branch in `packages/cli/src/exec/runRequest.ts`**

Add imports at the top:

```ts
import { GrpcTransport } from "@portiq/core/grpc";
import { buildGrpcPayload, normalizeGrpcResult, type NormalizedGrpcResponse } from "@portiq/core";
```

Extend `RunOutcome` (lines 9-14):

```ts
export interface RunOutcome {
  request: ExecRequestView;
  response: HttpResult | null;
  error: string | null;
  tests: TestSummary | null;
  grpc?: NormalizedGrpcResponse | null;
}
```

Extend `RunDeps` (lines 16-20) and `defaultRunDeps` (lines 22-24):

```ts
export interface RunDeps {
  transport: HttpTransport;
  sendGraphQL: typeof coreSendGraphQL;
  now: () => number;
  grpcTransport: Pick<GrpcTransport, "send" | "cancel">;
}

export function defaultRunDeps(appVersion?: string): RunDeps {
  return { transport: new HttpTransport({ appVersion }), sendGraphQL: coreSendGraphQL, now: () => Date.now(), grpcTransport: new GrpcTransport() };
}
```

Replace the throw guard (lines 36-39) with a websocket-only throw plus a gRPC branch:

```ts
  const protocol = req.protocol || "http";
  if (protocol === "websocket") {
    throw new RuntimeError(`Protocol "${protocol}" is not supported via the CLI (interactive/experimental).`);
  }
  if (protocol === "grpc") {
    const callType = req.grpcConfig?.callType || "UNARY";
    const url = interpolate(req.url || "", vars);
    const view: ExecRequestView = { protocol: "grpc", method: callType, url, headers: req.grpcConfig?.metadata ?? {} };
    const raw = await deps.grpcTransport.send(buildGrpcPayload(req, vars));
    const grpc = normalizeGrpcResult(raw, callType);
    return { request: view, response: null, error: grpc.error, tests: null, grpc };
  }
```

(`vars` is the second parameter of `runRequest`; `env` is a copy of it further down — the gRPC branch runs before `env` is built, so it uses `vars` directly for interpolation. `interpolate` is already imported.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/cli/src/exec/runRequest.test.ts`
Expected: PASS.

- [ ] **Step 6: Carry `grpc` into the reporter output type — `packages/cli/src/reporters/types.ts`**

Add the import at line 1:

```ts
import type { HttpResult, TestSummary, NormalizedGrpcResponse } from "@portiq/core";
```

Extend the `execution` member (lines 14-21):

```ts
  | {
      kind: "execution";
      request: ExecRequestView;
      response: HttpResult | null;
      error: string | null;
      tests: TestSummary | null;
      steps?: unknown;
      grpc?: NormalizedGrpcResponse | null;
    }
```

- [ ] **Step 7: Write the failing reporter test — append to `packages/cli/src/reporters/reporters.test.ts`**

```ts
import type { NormalizedGrpcResponse } from "@portiq/core";

const grpcResp: NormalizedGrpcResponse = {
  protocol: "grpc", callType: "SERVER_STREAM", statusCode: 0, statusMessage: "OK", duration: 9,
  metadata: {}, trailers: {}, messages: [{ n: 1 }, { n: 2 }], json: null, body: "[]", streamed: true, error: null,
};

describe("PrettyReporter gRPC", () => {
  it("renders a streamed gRPC response with status, call type, and message count", async () => {
    const { PrettyReporter } = await import("./index");
    const out = new PrettyReporter(false).write({
      kind: "execution",
      request: { protocol: "grpc", method: "SERVER_STREAM", url: "grpc://x", headers: {} },
      response: null, error: null, tests: null, grpc: grpcResp,
    });
    expect(out).toContain("SERVER_STREAM grpc://x");
    expect(out).toContain("OK");
    expect(out).toContain("2 messages");
  });

  it("renders a gRPC error status", async () => {
    const { PrettyReporter } = await import("./index");
    const out = new PrettyReporter(false).write({
      kind: "execution",
      request: { protocol: "grpc", method: "UNARY", url: "grpc://x", headers: {} },
      response: null, error: "nope", tests: null,
      grpc: { ...grpcResp, callType: "UNARY", statusCode: 5, statusMessage: "NOT_FOUND", messages: [], streamed: false, error: "nope" },
    });
    expect(out).toContain("NOT_FOUND");
    expect(out).toContain("nope");
  });
});

describe("JsonReporter gRPC", () => {
  it("serializes the grpc field", async () => {
    const { JsonReporter } = await import("./index");
    const parsed = JSON.parse(new JsonReporter().write({
      kind: "execution",
      request: { protocol: "grpc", method: "UNARY", url: "grpc://x", headers: {} },
      response: null, error: null, tests: null, grpc: grpcResp,
    }));
    expect(parsed.grpc.streamed).toBe(true);
    expect(parsed.grpc.messages).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -- packages/cli/src/reporters/reporters.test.ts`
Expected: FAIL — Pretty output does not yet render the `grpc` field (no "SERVER_STREAM"/"messages" text).

- [ ] **Step 9: Render gRPC in `PrettyReporter` — `packages/cli/src/reporters/index.ts`**

In the `execution` case of `PrettyReporter.write` (line 42-43), branch on a present `grpc` field:

```ts
      case "execution":
        if (out.grpc) return this.grpc(out.request.method, out.request.url, out.grpc);
        return this.execution(out.request.method, out.request.url, out.response, out.error, out.tests);
```

Add this private method to `PrettyReporter` (after `execution`, before `testsLine`):

```ts
  private grpc(callType: string, url: string, r: import("@portiq/core").NormalizedGrpcResponse): string {
    const head = `${callType} ${url}`;
    if (r.error) {
      return `${head}\n${this.c(RED, `${r.statusCode} ${r.statusMessage}`)} ${this.c(DIM, `(${r.duration}ms)`)}\n${this.c(RED, "ERROR")} ${r.error}`;
    }
    const status = `${this.c(r.statusCode === 0 ? GREEN : RED, `${r.statusCode} ${r.statusMessage}`)} ${this.c(DIM, `(${r.duration}ms)`)}`;
    const payload = r.streamed
      ? this.c(DIM, `${r.messages.length} messages`)
      : this.c(DIM, JSON.stringify(r.json));
    return `${head}\n${status}\n${payload}`;
  }
```

(`JsonReporter` and `JunitReporter` need no change: JSON serializes the whole output including `grpc`; JUnit emits an empty suite for a no-test execution, already handled at `index.ts:22-24`.)

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- packages/cli/src/reporters/reporters.test.ts`
Expected: PASS.

- [ ] **Step 11: Carry `grpc` through `run <ref>` — `packages/cli/src/commands/run.ts`**

In the single-request path, replace lines 73-76 with:

```ts
          const outcome = await runRequest(req, vars, deps, { timeoutMs: flags.timeout });
          const output: CommandOutput = { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: outcome.tests, grpc: outcome.grpc };
          if (outcome.error) process.exitCode = 1;
          return { output, failed: hasFailures(outcome.tests) };
```

Also, in the single-request dry-run branch (lines 68-72), gRPC requests must not go through `resolveHttpPayload` (HTTP-only). Replace that branch with:

```ts
          if (flags.dryRun) {
            if (req.protocol === "grpc") {
              const { buildGrpcPayload } = await import("@portiq/core");
              const payload = buildGrpcPayload(req, vars);
              const output: CommandOutput = { kind: "entity", entity: { protocol: "grpc", service: payload.service, method: payload.method, url: payload.url, callType: payload.callType ?? "UNARY", body: JSON.stringify(payload.body) } };
              return { output, failed: false };
            }
            const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
            const output: CommandOutput = { kind: "execution", request: view, response: null, error: null, tests: null };
            return { output, failed: false };
          }
```

(The collection path at line 43 still filters out `grpc`/`websocket`/`dag` — gRPC has no tests and the suite output shape is HTTP-only; single `run <ref>` and `exec` are the gRPC entrypoints. This is intentional and noted in Self-Review.)

- [ ] **Step 12: Add gRPC flags to `exec` — `packages/cli/src/commands/exec.ts`**

Extend `ExecOptions` (lines 15-21):

```ts
export interface ExecOptions {
  url?: string;
  method?: string;
  header: string[];
  data?: string;
  fromCurl?: string;
  grpc?: boolean;
  service?: string;
  proto?: string;
  callType?: string;
}
```

Add the option registrations inside `register` (after the `--from-curl` option, line 60):

```ts
      .option("--grpc", "send a gRPC request (target = [url] as grpc://host:port, RPC method = -X, metadata = -H, body = -d)")
      .option("--service <name>", "gRPC service name (implies --grpc)")
      .option("--proto <file>", "path to a .proto file (gRPC)")
      .option("--call-type <type>", "gRPC call type: UNARY | SERVER_STREAM | CLIENT_STREAM | BIDI_STREAM", "UNARY")
```

Replace the `.action(...)` body (lines 61-77) with a gRPC-aware version:

```ts
      .action(async (url: string | undefined, opts: Omit<ExecOptions, "url">, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const isGrpc = !!opts.grpc || !!opts.service || (!!url && /^grpcs?:\/\//i.test(url));
        const vars = safeResolveVars(ctx, flags);
        const deps: RunDeps = defaultRunDeps();

        if (isGrpc) {
          if (!url) throw new UsageError("gRPC exec requires a <url> target (grpc://host:port)");
          if (!opts.service) throw new UsageError("gRPC exec requires --service <name>");
          const metadata: Record<string, string> = {};
          for (const h of opts.header) { const i = h.indexOf(":"); metadata[i === -1 ? h.trim() : h.slice(0, i).trim()] = i === -1 ? "" : h.slice(i + 1).trim(); }
          const item: RequestItem = {
            type: "request", id: "adhoc", name: "adhoc", description: "", tags: [],
            protocol: "grpc", method: "", url,
            grpcConfig: {
              service: opts.service, method: opts.method || "",
              requestBody: opts.data ?? "{}", metadata,
              callType: (opts.callType as import("@portiq/core").GrpcConfig["callType"]) || "UNARY",
              protoPath: opts.proto,
            },
          };
          if (!item.grpcConfig!.method) throw new UsageError("gRPC exec requires -X <RpcMethod>");
          const outcome = await runRequest(item, vars, deps, { runTests: false });
          emit(ctx, flags, { kind: "execution", request: outcome.request, response: null, error: outcome.error, tests: null, grpc: outcome.grpc });
          if (outcome.error) process.exitCode = 1;
          return;
        }

        const req = buildExecRequest({ ...opts, url });
        if (flags.dryRun) {
          const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
          emit(ctx, flags, { kind: "entity", entity: { ...view } } as CommandOutput);
          return;
        }
        const item: RequestItem = { type: "request", id: "adhoc", name: "adhoc", description: "", tags: [], ...req } as RequestItem;
        const outcome = await runRequest(item, vars, deps, { timeoutMs: flags.timeout, runTests: false });
        emit(ctx, flags, { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: null });
        if (outcome.error) process.exitCode = 1;
      });
```

- [ ] **Step 13: Write the failing `exec` gRPC test — append to `packages/cli/src/commands/exec.test.ts`**

Read the top of the existing `exec.test.ts` to match its harness (how it builds a `CliContext` sink and calls `buildProgram`). Append a case that starts an in-process echo server and runs `exec --grpc`. Add these imports at the top:

```ts
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Append:

```ts
describe("exec gRPC", () => {
  let server: grpc.Server;
  let target: string;
  let protoFile: string;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-grpc-"));
    protoFile = join(dir, "echo.proto");
    writeFileSync(protoFile, `syntax="proto3";package echo;message EchoRequest{string message=1;}message EchoReply{string message=1;}service EchoService{rpc Unary(EchoRequest)returns(EchoReply);}`, "utf8");
    const def = protoLoader.loadSync(protoFile, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, { Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }) });
    target = await new Promise<string>((res, rej) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => e ? rej(e) : res(`grpc://127.0.0.1:${p}`)));
  });
  afterAll(() => { server.forceShutdown(); });

  it("runs a unary gRPC exec and prints the decoded json", async () => {
    const { out } = await run(["exec", target, "--grpc", "--service", "echo.EchoService", "-X", "Unary", "--proto", protoFile, "-d", '{"message":"cli"}', "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("execution");
    expect(parsed.grpc.statusCode).toBe(0);
    expect(parsed.grpc.json).toEqual({ message: "hi cli" });
  });
});
```

(Match the existing file's `run()` helper and `beforeAll/afterAll` imports; if the file does not already import `beforeAll/afterAll` from vitest, add them.)

- [ ] **Step 14: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/exec.test.ts packages/cli/src/exec/runRequest.test.ts packages/cli/src/reporters/reporters.test.ts`
Expected: PASS.

- [ ] **Step 15: Build CLI dist + full suite + lint**

Run: `npm run build --workspace portiq` (confirms `@portiq/core/grpc` resolves under CLI's classic `moduleResolution:Node`, and that `require("@portiq/core/grpc")` → `dist/transport/grpc.js` works without esbuild bundling — `@grpc/grpc-js` is CJS).
Run: `node -e "require('@portiq/core/grpc'); require('@portiq/core')" ` — expected: no throw (proves the CJS require path).
Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 16: Commit**

```bash
git add packages/cli/tsconfig.build.json packages/cli/src/exec/runRequest.ts packages/cli/src/exec/runRequest.test.ts packages/cli/src/reporters/types.ts packages/cli/src/reporters/index.ts packages/cli/src/reporters/reporters.test.ts packages/cli/src/commands/run.ts packages/cli/src/commands/exec.ts packages/cli/src/commands/exec.test.ts
git commit -m "feat(cli): dispatch gRPC through run/exec with streamed-response reporter output"
```

---

## Task 4: Core engine — CLIENT_STREAM (batch send-all → single response)

**Files:**
- Modify: `packages/core/src/transport/fixtures/echo.proto` (add `ClientStream` rpc)
- Modify: `packages/core/src/transport/grpc.ts` (`GrpcSendPayload.messages`; `clientStream`; dispatch)
- Modify: `packages/core/src/transport/grpc.test.ts` (append case)

**Interfaces:**
- Consumes: `GrpcTransport.send` (existing).
- Produces: `GrpcSendPayload.messages?: unknown[]`; `send` handles `callType: "CLIENT_STREAM"` — writes every message in `payload.messages` (default `[parsedBody]`), half-closes, resolves with the single reply as `json`/`body` (`messages: []`, matching unary).

- [ ] **Step 1: Add the `ClientStream` rpc to the fixture**

In `packages/core/src/transport/fixtures/echo.proto`, inside `service EchoService { ... }`, add after the `ServerStream` line:

```proto
  rpc ClientStream (stream EchoRequest) returns (EchoReply);
```

- [ ] **Step 2: Write the failing test — append to `packages/core/src/transport/grpc.test.ts`**

First extend the shared `startEchoServer` default impl (in the existing helper) to include a `ClientStream` handler — add this entry to the `server.addService(..., { ... })` object literal, before `...impl`:

```ts
      ClientStream: (call: any, cb: any) => {
        const parts: string[] = [];
        call.on("data", (msg: any) => parts.push(msg.message));
        call.on("end", () => cb(null, { message: "got:" + parts.join(",") }));
      },
```

Also widen the helper's `impl` param type to include `ClientStream?: grpc.handleClientStreamingCall<any, any>;`. Then append:

```ts
describe("GrpcTransport client streaming", () => {
  it("sends all request messages and returns the single aggregated reply", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "ClientStream",
      callType: "CLIENT_STREAM",
      messages: [{ message: "a" }, { message: "b" }, { message: "c" }],
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "got:a,b,c" });
    expect(r.messages).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: FAIL — `CLIENT_STREAM` currently resolves `statusCode: 12` (UNIMPLEMENTED).

- [ ] **Step 4: Implement CLIENT_STREAM in `packages/core/src/transport/grpc.ts`**

Add `messages?: unknown[];` to the `GrpcSendPayload` interface (after `body?: ...`, line 8).

In `send`, compute the streaming message list right after `request` is parsed (after line 120):

```ts
    const streamMessages: unknown[] =
      Array.isArray(payload.messages) && payload.messages.length ? payload.messages : [request];
```

Replace the dispatch tail (lines 157-165) with:

```ts
    if (callType === "UNARY") {
      return this.unary(client, fn, request, md, options, payload.requestId);
    }
    if (callType === "SERVER_STREAM") {
      return this.serverStream(client, fn, request, md, options, payload.requestId);
    }
    if (callType === "CLIENT_STREAM") {
      return this.clientStream(client, fn, streamMessages, md, options, payload.requestId);
    }
    // BIDI_STREAM lands in the next task.
    try { client.close(); } catch { /* ignore */ }
    return fail(grpc.status.UNIMPLEMENTED, `gRPC call type not supported yet: ${callType}`);
```

Add this private method to `GrpcTransport` (after `serverStream`):

```ts
  private clientStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientWritableStream<any>,
    messages: unknown[],
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      let responseMsg: any = undefined;

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, md, options, (err: grpc.ServiceError | null, value: any) => {
        if (!err) responseMsg = value;
      }) as grpc.ClientWritableStream<any>;

      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        if (status.code === grpc.status.OK) {
          finish({ statusCode: 0, statusMessage: "OK", duration, metadata: initialMd, trailers,
            body: JSON.stringify(responseMsg ?? {}), json: responseMsg ?? null, error: null, messages: [] });
        } else {
          finish({ statusCode: status.code, statusMessage: statusName(status.code), duration, metadata: initialMd, trailers,
            body: "", json: null, error: status.details || `gRPC error ${status.code}`, messages: [] });
        }
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }

      for (const m of messages) call.write(m);
      call.end();
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: PASS (all prior cases + client-stream).

- [ ] **Step 6: Full suite + lint + commit**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/core/src/transport/fixtures/echo.proto packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts
git commit -m "feat(core): gRPC CLIENT_STREAM (batch send-all, single aggregated reply)"
```

---

## Task 5: Core engine — BIDI_STREAM (batch send-all → collect all replies)

**Files:**
- Modify: `packages/core/src/transport/fixtures/echo.proto` (add `BidiStream` rpc)
- Modify: `packages/core/src/transport/grpc.ts` (`bidiStream`; dispatch)
- Modify: `packages/core/src/transport/grpc.test.ts` (append case)

**Interfaces:**
- Consumes: `GrpcTransport.send`, `GrpcSendPayload.messages` (Task 4).
- Produces: `send` handles `callType: "BIDI_STREAM"` — writes every message, half-closes, aggregates all streamed replies into `messages[]` (`json: null`, `body: JSON.stringify(messages)`), exactly like SERVER_STREAM.

- [ ] **Step 1: Add the `BidiStream` rpc to the fixture**

In `packages/core/src/transport/fixtures/echo.proto`, inside `service EchoService { ... }`, add:

```proto
  rpc BidiStream (stream EchoRequest) returns (stream EchoReply);
```

- [ ] **Step 2: Write the failing test — append to `packages/core/src/transport/grpc.test.ts`**

Add a `BidiStream` handler to the shared `startEchoServer` default impl object (before `...impl`):

```ts
      BidiStream: (call: any) => {
        call.on("data", (msg: any) => call.write({ message: "echo:" + msg.message }));
        call.on("end", () => call.end());
      },
```

Widen the helper's `impl` param type to include `BidiStream?: grpc.handleBidiStreamingCall<any, any>;`. Then append:

```ts
describe("GrpcTransport bidi streaming", () => {
  it("sends all request messages and aggregates all streamed replies", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "BidiStream",
      callType: "BIDI_STREAM",
      messages: [{ message: "x" }, { message: "y" }],
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.messages).toEqual([{ message: "echo:x" }, { message: "echo:y" }]);
    expect(r.json).toBeNull();
    expect(JSON.parse(r.body)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: FAIL — `BIDI_STREAM` resolves `statusCode: 12` (UNIMPLEMENTED).

- [ ] **Step 4: Implement BIDI_STREAM in `packages/core/src/transport/grpc.ts`**

Replace the dispatch tail so BIDI_STREAM routes to a new method (change the "BIDI_STREAM lands in the next task" comment + fallthrough from Task 4):

```ts
    if (callType === "CLIENT_STREAM") {
      return this.clientStream(client, fn, streamMessages, md, options, payload.requestId);
    }
    if (callType === "BIDI_STREAM") {
      return this.bidiStream(client, fn, streamMessages, md, options, payload.requestId);
    }
    try { client.close(); } catch { /* ignore */ }
    return fail(grpc.status.UNIMPLEMENTED, `gRPC call type not supported yet: ${callType}`);
```

Add this private method (after `clientStream`):

```ts
  private bidiStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientDuplexStream<any, any>,
    messages: unknown[],
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      const replies: any[] = [];

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, md, options) as grpc.ClientDuplexStream<any, any>;
      call.on("data", (chunk: any) => { replies.push(chunk); });
      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        finish({
          statusCode: status.code === grpc.status.OK ? 0 : status.code,
          statusMessage: statusName(status.code),
          duration, metadata: initialMd, trailers,
          body: JSON.stringify(replies), json: null,
          error: status.code === grpc.status.OK ? null : (status.details || `gRPC error ${status.code}`),
          messages: replies,
        });
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }

      for (const m of messages) call.write(m);
      call.end();
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: PASS (all four call types).

- [ ] **Step 6: Full suite + lint + commit**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/core/src/transport/fixtures/echo.proto packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts
git commit -m "feat(core): gRPC BIDI_STREAM (batch send-all, aggregate all replies)"
```

---

## Task 6: Core engine — gRPC server reflection (descriptor resolution when no proto)

**Files:**
- Modify: `packages/core/package.json` (add `grpc-reflection-js` dep + `@grpc/reflection` devDep)
- Create: `packages/core/src/transport/grpcReflection.ts`
- Create: `packages/core/src/transport/grpcReflection.test.ts`
- Modify: `packages/core/src/transport/grpc.ts` (`useReflection` payload field + reflection fallback in `send`)
- Modify: `packages/core/src/transport/grpc.test.ts` (append no-proto-via-reflection case)

**Interfaces:**
- Consumes: `grpc-reflection-js` `Client`, `@grpc/grpc-js`.
- Produces:
  - `loadProtoViaReflection(target: string, creds: grpc.ChannelCredentials, service: string): Promise<grpc.GrpcObject>` — resolves the package definition for `service` from the server's reflection endpoint.
  - `GrpcSendPayload.useReflection?: boolean` — when set (or when neither `protoPath` nor `protoContent` is provided) `send` resolves descriptors via reflection instead of `loadProto`.

- [ ] **Step 1: Add dependencies**

In `packages/core/package.json`, add to `"dependencies"`:

```json
    "grpc-reflection-js": "^0.3.0",
```

and to `"devDependencies"`:

```json
    "@grpc/reflection": "^1.0.4",
```

Run: `npm install`
Expected: both resolve (pure JS). No native rebuild triggered.

- [ ] **Step 2: Write the failing test `packages/core/src/transport/grpcReflection.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import { loadProtoViaReflection } from "./grpcReflection";
import { findService } from "./grpcProto";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;

function startReflectiveServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, { Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }) });
    new ReflectionService(def).addToServer(server);
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}
afterEach(() => { server?.forceShutdown(); server = null; });

describe("loadProtoViaReflection", () => {
  it("resolves a service descriptor from a reflection endpoint", async () => {
    const target = await startReflectiveServer();
    const pkg = await loadProtoViaReflection(target, grpc.credentials.createInsecure(), "echo.EchoService");
    const ctor = findService(pkg, "echo.EchoService");
    expect(typeof ctor.service).toBe("object");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpcReflection.test.ts`
Expected: FAIL — module `./grpcReflection` not found.

- [ ] **Step 4: Implement `packages/core/src/transport/grpcReflection.ts`**

```ts
import * as grpc from "@grpc/grpc-js";
import { Client as ReflectionClient } from "grpc-reflection-js";

/**
 * Resolve a gRPC package object for `service` from a server's reflection endpoint
 * (grpc.reflection.v1alpha.ServerReflection), avoiding the need for a local .proto.
 * Returns the same shape as loadProto so findService + the transport dial path are unchanged.
 */
export async function loadProtoViaReflection(
  target: string,
  creds: grpc.ChannelCredentials,
  service: string
): Promise<grpc.GrpcObject> {
  const client = new ReflectionClient(target, creds);
  const descriptor = await client.fileContainingSymbol(service);
  const packageDefinition = descriptor.getPackageDefinition();
  return grpc.loadPackageDefinition(packageDefinition);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpcReflection.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the reflection fallback into `send` — `packages/core/src/transport/grpc.ts`**

Add `useReflection?: boolean;` to `GrpcSendPayload` (after `protoPath?: string;`, line 15).

Add the import at the top:

```ts
import { loadProtoViaReflection } from "./grpcReflection";
```

Replace the proto-load + client-construction block in `send` (currently lines 122-134, the `try { const pkg = loadProto(...) ... } catch { ... }`) with a reflection-aware version:

```ts
    let client: grpc.Client;
    let fn: ((...args: any[]) => any) | null;
    let ClientCtor: grpc.ServiceClientConstructor;
    try {
      const { target, secure } = normalizeTarget(url, payload.tls);
      const creds = secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      const hasProto = !!(payload.protoPath || (payload.protoContent && payload.protoContent.trim()));
      const pkg = hasProto && !payload.useReflection
        ? loadProto({ protoPath: payload.protoPath, protoContent: payload.protoContent })
        : await loadProtoViaReflection(target, creds, service);
      ClientCtor = findService(pkg, service);
      client = new ClientCtor(target, creds);
      fn = resolveMethod(client, method);
    } catch (err: any) {
      return fail(grpc.status.INVALID_ARGUMENT, err?.message || String(err));
    }
```

(This makes reflection the automatic path when no proto is supplied, and an explicit opt-in via `useReflection` even when a proto exists. `normalizeTarget`/`loadProto`/`findService`/`resolveMethod` are unchanged.)

- [ ] **Step 7: Write the failing end-to-end test — append to `packages/core/src/transport/grpc.test.ts`**

Add the reflection import at the top of the test file:

```ts
import { ReflectionService } from "@grpc/reflection";
```

Extend the shared `startEchoServer` helper so the server also serves reflection — after `server.addService(...)` and before `server.bindAsync(...)`, add:

```ts
    new ReflectionService(def).addToServer(server);
```

(`def` is the `protoLoader.loadSync(...)` result already computed at the top of `startEchoServer`.) Then append:

```ts
describe("GrpcTransport via reflection", () => {
  it("performs a unary call with NO proto supplied (descriptors from reflection)", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "reflected" },
      callType: "UNARY",
      tls: false,
      useReflection: true,
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "hi reflected" });
  });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts packages/core/src/transport/grpcReflection.test.ts`
Expected: PASS.

- [ ] **Step 9: Full suite + lint + commit**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/core/package.json package-lock.json packages/core/src/transport/grpcReflection.ts packages/core/src/transport/grpcReflection.test.ts packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts
git commit -m "feat(core): gRPC server reflection descriptor resolution (no-proto path)"
```

---

## Task 7: Core engine — advanced auth (TLS client certs, custom CA, call-credential token)

**Files:**
- Create: `packages/core/src/transport/fixtures/tls/{ca.crt,server.crt,server.key,client.crt,client.key}`
- Modify: `packages/core/src/transport/grpc.ts` (`tlsConfig` + `callToken` payload fields; `buildCredentials`)
- Modify: `packages/core/src/transport/grpc.test.ts` (append mTLS + token case)

**Interfaces:**
- Consumes: `@grpc/grpc-js` credentials API.
- Produces:
  - `GrpcSendPayload.tlsConfig?: { rootCertsPem?: string; clientCertPem?: string; clientKeyPem?: string }`
  - `GrpcSendPayload.callToken?: string`
  - `send` builds channel credentials via `grpc.credentials.createSsl(rootCerts, clientKey, clientCert)` (custom CA + optional mTLS client cert), combined with a `createFromMetadataGenerator` call-credential injecting `authorization: Bearer <callToken>` over secure channels.

- [ ] **Step 1: Generate the TLS fixtures (run once, commit the PEMs)**

Run exactly (macOS/Linux `openssl` present at `/opt/homebrew/bin/openssl`):

```bash
mkdir -p packages/core/src/transport/fixtures/tls
cd packages/core/src/transport/fixtures/tls
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -sha256 -days 36500 -subj "/CN=Portiq Test CA" -out ca.crt
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/CN=localhost" -out server.csr
printf "subjectAltName=IP:127.0.0.1,DNS:localhost" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 36500 -sha256 -extfile server.ext -out server.crt
openssl genrsa -out client.key 2048
openssl req -new -key client.key -subj "/CN=portiq-client" -out client.csr
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 36500 -sha256 -out client.crt
rm -f server.csr server.ext client.csr ca.srl ca.key
cd -
```

Result: commit `ca.crt`, `server.crt`, `server.key`, `client.crt`, `client.key` (ca.key is removed so it cannot be misused; the fixtures are test-only self-signed material). These are static test fixtures — regeneration is never needed (100-year validity).

- [ ] **Step 2: Write the failing test — append to `packages/core/src/transport/grpc.test.ts`**

Add fixture-reading imports at the top of the test file (reuse the existing `readFileSync`/`join`/`dirname`):

```ts
import { readFileSync } from "node:fs";
```

Add a TLS server factory near the other helpers:

```ts
const TLS = join(here, "fixtures", "tls");
let tlsServer: grpc.Server | null = null;

function startMtlsEchoServer(onToken: (t: string | undefined) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    tlsServer = new grpc.Server();
    tlsServer.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => {
        onToken(call.metadata.get("authorization")[0] as string | undefined);
        cb(null, { message: "secure " + call.request.message });
      },
    });
    const creds = grpc.ServerCredentials.createSsl(
      readFileSync(join(TLS, "ca.crt")),
      [{ private_key: readFileSync(join(TLS, "server.key")), cert_chain: readFileSync(join(TLS, "server.crt")) }],
      true // require + verify client cert (mTLS)
    );
    tlsServer.bindAsync("127.0.0.1:0", creds, (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}

afterEach(() => { tlsServer?.forceShutdown(); tlsServer = null; });
```

Then append:

```ts
describe("GrpcTransport advanced auth", () => {
  it("performs an mTLS unary call with a custom CA + client cert and injects a call-credential token", async () => {
    let seenToken: string | undefined;
    const target = await startMtlsEchoServer((t) => { seenToken = t; });
    const t = new GrpcTransport();
    const r = await t.send({
      url: `grpcs://${target}`,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "world" },
      callType: "UNARY",
      protoPath: FIXTURE,
      tlsConfig: {
        rootCertsPem: readFileSync(join(TLS, "ca.crt"), "utf8"),
        clientCertPem: readFileSync(join(TLS, "client.crt"), "utf8"),
        clientKeyPem: readFileSync(join(TLS, "client.key"), "utf8"),
      },
      callToken: "s3cr3t",
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "secure world" });
    expect(seenToken).toBe("Bearer s3cr3t");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: FAIL — `tlsConfig`/`callToken` are not honored; the default `createSsl()` (system roots) cannot verify the self-signed server, and no client cert is presented → the call fails with a TLS/UNAVAILABLE error rather than `statusCode: 0`.

- [ ] **Step 4: Implement advanced credentials in `packages/core/src/transport/grpc.ts`**

Add to `GrpcSendPayload` (after `useReflection?: boolean;`):

```ts
  tlsConfig?: { rootCertsPem?: string; clientCertPem?: string; clientKeyPem?: string };
  callToken?: string;
```

Add a credentials builder near the other module helpers (after `normalizeTarget`):

```ts
/** Build channel credentials honoring custom CA / client certs (mTLS) and an optional call-credential token. */
function buildCredentials(
  secure: boolean,
  tlsConfig: GrpcSendPayload["tlsConfig"],
  callToken: string | undefined
): grpc.ChannelCredentials {
  const wantsTls = secure || !!tlsConfig;
  let channelCreds: grpc.ChannelCredentials;
  if (!wantsTls) {
    channelCreds = grpc.credentials.createInsecure();
  } else {
    const root = tlsConfig?.rootCertsPem ? Buffer.from(tlsConfig.rootCertsPem) : null;
    const key = tlsConfig?.clientKeyPem ? Buffer.from(tlsConfig.clientKeyPem) : null;
    const cert = tlsConfig?.clientCertPem ? Buffer.from(tlsConfig.clientCertPem) : null;
    channelCreds = grpc.credentials.createSsl(root, key, cert);
  }
  if (callToken) {
    if (wantsTls) {
      const callCreds = grpc.credentials.createFromMetadataGenerator((_params, cb) => {
        const md = new grpc.Metadata();
        md.set("authorization", `Bearer ${callToken}`);
        cb(null, md);
      });
      channelCreds = grpc.credentials.combineChannelCredentials(channelCreds, callCreds);
    }
    // Over an insecure channel grpc-js rejects call credentials; the token is added to
    // request metadata instead (see send() below).
  }
  return channelCreds;
}
```

In `send`, replace the `const creds = secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();` line (inside the reflection-aware block from Task 6) with:

```ts
      const creds = buildCredentials(secure, payload.tlsConfig, payload.callToken);
```

Finally, cover the insecure-token case: right after `const md = buildMetadata(payload.metadata);` (line 153), add:

```ts
    const insecureToken = payload.callToken && !(payload.tls || url.toLowerCase().startsWith("grpcs://") || payload.tlsConfig);
    if (insecureToken) md.set("authorization", `Bearer ${payload.callToken}`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: PASS (mTLS + token case, plus all prior cases).

- [ ] **Step 6: Full suite + lint + commit**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

```bash
git add packages/core/src/transport/fixtures/tls packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts
git commit -m "feat(core): gRPC advanced auth (mTLS client certs, custom CA, call-credential token)"
```

---

## Task 8: Expose streaming / reflection / advanced-auth through MCP + CLI

**Files:**
- Modify: `packages/core/src/model/request.ts` (extend `GrpcConfig`)
- Modify: `packages/core/src/exec/grpcExec.ts` (`buildGrpcPayload` forwards the new fields)
- Modify: `packages/core/src/exec/grpcExec.test.ts` (assert forwarding)
- Modify: `packages/mcp/src/tools/exec.ts` (`run_ad_hoc_request` gains streaming/reflection/auth fields)
- Modify: `packages/mcp/src/tools/exec.test.ts` (client-stream ad-hoc case)
- Modify: `packages/cli/src/commands/exec.ts` (`--message`, `--reflection`, `--ca-cert`, `--client-cert`, `--client-key`, `--token`)
- Modify: `packages/cli/src/commands/exec.test.ts` (reflection / client-stream exec case)

**Interfaces:**
- Consumes: extended `GrpcSendPayload` (Tasks 4/6/7).
- Produces:
  - `GrpcConfig` gains `messages?: string[]`, `useReflection?: boolean`, `tlsConfig?: { rootCertsPem?: string; clientCertPem?: string; clientKeyPem?: string }`, `callToken?: string`.
  - `buildGrpcPayload` parses `messages` (JSON strings → objects) and forwards `useReflection`/`tlsConfig`/`callToken`.
  - MCP `run_ad_hoc_request` inputs: `messages` (string[]), `useReflection` (bool), `rootCertsPem`/`clientCertPem`/`clientKeyPem` (string), `callToken` (string).
  - CLI `exec` flags: `--message <json>` (repeatable), `--reflection`, `--ca-cert <file>`, `--client-cert <file>`, `--client-key <file>`, `--token <token>`.

- [ ] **Step 1: Extend `GrpcConfig` — `packages/core/src/model/request.ts`**

Add these fields to the `GrpcConfig` interface (after `protoPath?: string;`):

```ts
  messages?: string[];
  useReflection?: boolean;
  tlsConfig?: { rootCertsPem?: string; clientCertPem?: string; clientKeyPem?: string };
  callToken?: string;
```

- [ ] **Step 2: Write the failing forwarding test — append to `packages/core/src/exec/grpcExec.test.ts`**

```ts
describe("buildGrpcPayload advanced fields", () => {
  it("parses messages (JSON strings) and forwards reflection + auth", () => {
    const p = buildGrpcPayload(item({
      grpcConfig: {
        service: "S", method: "M", callType: "CLIENT_STREAM",
        messages: ['{"message":"a"}', '{"message":"b"}'],
        useReflection: true,
        tlsConfig: { rootCertsPem: "CA" },
        callToken: "tok",
      },
    }), {});
    expect(p.messages).toEqual([{ message: "a" }, { message: "b" }]);
    expect(p.useReflection).toBe(true);
    expect(p.tlsConfig).toEqual({ rootCertsPem: "CA" });
    expect(p.callToken).toBe("tok");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- packages/core/src/exec/grpcExec.test.ts`
Expected: FAIL — `buildGrpcPayload` does not yet forward `messages`/`useReflection`/`tlsConfig`/`callToken`.

- [ ] **Step 4: Forward the fields in `buildGrpcPayload` — `packages/core/src/exec/grpcExec.ts`**

Replace the `return { ...built, requestId } as GrpcSendPayload;` line with:

```ts
  const messages = (cfg.messages ?? []).map((m) => {
    const s = interpolate(m, vars);
    try { return JSON.parse(s) as unknown; } catch { return {}; }
  });
  return {
    ...built,
    requestId,
    ...(messages.length ? { messages } : {}),
    useReflection: cfg.useReflection,
    tlsConfig: cfg.tlsConfig,
    callToken: cfg.callToken ? interpolate(cfg.callToken, vars) : undefined,
  } as GrpcSendPayload;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/core/src/exec/grpcExec.test.ts`
Expected: PASS.

Commit the core piece:

```bash
git add packages/core/src/model/request.ts packages/core/src/exec/grpcExec.ts packages/core/src/exec/grpcExec.test.ts
git commit -m "feat(core): forward gRPC streaming/reflection/auth config through buildGrpcPayload"
```

- [ ] **Step 6: Extend the MCP ad-hoc schema — `packages/mcp/src/tools/exec.ts`**

In the `run_ad_hoc_request` `inputSchema`, add after `tls: z.boolean().optional(),`:

```ts
        messages: z.array(z.string()).optional(),
        useReflection: z.boolean().optional(),
        rootCertsPem: z.string().optional(),
        clientCertPem: z.string().optional(),
        clientKeyPem: z.string().optional(),
        callToken: z.string().optional(),
```

In the handler's `grpcConfig` construction (the `if (proto === "grpc")` block), extend it to:

```ts
        const grpcConfig: GrpcConfig = {
          service: args.service ?? "", method,
          requestBody: body ?? "{}",
          metadata: headers ?? {},
          callType: args.callType ?? "UNARY",
          deadline: args.deadline, tls: args.tls,
          protoContent: args.protoContent, protoPath: args.protoPath,
          messages: args.messages,
          useReflection: args.useReflection,
          tlsConfig: (args.rootCertsPem || args.clientCertPem || args.clientKeyPem)
            ? { rootCertsPem: args.rootCertsPem, clientCertPem: args.clientCertPem, clientKeyPem: args.clientKeyPem }
            : undefined,
          callToken: args.callToken,
        };
```

- [ ] **Step 7: Write the failing MCP client-stream test — append to `packages/mcp/src/tools/exec.test.ts`**

The `startEchoGrpcServer` helper (Task 2) only serves Unary + ServerStream. Extend it to add a `ClientStream` handler so this test can exercise batch client-streaming. In `packages/mcp/src/testkit/grpcServer.ts`:
- add `rpc ClientStream (stream EchoRequest) returns (EchoReply);` to the `ECHO_PROTO` service block, and
- add this handler to `server.addService(...)`:

```ts
    ClientStream: (call: any, cb: any) => {
      const parts: string[] = [];
      call.on("data", (m: any) => parts.push(m.message));
      call.on("end", () => cb(null, { message: "got:" + parts.join(",") }));
    },
```

Then append to `packages/mcp/src/tools/exec.test.ts` inside the existing `describe("exec tools gRPC", ...)` block:

```ts
  it("run_ad_hoc_request performs a CLIENT_STREAM call with batch messages", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", {
      protocol: "grpc", url: grpcServer.target, method: "ClientStream",
      service: "echo.EchoService", callType: "CLIENT_STREAM",
      messages: ['{"message":"a"}', '{"message":"b"}'],
      protoContent: grpcServer.protoContent, tls: false,
    });
    expect(out.response.streamed).toBe(true);
    expect(out.response.json).toEqual({ message: "got:a,b" });
  });
```

(Note: `streamed` is `true` for CLIENT_STREAM per `normalizeGrpcResult`; the single reply is in `json`.)

- [ ] **Step 8: Run MCP tests**

Run: `npm test -- packages/mcp/src/tools/exec.test.ts`
Expected: PASS.

- [ ] **Step 9: Add gRPC advanced flags to CLI `exec` — `packages/cli/src/commands/exec.ts`**

Extend `ExecOptions`:

```ts
  message: string[];
  reflection?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  token?: string;
```

Register the options (after `--call-type`):

```ts
      .option("--message <json>", "gRPC request message JSON (repeatable; for client/bidi streaming)", (v: string, p: string[]) => p.concat([v]), [])
      .option("--reflection", "resolve gRPC descriptors via server reflection (no --proto needed)")
      .option("--ca-cert <file>", "gRPC custom CA bundle (PEM)")
      .option("--client-cert <file>", "gRPC client certificate (PEM, for mTLS)")
      .option("--client-key <file>", "gRPC client private key (PEM, for mTLS)")
      .option("--token <token>", "gRPC call-credential bearer token")
```

Add the import at the top of the file:

```ts
import { readFileSync } from "node:fs";
```

In the `if (isGrpc)` block, replace the `grpcConfig` literal with the full version:

```ts
          const item: RequestItem = {
            type: "request", id: "adhoc", name: "adhoc", description: "", tags: [],
            protocol: "grpc", method: "", url,
            grpcConfig: {
              service: opts.service, method: opts.method || "",
              requestBody: opts.data ?? "{}", metadata,
              callType: (opts.callType as import("@portiq/core").GrpcConfig["callType"]) || "UNARY",
              protoPath: opts.proto,
              messages: opts.message.length ? opts.message : undefined,
              useReflection: opts.reflection,
              tlsConfig: (opts.caCert || opts.clientCert || opts.clientKey)
                ? {
                    rootCertsPem: opts.caCert ? readFileSync(opts.caCert, "utf8") : undefined,
                    clientCertPem: opts.clientCert ? readFileSync(opts.clientCert, "utf8") : undefined,
                    clientKeyPem: opts.clientKey ? readFileSync(opts.clientKey, "utf8") : undefined,
                  }
                : undefined,
              callToken: opts.token,
            },
          };
```

(Streaming needs an RPC method but the earlier `-X` guard still applies. When `--reflection` is set, `--proto` is optional — the transport resolves descriptors from the server.)

- [ ] **Step 10: Write the failing CLI reflection test — append to `packages/cli/src/commands/exec.test.ts`**

Inside the `describe("exec gRPC", ...)` block, add a reflection-enabled server (extend the `beforeAll` server to serve reflection) and a case:

In `beforeAll`, add reflection to the server before `bindAsync`:

```ts
    const { ReflectionService } = await import("@grpc/reflection");
    new ReflectionService(def).addToServer(server);
```

Then append:

```ts
  it("runs a gRPC exec resolving descriptors via reflection (no --proto)", async () => {
    const { out } = await run(["exec", target, "--service", "echo.EchoService", "-X", "Unary", "--reflection", "-d", '{"message":"refl"}', "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.grpc.statusCode).toBe(0);
    expect(parsed.grpc.json).toEqual({ message: "hi refl" });
  });
```

- [ ] **Step 11: Run CLI tests**

Run: `npm test -- packages/cli/src/commands/exec.test.ts`
Expected: PASS.

- [ ] **Step 12: Build both dists + full suite + lint**

Run: `npm run build --workspace portiq-mcp && npm run build --workspace portiq`
Expected: clean emit (the `@portiq/core/grpc` paths + `grpc-reflection-js` transitive require resolve).
Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 13: Commit**

```bash
git add packages/mcp/src/tools/exec.ts packages/mcp/src/tools/exec.test.ts packages/mcp/src/testkit/grpcServer.ts packages/cli/src/commands/exec.ts packages/cli/src/commands/exec.test.ts
git commit -m "feat(cli,mcp): expose gRPC streaming, reflection, and advanced auth via exec/run_ad_hoc_request"
```

---

## Open Questions & Assumptions

- **Saved-request gRPC needed a model field.** `RequestItem` had NO `grpcConfig` (verified: `packages/core/src/model/request.ts` has `graphqlConfig`/`wsConfig` only; the desktop holds gRPC config in an ephemeral `useState` at `src/App.tsx:463` and never persists it). Task 1 adds the persisted field so `run_request` (MCP) and `run <ref>` (CLI) can execute saved gRPC requests. **Follow-up (out of scope):** the desktop `App.tsx` should persist `grpcConfig` onto the saved request (currently it does not); until then, saved gRPC requests can be created via MCP `create_request`/CLI import or by the desktop once that follow-up lands. Ad-hoc paths (`exec`, `run_ad_hoc_request`) work regardless.
- **`transport/grpc.ts` stays off the `.` barrel.** Confirmed by `packages/core/src/index.ts:19-26`. All CLI/MCP consumers import from `@portiq/core/grpc`; only the type-only-importing `grpcExec.ts` is added to the barrel.
- **Streaming is batch, not interactive.** CLIENT_STREAM/BIDI_STREAM send all `messages[]` up front then collect — matching the one-shot `send()` contract. An interactive send-loop (WS-manager style) remains out of scope, as the original Phase-3 plan noted (`2026-07-24-phase3-parity-grpc.md:1169`).
- **Reflection dependency approved here.** The Phase-3 plan gated reflection on "extra dependency + reflection-enabled test target approved" (`:1170`). This plan approves `grpc-reflection-js` (client) + `@grpc/reflection` (test server) and validates against an in-process reflective server. Reflection client API assumed: `new Client(target, creds).fileContainingSymbol(service)` → descriptor with `.getPackageDefinition()` (grpc-reflection-js README). If the installed version exposes a different accessor, the Task-6 test fails loudly and the resolver is the only place to adjust.
- **TLS fixtures are committed, test-only, self-signed** (100-year validity, `ca.key` deleted post-generation). Advanced-auth deferred by Phase-3 (`:1171`) is delivered here: custom CA, mTLS client cert, and call-credential token (real `CallCredentials` over TLS; metadata fallback over insecure).
- **`requestId`/`cancel` already spans all call types** (`transport/grpc.ts:104,168-172`, and each new stream method registers into `this.pending`). No new cancel wiring is required; CLI/MCP do not expose a separate cancel command (matches HTTP).

## Self-Review

**1. Scope coverage.**
- (1) MCP dispatch of the existing engine (unary + server-stream) → Task 2 (`run_request` saved + `run_ad_hoc_request`), with the headless streamed result shape `NormalizedGrpcResponse` defined in Task 1. Covered.
- (2) CLI `run`/`exec` dispatch + streamed reporter output → Task 3 (replaces the `runRequest.ts:37-38` hard-throw; `PrettyReporter.grpc` renders status/call-type/message-count). Covered.
- (3) CLIENT_STREAM + BIDI_STREAM in the core engine → Tasks 4 + 5 (replacing the `transport/grpc.ts:163-165` UNIMPLEMENTED fallthrough). Covered.
- (4) Server reflection → Task 6 (`grpcReflection.ts` + no-proto fallback in `send`). Covered.
- (5) Advanced auth (client certs, CA bundles, call-cred token) → Task 7 (`buildCredentials`). Covered.
- Exposure of 3–5 through CLI + MCP → Task 8 (ad-hoc tool fields + `exec` flags; saved requests inherit via `grpcConfig`→`buildGrpcPayload`). Covered.

**2. Placeholder scan.** No `TODO`/`TBD`/"similar to"/"add error handling". Every step shows complete code and exact commands. Deferred items (interactive streaming, desktop `grpcConfig` persistence) live in Open Questions, not as stub tasks.

**3. Type consistency.** `GrpcConfig` (Task 1, extended Task 8) and `GrpcSendPayload` (extended Tasks 4/6/7) stay in sync via `buildGrpcPayload`, which is updated in the same task that adds each field. `NormalizedGrpcResponse` is defined once (Task 1) and consumed by MCP `RunResult`, CLI `RunOutcome`, and the reporter `CommandOutput`/`PrettyReporter`. `GrpcSendResult` (already in `transport/grpc.ts`) is unchanged in shape — `normalizeGrpcResult` reads only its existing fields. Subpath type-wiring (`@portiq/core/grpc` in both `tsconfig.build.json` `paths`) matches the established `@portiq/core/flows` / `@portiq/core/sync` pattern. `@grpc/*` never enters a browser barrel (grpcExec type-only-imports the transport).
