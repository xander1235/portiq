# Phase 0.5 — Core Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock in three cross-cutting seams that the six parallel Phase 1–3 plans each re-derived — extract one canonical HTTP request-assembly API into `@portiq/core`, add the `require`→`dist` condition to the `./flows` subpath export, and decide one registry convention — so those plans consume a single source of truth instead of birthing divergent copies.

**Architecture:** Add a framework-free `assembleRequest()` to `packages/core/src/exec/assembleRequest.ts`, composed from the Phase-0 primitives already in core (`interpolate`, `getEnvVars`, `MultipartPart`, `HttpSendPayload`) plus the missing pieces (rows→object, auth compile, body-by-type, URL params). It reproduces the renderer's canonical `handleSend` byte-for-byte (proven by a golden test) and is re-exported through the top barrel `@portiq/core` (there is **no** `./exec` subpath — exec helpers ship via `.`). A one-line `package.json` edit makes `@portiq/core/flows` `require()`-able from CommonJS. A short decision section fixes the registry naming rule. No production behavior changes and no downstream plan is rewritten here — only the reusable seam is landed and a delta map is produced.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (`node` environment), npm workspaces, Node globals (`Buffer`, `URLSearchParams`, `TextEncoder`). No new dependencies.

## Global Constraints

- Package name is `@portiq/core`; `"type": "module"`; `"private": true`. NO Electron imports anywhere under `packages/core/**` (no `electron`, `app`, `BrowserWindow`, `ipcMain`, `window.*`, `document`, DOM).
- **Pure / headless:** the extracted request-assembly MUST be framework-free. Renderer-only concerns (the CORS-bypass `window.api.sendRequest` / `safeFetch` path) stay INJECTED at the transport layer, never extracted into `assembleRequest`.
- **Canonical export subpath:** core's `package.json` `exports` map has exactly two entries — `"."` and `"./flows"`. There is **NO `./exec` subpath.** All `exec/*` helpers are surfaced through the top barrel, so the request-assembly contract is imported as `import { assembleRequest } from "@portiq/core"` (NOT `@portiq/core/exec`).
- **better-sqlite3 ABI gotcha:** the hoisted native binary serves EITHER plain-Node (vitest/CLI/MCP) OR Electron, never both. Tests here run on plain-Node — if `better-sqlite3` fails to load, run `npm rebuild better-sqlite3` first; `npm run rebuild` restores the Electron ABI. (Part A/B touch no SQLite, but any full-suite run may transitively load the store tests.)
- **Data-location contract:** resolve storage via `core.resolveDataDir()`; never re-derive a path. (Not exercised by this plan, but downstream consumers of `assembleRequest` MUST still obey it.)
- **Registry pattern:** additive self-registration mirroring `ProtocolRegistry`; no central switchboard, no meta-registry enumerating modules.
- **Result parity:** `assembleRequest` output must be byte-identical to the renderer's `handleSend` assembly (`src/App.tsx:2211-2276`) for the common path; the single deliberate deviation (basic-auth credential interpolation) is documented and tested.
- Test convention (match existing): `import { describe, it, expect } from "vitest";`; import module under test by relative path; `describe` per function, `it` per behavior; no global setup file.
- Commit after every task with a Conventional Commit message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (verified against the actual code)

- **Canonical renderer assembly** (the thing being extracted): `src/App.tsx`
  - `handleSend()` payload build — `:2211-2276` (body-by-type at `:2221-2266`, final payload at `:2267-2276`).
  - `parseHeaders()` — `:1269-1289` (headersText JSON wins over table rows; auth merged UNDER manual: `{ ...authHeaders, ...parsed }`).
  - `getCompiledAuthHeaders()` — `:1291-1309` (none/bearer/basic(`btoa`)/api_key-header/custom).
  - `getCompiledAuthParams()` — `:1311-1316` (api_key-query only).
  - `rowsToObject()` — `:1831-1836` (keys AND values interpolated by default).
  - `stripJsonComments()` — `:1912-1916`.
  - `buildUrlWithParams()` — `:1918-1941` (host:port slash fix; manual `encodeURIComponent` join, NOT `URLSearchParams`; auth query params appended).
- **Core primitives to REUSE (already landed in Phase 0):**
  - `packages/core/src/exec/interpolate.ts` — `getEnvVars(env)`, `interpolate<T>(value, vars)`.
  - `packages/core/src/exec/multipart.ts` — `type MultipartPart` (`{ kind:"file"|"text"; ... }`), `buildMultipartBody`.
  - `packages/core/src/exec/headers.ts` — `HeaderRow`, `applyBodyContentType`, `BODY_CONTENT_TYPES`, `hasHeader` (not needed by assembly, but the exec home).
  - `packages/core/src/transport/http.ts` — `interface HttpSendPayload { requestId?; method; url; headers?; body?; timeoutMs?; httpVersion?: "auto"|"1.1"|"2"; multipartParts?: MultipartPart[] }` (the RETURN contract).
  - `packages/core/src/model/request.ts` — `RequestItem`, `RequestRow`, `AuthConfig`.
- **Downstream local re-implementations this supersedes:**
  - MCP `packages/mcp/src/exec/resolveHttpSend.ts` (plan `2026-07-24-phase1-portiq-mcp-server.md` Task 4).
  - CLI `packages/cli/src/resolve/httpPayload.ts` (plan `2026-07-24-phase2-portiq-cli.md` Task 8).
- **`./flows` export follow-up:** `.superpowers/sdd/progress.md` Phase-1 follow-up #4 ("`@portiq/core/flows` subpath has no require/dist mapping — add `{import,require}` when a CJS consumer appears"). CLI plan Task 2 and MCP plan Task 1 Step 5 both do this independently.
- **Current `exports` map** (`packages/core/package.json`): `"."` = `{import: ./src/index.ts, require: ./dist/index.js}`; `"./flows"` = `"./src/flows/index.ts"` (string, src-only). `dist/flows/index.js` is emitted by `npm run build:core` (confirmed present).
- **Registry to mirror:** `packages/core/src/protocols/registry.ts` (`ProtocolRegistryClass` + singleton `export const ProtocolRegistry`), self-registered via `packages/core/src/protocols/index.ts:17-20`.

