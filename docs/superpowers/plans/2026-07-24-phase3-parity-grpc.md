# Phase 3 — gRPC Parity (core protocol sender) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring gRPC to parity as a first-class `@portiq/core` protocol sender — a real network transport (`GrpcTransport`) with proto loading and unary + server-streaming calls, discoverable through the existing `ProtocolRegistry`, and wired into the Electron seam that is currently a hard-coded stub.

**Architecture:** Follow the exact split the other protocols already use in core. The renderer-safe metadata handler `packages/core/src/protocols/grpc.ts` (already self-registered into `ProtocolRegistry` via `protocols/index.ts`) stays free of native dependencies. The actual network sender lives in `packages/core/src/transport/grpc.ts` as a `GrpcTransport` class — a peer to the existing `HttpTransport` (`transport/http.ts`) and `sendGraphQL` (`transport/graphql.ts`) — backed by the pure-JavaScript `@grpc/grpc-js` and `@grpc/proto-loader`. `GrpcProtocol.buildRequest` produces the send payload; `GrpcTransport.send` performs the call; `GrpcProtocol.parseResponse` normalizes the result for the UI. Because this is the identical `buildRequest → transport.send → parseResponse` contract the other protocols expose and the handler is already in the registry, a future generic executor (Phase 1 MCP `run_request`, Phase 2 CLI `run`/`exec`) dispatches gRPC by `RequestItem.protocol` with no gRPC-specific branch. This track adds no bespoke CLI command or MCP tool.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (`node` environment), `@grpc/grpc-js` (pure JS, no native ABI), `@grpc/proto-loader` (pure JS, protobuf.js), npm workspaces, `typescript-eslint` flat config.

## Global Constraints