---

## Part A — Request-assembly extraction

### Divergences the canonical API resolves (why one source of truth matters)

The renderer's `handleSend` is the canonical behavior. The two downstream ports drifted from it and from each other:

| Concern | Renderer (canonical) | CLI port (`resolveHttpPayload`) | MCP port (`resolveHttpSend`) |
|---|---|---|---|
| Header source precedence | `headersText` JSON **wins**, rows fallback | headersText wins ✓ | **rows win** ✗ |
| JSON body comments | `stripJsonComments` then parse | strips ✓ | **does NOT strip** ✗ |
| URL query encoding | manual `encodeURIComponent` (space→`%20`) + host:port slash fix | manual `encodeURIComponent` + slash fix ✓ | **`URLSearchParams`** (space→`+`), **no slash fix** ✗ |
| Header key/value interpolation | keys raw, values interpolated | keys raw, values interpolated (except api_key header key) | keys raw, values interpolated (except api_key header key) |
| basic-auth base64 | `btoa` of **raw** template (latent bug) | `Buffer.from` of interpolated creds | `btoa` of interpolated creds |

Extracting `assembleRequest` from the renderer's behavior therefore **fixes three latent MCP divergences for free** and unifies the CLI. The one place core deliberately deviates from the renderer is basic-auth: core interpolates credentials **before** base64-encoding them (the renderer base64s the raw `{{template}}` because its `parseHeaders` calls `getCompiledAuthHeaders` with an identity `valFn`, and the later value-interpolation pass cannot reach inside a base64 blob). This deviation is correct, matches both downstream ports, and is documented + tested (Task 2).

### Chosen contract (the exact API downstream consumes)

```ts
// import { assembleRequest, type AssemblableRequest, type AssembleRequestOptions,
//          resolveVars, stripJsonComments, InvalidJsonBodyError } from "@portiq/core";

export type AssemblableRequest = Pick<
  RequestItem,
  | "protocol" | "method" | "url" | "headersText" | "headersRows" | "paramsRows"
  | "authType" | "authConfig" | "authRows" | "bodyType" | "bodyText" | "bodyRows"
  | "httpVersion" | "requestTimeoutMs"
>;

export interface AssembleRequestOptions {
  env?: Environment | null;              // enabled vars seed interpolation
  vars?: Record<string, string>;         // overrides layered on top of env (CLI --var / MCP overrides)
  requestId?: string;                    // echoed into payload for cancellation
  timeoutMs?: number;                    // overrides item.requestTimeoutMs when set
}

export function assembleRequest(req: AssemblableRequest, opts?: AssembleRequestOptions): HttpSendPayload;
```

`HttpSendPayload` is the existing core type (`transport/http.ts`), already re-exported from `@portiq/core`. This is exactly the shape both downstream ports build today, so they can delete their copies and delegate.

---

## Task 1: `exec/assembleRequest.ts` — the canonical HTTP assembler

**Files:**
- Create: `packages/core/src/exec/assembleRequest.ts`
- Create: `packages/core/src/exec/assembleRequest.test.ts`
- Modify: `packages/core/src/index.ts` (add one barrel export line)

**Interfaces:**
- Consumes: `getEnvVars`, `interpolate` from `./interpolate`; `Environment`, `RequestItem`, `RequestRow`, `AuthConfig` (type) from `../model`; `MultipartPart` (type) from `./multipart`; `HttpSendPayload` (type) from `../transport/http`. All value-imports are pure; `HttpSendPayload`, `MultipartPart`, `AuthConfig`, `RequestItem`, `RequestRow`, `Environment` are `import type` (erased — keeps `node:http` out of any renderer bundle).
- Produces (all re-exported from `@portiq/core`):
  - `type AssemblableRequest` — the `Pick<RequestItem, …>` above.
  - `interface AssembleRequestOptions { env?; vars?; requestId?; timeoutMs? }`.
  - `class InvalidJsonBodyError extends Error` (`name = "InvalidJsonBodyError"`).
  - `resolveVars(env, overrides?): Record<string,string>` — `{ ...getEnvVars(env), ...overrides }`.
  - `stripJsonComments(text): string` — faithful port of `src/App.tsx:1912-1916`.
  - `assembleRequest(req, opts?): HttpSendPayload` — the composed assembler.