- **Package boundary:** all new core code lives under `packages/core/src/{protocols,transport}`. No file in this track is touched by any other Phase-3 track. NO Electron imports anywhere under `packages/core/**` (`electron`, `app`, `BrowserWindow`, `ipcMain`, `window.*`).
- **Registry pattern — additive only:** the gRPC sender integrates by ADDITIVE self-registration into `ProtocolRegistry` (the registration line already exists in `packages/core/src/protocols/index.ts:20`). Never edit a shared switchboard; never introduce a parallel protocol dispatcher.
- **Confirmed aligned with Phase 0.5 (Part C + Part D delta #10):** no new registry is introduced — gRPC is one more protocol that self-registers into the existing `ProtocolRegistry` (`protocols/index.ts:20`), with the native sender in `transport/grpc.ts` and the renderer-safe handler in `protocols/grpc.ts`. This is already the decided convention; no change required.
- **Renderer-safety guardrail:** `packages/core/src/protocols/grpc.ts` is retained in the renderer (Vite/Chromium) bundle because `protocols/index.ts` has module-level registration side-effects. It MUST NOT statically or dynamically import `@grpc/grpc-js`, `@grpc/proto-loader`, `transport/grpc.ts`, or any `node:*` module. All native/Node code lives in `transport/grpc.ts`, which is reachable from the barrel only via `export * from "./transport/grpc"` and is tree-shaken out of the renderer bundle (same as `transport/http.ts`, `transport/websocket.ts` today). This mirrors the Phase-0 Task-15 rule: never reintroduce Node-only globals into renderer-bundled core modules.
- **better-sqlite3 ABI gotcha (repo-wide):** the hoisted native `better-sqlite3` binary serves EITHER plain-Node (vitest/CLI/MCP) OR Electron, not both. Tests in this plan run on plain-Node — run `npm rebuild better-sqlite3` before `npm test` if a native-module error appears; run `npm run rebuild` to restore the Electron ABI before `npm run dev`. **gRPC adds no new native ABI tension:** `@grpc/grpc-js` and `@grpc/proto-loader` are pure JavaScript and run identically on plain-Node and Electron.
- **Data-location contract:** any storage access resolves via `core.resolveDataDir()` — never re-derive a path. (This track does not persist anything new; noted for completeness.)
- **Result contract:** `GrpcTransport.send` resolves (never rejects) with a `GrpcSendResult`: `{ statusCode, statusMessage, duration, metadata, trailers, body, json, error, messages }`. `statusCode` uses the gRPC status codes already defined in `GrpcProtocol.statusCodes` (0 = OK). This is exactly the raw shape `GrpcProtocol.parseResponse` (`packages/core/src/protocols/grpc.ts:122-136`) already consumes, so `parseResponse` needs no change.
- **Tests:** all gRPC tests run against a local in-process `@grpc/grpc-js` server bound to `127.0.0.1:0` (ephemeral port). No external network. Test convention (match existing core tests): `import { describe, it, expect } from "vitest";` (add `afterEach` for server teardown); import module under test by relative path; local factory helpers at top; `describe` per unit, `it` per behavior.
- **Commits:** commit after every task with a Conventional Commit message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Current gRPC state in the repo (investigation findings)

The task treats gRPC as EXPERIMENTAL. Investigation confirms it is effectively **non-functional today**:

- **Metadata handler (exists, renderer-safe):** `packages/core/src/protocols/grpc.ts` exports `GrpcProtocol: ProtocolHandler & {...}` and self-registers via `packages/core/src/protocols/index.ts:14,20`. It provides `id: "grpc"`, `detectProtocol` (`grpc://` / `grpcs://`), `validateRequest`, `buildRequest` (returns `{ url, service, method, body, metadata, callType, deadline, tls }` — **note: omits `protoContent`**), `parseResponse` (already expects `{ statusCode, statusMessage, duration, metadata, trailers, body, json, error, messages }`), a **regex-based** `parseProtoSchema` (UI-only, not a real protobuf parser), `generateSampleBody`, and `statusCodes` / `getStatusName`.
- **UI pane (exists):** `src/components/ProtocolPanes/GrpcPane.tsx` imports `GrpcProtocol` from `@portiq/core` and manages config fields `protoContent`, `service`, `method`, `requestBody`, `metadata` (object), `deadline`. It renders responses using `response.statusCode / .duration / .error / .json / .body`.
- **No transport (MISSING):** there is **no** `transport/grpc.ts`, and **no** `@grpc/grpc-js` / `@grpc/proto-loader` in any `package.json`. `packages/core/src/transport/` contains only `http`, `graphql`, `websocket`, `mock`.
- **No Electron seam (MISSING):** `electron/main.cjs` has **no** `grpc:*` IPC handler (it wires `http:*`, `graphql:sendRequest`, `ws:*`, `mock:*`, `db:*` only). `electron/preload.cjs` exposes no `sendGrpc`. `src/types/global.d.ts` declares no gRPC method on `window.api`.
- **The seam that DOES exist is a stub:** `src/App.tsx:2477-2503` `handleGrpcSend()` validates the config and then unconditionally returns `{ error: "gRPC native transport not yet available. Install @grpc/grpc-js to enable.", statusCode: 12 }` (UNIMPLEMENTED). `handleProtocolSend()` (`src/App.tsx:2506-2513`) routes `case "grpc"` to it.

**Conclusion:** the metadata handler and UI are in place; the sender, the dependency, and the Electron IPC are absent. This plan adds the transport, forwards `protoContent` through `buildRequest`, proves the registry-driven contract, and replaces the stub. See **Open Questions & Assumptions** for what is buildable now vs. gated on maturity (streaming variants, server reflection).

---

## Source-of-truth references

- Existing transport peer to mirror (class with `send`/`cancel`, pending map, returns normalized result): `packages/core/src/transport/http.ts` (`HttpTransport`), `packages/core/src/transport/graphql.ts` (`sendGraphQL`).
- Transport test harness style (in-process server on `127.0.0.1:0`, `afterEach` teardown): `packages/core/src/transport/http.test.ts`, `packages/core/src/transport/mock.test.ts`.
- Barrel: `packages/core/src/index.ts` (add `export * from "./transport/grpc"`).
- Registry + handler contract: `packages/core/src/protocols/registry.ts` (`ProtocolHandler`, `ProtocolRegistry`), `packages/core/src/protocols/index.ts` (registration), `packages/core/src/protocols/grpc.ts` (`GrpcProtocol`).
- Electron seam to mirror (graphql path): `electron/main.cjs:127-130` (`graphql:sendRequest` handler), `electron/preload.cjs:12` (`sendGraphQL`), `src/App.tsx:2370-2475` (`handleGraphQLSend`), `src/App.tsx:2477-2513` (`handleGrpcSend` stub + `handleProtocolSend`), `src/types/global.d.ts:58-59` (`window.api` types).
- Core build (CJS emit that `main.cjs` requires; excludes `**/*.test.ts`): `packages/core/tsconfig.build.json`, `packages/core/package.json` `build` script; root scripts `build:core`, `rebuild`, `dev`, `package*`.
- Config: `vitest.config.ts` (`include` already covers `packages/*/src/**/*.test.ts`), `eslint.config.js` (`packages/core/tsconfig.json` already registered; `**/dist` ignored).

---

## Task 1: gRPC dependencies + proto fixture + proto loader

**Files:**
- Modify: `packages/core/package.json` (add `@grpc/grpc-js`, `@grpc/proto-loader`)
- Create: `packages/core/src/transport/fixtures/echo.proto`
- Create: `packages/core/src/transport/grpcProto.ts`
- Create: `packages/core/src/transport/grpcProto.test.ts`

**Interfaces:**
- Produces:
  - `PROTO_LOADER_OPTIONS: protoLoader.Options`
  - `interface LoadProtoInput { protoPath?: string; protoContent?: string }`
  - `loadProto(input: LoadProtoInput): grpc.GrpcObject` — loads from a `.proto` file path, or writes `protoContent` to an OS temp file and loads it; throws `Error` when neither is provided.
  - `findService(pkg: grpc.GrpcObject, serviceName: string): grpc.ServiceClientConstructor` — resolves a service constructor by dotted path (`echo.EchoService`) or bare name (deep search for `EchoService`); throws `Error` when not found.
  - `metadataToObject(md: grpc.Metadata): Record<string, string>` — flattens gRPC metadata to a first-value string map.

- [ ] **Step 1: Add dependencies to `packages/core/package.json`**

In the `"dependencies"` object (currently `better-sqlite3`, `dagre`, `ws`), add the two gRPC packages so the block reads:

```json
  "dependencies": {
    "@grpc/grpc-js": "^1.12.6",
    "@grpc/proto-loader": "^0.7.13",
    "better-sqlite3": "^12.11.1",
    "dagre": "^0.8.5",
    "ws": "^8.21.1"
  }
```

- [ ] **Step 2: Install and confirm resolution**

Run: `npm install`
Expected: installs `@grpc/grpc-js` and `@grpc/proto-loader` (both pure JS — no native build step). No `better-sqlite3` rebuild is triggered by this.

- [ ] **Step 3: Create the test fixture `packages/core/src/transport/fixtures/echo.proto`**

```proto
syntax = "proto3";

package echo;

message EchoRequest {
  string message = 1;
}

message EchoReply {
  string message = 1;
}

service EchoService {
  rpc Unary (EchoRequest) returns (EchoReply);
  rpc ServerStream (EchoRequest) returns (stream EchoReply);
}
```

- [ ] **Step 4: Write the failing test `packages/core/src/transport/grpcProto.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadProto, findService, metadataToObject } from "./grpcProto";
import * as grpc from "@grpc/grpc-js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

describe("loadProto", () => {
  it("loads a service from a .proto file path", () => {
    const pkg = loadProto({ protoPath: FIXTURE }) as any;
    expect(typeof pkg.echo.EchoService).toBe("function");
    expect(typeof pkg.echo.EchoService.service).toBe("object");
  });

  it("loads a service from proto content string", () => {
    const content = readFileSync(FIXTURE, "utf8");
    const pkg = loadProto({ protoContent: content }) as any;
    expect(typeof pkg.echo.EchoService).toBe("function");
  });

  it("throws when neither protoPath nor protoContent is provided", () => {
    expect(() => loadProto({})).toThrow(/protoPath or protoContent/i);
  });
});

describe("findService", () => {
  it("resolves by fully-qualified name", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    const ctor = findService(pkg, "echo.EchoService");
    expect(typeof ctor.service).toBe("object");
  });

  it("resolves by bare service name via deep search", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    const ctor = findService(pkg, "EchoService");
    expect(typeof ctor.service).toBe("object");
  });

  it("throws for an unknown service", () => {
    const pkg = loadProto({ protoPath: FIXTURE });
    expect(() => findService(pkg, "NoSuchService")).toThrow(/NoSuchService/);
  });
});

describe("metadataToObject", () => {
  it("flattens metadata to a first-value string map", () => {
    const md = new grpc.Metadata();
    md.set("x-trace", "abc");
    expect(metadataToObject(md)).toEqual({ "x-trace": "abc" });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpcProto.test.ts`
Expected: FAIL — module `./grpcProto` not found.

- [ ] **Step 6: Implement `packages/core/src/transport/grpcProto.ts`**

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

/** Standard proto-loader options: preserve field casing and stringify longs/enums. */
export const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export interface LoadProtoInput {
  protoPath?: string;
  protoContent?: string;
}

/**
 * Load a proto definition into a gRPC package object.
 * Accepts a file path, or raw proto content (written to an OS temp file, then loaded).
 */
export function loadProto(input: LoadProtoInput): grpc.GrpcObject {
  let file = input.protoPath;
  if (!file) {
    if (!input.protoContent || !input.protoContent.trim()) {
      throw new Error("gRPC requires either protoPath or protoContent");
    }
    const dir = mkdtempSync(join(tmpdir(), "portiq-proto-"));
    file = join(dir, "service.proto");
    writeFileSync(file, input.protoContent, "utf8");
  }
  const def = protoLoader.loadSync(file, PROTO_LOADER_OPTIONS);
  return grpc.loadPackageDefinition(def);
}

function isServiceCtor(value: unknown): value is grpc.ServiceClientConstructor {
  return typeof value === "function" && typeof (value as any).service === "object";
}

/**
 * Resolve a service client constructor by dotted path ("pkg.Service")
 * or by bare name (deep search of the package tree).
 */
export function findService(pkg: grpc.GrpcObject, serviceName: string): grpc.ServiceClientConstructor {
  if (serviceName.includes(".")) {
    let node: any = pkg;
    for (const segment of serviceName.split(".")) {
      node = node?.[segment];
    }
    if (isServiceCtor(node)) return node;
  }

  const bare = serviceName.includes(".") ? serviceName.split(".").pop()! : serviceName;
  const stack: any[] = [pkg];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === bare && isServiceCtor(value)) return value;
      if (value && typeof value === "object" && !isServiceCtor(value)) stack.push(value);
    }
  }
  throw new Error(`gRPC service not found: ${serviceName}`);
}

/** Flatten gRPC Metadata to a first-value string map (best-effort, for display). */
export function metadataToObject(md: grpc.Metadata | undefined | null): Record<string, string> {
  if (!md) return {};
  const json = md.toJSON();
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(json)) {
    const first = Array.isArray(values) ? values[0] : values;
    out[key] = typeof first === "string" ? first : String(first ?? "");
  }
  return out;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpcProto.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Lint and commit**

Run: `npm run lint` — expected: no new errors under `packages/core`.

```bash
git add packages/core/package.json package-lock.json packages/core/src/transport/fixtures/echo.proto packages/core/src/transport/grpcProto.ts packages/core/src/transport/grpcProto.test.ts
git commit -m "feat(core): add gRPC deps + proto loader (proto file/content + service lookup)"
```

---

## Task 2: `GrpcTransport.send` — unary calls

**Files:**
- Create: `packages/core/src/transport/grpc.ts`
- Create: `packages/core/src/transport/grpc.test.ts`
- Modify: `packages/core/src/index.ts` (add barrel export)

**Interfaces:**
- Consumes: `loadProto`, `findService`, `metadataToObject` from `./grpcProto`; `@grpc/grpc-js`.
- Produces:
  - `interface GrpcSendPayload { requestId?: string; url: string; service: string; method: string; body?: Record<string, unknown> | string; metadata?: Record<string, string>; callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM"; deadline?: number; tls?: boolean; protoContent?: string; protoPath?: string }`
  - `interface GrpcSendResult { statusCode: number; statusMessage: string; duration: number; metadata: Record<string, string>; trailers: Record<string, string>; body: string; json: any; error: string | null; messages: any[] }`
  - `class GrpcTransport { constructor(opts?: {}); send(payload: GrpcSendPayload): Promise<GrpcSendResult>; cancel(requestId: string): { ok: true } | { error: string } }` — this task implements `send` for `UNARY` (default). `cancel` is a stub that returns `{ ok: true }` here and gains real behavior in Task 3. Non-unary `callType` values resolve with `statusCode: 12` (UNIMPLEMENTED) until Task 4 / deferred work lands.

- [ ] **Step 1: Write the failing test `packages/core/src/transport/grpc.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { GrpcTransport } from "./grpc";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;

/** Start an in-process Echo server on an ephemeral port; returns "127.0.0.1:<port>". */
function startEchoServer(
  impl: {
    Unary?: grpc.handleUnaryCall<any, any>;
    ServerStream?: grpc.handleServerStreamingCall<any, any>;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
      ServerStream: (call: any) => {
        for (let i = 0; i < 3; i++) call.write({ message: "chunk-" + i });
        call.end();
      },
      ...impl,
    });
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  server?.forceShutdown();
  server = null;
});

describe("GrpcTransport unary", () => {
  it("performs a unary call and returns the decoded message", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "world" },
      callType: "UNARY",
      tls: false,
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.statusMessage).toBe("OK");
    expect(r.json).toEqual({ message: "hi world" });
    expect(r.error).toBeNull();
    expect(JSON.parse(r.body)).toEqual({ message: "hi world" });
  });

  it("maps a server error to its gRPC status code", async () => {
    const target = await startEchoServer({
      Unary: (_call: any, cb: any) =>
        cb({ code: grpc.status.NOT_FOUND, details: "nope" }),
    });
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.NOT_FOUND);
    expect(r.statusMessage).toBe("NOT_FOUND");
    expect(r.error).toContain("nope");
    expect(r.json).toBeNull();
  });

  it("resolves INVALID_ARGUMENT when required fields are missing", async () => {
    const t = new GrpcTransport();
    const r = await t.send({ url: "", service: "", method: "", protoPath: FIXTURE });
    expect(r.statusCode).toBe(grpc.status.INVALID_ARGUMENT);
    expect(r.error).toBeTruthy();
  });

  it("resolves UNIMPLEMENTED for an unknown method", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "DoesNotExist",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.UNIMPLEMENTED);
    expect(r.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: FAIL — module `./grpc` not found.

- [ ] **Step 3: Implement `packages/core/src/transport/grpc.ts`**

```ts
import * as grpc from "@grpc/grpc-js";
import { loadProto, findService, metadataToObject } from "./grpcProto";