- [ ] **Step 1: Write the failing test `packages/core/src/exec/assembleRequest.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  assembleRequest,
  resolveVars,
  stripJsonComments,
  InvalidJsonBodyError,
  type AssemblableRequest,
} from "./assembleRequest";
import type { Environment } from "../model";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [
    { key: "baseUrl", value: "https://api.test", comment: "", enabled: true },
    { key: "token", value: "sekret", comment: "", enabled: true },
    { key: "disabled", value: "nope", comment: "", enabled: false },
  ],
};

const base = (over: Partial<AssemblableRequest> = {}): AssemblableRequest => ({
  protocol: "http", method: "get", url: "{{baseUrl}}/users", bodyType: "none",
  ...over,
});

describe("resolveVars", () => {
  it("overlays overrides on enabled env vars", () => {
    expect(resolveVars(env, { token: "override" }))
      .toEqual({ baseUrl: "https://api.test", token: "override" });
  });
  it("returns overrides only when env is null", () => {
    expect(resolveVars(null, { a: "1" })).toEqual({ a: "1" });
  });
});

describe("stripJsonComments", () => {
  it("removes // and /* */ comments", () => {
    expect(stripJsonComments('{"a":1} // x')).toContain('{"a":1}');
    expect(stripJsonComments("{/* c */}")).toBe("{}");
  });
});

describe("assembleRequest", () => {
  it("interpolates the url and uppercases the method", () => {
    const p = assembleRequest(base(), { env });
    expect(p.method).toBe("GET");
    expect(p.url).toBe("https://api.test/users");
    expect(p.httpVersion).toBe("auto");
  });

  it("compiles bearer auth into an Authorization header (value interpolated)", () => {
    const p = assembleRequest(base({
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
    }), { env });
    expect(p.headers?.Authorization).toBe("Bearer sekret");
  });

  it("appends api_key query auth to the url", () => {
    const p = assembleRequest(base({
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "k", value: "{{token}}", add_to: "query" } },
    }), { env });
    expect(p.url).toBe("https://api.test/users?k=sekret");
  });

  it("lets manual headers win over auth headers (headersText JSON precedence)", () => {
    const p = assembleRequest(base({
      headersText: '{"Authorization":"manual"}',
      headersRows: [{ key: "X-Ignored", value: "1", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "x" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
    }), { env });
    expect(p.headers?.Authorization).toBe("manual");
    expect(p.headers?.["X-Ignored"]).toBeUndefined(); // headersText wins, rows ignored
  });

  it("uses table rows when headersText is empty (keys raw, values interpolated)", () => {
    const p = assembleRequest(base({
      headersRows: [{ key: "X-Token", value: "{{token}}", comment: "", enabled: true }],
    }), { env });
    expect(p.headers?.["X-Token"]).toBe("sekret");
  });

  it("compacts a json body, stripping comments", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "json", bodyText: '{\n  "a": "{{token}}" // note\n}',
    }), { env });
    expect(p.body).toBe('{"a":"sekret"}');
  });

  it("throws InvalidJsonBodyError on a malformed json body", () => {
    expect(() => assembleRequest(base({ method: "POST", bodyType: "json", bodyText: "{ not json" }), { env }))
      .toThrow(InvalidJsonBodyError);
  });

  it("builds a form body with URLSearchParams", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "form",
      bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
    }), { env });
    expect(p.body).toBe("a=1&b=sekret");
  });

  it("builds multipart parts and leaves body undefined", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "multipart",
      bodyRows: [{ key: "field", value: "{{token}}", comment: "", enabled: true, kind: "text" }],
    }), { env });
    expect(p.multipartParts).toEqual([{ kind: "text", name: "field", value: "sekret" }]);
    expect(p.body).toBeUndefined();
  });

  it("encodes spaces in query params as %20 (not +) and fixes a missing host:port slash", () => {
    const p = assembleRequest(base({
      url: "https://api.test:8080users",
      paramsRows: [{ key: "q", value: "a b", comment: "", enabled: true }],
    }), { env });
    expect(p.url).toBe("https://api.test:8080/users?q=a%20b");
  });

  it("carries requestId, timeoutMs override and httpVersion through", () => {
    const p = assembleRequest(base({ requestTimeoutMs: 5000, httpVersion: "2" }), { env, requestId: "abc", timeoutMs: 9000 });
    expect(p.requestId).toBe("abc");
    expect(p.timeoutMs).toBe(9000);
    expect(p.httpVersion).toBe("2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/core/src/exec/assembleRequest.test.ts`
Expected: FAIL — cannot find module `./assembleRequest`.

- [ ] **Step 3: Implement `packages/core/src/exec/assembleRequest.ts`**