export interface GrpcSendPayload {
  requestId?: string;
  url: string;
  service: string;
  method: string;
  body?: Record<string, unknown> | string;
  metadata?: Record<string, string>;
  callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM";
  deadline?: number;
  tls?: boolean;
  protoContent?: string;
  protoPath?: string;
}

export interface GrpcSendResult {
  statusCode: number;
  statusMessage: string;
  duration: number;
  metadata: Record<string, string>;
  trailers: Record<string, string>;
  body: string;
  json: any;
  error: string | null;
  messages: any[];
}

function statusName(code: number): string {
  return grpc.status[code] ?? `UNKNOWN(${code})`;
}

function fail(code: number, message: string, duration = 0): GrpcSendResult {
  return {
    statusCode: code,
    statusMessage: statusName(code),
    duration,
    metadata: {},
    trailers: {},
    body: "",
    json: null,
    error: message,
    messages: [],
  };
}

/** Strip grpc:// / grpcs:// prefixes; grpcs:// implies TLS. Returns dial target + security. */
function normalizeTarget(url: string, tls?: boolean): { target: string; secure: boolean } {
  const lower = url.toLowerCase();
  if (lower.startsWith("grpcs://")) return { target: url.slice("grpcs://".length), secure: true };
  if (lower.startsWith("grpc://")) return { target: url.slice("grpc://".length), secure: tls === true };
  return { target: url, secure: tls === true };
}

function parseBody(body: GrpcSendPayload["body"]): Record<string, unknown> {
  if (body == null || body === "") return {};
  if (typeof body === "string") return JSON.parse(body) as Record<string, unknown>;
  return body;
}

function buildMetadata(entries: Record<string, string> | undefined): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const [key, value] of Object.entries(entries ?? {})) md.set(key, String(value));
  return md;
}

/** Resolve a client method by exact name or camelCase alias (grpc-js registers both). */
function resolveMethod(client: grpc.Client, method: string): ((...args: any[]) => grpc.ClientUnaryCall) | null {
  const camel = method.charAt(0).toLowerCase() + method.slice(1);
  const fn = (client as any)[method] ?? (client as any)[camel];
  return typeof fn === "function" ? fn : null;
}

export class GrpcTransport {
  private pending = new Map<string, { cancel: () => void }>();

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  constructor(_opts: {} = {}) {}

  async send(payload: GrpcSendPayload): Promise<GrpcSendResult> {
    const { url, service, method } = payload || ({} as GrpcSendPayload);
    if (!url || !url.trim()) return fail(grpc.status.INVALID_ARGUMENT, "gRPC server address is required");
    if (!service || !service.trim()) return fail(grpc.status.INVALID_ARGUMENT, "Service name is required");
    if (!method || !method.trim()) return fail(grpc.status.INVALID_ARGUMENT, "Method name is required");

    let request: Record<string, unknown>;
    try {
      request = parseBody(payload.body);
    } catch {
      return fail(grpc.status.INVALID_ARGUMENT, "Request body must be valid JSON");
    }

    let client: grpc.Client;
    let fn: ((...args: any[]) => grpc.ClientUnaryCall) | null;
    try {
      const pkg = loadProto({ protoPath: payload.protoPath, protoContent: payload.protoContent });
      const ClientCtor = findService(pkg, service);
      const { target, secure } = normalizeTarget(url, payload.tls);
      const creds = secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      client = new ClientCtor(target, creds);
      fn = resolveMethod(client, method);
    } catch (err: any) {
      return fail(grpc.status.INVALID_ARGUMENT, err?.message || String(err));
    }
    if (!fn) return fail(grpc.status.UNIMPLEMENTED, `Method not found on service: ${method}`);

    const callType = payload.callType || "UNARY";
    const md = buildMetadata(payload.metadata);
    const deadlineMs = typeof payload.deadline === "number" && payload.deadline > 0 ? payload.deadline : 30000;
    const options: grpc.CallOptions = { deadline: new Date(Date.now() + deadlineMs) };

    if (callType === "UNARY") {
      return this.unary(client, fn, request, md, options, payload.requestId);
    }
    // SERVER_STREAM is added in Task 4; CLIENT_STREAM / BIDI_STREAM are deferred.
    try { client.close(); } catch { /* ignore */ }
    return fail(grpc.status.UNIMPLEMENTED, `gRPC call type not supported yet: ${callType}`);
  }

  cancel(requestId: string): { ok: true } | { error: string } {
    if (!requestId) return { error: "Missing request ID" };
    this.pending.get(requestId)?.cancel();
    return { ok: true };
  }

  private unary(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientUnaryCall,
    request: Record<string, unknown>,
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

      const call = fn.call(client, request, md, options, (err: grpc.ServiceError | null, value: any) => {
        if (!err) responseMsg = value;
      });

      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });

      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        if (status.code === grpc.status.OK) {
          finish({
            statusCode: 0,
            statusMessage: "OK",
            duration,
            metadata: initialMd,
            trailers,
            body: JSON.stringify(responseMsg ?? {}),
            json: responseMsg ?? null,
            error: null,
            messages: [],
          });
        } else {
          finish({
            statusCode: status.code,
            statusMessage: statusName(status.code),
            duration,
            metadata: initialMd,
            trailers,
            body: "",
            json: null,
            error: status.details || `gRPC error ${status.code}`,
            messages: [],
          });
        }
      });

      // "error" always precedes a terminal "status"; swallow to avoid an unhandled emit.
      call.on("error", () => { /* terminal state handled by "status" */ });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }
    });
  }
}

export default GrpcTransport;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: PASS (4 tests). If a `better-sqlite3` native-module error appears (it should not — this test does not touch the store), run `npm rebuild better-sqlite3` and re-run.

- [ ] **Step 5: Add the barrel export**

In `packages/core/src/index.ts`, after the line `export * from "./transport/mock";` add:

```ts
export * from "./transport/grpc";
```

- [ ] **Step 6: Verify the full suite and lint**

Run: `npm test` — expected: entire suite passes (prior 224 tests + the new gRPC tests).
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts packages/core/src/index.ts
git commit -m "feat(core): GrpcTransport unary sender with normalized result"
```

---

## Task 3: deadline + cancel semantics

**Files:**
- Modify: `packages/core/src/transport/grpc.ts` (no signature change; deadline already wired in Task 2 — this task adds regression tests and confirms `cancel` behavior)
- Modify: `packages/core/src/transport/grpc.test.ts` (append cases)

**Interfaces:**
- Consumes: `GrpcTransport` (Task 2). No new exports.
- Produces: verified `DEADLINE_EXCEEDED` (code 4) on slow servers and `CANCELLED` (code 1) via `cancel(requestId)`.

- [ ] **Step 1: Append the failing tests to `packages/core/src/transport/grpc.test.ts`**

Add inside the file (after the existing `describe("GrpcTransport unary", ...)` block):

```ts
describe("GrpcTransport deadline & cancel", () => {
  it("returns DEADLINE_EXCEEDED when the server is slower than the deadline", async () => {
    const target = await startEchoServer({
      Unary: (call: any, cb: any) => {
        setTimeout(() => cb(null, { message: "late " + call.request.message }), 300);
      },
    });
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      deadline: 100,
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(r.error).toBeTruthy();
  });

  it("returns CANCELLED when cancel(requestId) is called mid-flight", async () => {
    const target = await startEchoServer({
      Unary: (call: any, cb: any) => {
        setTimeout(() => cb(null, { message: "slow " + call.request.message }), 500);
      },
    });
    const t = new GrpcTransport();
    const promise = t.send({
      requestId: "rq-1",
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      deadline: 5000,
      protoPath: FIXTURE,
    });
    setTimeout(() => t.cancel("rq-1"), 50);
    const r = await promise;
    expect(r.statusCode).toBe(grpc.status.CANCELLED);
  });

  it("cancel with no requestId returns an error object", () => {
    const t = new GrpcTransport();
    expect(t.cancel("")).toEqual({ error: "Missing request ID" });
  });
});
```

- [ ] **Step 2: Run tests to verify the new cases pass (or fail meaningfully)**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: the deadline and cancel cases PASS with the Task-2 implementation (deadline is passed as an absolute `Date`; `cancel` calls `call.cancel()`, which drives a terminal `status` with code `CANCELLED`). If the CANCELLED case is flaky because the call already completed, keep the server delay at 500ms and the cancel timer at 50ms — the 10x gap makes the race deterministic on CI.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/transport/grpc.test.ts
git commit -m "test(core): gRPC deadline (DEADLINE_EXCEEDED) and cancel (CANCELLED) coverage"
```

---

## Task 4: server-streaming (aggregate into `messages[]`)

**Files:**
- Modify: `packages/core/src/transport/grpc.ts` (add `serverStream` handling)
- Modify: `packages/core/src/transport/grpc.test.ts` (append server-stream case)

**Interfaces:**
- Consumes: `GrpcTransport` (Task 2). No signature change: `send` already accepts `callType: "SERVER_STREAM"`.
- Produces: for `callType: "SERVER_STREAM"`, `send` collects every streamed message into `GrpcSendResult.messages` and resolves once when the stream ends. `json` is `null`; `body` is `JSON.stringify(messages)`. Terminal status/errors map exactly as in unary.

- [ ] **Step 1: Append the failing test to `packages/core/src/transport/grpc.test.ts`**

```ts
describe("GrpcTransport server streaming", () => {
  it("aggregates all streamed messages into messages[]", async () => {
    const target = await startEchoServer({}); // default ServerStream writes 3 chunks
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "ServerStream",
      body: { message: "go" },
      callType: "SERVER_STREAM",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.messages).toEqual([
      { message: "chunk-0" },
      { message: "chunk-1" },
      { message: "chunk-2" },
    ]);
    expect(JSON.parse(r.body)).toHaveLength(3);
    expect(r.json).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: FAIL — `SERVER_STREAM` currently resolves `statusCode: 12` (UNIMPLEMENTED), so `r.statusCode` is `12`, not `0`.

- [ ] **Step 3: Wire server-streaming in `packages/core/src/transport/grpc.ts`**

Replace the unary dispatch tail of `send` (the block from `if (callType === "UNARY") {` through the `return fail(grpc.status.UNIMPLEMENTED, ...)` for unsupported call types) with:

```ts
    if (callType === "UNARY") {
      return this.unary(client, fn, request, md, options, payload.requestId);
    }
    if (callType === "SERVER_STREAM") {
      return this.serverStream(client, fn, request, md, options, payload.requestId);
    }
    // CLIENT_STREAM / BIDI_STREAM are deferred (see plan: Open Questions & Assumptions).
    try { client.close(); } catch { /* ignore */ }
    return fail(grpc.status.UNIMPLEMENTED, `gRPC call type not supported yet: ${callType}`);
```

Then add this private method to the `GrpcTransport` class (below `unary`):

```ts
  private serverStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientReadableStream<any>,
    request: Record<string, unknown>,
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      const messages: any[] = [];

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, request, md, options) as grpc.ClientReadableStream<any>;
      call.on("data", (chunk: any) => { messages.push(chunk); });
      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        if (status.code === grpc.status.OK) {
          finish({
            statusCode: 0,
            statusMessage: "OK",
            duration,
            metadata: initialMd,
            trailers,
            body: JSON.stringify(messages),
            json: null,
            error: null,
            messages,
          });
        } else {
          finish({
            statusCode: status.code,
            statusMessage: statusName(status.code),
            duration,
            metadata: initialMd,
            trailers,
            body: JSON.stringify(messages),
            json: null,
            error: status.details || `gRPC error ${status.code}`,
            messages,
          });
        }
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpc.test.ts`
Expected: PASS (all gRPC transport cases, including the new server-stream case).

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transport/grpc.ts packages/core/src/transport/grpc.test.ts
git commit -m "feat(core): gRPC server-streaming aggregated into messages[]"
```