```ts
import { getEnvVars, interpolate } from "./interpolate";
import type { Environment, RequestItem, RequestRow } from "../model";
import type { MultipartPart } from "./multipart";
import type { HttpSendPayload } from "../transport/http";

/** The subset of a stored RequestItem needed to assemble an HTTP send. A full
 *  RequestItem satisfies it, as does a hand-built ad-hoc request (CLI `exec`). */
export type AssemblableRequest = Pick<
  RequestItem,
  | "protocol" | "method" | "url" | "headersText" | "headersRows" | "paramsRows"
  | "authType" | "authConfig" | "authRows" | "bodyType" | "bodyText" | "bodyRows"
  | "httpVersion" | "requestTimeoutMs"
>;

export interface AssembleRequestOptions {
  /** Environment whose enabled vars seed interpolation. */
  env?: Environment | null;
  /** Overrides layered on top of env vars (overrides win). */
  vars?: Record<string, string>;
  /** Correlation id echoed into the payload for cancellation. */
  requestId?: string;
  /** Overrides item.requestTimeoutMs when provided. */
  timeoutMs?: number;
}

export class InvalidJsonBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

/** Merge enabled env vars with explicit overrides (overrides win). */
export function resolveVars(
  env: Environment | null | undefined,
  overrides?: Record<string, string>,
): Record<string, string> {
  return { ...getEnvVars(env), ...(overrides ?? {}) };
}

/** Faithful port of the renderer's stripJsonComments (src/App.tsx:1912-1916). */
export function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Auth headers with RAW values, mirroring the renderer's
 *  getCompiledAuthHeaders(..., identity) call inside parseHeaders (values are
 *  interpolated later, in assembleHeaders). The one deliberate deviation is
 *  `basic`: credentials are interpolated BEFORE base64 (the renderer base64s the
 *  raw template — a latent bug the later value-interpolation cannot fix because
 *  {{ }} inside a base64 blob is unreachable). See assembleRequest.parity.test.ts. */
function compileAuthHeaders(req: AssemblableRequest, vars: Record<string, string>): Record<string, string> {
  const type = req.authType ?? "none";
  const cfg = req.authConfig;
  if (type === "none" || !cfg) return {};
  if (type === "bearer" && cfg.bearer?.token) {
    return { Authorization: `Bearer ${cfg.bearer.token}` };
  }
  if (type === "basic" && (cfg.basic?.username || cfg.basic?.password)) {
    const creds = `${interpolate(cfg.basic.username ?? "", vars)}:${interpolate(cfg.basic.password ?? "", vars)}`;
    return { Authorization: `Basic ${Buffer.from(creds).toString("base64")}` };
  }
  if (type === "api_key" && cfg.api_key?.add_to === "header" && cfg.api_key.key) {
    return { [cfg.api_key.key]: cfg.api_key.value };
  }
  if (type === "custom") {
    const out: Record<string, string> = {};
    for (const row of req.authRows ?? []) {
      if (row.key && row.enabled !== false) out[row.key] = row.value;
    }
    return out;
  }
  return {};
}

/** api_key query params — keys AND values interpolated (matches buildUrlWithParams). */
function compileAuthParams(req: AssemblableRequest, vars: Record<string, string>): Record<string, string> {
  const cfg = req.authConfig;
  if (req.authType === "api_key" && cfg?.api_key?.add_to === "query" && cfg.api_key.key) {
    return { [interpolate(cfg.api_key.key, vars)]: interpolate(cfg.api_key.value, vars) };
  }
  return {};
}

/** Mirror renderer parseHeaders (App.tsx:1269-1289) + handleSend's final
 *  value-interpolation (App.tsx:2271): headersText JSON wins over table rows;
 *  auth headers merge UNDER manual headers; keys stay raw, values interpolated. */
function assembleHeaders(req: AssemblableRequest, vars: Record<string, string>): Record<string, string> {
  const rowsFallback = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const row of req.headersRows ?? []) {
      if (row.key && row.enabled !== false) out[row.key] = row.value;
    }
    return out;
  };
  let parsed: Record<string, string>;
  const text = req.headersText;
  if (text && text.trim().length > 0) {
    try {
      const j = JSON.parse(text) as unknown;
      parsed = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, string>) : {};
    } catch {
      parsed = rowsFallback();
    }
  } else {
    parsed = rowsFallback();
  }
  const merged = { ...compileAuthHeaders(req, vars), ...parsed };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) out[k] = interpolate(String(v), vars);
  return out;
}

/** Mirror renderer buildUrlWithParams (App.tsx:1918-1941): host:port slash fix,
 *  manual encodeURIComponent join (NOT URLSearchParams), auth query params
 *  appended; keys and values interpolated. */
function assembleUrl(req: AssemblableRequest, vars: Record<string, string>): string {
  let base = interpolate(req.url ?? "", vars);
  base = base.replace(/^(https?:\/\/[a-zA-Z0-9.-]+:\d+)([a-zA-Z_\-~])/i, "$1/$2");
  const active: RequestRow[] = [...(req.paramsRows ?? [])];
  for (const [k, v] of Object.entries(compileAuthParams(req, vars))) {
    active.push({ key: k, value: v, comment: "", enabled: true });
  }
  const query = active
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => `${encodeURIComponent(interpolate(r.key, vars))}=${encodeURIComponent(interpolate(r.value ?? "", vars))}`)
    .join("&");
  if (!query) return base;
  return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
}

/** Mirror handleSend body-by-type (App.tsx:2221-2266). Throws InvalidJsonBodyError. */
function assembleBody(req: AssemblableRequest, vars: Record<string, string>): { body?: string; multipartParts?: MultipartPart[] } {
  const bt = req.bodyType ?? "none";
  if (bt === "none") return { body: undefined };
  if (bt === "json") {
    const stripped = stripJsonComments(interpolate(req.bodyText ?? "", vars));
    if (!stripped.trim()) return { body: "" };
    try {
      return { body: JSON.stringify(JSON.parse(stripped)) };
    } catch (err) {
      throw new InvalidJsonBodyError(`Invalid JSON body: ${(err as Error).message}`);
    }
  }
  if (bt === "form") {
    const data: Record<string, string> = {};
    for (const r of req.bodyRows ?? []) {
      if (r.key && r.enabled !== false) data[interpolate(r.key, vars)] = interpolate(r.value ?? "", vars);
    }
    return { body: new URLSearchParams(data).toString() };
  }
  if (bt === "multipart") {
    const parts: MultipartPart[] = (req.bodyRows ?? [])
      .filter((r) => r.key && r.enabled !== false)
      .map((r) =>
        r.kind === "file"
          ? {
              kind: "file",
              name: interpolate(r.key, vars),
              filename: r.fileName || "upload.bin",
              contentType: r.mimeType || "application/octet-stream",
              dataBase64: r.fileBase64 || "",
            }
          : { kind: "text", name: interpolate(r.key, vars), value: interpolate(r.value ?? "", vars) },
      );
    return { multipartParts: parts };
  }
  // xml / raw / anything else → interpolated text body
  return { body: interpolate(req.bodyText ?? "", vars) };
}

/** Assemble a stored HTTP request model into a normalized core HttpSendPayload
 *  (method, url, headers, body/multipart, auth applied). Framework-free: no
 *  window/DOM/Electron/IPC. Covers protocol "http" (and empty/undefined);
 *  GraphQL/WebSocket/gRPC are assembled by their own transports. */
export function assembleRequest(req: AssemblableRequest, opts: AssembleRequestOptions = {}): HttpSendPayload {
  const vars = resolveVars(opts.env, opts.vars);
  const { body, multipartParts } = assembleBody(req, vars);
  return {
    requestId: opts.requestId,
    method: (req.method || "GET").toUpperCase(),
    url: assembleUrl(req, vars),
    headers: assembleHeaders(req, vars),
    body,
    multipartParts,
    timeoutMs: opts.timeoutMs ?? req.requestTimeoutMs,
    httpVersion: (req.httpVersion as HttpSendPayload["httpVersion"]) || "auto",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/core/src/exec/assembleRequest.test.ts`