---

## Task 5: forward `protoContent` through `buildRequest` + registry-driven parity test

**Files:**
- Modify: `packages/core/src/protocols/grpc.ts` (`buildRequest` forwards `protoContent` / `protoPath`)
- Create: `packages/core/src/transport/grpcDispatch.test.ts`

**Interfaces:**
- Consumes: `GrpcProtocol` from `../protocols/grpc` (via `ProtocolRegistry.get("grpc")`), `GrpcTransport` from `./grpc`, `ProtocolRegistry` from `../protocols`.
- Produces: `GrpcProtocol.buildRequest(config)` return value gains `protoContent: string` and `protoPath?: string` (additive; all existing fields unchanged). Proves the exact `registry → buildRequest → GrpcTransport.send → parseResponse` sequence a generic executor performs.

- [ ] **Step 1: Write the failing test `packages/core/src/transport/grpcDispatch.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ProtocolRegistry } from "../protocols";
import { GrpcTransport } from "./grpc";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;
function startEchoServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
    });
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}
afterEach(() => { server?.forceShutdown(); server = null; });

describe("gRPC generic-dispatch parity", () => {
  it("buildRequest forwards protoContent", () => {
    const grpcHandler = ProtocolRegistry.get("grpc")!;
    const built = grpcHandler.buildRequest({
      url: "127.0.0.1:50051",
      service: "echo.EchoService",
      method: "Unary",
      requestBody: '{"message":"x"}',
      protoContent: "syntax=\"proto3\";",
    });
    expect(built.protoContent).toBe("syntax=\"proto3\";");
    expect(built.service).toBe("echo.EchoService");
  });

  it("runs a saved gRPC request through registry → buildRequest → transport → parseResponse", async () => {
    const target = await startEchoServer();
    // A saved RequestItem, exactly as a generic executor would see it (protocol + config fields).
    const saved = {
      protocol: "grpc",
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      requestBody: JSON.stringify({ message: "world" }),
      callType: "UNARY",
      tls: false,
    };

    // Generic step 1: look the handler up by protocol id (no gRPC-specific branch).
    const handler = ProtocolRegistry.get(saved.protocol)!;
    expect(handler.id).toBe("grpc");

    // Generic step 2: build the payload. Attach the proto file the transport needs.
    const payload = { ...handler.buildRequest(saved), protoPath: FIXTURE };

    // Generic step 3: send via the exported transport.
    const raw = await new GrpcTransport().send(payload as any);

    // Generic step 4: normalize for the surface.
    const normalized = handler.parseResponse(raw);
    expect(normalized.statusCode).toBe(0);
    expect(normalized.json).toEqual({ message: "hi world" });
    expect(normalized.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/transport/grpcDispatch.test.ts`
Expected: FAIL — the first case fails because `buildRequest` does not yet return `protoContent`.

- [ ] **Step 3: Forward `protoContent` / `protoPath` in `packages/core/src/protocols/grpc.ts`**

In `GrpcProtocol.buildRequest` (currently `packages/core/src/protocols/grpc.ts:98-120`), add two fields to the returned object. Change the `return { ... }` block so it reads:

```ts
    return {
      url: config.url,
      service: config.service,
      method: config.method,
      body,
      metadata: config.metadata || {},
      callType: config.callType || "UNARY",
      deadline: config.deadline || 30000,
      tls: config.tls !== false,
      protoContent: config.protoContent || "",
      protoPath: config.protoPath || undefined
    };
```

Guardrail: this file stays renderer-safe — do NOT import `transport/grpc.ts` or `@grpc/*` here. Only plain-object fields are added.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/transport/grpcDispatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test` — expected: full suite passes.
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/protocols/grpc.ts packages/core/src/transport/grpcDispatch.test.ts
git commit -m "feat(core): forward protoContent via buildRequest + prove registry-driven gRPC dispatch"
```

---

## Task 6: rewire the Electron seam to the core sender

**Files:**
- Modify: `electron/main.cjs` (instantiate `GrpcTransport`; add `grpc:sendRequest` + `grpc:cancelRequest` IPC handlers)
- Modify: `electron/preload.cjs` (expose `sendGrpc` / `cancelGrpc`)
- Modify: `src/types/global.d.ts` (declare `sendGrpc` / `cancelGrpc` on `window.api`)
- Modify: `src/App.tsx` (`handleGrpcSend` calls the transport via IPC instead of returning the stub)

**Interfaces:**
- Consumes: `core.GrpcTransport` (barrel export from Task 2), `GrpcProtocol.buildRequest` / `parseResponse` (renderer, already imported in `src/App.tsx:6`).
- Produces: the desktop app performs real gRPC unary/server-stream calls. IPC channel `grpc:sendRequest` accepts a `GrpcSendPayload`-shaped object and resolves a `GrpcSendResult`; `grpc:cancelRequest` accepts `{ requestId }`.

- [ ] **Step 1: Instantiate the transport in `electron/main.cjs`**

Next to the existing manager instances (`electron/main.cjs:26-27`, `const wsManager = new core.WsManager();` / `const mockManager = new core.MockServerManager();`), add:

```js
const grpcTransport = new core.GrpcTransport();
```

(Eager module-level construction is safe: `@grpc/grpc-js` is pure JS with no `whenReady`/ABI constraint, unlike `httpTransport` which is lazily built to read `app.getVersion()`.)

- [ ] **Step 2: Add the IPC handlers in `electron/main.cjs`**

Immediately after the GraphQL handler (`electron/main.cjs:127-130`, `ipcMain.handle("graphql:sendRequest", ...)`), add:

```js
// ── gRPC request handler (native transport via @grpc/grpc-js) ──
ipcMain.handle("grpc:sendRequest", async (_event, payload) => {
  try {
    return await grpcTransport.send(payload);
  } catch (err) {
    return {
      statusCode: 2,
      statusMessage: "UNKNOWN",
      duration: 0,
      metadata: {},
      trailers: {},
      body: "",
      json: null,
      error: err && err.message ? err.message : String(err),
      messages: []
    };
  }
});

ipcMain.handle("grpc:cancelRequest", async (_event, payload) => {
  try {
    return grpcTransport.cancel(payload && payload.requestId);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
});
```

- [ ] **Step 3: Expose the bridge in `electron/preload.cjs`**

After the `// ── GraphQL ──` block (`electron/preload.cjs:11-12`), add:

```js
  // ── gRPC ──
  sendGrpc: (payload) => ipcRenderer.invoke("grpc:sendRequest", payload),
  cancelGrpc: (payload) => ipcRenderer.invoke("grpc:cancelRequest", payload),
```

- [ ] **Step 4: Declare the types in `src/types/global.d.ts`**

After the `// GraphQL` line (`src/types/global.d.ts:58-59`, `sendGraphQL: (payload: any) => Promise<any>;`), add:

```ts
      // gRPC
      sendGrpc: (payload: any) => Promise<any>;
      cancelGrpc: (payload: any) => Promise<any>;
```

- [ ] **Step 5: Rewire `handleGrpcSend` in `src/App.tsx`**

Replace the stub body of `handleGrpcSend` (`src/App.tsx:2477-2503`) with a real send that mirrors `handleGraphQLSend`'s validate → build → send → parse flow:

```ts
  async function handleGrpcSend() {
    if (!url.trim()) return;
    setIsSending(true);
    setGrpcResponse(null);
    try {
      const validation = GrpcProtocol.validateRequest({
        url: interpolate(url),
        service: grpcConfig.service,
        method: grpcConfig.method,
        requestBody: grpcConfig.requestBody
      });
      if (!validation.valid) {
        setGrpcResponse(GrpcProtocol.parseResponse({
          error: validation.errors.join("\n"),
          statusCode: 3
        }));
        return;
      }

      const metadata = grpcConfig.metadata && typeof grpcConfig.metadata === "object"
        ? Object.fromEntries(
            Object.entries(grpcConfig.metadata).map(([k, v]) => [k, interpolate(String(v))])
          )
        : {};

      const payload = GrpcProtocol.buildRequest({
        url: interpolate(url),
        service: grpcConfig.service,
        method: grpcConfig.method,
        requestBody: interpolate(grpcConfig.requestBody || "{}"),
        metadata,
        callType: grpcConfig.callType || "UNARY",
        deadline: grpcConfig.deadline || 30000,
        tls: grpcConfig.tls,
        protoContent: grpcConfig.protoContent || ""
      });

      addLog({ source: "API", type: "info", message: `Sending gRPC ${payload.service}/${payload.method} → ${payload.url}` });

      const raw = await window.api.sendGrpc(payload);
      const result = GrpcProtocol.parseResponse(raw);
      setGrpcResponse(result);

      if (result.error) {
        addLog({ source: "API", type: "error", message: `gRPC Error: ${GrpcProtocol.getStatusName(result.statusCode || 0)}`, data: result.error });
      } else {
        addLog({ source: "API", type: "success", message: `gRPC ${GrpcProtocol.getStatusName(result.statusCode || 0)} (${result.duration || 0}ms)` });
      }
    } catch (err: any) {
      setGrpcResponse(GrpcProtocol.parseResponse({ error: err.message, statusCode: 13 }));
    } finally {
      setIsSending(false);
    }
  }
```

(No change to `handleProtocolSend` — `case "grpc": return handleGrpcSend();` at `src/App.tsx:2509` already routes here. `interpolate`, `addLog`, `setGrpcResponse`, `setIsSending`, `GrpcProtocol` are all already in scope in this component.)

- [ ] **Step 6: Build core (CJS) and confirm the transport is emitted**

Run: `npm run build:core`
Expected: `packages/core/dist/index.js` and `packages/core/dist/transport/grpc.js` exist; build clean. Confirm the export is requireable:

Run: `node -e "const c = require('@portiq/core'); if (typeof c.GrpcTransport !== 'function') throw new Error('GrpcTransport missing from dist'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 7: Confirm the renderer build stays clean (renderer-safety guardrail)**

Run: `npm run build`
Expected: Vite build succeeds with no error about bundling `@grpc/grpc-js` / `node:*` into the renderer. This proves `protocols/grpc.ts` did not pull the native transport into the renderer graph and `transport/grpc.ts` was tree-shaken out (same as `transport/http.ts`/`transport/websocket.ts`).

- [ ] **Step 8: Full suite + lint**

Run: `npm test` — expected: full suite passes (Electron files carry no vitest tests; this confirms no regression).
Run: `npm run lint` — expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/types/global.d.ts src/App.tsx
git commit -m "feat(electron): wire gRPC IPC to @portiq/core GrpcTransport (replace stub)"
```

- [ ] **Step 10: Manual GUI smoke (INTERACTIVE — for the user)**

This step is interactive and left for the user (matches the Phase-0 precedent for `npm run dev`). Because vitest just rebuilt `better-sqlite3` for plain-Node, restore the Electron ABI first:

Run: `npm run rebuild` (restores `better-sqlite3` to the Electron ABI)
Run: `npm run dev`
Then: open a gRPC request, paste a `.proto`, pick `EchoService` / a unary method, point the URL at a reachable gRPC server (or a local one), and Send. Expected: a real status badge (OK / error code) and decoded JSON — no longer the "native transport not yet available" message.

---

## Open Questions & Assumptions

This track carries the spec's open risk: *"gRPC is experimental today (native transport not fully enabled); its CLI/MCP parity depends on that maturing"* (`docs/superpowers/specs/2026-07-23-cli-mcp-access-design.md:224`). Findings, assumptions, and gating:

### Current maturity found in the repo
gRPC could not execute at all before this plan: no transport module, no `@grpc/*` dependency, no Electron IPC handler — the only "send" path (`src/App.tsx handleGrpcSend`) was a hard-coded UNIMPLEMENTED stub. The registry handler (`GrpcProtocol`) and the UI pane existed but had nothing to call. The "native transport not fully enabled" phrasing in the spec is literal.