Expected: PASS (14 assertions across the described `it` blocks).

- [ ] **Step 5: Re-export from the top barrel**

Add to `packages/core/src/index.ts` immediately after the line `export * from "./exec/multipart";`:

```ts
export * from "./exec/assembleRequest";
```

- [ ] **Step 6: Verify no barrel collisions and lint clean**

Run: `npm test -- packages/core/src` (full core suite still green — proves no duplicate-export break in the flat barrel)
Run: `npm run lint`
Expected: core suite green; no NEW eslint errors in `packages/core` (pre-existing 51 react-hooks warnings elsewhere are tolerated).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/exec/assembleRequest.ts packages/core/src/exec/assembleRequest.test.ts packages/core/src/index.ts
git commit -m "feat(core): canonical assembleRequest (rows/auth/body/params) for HTTP sends"
```

---

## Task 2: Golden parity test — `assembleRequest` is byte-identical to the renderer

**Files:**
- Create: `packages/core/src/exec/assembleRequest.parity.test.ts`

**Interfaces:**
- Consumes: `assembleRequest`, `type AssemblableRequest` from `./assembleRequest`; `interpolate` from `./interpolate`.
- Produces: no exports (test only). Contains a local `rendererAssemble(model, vars)` fixture that reproduces `src/App.tsx` `handleSend` + its helpers VERBATIM (cited line ranges), using core's `interpolate` (the faithful Phase-0 extraction of the renderer's own `interpolate`). Asserts `assembleRequest` deep-equals the fixture on `{ method, url, headers, body, multipartParts, httpVersion, timeoutMs }` for a representative request, and documents the single intentional basic-auth deviation.

- [ ] **Step 1: Write the failing test `packages/core/src/exec/assembleRequest.parity.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { assembleRequest, type AssemblableRequest } from "./assembleRequest";
import { interpolate as coreInterpolate } from "./interpolate";

/**
 * Verbatim reproduction of src/App.tsx handleSend (:2211-2276) + its helpers
 * parseHeaders (:1269-1289), getCompiledAuthHeaders (:1291-1309),
 * getCompiledAuthParams (:1311-1316), rowsToObject (:1831-1836),
 * stripJsonComments (:1912-1916), buildUrlWithParams (:1918-1941).
 * interpolate is the same primitive core extracted from the renderer.
 * Used ONLY to prove byte-identical parity of the extracted assembler.
 */
function rendererAssemble(m: AssemblableRequest, vars: Record<string, string>) {
  const interpolate = (v: string) => coreInterpolate(v, vars);

  const rowsToObject = (rows: any[], interpolateValues = true) => {
    const val = (v: string) => (interpolateValues ? interpolate(v) : v);
    return (rows || [])
      .filter((row: any) => row.key && row.enabled !== false)
      .reduce((acc: any, row: any) => ({ ...acc, [val(row.key)]: val(row.value) }), {});
  };

  const getCompiledAuthHeaders = (type: string, config: any, customRows: any[], valFn: (v: string) => string): Record<string, string> => {
    if (type === "none") return {};
    if (type === "bearer" && config.bearer?.token) return { Authorization: `Bearer ${valFn(config.bearer.token)}` };
    if (type === "basic" && (config.basic?.username || config.basic?.password)) {
      const creds = `${valFn(config.basic.username)}:${valFn(config.basic.password)}`;
      return { Authorization: `Basic ${btoa(creds)}` };
    }
    if (type === "api_key" && config.api_key?.add_to === "header" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    if (type === "custom") {
      return (customRows || [])
        .filter((row: any) => row.key && row.enabled !== false)
        .reduce((acc: any, row: any) => ({ ...acc, [valFn(row.key)]: valFn(row.value) }), {});
    }
    return {};
  };

  const getCompiledAuthParams = (type: string, config: any, valFn: (v: string) => string): Record<string, string> => {
    if (type === "api_key" && config.api_key?.add_to === "query" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    return {};
  };

  const parseHeaders = () => {
    let parsed: any;
    try {
      if (m.headersText && m.headersText.trim().length > 0) parsed = JSON.parse(m.headersText);
      else parsed = (m.headersRows || []).filter((r: any) => r.key && r.enabled !== false).reduce((a: any, r: any) => ({ ...a, [r.key]: r.value }), {});
    } catch {
      parsed = (m.headersRows || []).filter((r: any) => r.key && r.enabled !== false).reduce((a: any, r: any) => ({ ...a, [r.key]: r.value }), {});
    }
    const authHeaders = getCompiledAuthHeaders(m.authType as string, m.authConfig, m.authRows as any[], (v: string) => v);
    return { ...authHeaders, ...parsed };
  };

  const stripJsonComments = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const buildUrlWithParams = () => {
    const val = (v: string) => interpolate(v);
    let base = val(m.url || "");
    base = base.replace(/^(https?:\/\/[a-zA-Z0-9.-]+:\d+)([a-zA-Z_\-~])/i, "$1/$2");
    const activeParams = [...((m.paramsRows as any[]) || [])];
    const authParams = getCompiledAuthParams(m.authType as string, m.authConfig, val);
    Object.entries(authParams).forEach(([k, v]) => activeParams.push({ key: k, value: v as string, enabled: true, comment: "" }));
    if (!activeParams.length) return base;
    const query = activeParams
      .filter((r: any) => r.key && r.enabled !== false)
      .map((r: any) => `${encodeURIComponent(val(r.key))}=${encodeURIComponent(val(r.value || ""))}`)
      .join("&");
    if (!query) return base;
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  };

  const headers = parseHeaders();
  let body: any = m.bodyType === "none" ? undefined : m.bodyText;
  let multipartParts: any;
  if (m.bodyType === "json") {
    const s = stripJsonComments(interpolate(m.bodyText || ""));
    body = s.trim() ? JSON.stringify(JSON.parse(s)) : "";
  }
  if (m.bodyType === "form") body = new URLSearchParams(rowsToObject(m.bodyRows as any[])).toString();
  if (m.bodyType === "multipart") {
    multipartParts = ((m.bodyRows as any[]) || [])
      .filter((r: any) => r.key && r.enabled !== false)
      .map((r: any) =>
        r.kind === "file"
          ? { kind: "file", name: interpolate(r.key), filename: r.fileName || "upload.bin", contentType: r.mimeType || "application/octet-stream", dataBase64: r.fileBase64 || "" }
          : { kind: "text", name: interpolate(r.key), value: interpolate(r.value || "") },
      );
    body = undefined;
  }
  if (m.bodyType === "xml") body = interpolate(m.bodyText || "");
  if (m.bodyType === "raw") body = interpolate(m.bodyText || "");

  return {
    method: m.method,
    url: buildUrlWithParams(),
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v as string)])),
    body,
    multipartParts,
    httpVersion: m.httpVersion,
    timeoutMs: m.requestTimeoutMs,
  };
}