### Assumptions (buildable now)
- **Library = `@grpc/grpc-js` + `@grpc/proto-loader`.** Assumption: the old native `grpc` package is NOT used. `@grpc/grpc-js` is **pure JavaScript** (implements gRPC over Node's built-in `http2`) and `@grpc/proto-loader` uses protobuf.js — **so no native build and no ABI concern**. This is the crux of "native transport not fully enabled": there is no native addon to enable; the pure-JS stack runs identically on plain-Node (vitest/CLI/MCP) and Electron. This is why the `better-sqlite3` ABI gotcha does not extend to gRPC.
- **Transport not required to be Electron-hosted.** The sender is framework-free core; the Electron main process, and any future CLI/MCP, all call the same `GrpcTransport`.
- **Unary is the primary parity target** (task: "unary calls at minimum") — fully built (Tasks 2–3, 5).
- **Server-streaming is buildable now and scoped IN** (Task 4) as a collect-then-return aggregate, because it fits the one-shot `send(payload) → result` contract that CLI `run` and MCP `run_request` use.
- **Proto loading is scoped IN** (Task 1): from a `.proto` file path or from stored `protoContent` (written to a temp file). The existing regex `parseProtoSchema` remains UI-only; real calls use `@grpc/proto-loader`.

### Deferred / gated on maturity (do NOT implement in this track)
- **Client-streaming and bidi-streaming (`CLIENT_STREAM`, `BIDI_STREAM`).** These require an interactive, stateful send-loop (open call → push N messages over time → observe replies), which does not fit the one-shot execution contract that the generic CLI/MCP run path assumes. The natural home is a stateful manager mirroring `WsManager` (`packages/core/src/transport/websocket.ts`) with its own IPC event channels — a separate, larger effort. Today `GrpcTransport.send` resolves these with `statusCode: 12` (UNIMPLEMENTED) and a clear message. **Gate:** revisit once an interactive streaming surface (like the WS manager's event forwarding) is designed for CLI/MCP.
- **Server reflection** (`grpc.reflection.v1alpha.ServerReflection`). Discovering services without a `.proto` requires an extra dependency (e.g. `grpc-reflection-js`) and, inherently, a live reflection-enabled server — it cannot be exercised by a purely static/offline unit. Proto loading covers the buildable-now need (the UI already has a proto editor / file import). **Gate:** add a reflection loader (feeding the same `loadProto` → client path) when a reflection-enabled test target and the extra dependency are approved.
- **Auth/credentials beyond insecure + default TLS.** `normalizeTarget` supports `grpc://` (insecure unless `tls`) and `grpcs://` (SSL via `grpc.credentials.createSsl()` with system roots). Per-call TLS client certs, custom CA bundles, and call-credential token injection are deferred.

### Dependency on other phases (why "no surface-specific wiring")
There is **no generic executor in `@portiq/core` today** — HTTP/GraphQL/WS/mock are each invoked directly by their own Electron IPC handler. Building that generic executor is Phase 1 (MCP `run_request`) / Phase 2 (CLI `run`/`exec`) work, per the spec's phase order — **not this track**. This track's contribution to "gRPC flows through the generic execution path automatically" is structural and proven by Task 5's parity test: gRPC exposes the identical `ProtocolRegistry` handler + exported transport contract as the other protocols, so the future executor dispatches it by `RequestItem.protocol` with zero gRPC-specific branching. This track adds no bespoke CLI command and no bespoke MCP tool.

---

## Self-Review

**1. Spec / task coverage.**
- "Add/complete a gRPC sender in `packages/core/src/protocols` (grpc), self-registering into the ProtocolRegistry" → the handler self-registers already (`protocols/index.ts:20`); the sender is added in `transport/grpc.ts` (the repo's actual home for senders — `protocols/*.ts` are renderer-safe metadata handlers, `transport/*.ts` are the Node senders). Task 5 forwards `protoContent` through the registered handler so the registry-driven path is complete. Covered (Tasks 1–5).
- "flows through the generic execution path automatically … CLI run/exec and MCP run_request pick it up with NO surface-specific wiring" → proven by the Task-5 parity test that runs registry → buildRequest → transport → parseResponse; documented that the executor itself is Phase 1/2. No bespoke CLI/MCP surface added. Covered.
- "proto loading/reflection, unary at minimum" → proto loading (Task 1), unary (Tasks 2–3, 5); server-stream scoped in (Task 4); reflection explicitly deferred/gated with rationale. Covered.
- "document streaming (client/server/bidi) as scoped-in or explicitly deferred based on what you find" → server-stream IN, client/bidi DEFERRED with repo-grounded rationale (WS-manager analogy). Covered.
- "Rewire any existing electron gRPC seam to the core sender" → Task 6 replaces the `src/App.tsx` stub and adds the missing `grpc:*` IPC + preload + types. Covered.
- "Tests against a local in-process gRPC test server (no external network)" → all tests bind `127.0.0.1:0`. Covered.
- "explicit Open Questions & Assumptions section" → present, with maturity, assumptions, buildable-now vs gated. Covered.
- Global constraints (better-sqlite3 ABI, data-location, additive registry, package boundaries) → baked into Global Constraints and per-task notes. Covered.

**2. Placeholder scan.** No `TODO`/`TBD`/"handle edge cases"/"similar to Task N" — every code step shows complete code; deferred work lives in Open Questions (not as stub tasks). Clean.

**3. Type consistency.** `GrpcSendPayload` / `GrpcSendResult` are defined once (Task 2) and reused verbatim in Tasks 3–6. `GrpcSendResult` fields exactly match what `GrpcProtocol.parseResponse` (`protocols/grpc.ts:122-136`) already reads (`statusCode`, `statusMessage`, `duration`, `metadata`, `trailers`, `body`, `json`, `error`, `messages`), so no `parseResponse` edit is needed. `loadProto` / `findService` / `metadataToObject` signatures (Task 1) are used unchanged in Tasks 2 and 4. `GrpcTransport` constructor/`send`/`cancel` signatures are stable across Tasks 2–6. `buildRequest`'s additive `protoContent`/`protoPath` fields (Task 5) are consumed by the payload type from Task 2. Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase3-parity-grpc.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks (fast iteration). REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

Suggested base commit: `7e7e866` (branch `feat/portiq-core-phase0`). Which approach?