const vars = { baseUrl: "https://api.test", token: "sekret", q: "search me" };

function pick(p: ReturnType<typeof assembleRequest>) {
  return { method: p.method, url: p.url, headers: p.headers, body: p.body, multipartParts: p.multipartParts, httpVersion: p.httpVersion, timeoutMs: p.timeoutMs };
}

describe("golden parity: assembleRequest == renderer handleSend", () => {
  it("matches for a templated url + params + bearer + headers + json body", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "POST", url: "{{baseUrl}}:8443api/items",
      headersText: '{"X-Trace":"{{token}}","Accept":"application/json"}',
      paramsRows: [{ key: "q", value: "{{q}}", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "json", bodyText: '{\n  "id": "{{token}}" // trailing\n}',
      httpVersion: "1.1", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for api_key query auth + form body + host:port slash fix", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "POST", url: "https://api.test:8080submit",
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "apikey", value: "{{token}}", add_to: "query" } },
      bodyType: "form",
      bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
      httpVersion: "auto", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for multipart body + table-row headers fallback", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "PUT", url: "{{baseUrl}}/upload",
      headersRows: [{ key: "X-Env", value: "{{token}}", comment: "", enabled: true }],
      bodyType: "multipart",
      bodyRows: [{ key: "field", value: "{{token}}", comment: "", enabled: true, kind: "text" }],
      httpVersion: "auto", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for literal basic-auth credentials (byte-identical base64)", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "GET", url: "https://api.test/",
      authType: "basic",
      authConfig: { bearer: { token: "" }, basic: { username: "alice", password: "pa55" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "none", httpVersion: "auto", requestTimeoutMs: 30000,
    };
    // Buffer.from("alice:pa55").toString("base64") === btoa("alice:pa55") for ASCII.
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });
});

describe("documented deviation: basic-auth credential interpolation (core fixes a renderer bug)", () => {
  it("interpolates {{var}} credentials BEFORE base64 (the renderer base64s the raw template)", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "GET", url: "https://api.test/",
      authType: "basic",
      authConfig: { bearer: { token: "" }, basic: { username: "{{token}}", password: "pw" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "none", httpVersion: "auto", requestTimeoutMs: 30000,
    };
    const core = assembleRequest(model, { vars });
    expect(core.headers?.Authorization).toBe(`Basic ${Buffer.from("sekret:pw").toString("base64")}`);
    // The renderer would emit Basic <base64 of "{{token}}:pw"> — the latent bug core intentionally fixes.
    expect(core.headers?.Authorization).not.toBe(rendererAssemble(model, vars).headers.Authorization);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- packages/core/src/exec/assembleRequest.parity.test.ts`
Expected: PASS (5 `it` blocks). If a golden `toEqual` fails, the extracted assembler diverges from the renderer — STOP and reconcile `assembleRequest.ts` against `src/App.tsx` before proceeding (do NOT weaken the assertion).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/exec/assembleRequest.parity.test.ts
git commit -m "test(core): golden parity — assembleRequest matches renderer handleSend byte-for-byte"
```

---

## Part B — `./flows` export fix

## Task 3: Map `@portiq/core/flows` `require`→`dist` for CJS consumers

**Files:**
- Modify: `packages/core/package.json` (`exports["./flows"]`)

**Interfaces:**
- Produces: `require("@portiq/core/flows")` resolves to `./dist/flows/index.js` (built CJS: CLI bin, MCP bin, `electron/main.cjs`); `import "@portiq/core/flows"` still resolves to `./src/flows/index.ts` for vitest/editor. No logic/API change. This is the seam both the MCP plan (Task 1 Step 5) and the CLI plan (Task 2) each schedule independently; landing it here turns both into no-ops (see Part D).

- [ ] **Step 1: Build core and confirm the dist target exists**

Run: `npm run build:core`
Run: `node -e "require('fs').accessSync('packages/core/dist/flows/index.js'); console.log('flows dist present')"`
Expected: `flows dist present`. (`tsconfig.build.json` has `rootDir: src`, `outDir: dist`, `module: CommonJS` and excludes `**/*.test.ts`, so `dist/flows/index.js` is emitted.) If missing, STOP — the core build config changed and this task's assumption is invalid.

- [ ] **Step 2: Write a failing require check**

Run: `node -e "require('@portiq/core/flows')"`
Expected: FAIL — `ERR_PACKAGE_PATH_NOT_EXPORTED` or a TS-source require error, because `exports["./flows"]` currently points only at `./src/flows/index.ts` (a `.ts` file Node's CJS loader cannot require).

- [ ] **Step 3: Update `packages/core/package.json` `exports`**

Change:

```json
    "./flows": "./src/flows/index.ts"
```

to:

```json
    "./flows": {
      "import": "./src/flows/index.ts",
      "require": "./dist/flows/index.js"
    }
```

- [ ] **Step 4: Verify the require now resolves and the key symbols are present**

Run: `node -e "const f = require('@portiq/core/flows'); if (typeof f.runFlow !== 'function') throw new Error('runFlow missing'); if (typeof f.savedRequestToConfig !== 'function') throw new Error('savedRequestToConfig missing'); if (typeof f.buildSendPayload !== 'function') throw new Error('buildSendPayload missing'); console.log('flows require ok')"`
Expected: `flows require ok`. (`runFlow` from `flows/engine`, `savedRequestToConfig` from `flows/linkResolve`, `buildSendPayload` from `flows/buildRequest` — all confirmed exported by `flows/index.ts`.)

- [ ] **Step 5: Confirm vitest still resolves the `import`→src condition**

Run: `npm test -- packages/core/src`
Expected: full core suite green (flows tests use the `import`→`./src/flows/index.ts` condition; unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json
git commit -m "chore(core): map @portiq/core/flows require to dist for CJS consumers"
```

---

## Part C — Registry convention (decision, not a TDD task)

**Decision:** Keep **per-domain, self-registering registries that mirror the existing `ProtocolRegistry`.** Do NOT introduce a meta-`CapabilityRegistry`.

### The rule

A domain gets its own registry **only when it has 2+ interchangeable implementations selected at runtime by a string `id`.** Otherwise it stays a plain module/factory (a registry of one is YAGNI). Every registry MUST follow the `ProtocolRegistry` shape and integrate by additive self-registration — never by editing a shared switchboard.

- **Naming:** singleton `PascalCase` named `<Domain>Registry` (e.g. `ProtocolRegistry`, `AIProviderRegistry`, `SyncRemoteRegistry`); backing class `<Domain>RegistryClass`; entries keyed by a string `id`.
- **Method surface (mirror `packages/core/src/protocols/registry.ts`):** `register(x)` (throws on empty `id`; `console.warn` + overwrite on duplicate), `get(id): X | null`, `getAll(): X[]`, `getIds(): string[]`, `unregister(id)`. Add domain-specific lookups only when needed (e.g. `ProtocolRegistry.detectFromUrl`).
- **File / side-effect pattern:** implementations live in their own directory (`<domain>/`); the domain's `index.ts` performs the registration side-effect on import (`import { X } from "./x"; <Domain>Registry.register(X);`), exactly as `protocols/index.ts:17-20` does. Consumers obtain implementations by importing the module (which triggers registration). There is **no** central index enumerating modules — this is what keeps the Phase-3 tracks additive and merge-independent.

### Per-track verdicts

| Track | Registry | Verdict | Rationale |
|---|---|---|---|
| gRPC | `ProtocolRegistry` (existing) | **KEEP — no new registry** | gRPC is one more protocol; it self-registers into `ProtocolRegistry` (line already exists at `protocols/index.ts:20`). The native sender lives in `transport/grpc.ts`; the renderer-safe handler stays in `protocols/grpc.ts`. Already conforms. |
| AI assist | `AIProviderRegistry` (new) | **KEEP** | Genuinely 2+ interchangeable implementations (`openai`, `anthropic`, `gemini`) chosen by id. Mirrors `ProtocolRegistry`; providers self-register in `ai/index.ts`. Legitimate. |
| Git sync | `SyncRemoteRegistry` (new) | **KEEP** | Genuinely 2+ implementations (`github`, `local`) behind a `SyncRemote` port, selected by id. Conforms. |
| Mock server | `CapabilityRegistry` (proposed) | **DROP** | Mock is a **single** manager already living in `transport/mock.ts` (`MockServerManager`). There is exactly one implementation and no runtime selection by id, so a registry is unwarranted (a registry of one). Keep the mock as a plain module exposing a `createMockManager()` factory; if the mock plan relocates it into `mock/`, that is fine, but it self-registers into **nothing** and no `CapabilityRegistry` is created. The spec's "module registry" note is already satisfied by the per-domain registries above (`Protocol`/`AIProvider`/`SyncRemote`), which are exactly the "how `flows`/`mock`/`sync`/`grpc`/`ai` self-register" pattern the spec asked for. |

**Net:** three registries total (`ProtocolRegistry`, `AIProviderRegistry`, `SyncRemoteRegistry`) — all identical in shape — plus plain factories for single-implementation domains (mock, flows engine). No fourth style, no `CapabilityRegistry`.

---

## Part D — Downstream integration map (deltas only; do NOT rewrite the other plans)

Each row is a patch the coordinator applies to the named plan once Phase 0.5 lands. Nothing else in those plans changes.

| # | Plan / Task | Delta |
|---|---|---|
| 1 | MCP `2026-07-24-phase1-portiq-mcp-server.md` **Task 4** (`exec/resolveHttpSend.ts`) | **Delete the local bridge.** Replace with `import { assembleRequest } from "@portiq/core"`; call `assembleRequest(item, { env, vars, requestId })`. Its `resolveHttpSend`/`mergeVars`/`rowsToObject`/`compileAuth*`/`buildUrl`/`buildBody` and Task-4 tests are superseded by core. This silently FIXES MCP's three divergences (header precedence, missing comment-strip, `URLSearchParams` query encoding). Keep a ≤1 test that the tool wiring passes options through. |
| 2 | MCP **Task 5** (`exec/run.ts`) | Swap the internal `resolveHttpSend(item, …)` call for `assembleRequest(item, …)`. Dispatch-by-protocol, scripts, and test summarization are unchanged. `InvalidJsonBodyError` from core → convert to the existing tool-error shape (was already a throw). |
| 3 | MCP **Architecture note + Task 1 Step 5** (add `require`/`dist` to `./flows`) | **Superseded by Part B.** The "exactly ONE cross-package edit" to `packages/core/package.json` is already applied; Task 1 Step 5 becomes a verify-only step (`node -e "require('@portiq/core/flows')"`), not an edit. Update the Global-Constraints sentence that reserves that edit. |
| 4 | CLI `2026-07-24-phase2-portiq-cli.md` **Task 8** (`resolve/httpPayload.ts`) | **Collapse to a thin wrapper.** `type ResolvableRequest = AssemblableRequest` (alias core's type). `resolveHttpPayload(req, vars, opts)` becomes: `const payload = assembleRequest(req, { vars, requestId: opts?.requestId, timeoutMs: opts?.timeoutMs }); const view: ExecRequestView = { protocol: req.protocol||"http", method: payload.method, url: payload.url, headers: payload.headers??{}, body: payload.body }; return { payload, view };`. Re-export `stripJsonComments` from `@portiq/core` (drop the local copy). Map core's `InvalidJsonBodyError` → `UsageError`. Task-8 unit tests stay (they now exercise the wrapper + core). |
| 5 | CLI **Task 2** (map `./flows` require→dist) | **Superseded by Part B** (identical edit). Convert Task 2 to verify-only (Steps 1/4/5 as checks); drop the Step-3 edit and the commit. |
| 6 | CLI **Task 9** (`exec/runRequest.ts`) | No code change required — it consumes `resolveHttpPayload` (now the wrapper). Optionally import `assembleRequest` directly; not necessary. |
| 7 | Parity mock `2026-07-24-phase3-parity-mock-server.md` **Task 1** (`registry/capabilityRegistry.ts`) | **Delete the task.** No `CapabilityRegistry` is created (Part C). Remove the `packages/core/src/registry/**` files and the barrel line it adds. |
| 8 | Parity mock **Task 2 + Architecture** (relocate mock, self-register into `CapabilityRegistry`) | Keep the useful parts (port `sanitizeRoutes`/`generateRoutesFromCollection`, expose `createMockManager()`, rewire Electron `mock:*`, add `portiq mock <ref>`). **Remove** every reference to `CapabilityRegistry` and the self-registration side-effect; mock stays a plain factory module. Update the Global-Constraints "self-registers into `CapabilityRegistry`" sentence. |
| 9 | Parity AI `2026-07-24-phase3-parity-ai-assist.md` (`AIProviderRegistry`) | **No change** — conforms to Part C. (Confirm naming: `AIProviderRegistry` / `AIProviderRegistryClass`, self-register in `ai/index.ts`. Its `@portiq/core/ai` subpath export follows the same `exports`-map convention Part B applied to `./flows`; AI adds its own subpath entry — out of scope here.) |
| 10 | Parity gRPC `2026-07-24-phase3-parity-grpc.md` (`ProtocolRegistry`) | **No change** — already the convention (self-registers via `protocols/index.ts:20`; native sender in `transport/grpc.ts`, renderer-safe handler in `protocols/grpc.ts`). |
| 11 | Parity git-sync `2026-07-24-phase3-parity-git-sync.md` (`SyncRemoteRegistry`) | **No change** — conforms to Part C. (Confirm naming: `SyncRemoteRegistry` + `registerSyncRemote(...)`. Its `./sync` export stays **src-only** — no `require`/`dist` — because `@octokit/rest` is ESM-only and `electron/main.cjs` never imports sync; this is consistent with Part B applying the CJS-dist condition per-subpath only where a CJS consumer exists.) |

**Delta count:** 11 rows across the six plans (4 supersede/collapse: #1, #3, #4, #5; 2 delete/de-scope: #7, #8; 1 minor swap: #2; 1 no-op consumer: #6; 3 confirm-only conformance: #9, #10, #11).

**Out of scope (explicitly NOT done here):** rewiring the renderer's `src/App.tsx handleSend` to call `assembleRequest` (Phase-0 follow-up #3 — opportunistic later; the golden test in Task 2 guards against drift until then). No renderer files are modified in Phase 0.5.

---

## Self-Review

**1. Spec coverage.** The task's four mandated parts are all present: Part A (Task 1 + golden Task 2) extracts `assembleRequest` reusing Phase-0 primitives and proves byte-identical parity; Part B (Task 3) adds the `require`→`dist` `./flows` condition with a proving require-check; Part C decides one registry convention (keep `ProtocolRegistry`-style per-domain registries, drop `CapabilityRegistry`); Part D maps 11 downstream deltas without rewriting the other plans. Global Constraints capture the better-sqlite3 ABI gotcha, data-location contract, pure/headless rule, registry pattern, and the corrected export-subpath fact.

**2. Placeholder scan.** No TBD/TODO/"handle edge cases"/"similar to". Every code step contains full code; every command has an expected output. The renderer parity fixture is written out verbatim rather than referenced.

**3. Type consistency.** `assembleRequest`, `AssemblableRequest`, `AssembleRequestOptions`, `resolveVars`, `stripJsonComments`, `InvalidJsonBodyError` are defined once (Task 1) and referenced identically in Task 2 and Part D. Return type `HttpSendPayload` matches the verified `transport/http.ts` shape (`requestId?/method/url/headers?/body?/timeoutMs?/httpVersion?/multipartParts?`). `MultipartPart` text/file variants match `exec/multipart.ts`. `AuthConfig` (`bearer/basic/api_key`) and `RequestRow` (`kind/fileName/mimeType/fileBase64`) match `model/request.ts`. The barrel export line is placed after `./exec/multipart` with no name collisions (verified: `resolveVars`/`stripJsonComments`/`assembleRequest` are new to the flat barrel).

Verified against the real code: the export map has only `.` and `./flows` (no `./exec` — contract is `@portiq/core`); `dist/flows/index.js` exists and exports `runFlow`/`savedRequestToConfig`/`buildSendPayload`; the renderer canonical is `src/App.tsx` `handleSend` (:2211-2276) and helpers at the cited lines.
