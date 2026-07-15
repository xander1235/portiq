# DAG Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DAG Flow feature's implicit whole-object data merge with explicit `{{steps...}}` references, add a Payload node, live-linked request steps with overrides, store the graph on the request object, rebuild the canvas on react-flow, and route requests through Electron IPC.

**Architecture:** Extract the DAG's data model, reference resolver, execution engine, live-link resolution, and v1→v2 migration into pure, unit-tested modules under `src/components/ProtocolPanes/dag/`. Rebuild the canvas as a thin `@xyflow/react` view with custom node renderers and a right-side inspector that consume those modules. Edges carry control flow only; data flows solely through references resolved against a per-run `steps` context.

**Tech Stack:** React 18, TypeScript, Vite, Electron, `@xyflow/react` (canvas), `dagre` (auto-layout), `vitest` (new — pure-logic tests), CodeMirror (existing, for code/body fields).

## Global Constraints

- Feature branding stays **"DAG Flow"**; protocol id stays `"dag"` (`src/components/ProtocolPicker.tsx:42`). Do not change protocol registration.
- All HTTP execution goes through Electron IPC via `window.api.sendRequest(payload)` (preload `electron/preload.cjs:7` → `http:sendRequest`). Never use browser `fetch()` for step execution.
- `sendRequest` payload shape: `{ requestId?, method, url, headers, body?, timeoutMs?, httpVersion?, multipartParts? }`. Response shape: `{ status, statusText, headers, data, time, httpVersion?, error?, cancelled? }`.
- Reference syntax: `{{steps.<name>.response.body...}}`, `{{env.<KEY>}}`, and expression escape `{{= <js> }}`. Reuse the existing `{{}}` convention (`src/hooks/useEnvironmentState.ts:63`); do not invent a new delimiter.
- Step reference names (`node.name`) are unique per graph, slugged from the label, editable.
- TypeScript strict-friendly: no `any` in new module public signatures except where mirroring existing untyped app boundaries (e.g. `collections`, `savedRequests`).
- TDD for all pure-logic tasks (resolver, engine, migration, link-resolution). UI tasks use explicit manual-verification steps.
- Commit after every task.

## File Structure

New module directory (pure, testable):
- `src/components/ProtocolPanes/dag/types.ts` — all DAG types (v2 model).
- `src/components/ProtocolPanes/dag/resolver.ts` — `{{...}}` reference/expression resolution.
- `src/components/ProtocolPanes/dag/linkResolve.ts` — live-link + override merge → concrete request config.
- `src/components/ProtocolPanes/dag/engine.ts` — topo sort + run loop + branch/loop/skip + steps-context build.
- `src/components/ProtocolPanes/dag/migrate.ts` — v1 (global localStorage) → v2 graph.
- `src/components/ProtocolPanes/dag/*.test.ts` — vitest specs colocated.

UI (react-flow):
- `src/components/ProtocolPanes/DagFlowPane.tsx` — rewritten thin pane (state, persistence, run orchestration, react-flow host).
- `src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`, `PayloadNode.tsx`, `ConditionNode.tsx`, `TransformNode.tsx` — custom node renderers.
- `src/components/ProtocolPanes/dag/Inspector.tsx` — right-side config panel.
- `src/components/ProtocolPanes/dag/AddStepPicker.tsx` — add/link step picker.

Integration:
- `src/App.tsx:3324` — pass request identity + persisted graph + `savedRequests`/`interpolate` down; persist graph back onto the request.
- `package.json` — add `@xyflow/react`, `dagre`, `vitest`; add `test` script.

---

## Task 1: Test infrastructure (vitest)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/components/ProtocolPanes/dag/smoke.test.ts` (temporary sanity test, deleted at end of task)

**Interfaces:**
- Produces: a working `npm test` command running vitest in `node`/`jsdom` env.

- [ ] **Step 1: Install dev deps**

```bash
npm install -D vitest@^2 jsdom@^25
```

- [ ] **Step 2: Add test script to package.json**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write smoke test**

`src/components/ProtocolPanes/dag/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("vitest setup", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: Run and verify pass**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Delete smoke test and commit**

```bash
rm src/components/ProtocolPanes/dag/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: DAG v2 type model

**Files:**
- Create: `src/components/ProtocolPanes/dag/types.ts`

**Interfaces:**
- Produces: all types below. Later tasks import from `./types`.

- [ ] **Step 1: Write the types file**

`src/components/ProtocolPanes/dag/types.ts`:

```ts
export type DagNodeType = "request" | "payload" | "condition" | "transform";
export type NodeStatus = "idle" | "pending" | "running" | "success" | "error" | "skipped";

/** Raw, untemplated request config fields (all strings; headers/params/pathVars are text blocks). */
export interface RequestConfig {
  method: string;
  url: string;
  headers: string;   // JSON string
  body: string;
  params: string;    // "k=v" newline-separated
  pathVars: string;  // "k=v" newline-separated
}

export interface RequestNodeData {
  linkedRequestId?: string;               // live link to a saved request
  overrides: Partial<RequestConfig>;      // per-step field overrides (templated)
  inlineConfig?: RequestConfig;           // used when not linked (or after detach)
}

export interface PayloadNodeData {
  content: string;                        // templated JSON/text
  contentType: "json" | "text";
}

export interface ConditionNodeData { expression: string; }
export interface TransformNodeData { script: string; }

export type DagNodeData =
  | RequestNodeData | PayloadNodeData | ConditionNodeData | TransformNodeData;

export interface DagNode {
  id: string;
  type: DagNodeType;
  name: string;    // stable, unique, editable reference key (slug)
  label: string;   // display label
  data: DagNodeData;
  status: NodeStatus;
}

export interface DagEdge {
  id: string;
  from: string;
  to: string;
  branch?: "true" | "false" | null;   // condition branch this edge belongs to
  runOnFailure?: boolean;             // follow even if source errored
  maxIterations?: number;             // self-edge loop cap
  terminateWhen?: string;             // self-edge loop stop expression
}

export interface DagPosition { x: number; y: number; }

export interface DagGraph {
  version: 2;
  nodes: DagNode[];
  edges: DagEdge[];
  positions: Record<string, DagPosition>;
}

/** Per-node runtime result, keyed in the steps context by node.name. */
export interface StepResult {
  request?: {
    method?: string; url?: string; headers?: Record<string, string>;
    body?: string; params?: Record<string, string>; pathVars?: Record<string, string>;
  };
  response?: {
    status: number; statusText?: string; headers?: Record<string, string>;
    data?: unknown; error?: string; time?: number;
  };
  loopIteration?: number;
}

export type StepsContext = Record<string, StepResult>;

export interface SkipInfo { nodeId: string; reason: "upstream-error" | "losing-branch" | "upstream-skipped"; }

export const EMPTY_REQUEST_CONFIG: RequestConfig = {
  method: "GET", url: "", headers: "", body: "", params: "", pathVars: "",
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtocolPanes/dag/types.ts
git commit -m "feat(dag): add v2 type model"
```

---

## Task 3: Reference resolver

**Files:**
- Create: `src/components/ProtocolPanes/dag/resolver.ts`
- Test: `src/components/ProtocolPanes/dag/resolver.test.ts`

**Interfaces:**
- Consumes: `StepsContext` from `./types`.
- Produces:
  - `resolveTemplate(template: string, ctx: ResolveContext): string`
  - `interface ResolveContext { steps: StepsContext; env: Record<string, string>; }`
  - `getByPath(root: unknown, path: string): unknown`

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/resolver.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveTemplate, getByPath } from "./resolver";
import type { StepsContext } from "./types";

const steps: StepsContext = {
  login: { response: { status: 200, headers: { "x-token": "abc" }, data: { token: "t0", user: { id: 7 } } } },
  list: { response: { status: 200, data: { items: [{ id: 1, active: false }, { id: 2, active: true }] } } },
};
const ctx = { steps, env: { BASE_URL: "https://api.test" } };

describe("getByPath", () => {
  it("reads nested paths", () => {
    expect(getByPath(steps, "login.response.data.token")).toBe("t0");
    expect(getByPath(steps, "login.response.data.user.id")).toBe(7);
  });
  it("returns undefined for missing paths", () => {
    expect(getByPath(steps, "login.response.data.nope")).toBeUndefined();
  });
});

describe("resolveTemplate", () => {
  it("resolves a step body reference", () => {
    expect(resolveTemplate("Bearer {{steps.login.response.data.token}}", ctx)).toBe("Bearer t0");
  });
  it("resolves a header reference", () => {
    expect(resolveTemplate("{{steps.login.response.headers.x-token}}", ctx)).toBe("abc");
  });
  it("resolves env references", () => {
    expect(resolveTemplate("{{env.BASE_URL}}/v1", ctx)).toBe("https://api.test/v1");
  });
  it("resolves an expression escape", () => {
    expect(resolveTemplate("{{= steps.list.response.data.items.filter(i => i.active)[0].id }}", ctx)).toBe("2");
  });
  it("stringifies object results as JSON", () => {
    expect(resolveTemplate("{{steps.login.response.data.user}}", ctx)).toBe('{"id":7}');
  });
  it("renders missing refs as empty string", () => {
    expect(resolveTemplate("x{{steps.login.response.data.missing}}y", ctx)).toBe("xy");
  });
  it("passes through plain text", () => {
    expect(resolveTemplate("no refs here", ctx)).toBe("no refs here");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resolver`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/resolver.ts`:

```ts
import type { StepsContext } from "./types";

export interface ResolveContext {
  steps: StepsContext;
  env: Record<string, string>;
}

/** Read a dotted path (supports numeric indices) from a root object. */
export function getByPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split(".").map(p => p.trim()).filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Evaluate a `{{= ... }}` JS expression against the resolve context. */
function evalExpression(expr: string, ctx: ResolveContext): unknown {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("steps", "env", `"use strict"; return (${expr});`);
    return fn(ctx.steps, ctx.env);
  } catch {
    return undefined;
  }
}

/** Resolve a single token body (the text between {{ and }}). */
function resolveToken(token: string, ctx: ResolveContext): unknown {
  const trimmed = token.trim();
  if (trimmed.startsWith("=")) return evalExpression(trimmed.slice(1), ctx);
  if (trimmed.startsWith("env.")) return ctx.env[trimmed.slice(4)];
  if (trimmed === "env") return ctx.env;
  if (trimmed.startsWith("steps.")) return getByPath(ctx.steps, trimmed.slice(6));
  if (trimmed.startsWith("steps")) return ctx.steps;
  // bare key → treat as env var (back-compat with existing {{VAR}})
  return ctx.env[trimmed];
}

/** Replace all {{...}} tokens in a template string. */
export function resolveTemplate(template: string, ctx: ResolveContext): string {
  if (typeof template !== "string" || !template.includes("{{")) return template;
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_m, token: string) =>
    stringify(resolveToken(token, ctx))
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resolver`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/resolver.ts src/components/ProtocolPanes/dag/resolver.test.ts
git commit -m "feat(dag): add {{steps}}/{{env}}/{{= expr}} reference resolver"
```

---

## Task 4: Live-link + override resolution

**Files:**
- Create: `src/components/ProtocolPanes/dag/linkResolve.ts`
- Test: `src/components/ProtocolPanes/dag/linkResolve.test.ts`

**Interfaces:**
- Consumes: `RequestNodeData`, `RequestConfig`, `EMPTY_REQUEST_CONFIG` from `./types`.
- Produces:
  - `resolveStepConfig(data: RequestNodeData, lookup: (id: string) => RequestConfig | undefined): { config: RequestConfig; brokenLink: boolean }`
  - `savedRequestToConfig(req: unknown): RequestConfig` — adapts an app collection request to `RequestConfig`.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/linkResolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStepConfig, savedRequestToConfig } from "./linkResolve";
import type { RequestConfig } from "./types";

const saved: Record<string, RequestConfig> = {
  r1: { method: "POST", url: "https://api/login", headers: '{"Accept":"application/json"}', body: "{}", params: "", pathVars: "" },
};
const lookup = (id: string) => saved[id];

describe("resolveStepConfig", () => {
  it("uses inline config when unlinked", () => {
    const { config, brokenLink } = resolveStepConfig(
      { overrides: {}, inlineConfig: { ...saved.r1, url: "https://inline" } }, lookup);
    expect(brokenLink).toBe(false);
    expect(config.url).toBe("https://inline");
  });
  it("resolves a live link and applies overrides", () => {
    const { config, brokenLink } = resolveStepConfig(
      { linkedRequestId: "r1", overrides: { headers: '{"Authorization":"Bearer x"}' } }, lookup);
    expect(brokenLink).toBe(false);
    expect(config.url).toBe("https://api/login");         // from link
    expect(config.headers).toBe('{"Authorization":"Bearer x"}'); // overridden
    expect(config.method).toBe("POST");                    // link untouched field
  });
  it("flags a broken link", () => {
    const { config, brokenLink } = resolveStepConfig({ linkedRequestId: "gone", overrides: {} }, lookup);
    expect(brokenLink).toBe(true);
    expect(config.method).toBe("GET"); // falls back to empty config
  });
});

describe("savedRequestToConfig", () => {
  it("maps app request fields to RequestConfig", () => {
    const cfg = savedRequestToConfig({ method: "PUT", url: "u", bodyText: "b" });
    expect(cfg.method).toBe("PUT");
    expect(cfg.url).toBe("u");
    expect(cfg.body).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- linkResolve`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/linkResolve.ts`:

```ts
import { EMPTY_REQUEST_CONFIG, type RequestConfig, type RequestNodeData } from "./types";

/** Adapt a collection/app request object (loosely typed) to a RequestConfig. */
export function savedRequestToConfig(req: unknown): RequestConfig {
  const r = (req || {}) as Record<string, unknown>;
  const headers = typeof r.headersText === "string" ? r.headersText : "";
  return {
    method: typeof r.method === "string" ? r.method : "GET",
    url: typeof r.url === "string" ? r.url : "",
    headers,
    body: typeof r.bodyText === "string" ? r.bodyText : (typeof r.body === "string" ? r.body : ""),
    params: typeof r.paramsText === "string" ? r.paramsText : "",
    pathVars: typeof r.pathVarsText === "string" ? r.pathVarsText : "",
  };
}

export function resolveStepConfig(
  data: RequestNodeData,
  lookup: (id: string) => RequestConfig | undefined,
): { config: RequestConfig; brokenLink: boolean } {
  let base: RequestConfig;
  let brokenLink = false;
  if (data.linkedRequestId) {
    const linked = lookup(data.linkedRequestId);
    if (linked) base = linked;
    else { base = { ...EMPTY_REQUEST_CONFIG }; brokenLink = true; }
  } else {
    base = data.inlineConfig || { ...EMPTY_REQUEST_CONFIG };
  }
  const config: RequestConfig = { ...base };
  (Object.keys(data.overrides) as (keyof RequestConfig)[]).forEach(k => {
    const v = data.overrides[k];
    if (v !== undefined) config[k] = v;
  });
  return { config, brokenLink };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- linkResolve`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/linkResolve.ts src/components/ProtocolPanes/dag/linkResolve.test.ts
git commit -m "feat(dag): add live-link + override resolution"
```

---

## Task 5: Request builder (config → send payload)

**Files:**
- Create: `src/components/ProtocolPanes/dag/buildRequest.ts`
- Test: `src/components/ProtocolPanes/dag/buildRequest.test.ts`

**Interfaces:**
- Consumes: `RequestConfig` from `./types`; `resolveTemplate` + `ResolveContext` from `./resolver`.
- Produces:
  - `buildSendPayload(config: RequestConfig, ctx: ResolveContext): SendPayload`
  - `interface SendPayload { method: string; url: string; headers: Record<string,string>; body?: string; }`
  - Every field is resolved through `resolveTemplate` first; path vars (`:k`/`{k}`) substituted into url; params appended to query string.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/buildRequest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSendPayload } from "./buildRequest";
import type { RequestConfig } from "./types";

const ctx = { steps: { login: { response: { data: { token: "T", id: 9 } } } }, env: { HOST: "https://h" } };

function cfg(over: Partial<RequestConfig>): RequestConfig {
  return { method: "GET", url: "", headers: "", body: "", params: "", pathVars: "", ...over };
}

describe("buildSendPayload", () => {
  it("resolves url + host env and substitutes path vars", () => {
    const p = buildSendPayload(cfg({
      method: "GET", url: "{{env.HOST}}/users/{id}", pathVars: "id={{steps.login.response.data.id}}",
    }), ctx as any);
    expect(p.url).toBe("https://h/users/9");
  });
  it("injects a resolved header", () => {
    const p = buildSendPayload(cfg({ headers: '{"Authorization":"Bearer {{steps.login.response.data.token}}"}' }), ctx as any);
    expect(p.headers.Authorization).toBe("Bearer T");
  });
  it("appends query params", () => {
    const p = buildSendPayload(cfg({ url: "https://h/s", params: "q=hello\nlimit=5" }), ctx as any);
    expect(p.url).toBe("https://h/s?q=hello&limit=5");
  });
  it("resolves body references", () => {
    const p = buildSendPayload(cfg({ method: "POST", body: '{"t":"{{steps.login.response.data.token}}"}' }), ctx as any);
    expect(p.body).toBe('{"t":"T"}');
  });
  it("omits body for GET", () => {
    const p = buildSendPayload(cfg({ method: "GET", body: "x" }), ctx as any);
    expect(p.body).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- buildRequest`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/buildRequest.ts`:

```ts
import type { RequestConfig } from "./types";
import { resolveTemplate, type ResolveContext } from "./resolver";

export interface SendPayload {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function parseKvLines(text: string, ctx: ResolveContext): Record<string, string> {
  const out: Record<string, string> = {};
  (text || "").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && k.trim()) out[k.trim()] = resolveTemplate(v.join("=").trim(), ctx);
  });
  return out;
}

export function buildSendPayload(config: RequestConfig, ctx: ResolveContext): SendPayload {
  const method = (config.method || "GET").toUpperCase();

  let headers: Record<string, string> = {};
  const headersText = resolveTemplate(config.headers || "", ctx).trim();
  if (headersText) {
    try {
      const parsed = JSON.parse(headersText);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) headers[k] = String(v);
      }
    } catch { /* leave headers empty on invalid JSON */ }
  }

  let url = resolveTemplate(config.url || "", ctx);
  const pathVars = parseKvLines(config.pathVars || "", ctx);
  for (const [k, v] of Object.entries(pathVars)) {
    url = url.replace(`:${k}`, encodeURIComponent(v)).replace(`{${k}}`, encodeURIComponent(v));
  }

  const params = parseKvLines(config.params || "", ctx);
  const qs = Object.entries(params)
    .filter(([k]) => k)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  const body = resolveTemplate(config.body || "", ctx);
  const payload: SendPayload = { method, url, headers };
  if (body && !["GET", "HEAD"].includes(method)) payload.body = body;
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- buildRequest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/buildRequest.ts src/components/ProtocolPanes/dag/buildRequest.test.ts
git commit -m "feat(dag): add reference-aware request builder"
```

---

## Task 6: Execution engine

**Files:**
- Create: `src/components/ProtocolPanes/dag/engine.ts`
- Test: `src/components/ProtocolPanes/dag/engine.test.ts`

**Interfaces:**
- Consumes: `DagGraph`, `DagNode`, `StepsContext`, `StepResult`, `NodeStatus` from `./types`; `resolveStepConfig` from `./linkResolve`; `buildSendPayload` from `./buildRequest`; `resolveTemplate` from `./resolver`.
- Produces:
  - `runFlow(graph: DagGraph, deps: RunDeps): Promise<StepsContext>`
  - `topoSort(graph: DagGraph): string[]`
  - `interface RunDeps { sendRequest(p): Promise<SendResult>; lookupConfig(id): RequestConfig | undefined; env: Record<string,string>; onStatus(nodeId, status, meta?): void; }`
  - `interface SendResult { status: number; statusText?: string; headers?: Record<string,string>; data?: unknown; time?: number; error?: string; }`
  - Payload nodes: their resolved `content` becomes a `StepResult` where `response.data` = parsed content; a request node linked downstream of a payload uses it as body via reference (no implicit body merge). Also, a payload wired directly into a request with an empty body sets that request body to the payload content — implemented in Task 11's inspector default, not the engine.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/engine.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runFlow, topoSort } from "./engine";
import type { DagGraph } from "./types";

function graph(partial: Partial<DagGraph>): DagGraph {
  return { version: 2, nodes: [], edges: [], positions: {}, ...partial };
}

const okSend = vi.fn(async (p: any) => ({ status: 200, statusText: "OK", headers: {}, data: { echoedUrl: p.url }, time: 5 }));

describe("topoSort", () => {
  it("orders by dependency", () => {
    const g = graph({
      nodes: [
        { id: "b", type: "request", name: "b", label: "B", data: { overrides: {}, inlineConfig: { method: "GET", url: "b", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "a", type: "request", name: "a", label: "A", data: { overrides: {}, inlineConfig: { method: "GET", url: "a", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "a", to: "b" }],
    });
    expect(topoSort(g)).toEqual(["a", "b"]);
  });
});

describe("runFlow", () => {
  it("runs requests in order and exposes step outputs to downstream references", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { token: "T" }, time: 1 })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: {}, time: 1 });
    const g = graph({
      nodes: [
        { id: "n1", type: "request", name: "login", label: "Login", data: { overrides: {}, inlineConfig: { method: "POST", url: "https://api/login", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "n2", type: "request", name: "me", label: "Me", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/me", headers: '{"Authorization":"Bearer {{steps.login.response.data.token}}"}', body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "n1", to: "n2" }],
    });
    const statuses: string[] = [];
    const ctx = await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (_id, s) => statuses.push(s) });
    expect(ctx.login.response?.data).toEqual({ token: "T" });
    // downstream request received the resolved auth header
    expect(send.mock.calls[1][0].headers.Authorization).toBe("Bearer T");
    expect(statuses).toContain("success");
  });

  it("skips a node whose only upstream errored (no runOnFailure)", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 500, error: "boom", headers: {}, data: null, time: 1 });
    const g = graph({
      nodes: [
        { id: "n1", type: "request", name: "a", label: "A", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/a", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "n2", type: "request", name: "b", label: "B", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/b", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "n1", to: "n2" }],
    });
    const statusById: Record<string, string> = {};
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statusById[id] = s; } });
    expect(statusById.n2).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("evaluates a condition and blocks the losing branch", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: {}, time: 1 }));
    const g = graph({
      nodes: [
        { id: "start", type: "request", name: "start", label: "S", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/s", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "cond", type: "condition", name: "cond", label: "C", data: { expression: "steps.start.response.status === 200" }, status: "idle" },
        { id: "yes", type: "request", name: "yes", label: "Y", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/yes", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "no", type: "request", name: "no", label: "N", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/no", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [
        { id: "e1", from: "start", to: "cond" },
        { id: "e2", from: "cond", to: "yes", branch: "true" },
        { id: "e3", from: "cond", to: "no", branch: "false" },
      ],
    });
    const statusById: Record<string, string> = {};
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statusById[id] = s; } });
    expect(statusById.yes).toBe("success");
    expect(statusById.no).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- engine`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/engine.ts`:

```ts
import type { DagGraph, DagNode, DagEdge, StepsContext, StepResult, NodeStatus, RequestConfig } from "./types";
import { resolveStepConfig } from "./linkResolve";
import { buildSendPayload } from "./buildRequest";
import { resolveTemplate, type ResolveContext } from "./resolver";

export interface SendResult {
  status: number; statusText?: string; headers?: Record<string, string>;
  data?: unknown; time?: number; error?: string;
}

export interface RunDeps {
  sendRequest: (payload: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs?: number }) => Promise<SendResult>;
  lookupConfig: (id: string) => RequestConfig | undefined;
  env: Record<string, string>;
  onStatus: (nodeId: string, status: NodeStatus, meta?: { reason?: string; result?: StepResult }) => void;
}

export function topoSort(graph: DagGraph): string[] {
  const inDeg: Record<string, number> = {};
  graph.nodes.forEach(n => { inDeg[n.id] = 0; });
  const out: Record<string, DagEdge[]> = {};
  graph.nodes.forEach(n => { out[n.id] = []; });
  graph.edges.filter(e => e.from !== e.to).forEach(e => {
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    out[e.from]?.push(e);
  });
  let queue = graph.nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  if (!queue.length && graph.nodes.length) queue = [graph.nodes[0].id];
  const order: string[] = [], seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!; if (seen.has(cur)) continue; seen.add(cur); order.push(cur);
    (out[cur] || []).forEach(e => {
      if (inDeg[e.to] === undefined) return;
      inDeg[e.to]--;
      if (inDeg[e.to] <= 0 && !seen.has(e.to)) queue.push(e.to);
    });
  }
  graph.nodes.forEach(n => { if (!seen.has(n.id)) order.push(n.id); });
  return order;
}

function evalCondition(expr: string, ctx: ResolveContext): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("steps", "env", `"use strict"; return (${expr});`);
    return !!fn(ctx.steps, ctx.env);
  } catch { return false; }
}

export async function runFlow(graph: DagGraph, deps: RunDeps): Promise<StepsContext> {
  const nodeMap: Record<string, DagNode> = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const outEdges: Record<string, DagEdge[]> = {};
  graph.nodes.forEach(n => { outEdges[n.id] = []; });
  graph.edges.forEach(e => { outEdges[e.from]?.push(e); });

  const steps: StepsContext = {};
  const skip = new Set<string>();
  const blockedEdges = new Set<string>();
  const order = topoSort(graph);

  for (const id of order) {
    const node = nodeMap[id];
    if (!node) continue;
    if (skip.has(id)) { deps.onStatus(id, "skipped", { reason: "upstream-skipped" }); continue; }

    const incoming = graph.edges.filter(e => e.to === id && e.from !== e.to);
    if (incoming.length > 0) {
      let reason: string | undefined;
      const allowed = incoming.some(e => {
        if (blockedEdges.has(e.id)) { reason = "losing-branch"; return false; }
        const src = nodeMap[e.from];
        if (src?.status === "error" && !e.runOnFailure) { reason = "upstream-error"; return false; }
        if (src?.status === "skipped" || skip.has(e.from)) { reason = "upstream-skipped"; return false; }
        return true;
      });
      if (!allowed) { skip.add(id); node.status = "skipped"; deps.onStatus(id, "skipped", { reason }); continue; }
    }

    const ctx: ResolveContext = { steps, env: deps.env };

    if (node.type === "condition") {
      node.status = "running"; deps.onStatus(id, "running");
      const expr = (node.data as { expression: string }).expression || "";
      const result = evalCondition(expr, ctx);
      steps[node.name] = { response: { status: result ? 1 : 0 } };
      (outEdges[id] || []).forEach(e => {
        if (e.from === e.to) return;
        if (e.branch === "true" && !result) blockedEdges.add(e.id);
        if (e.branch === "false" && result) blockedEdges.add(e.id);
      });
      node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      continue;
    }

    if (node.type === "payload") {
      node.status = "running"; deps.onStatus(id, "running");
      const raw = resolveTemplate((node.data as { content: string }).content || "", ctx);
      let data: unknown = raw;
      try { data = JSON.parse(raw); } catch { /* keep as text */ }
      steps[node.name] = { response: { status: 200, data } };
      node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      continue;
    }

    // request node
    node.status = "running"; deps.onStatus(id, "running");
    const { config } = resolveStepConfig(node.data as any, deps.lookupConfig);
    const payload = buildSendPayload(config, ctx);
    try {
      const res = await deps.sendRequest({ ...payload, timeoutMs: 30000 });
      const result: StepResult = {
        request: { method: payload.method, url: payload.url, headers: payload.headers, body: payload.body },
        response: { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, error: res.error, time: res.time },
      };
      steps[node.name] = result;
      if (res.error || res.status === 0) { node.status = "error"; deps.onStatus(id, "error", { result }); }
      else { node.status = "success"; deps.onStatus(id, "success", { result }); }
    } catch (err) {
      const result: StepResult = { request: { method: payload.method, url: payload.url }, response: { status: 0, error: (err as Error).message, time: 0 } };
      steps[node.name] = result;
      node.status = "error"; deps.onStatus(id, "error", { result });
    }
  }
  return steps;
}
```

> **Note (scope):** self-edge loop execution (`maxIterations`/`terminateWhen`) and transform-node `emit()` fan-out are preserved conceptually but implemented in Task 7 to keep this task focused. This task's engine treats a transform node like a passthrough payload if encountered; Task 7 adds real transform + loop handling with tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- engine`
Expected: PASS (3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/engine.ts src/components/ProtocolPanes/dag/engine.test.ts
git commit -m "feat(dag): add reference-first execution engine (requests, conditions, payloads)"
```

---

## Task 7: Transform nodes + self-edge loops

**Files:**
- Modify: `src/components/ProtocolPanes/dag/engine.ts`
- Modify: `src/components/ProtocolPanes/dag/engine.test.ts`

**Interfaces:**
- Consumes: `TransformNodeData` from `./types`.
- Produces (added to `engine.ts`): transform-node handling that runs `data.script` with globals `steps`, `env`, `emit`; emissions stored on `StepResult.response.data` (single emit) or as an array (fan-out). Self-edge on a request node repeats it up to `maxIterations`, stopping when `terminateWhen` expression is true, exposing `loopIteration` in the step's `StepResult`.

- [ ] **Step 1: Add failing tests**

Append to `src/components/ProtocolPanes/dag/engine.test.ts`:

```ts
describe("runFlow transform + loop", () => {
  it("runs a transform script and exposes emitted data downstream", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 200, headers: {}, data: { items: [{ id: 3 }] }, time: 1 })
                        .mockResolvedValueOnce({ status: 200, headers: {}, data: {}, time: 1 });
    const g = { version: 2 as const, positions: {}, nodes: [
      { id: "a", type: "request" as const, name: "list", label: "L", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/list", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const },
      { id: "t", type: "transform" as const, name: "pick", label: "T", data: { script: "emit({ firstId: steps.list.response.data.items[0].id })" }, status: "idle" as const },
      { id: "b", type: "request" as const, name: "get", label: "G", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/{id}", headers: "", body: "", params: "id={{steps.pick.response.data.firstId}}" } }, status: "idle" as const },
    ], edges: [{ id: "e1", from: "a", to: "t" }, { id: "e2", from: "t", to: "b" }] };
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: () => {} });
    expect(send.mock.calls[1][0].url).toBe("https://api/3");
  });

  it("loops a request until terminateWhen is true", async () => {
    let n = 0;
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: { page: ++n, done: n >= 3 }, time: 1 }));
    const g = { version: 2 as const, positions: {}, nodes: [
      { id: "a", type: "request" as const, name: "poll", label: "P", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/poll", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const },
    ], edges: [{ id: "self", from: "a", to: "a", maxIterations: 10, terminateWhen: "steps.poll.response.data.done === true" }] };
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: () => {} });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL on the two new cases (transform passthrough / no loop).

- [ ] **Step 3: Implement transform handling**

In `engine.ts`, replace the transform passthrough with real handling. Add before the request-node block:

```ts
    if (node.type === "transform") {
      node.status = "running"; deps.onStatus(id, "running");
      const script = (node.data as { script: string }).script || "";
      const emissions: unknown[] = [];
      const emit = (d: unknown) => emissions.push(d);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function("steps", "env", "emit", `"use strict"; ${script}`);
        fn(steps, deps.env, emit);
        const data = emissions.length <= 1 ? emissions[0] : emissions;
        steps[node.name] = { response: { status: 200, data } };
        node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      } catch (err) {
        steps[node.name] = { response: { status: 0, error: (err as Error).message } };
        node.status = "error"; deps.onStatus(id, "error", { result: steps[node.name] });
      }
      continue;
    }
```

- [ ] **Step 4: Implement self-edge loop for request nodes**

In `engine.ts`, wrap the request send in a loop. Replace the request-node block body with:

```ts
    // request node
    node.status = "running"; deps.onStatus(id, "running");
    const selfEdge = (outEdges[id] || []).find(e => e.from === e.to);
    const maxIter = selfEdge ? (selfEdge.maxIterations || 10) : 1;
    let lastResult: StepResult | undefined;
    for (let iter = 1; iter <= maxIter; iter++) {
      const { config } = resolveStepConfig(node.data as any, deps.lookupConfig);
      const payload = buildSendPayload(config, { steps, env: deps.env });
      try {
        const res = await deps.sendRequest({ ...payload, timeoutMs: 30000 });
        lastResult = {
          request: { method: payload.method, url: payload.url, headers: payload.headers, body: payload.body },
          response: { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, error: res.error, time: res.time },
          loopIteration: selfEdge ? iter : undefined,
        };
        steps[node.name] = lastResult;
        if (res.error || res.status === 0) break;
      } catch (err) {
        lastResult = { request: { method: payload.method, url: payload.url }, response: { status: 0, error: (err as Error).message, time: 0 }, loopIteration: selfEdge ? iter : undefined };
        steps[node.name] = lastResult;
        break;
      }
      if (selfEdge && selfEdge.terminateWhen && evalCondition(selfEdge.terminateWhen, { steps, env: deps.env })) break;
      if (!selfEdge) break;
    }
    if (lastResult?.response?.error || lastResult?.response?.status === 0) { node.status = "error"; deps.onStatus(id, "error", { result: lastResult }); }
    else { node.status = "success"; deps.onStatus(id, "success", { result: lastResult }); }
    continue;
```

(Remove the old single-shot request block replaced here.)

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm test -- engine`
Expected: PASS (all describes including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/components/ProtocolPanes/dag/engine.ts src/components/ProtocolPanes/dag/engine.test.ts
git commit -m "feat(dag): add transform emit() fan-out and self-edge loops to engine"
```

---

## Task 8: v1 → v2 migration

**Files:**
- Create: `src/components/ProtocolPanes/dag/migrate.ts`
- Test: `src/components/ProtocolPanes/dag/migrate.test.ts`

**Interfaces:**
- Consumes: `DagGraph`, `RequestConfig`, `EMPTY_REQUEST_CONFIG` from `./types`.
- Produces:
  - `migrateV1(oldState: unknown): { graph: DagGraph; notes: string[] }`
  - Reads the legacy shape `{ nodes: [{id,type,label,config,conditionConfig,transformConfig}], edges, positions }` from `localStorage["portiq_dag_flow_state_v1"]`.
  - Maps legacy request nodes → v2 `inlineConfig`; legacy `condition`/`transform` → new `data`. Assigns each node a unique slug `name`. Records a note for each edge that previously relied on implicit body/header merge, so the user knows to add explicit references.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/migrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrateV1 } from "./migrate";

const legacy = {
  nodes: [
    { id: "n1", type: "request", label: "Login", config: { method: "POST", url: "https://api/login", headers: "{}", body: "{}", params: "", pathVars: "" }, status: "idle" },
    { id: "n2", type: "transform", label: "Pick", transformConfig: { script: "emit({ id: body.id })" }, status: "idle" },
    { id: "n3", type: "condition", label: "OK?", conditionConfig: { expression: "status === 200" }, status: "idle" },
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }],
  positions: { n1: { x: 0, y: 0 } },
};

describe("migrateV1", () => {
  it("produces a v2 graph with unique slug names", () => {
    const { graph } = migrateV1(legacy);
    expect(graph.version).toBe(2);
    expect(graph.nodes.map(n => n.name)).toEqual(["login", "pick", "ok"]);
  });
  it("maps request config into inlineConfig", () => {
    const { graph } = migrateV1(legacy);
    const login = graph.nodes.find(n => n.id === "n1")!;
    expect((login.data as any).inlineConfig.url).toBe("https://api/login");
    expect((login.data as any).overrides).toEqual({});
  });
  it("carries transform and condition scripts", () => {
    const { graph } = migrateV1(legacy);
    expect((graph.nodes.find(n => n.id === "n2")!.data as any).script).toBe("emit({ id: body.id })");
    expect((graph.nodes.find(n => n.id === "n3")!.data as any).expression).toBe("status === 200");
  });
  it("emits a migration note about implicit merge", () => {
    const { notes } = migrateV1(legacy);
    expect(notes.some(n => n.toLowerCase().includes("reference"))).toBe(true);
  });
  it("handles empty/absent legacy state", () => {
    const { graph } = migrateV1(null);
    expect(graph.nodes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- migrate`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/migrate.ts`:

```ts
import { EMPTY_REQUEST_CONFIG, type DagGraph, type DagNode, type DagEdge, type RequestConfig } from "./types";

function slugify(label: string): string {
  return (label || "step").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base, i = 2;
  while (used.has(name)) name = `${base}-${i++}`;
  used.add(name);
  return name;
}

export function migrateV1(oldState: unknown): { graph: DagGraph; notes: string[] } {
  const notes: string[] = [];
  const legacy = (oldState || {}) as { nodes?: any[]; edges?: any[]; positions?: Record<string, any> };
  const used = new Set<string>();
  const nodes: DagNode[] = (legacy.nodes || []).map((n: any) => {
    const name = uniqueName(slugify(n.label), used);
    if (n.type === "condition") {
      return { id: n.id, type: "condition", name, label: n.label || "Condition", data: { expression: n.conditionConfig?.expression || "" }, status: "idle" };
    }
    if (n.type === "transform") {
      return { id: n.id, type: "transform", name, label: n.label || "Transform", data: { script: n.transformConfig?.script || "" }, status: "idle" };
    }
    const cfg: RequestConfig = { ...EMPTY_REQUEST_CONFIG, ...(n.config || {}) };
    return { id: n.id, type: "request", name, label: n.label || "Request", data: { overrides: {}, inlineConfig: cfg }, status: "idle" };
  });

  const edges: DagEdge[] = (legacy.edges || []).map((e: any) => ({
    id: e.id, from: e.from, to: e.to,
    branch: e.branch ?? null, runOnFailure: e.runOnFailure,
    maxIterations: e.maxIterations, terminateWhen: e.terminateWhen ?? e.condition,
  }));

  if (edges.length > 0) {
    notes.push("Data no longer flows automatically along edges. Add explicit references like {{steps.<name>.response.body.field}} where a step used to inherit the previous step's body/headers.");
  }

  return { graph: { version: 2, nodes, edges, positions: legacy.positions || {} }, notes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- migrate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/migrate.ts src/components/ProtocolPanes/dag/migrate.test.ts
git commit -m "feat(dag): add v1 to v2 graph migration"
```

---

## Task 9: Install react-flow + dagre, add auto-layout util

**Files:**
- Modify: `package.json`
- Create: `src/components/ProtocolPanes/dag/layout.ts`
- Test: `src/components/ProtocolPanes/dag/layout.test.ts`

**Interfaces:**
- Consumes: `DagGraph` from `./types`.
- Produces: `autoLayout(graph: DagGraph): Record<string, { x: number; y: number }>` using `dagre`.

- [ ] **Step 1: Install deps**

```bash
npm install @xyflow/react@^12 dagre@^0.8 && npm install -D @types/dagre@^0.7
```

- [ ] **Step 2: Write the failing test**

`src/components/ProtocolPanes/dag/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { autoLayout } from "./layout";
import type { DagGraph } from "./types";

const g: DagGraph = {
  version: 2, positions: {},
  nodes: [
    { id: "a", type: "request", name: "a", label: "A", data: { overrides: {} }, status: "idle" },
    { id: "b", type: "request", name: "b", label: "B", data: { overrides: {} }, status: "idle" },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
};

describe("autoLayout", () => {
  it("assigns positions for every node", () => {
    const pos = autoLayout(g);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
    expect(typeof pos.a.x).toBe("number");
    expect(typeof pos.a.y).toBe("number");
  });
  it("places a downstream node below/after its source", () => {
    const pos = autoLayout(g);
    expect(pos.b.y).toBeGreaterThanOrEqual(pos.a.y);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- layout`
Expected: FAIL.

- [ ] **Step 4: Write the implementation**

`src/components/ProtocolPanes/dag/layout.ts`:

```ts
import dagre from "dagre";
import type { DagGraph } from "./types";

const NODE_W = 200, NODE_H = 60;

export function autoLayout(graph: DagGraph): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  graph.edges.filter(e => e.from !== e.to).forEach(e => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  graph.nodes.forEach(n => {
    const p = g.node(n.id);
    out[n.id] = { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) };
  });
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- layout`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/ProtocolPanes/dag/layout.ts src/components/ProtocolPanes/dag/layout.test.ts
git commit -m "feat(dag): add react-flow/dagre deps and auto-layout util"
```

---

## Task 10: react-flow canvas shell + custom nodes

**Files:**
- Rewrite: `src/components/ProtocolPanes/DagFlowPane.tsx`
- Create: `src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`
- Create: `src/components/ProtocolPanes/dag/nodes/PayloadNode.tsx`
- Create: `src/components/ProtocolPanes/dag/nodes/ConditionNode.tsx`
- Create: `src/components/ProtocolPanes/dag/nodes/TransformNode.tsx`

**Interfaces:**
- Consumes: `DagGraph`, node types, `autoLayout`, `runFlow`, `savedRequestToConfig`.
- Produces: a `DagFlowPane` that maps `DagGraph` → react-flow `nodes`/`edges`, renders custom node types, supports add/connect/delete/move, and persists the graph via a `onChange(graph)` callback prop (wired in Task 13).
- Props (this task): `DagFlowPane({ graph, onChange, savedRequests, env, sendRequest })`. `graph: DagGraph`, `onChange: (g: DagGraph) => void`, `savedRequests: any[]`, `env: Record<string,string>`, `sendRequest: (p) => Promise<SendResult>`.

- [ ] **Step 1: Write a custom node renderer (RequestNode)**

`src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";

const METHOD_COLORS: Record<string, string> = { GET: "#22c55e", POST: "#f59e0b", PUT: "#3b82f6", PATCH: "#a78bfa", DELETE: "#ff5555", HEAD: "#64748b", OPTIONS: "#64748b" };
const STATUS_RING: Record<string, string> = { idle: "#334155", running: "#f59e0b", success: "#22c55e", error: "#ff5555", skipped: "#64748b", pending: "#a78bfa" };

export function RequestNode({ data }: NodeProps) {
  const d = data as any;
  const method = d.method || "GET";
  return (
    <div style={{ width: 200, borderRadius: 10, background: "rgba(17,24,39,0.92)", border: `1.5px solid ${STATUS_RING[d.status] || "#334155"}`, padding: "8px 10px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "0.6rem", fontWeight: 800, color: METHOD_COLORS[method] || "#64748b" }}>{method}</span>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
        {d.brokenLink && <span title="Linked request missing" style={{ marginLeft: "auto", color: "#ff5555" }}>⚠</span>}
      </div>
      <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{d.name}</div>
      {d.io && <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: 4 }}>{d.io}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 2: Write PayloadNode, ConditionNode, TransformNode**

`PayloadNode.tsx` (teal block, target+source handles, shows `name` and a JSON glyph):

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
export function PayloadNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ width: 170, borderRadius: 10, background: "rgba(45,212,191,0.12)", border: "1.5px solid #2dd4bf", padding: "8px 10px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#2dd4bf" }}>{"{ } Payload"}</div>
      <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{d.label}</div>
      <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{d.name}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

`ConditionNode.tsx` (violet diamond via rotated square; two source handles labeled Y/N):

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
export function ConditionNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: "rgba(167,139,250,0.15)", border: "1.5px solid #a78bfa", borderRadius: 8 }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", color: "#a78bfa" }}>{d.label}</div>
      <Handle id="true" type="source" position={Position.Bottom} style={{ background: "#22c55e" }} />
      <Handle id="false" type="source" position={Position.Right} style={{ background: "#ff5555" }} />
    </div>
  );
}
```

`TransformNode.tsx` (teal hex-ish rect, target+source):

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
export function TransformNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ width: 140, borderRadius: 6, background: "rgba(45,212,191,0.1)", border: "1.5px dashed #2dd4bf", padding: "6px 8px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#2dd4bf" }}>ƒ Transform</div>
      <div style={{ fontSize: "0.72rem" }}>{d.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite DagFlowPane as a react-flow host**

`src/components/ProtocolPanes/DagFlowPane.tsx` (core skeleton — full state wiring completed across Tasks 11–13; this step establishes the react-flow host, node/edge mapping, add/connect/delete, and calls `onChange`):

```tsx
import React, { useCallback, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DagGraph, DagNode, DagEdge } from "./dag/types";
import { RequestNode } from "./dag/nodes/RequestNode";
import { PayloadNode } from "./dag/nodes/PayloadNode";
import { ConditionNode } from "./dag/nodes/ConditionNode";
import { TransformNode } from "./dag/nodes/TransformNode";
import { autoLayout } from "./dag/layout";
import { resolveStepConfig } from "./dag/linkResolve";

const NODE_TYPES = { request: RequestNode, payload: PayloadNode, condition: ConditionNode, transform: TransformNode };

export interface DagFlowPaneProps {
  graph: DagGraph;
  onChange: (g: DagGraph) => void;
  savedRequests: any[];
  env: Record<string, string>;
  sendRequest: (p: any) => Promise<any>;
}

export default function DagFlowPane({ graph, onChange, savedRequests, env, sendRequest }: DagFlowPaneProps) {
  const rfNodes: Node[] = useMemo(() => graph.nodes.map(n => ({
    id: n.id, type: n.type,
    position: graph.positions[n.id] || { x: 0, y: 0 },
    data: {
      label: n.label, name: n.name, status: n.status,
      method: n.type === "request" ? resolveStepConfig(n.data as any, () => undefined).config.method : undefined,
    },
  })), [graph]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.branch === "true" ? "true" : e.branch === "false" ? "false" : undefined,
    label: e.branch ? (e.branch === "true" ? "Y" : "N") : e.runOnFailure ? "on-fail" : undefined,
  })), [graph]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, rfNodes);
    const positions = { ...graph.positions };
    next.forEach(n => { positions[n.id] = n.position; });
    // deletions
    const keep = new Set(next.map(n => n.id));
    onChange({ ...graph, nodes: graph.nodes.filter(n => keep.has(n.id)), edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to)), positions });
  }, [graph, onChange, rfNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, rfEdges);
    const keep = new Set(next.map(e => e.id));
    onChange({ ...graph, edges: graph.edges.filter(e => keep.has(e.id)) });
  }, [graph, onChange, rfEdges]);

  const onConnect = useCallback((c: Connection) => {
    const branch = c.sourceHandle === "true" ? "true" : c.sourceHandle === "false" ? "false" : null;
    const edge: DagEdge = { id: `edge-${Date.now()}`, from: c.source!, to: c.target!, branch };
    onChange({ ...graph, edges: [...graph.edges, edge] });
  }, [graph, onChange]);

  const relayout = useCallback(() => onChange({ ...graph, positions: autoLayout(graph) }), [graph, onChange]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, display: "flex", gap: 8 }}>
        <button className="ghost" onClick={relayout}>Auto-layout</button>
        {/* Add-step + Run buttons wired in Tasks 11–12 */}
      </div>
      <ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
        <Background /><Controls /><MiniMap />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: build succeeds (no type errors in the new pane/nodes). Fix any import/type mismatches.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Open the app, create a request, switch its protocol to **DAG Flow**. Expected: an empty react-flow canvas with Background/Controls/MiniMap and an "Auto-layout" button; you can pan and zoom. (Adding nodes comes in Task 12; a temporary seed node may be added for this check and removed.)

- [ ] **Step 6: Commit**

```bash
git add src/components/ProtocolPanes/DagFlowPane.tsx src/components/ProtocolPanes/dag/nodes
git commit -m "feat(dag): react-flow canvas shell with custom node renderers"
```

---

## Task 11: Inspector panel

**Files:**
- Create: `src/components/ProtocolPanes/dag/Inspector.tsx`
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx`

**Interfaces:**
- Consumes: `DagNode`, `StepResult`, `resolveTemplate`, `savedRequests`.
- Produces: `Inspector({ node, stepResult, savedRequests, env, steps, onUpdate, onDetach, onClose })` where `onUpdate(id, patch: Partial<DagNode>)` updates a node's `label`/`name`/`data`. Renders type-specific editors:
  - **Request:** link picker (or inline), method/url/headers/body/params/pathVars fields (override editors), a "Detach to copy" button when linked, and Request/Response/Resolved-refs result tabs.
  - **Payload:** content editor + contentType toggle.
  - **Condition:** expression editor.
  - **Transform:** script editor.
- Selecting a node in the pane sets `selectedId`; the Inspector renders on the right (flex row: canvas + 320px panel).

- [ ] **Step 1: Implement Inspector.tsx**

Create `src/components/ProtocolPanes/dag/Inspector.tsx` with a right-panel layout. Key structure (fields wired to `onUpdate`):

```tsx
import React, { useState } from "react";
import type { DagNode, StepResult } from "./types";
import { resolveTemplate } from "./resolver";

export interface InspectorProps {
  node: DagNode;
  stepResult?: StepResult;
  savedRequests: any[];
  env: Record<string, string>;
  steps: Record<string, StepResult>;
  onUpdate: (id: string, patch: Partial<DagNode>) => void;
  onDetach: (id: string) => void;
  onClose: () => void;
}

export function Inspector({ node, stepResult, savedRequests, env, steps, onUpdate, onDetach, onClose }: InspectorProps) {
  const [tab, setTab] = useState<"config" | "request" | "response">("config");
  const patchData = (patch: any) => onUpdate(node.id, { data: { ...(node.data as any), ...patch } });
  const patchOverride = (k: string, v: string) => patchData({ overrides: { ...(node.data as any).overrides, [k]: v } });

  return (
    <div style={{ width: 320, borderLeft: "1px solid var(--border)", padding: 12, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input value={node.label} onChange={e => onUpdate(node.id, { label: e.target.value })}
          style={{ fontWeight: 700, flex: 1 }} />
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Reference name</label>
      <input value={node.name} onChange={e => onUpdate(node.id, { name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
        style={{ width: "100%", marginBottom: 8 }} />

      {node.type === "request" && (
        <RequestInspector node={node} savedRequests={savedRequests} patchData={patchData}
          patchOverride={patchOverride} onDetach={() => onDetach(node.id)} />
      )}
      {node.type === "payload" && (
        <textarea value={(node.data as any).content || ""} onChange={e => patchData({ content: e.target.value })}
          rows={12} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.72rem" }}
          placeholder='{"key": "{{steps.login.response.body.token}}"}' />
      )}
      {node.type === "condition" && (
        <textarea value={(node.data as any).expression || ""} onChange={e => patchData({ expression: e.target.value })}
          rows={4} style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="steps.login.response.status === 200" />
      )}
      {node.type === "transform" && (
        <textarea value={(node.data as any).script || ""} onChange={e => patchData({ script: e.target.value })}
          rows={12} style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="emit({ id: steps.list.response.data.items[0].id })" />
      )}

      {node.type === "request" && stepResult && (
        <ResultTabs tab={tab} setTab={setTab} stepResult={stepResult} />
      )}
    </div>
  );
}

function RequestInspector({ node, savedRequests, patchData, patchOverride, onDetach }: any) {
  const data = node.data;
  const linked = !!data.linkedRequestId;
  const cfg = linked ? {} : (data.inlineConfig || {});
  const val = (k: string) => (data.overrides[k] ?? (linked ? "" : cfg[k]) ?? "");
  const FIELDS: [string, string][] = [["url", "URL"], ["headers", "Headers (JSON)"], ["body", "Body"], ["params", "Params (k=v)"], ["pathVars", "Path vars (k=v)"]];
  return (
    <div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Linked request</label>
      <select value={data.linkedRequestId || ""} onChange={e => patchData({ linkedRequestId: e.target.value || undefined })}
        style={{ width: "100%", marginBottom: 6 }}>
        <option value="">(inline / none)</option>
        {savedRequests.map((r: any) => <option key={r.id} value={r.id}>{r.name || r.url}</option>)}
      </select>
      {linked && <button className="ghost" onClick={onDetach} style={{ marginBottom: 8 }}>Detach to copy</button>}
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <select value={val("method") || "GET"} onChange={e => patchOverride("method", e.target.value)}>
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      {FIELDS.map(([k, lbl]) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <label style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>{lbl} {linked ? "(override)" : ""}</label>
          <textarea value={val(k)} onChange={e => patchOverride(k, e.target.value)} rows={k === "body" || k === "headers" ? 4 : 2}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.72rem" }}
            placeholder={k === "headers" ? '{"Authorization":"Bearer {{steps.login.response.body.token}}"}' : ""} />
        </div>
      ))}
    </div>
  );
}

function ResultTabs({ tab, setTab, stepResult }: any) {
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {["request", "response"].map(t => (
          <button key={t} className="ghost" onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 700 : 400 }}>{t}</button>
        ))}
      </div>
      <pre style={{ fontSize: "0.68rem", whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
        {JSON.stringify(tab === "request" ? stepResult.request : stepResult.response, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Wire selection + inspector into DagFlowPane**

In `DagFlowPane.tsx`: add `const [selectedId, setSelectedId] = useState<string|null>(null)`; pass `onNodeClick={(_, n) => setSelectedId(n.id)}` to `<ReactFlow>`; wrap canvas + `<Inspector>` in a flex row; implement `onUpdate(id, patch)` (map over `graph.nodes`, enforce unique `name` by suffixing on collision), `onDetach(id)` (snapshot current linked config into `inlineConfig`, clear `linkedRequestId` using `resolveStepConfig` + `savedRequestToConfig`). Persist via `onChange`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual verification**

`npm run dev`: select a node → inspector opens on the right; edit label/name/fields → canvas updates; link a saved request → fields show as overrides; "Detach to copy" fills inline fields and clears the link.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/Inspector.tsx src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): add inspector panel for node config and results"
```

---

## Task 12: Add-step picker + Run wiring

**Files:**
- Create: `src/components/ProtocolPanes/dag/AddStepPicker.tsx`
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx`

**Interfaces:**
- Consumes: `savedRequests`, `runFlow`, `autoLayout`, node factory helpers.
- Produces:
  - `AddStepPicker({ savedRequests, onAddRequest, onLinkRequest, onAddPayload, onAddCondition, onAddTransform, onClose })`.
  - In `DagFlowPane`: node factory `makeNode(type, partial)` assigning unique `id`+`name`; `handleRun()` that resets statuses, calls `runFlow(graph, deps)`, and updates node status + per-node `stepResult` state as `onStatus` fires.

- [ ] **Step 1: Implement AddStepPicker.tsx**

```tsx
import React from "react";

export interface AddStepPickerProps {
  savedRequests: any[];
  onAddRequest: (method: string) => void;
  onLinkRequest: (req: any) => void;
  onAddPayload: () => void;
  onAddCondition: () => void;
  onAddTransform: () => void;
  onClose: () => void;
}

export function AddStepPicker(p: AddStepPickerProps) {
  return (
    <div style={{ position: "absolute", zIndex: 20, top: 48, left: 10, width: 320, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, maxHeight: 420, overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <b>Add step</b><button className="ghost" onClick={p.onClose}>✕</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => (
          <button key={m} className="ghost" onClick={() => { p.onAddRequest(m); p.onClose(); }}>{m}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button className="ghost" onClick={() => { p.onAddPayload(); p.onClose(); }}>+ Payload</button>
        <button className="ghost" onClick={() => { p.onAddCondition(); p.onClose(); }}>+ Condition</button>
        <button className="ghost" onClick={() => { p.onAddTransform(); p.onClose(); }}>+ Transform</button>
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Link a saved request</label>
      {p.savedRequests.map(r => (
        <button key={r.id} className="ghost" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
          onClick={() => { p.onLinkRequest(r); p.onClose(); }}>{r.name || r.url}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire add + run into DagFlowPane**

Add to `DagFlowPane.tsx`:
- `slug(label)` + `uniqueName` helpers (same rule as `migrate.ts`).
- `makeNode(type, partial)`: builds a `DagNode` with `id = "n-"+Date.now()+rand`, unique `name`, default `data` per type (request → `{ overrides: {}, inlineConfig: EMPTY_REQUEST_CONFIG w/ method }`, payload → `{ content: "{}", contentType: "json" }`, condition → `{ expression: "" }`, transform → `{ script: "" }`), placed at a default position; appended via `onChange`.
- `onLinkRequest(req)`: `makeNode("request", { data: { linkedRequestId: req.id, overrides: {} }, label: req.name })`.
- `[stepResults, setStepResults] = useState<Record<string, StepResult>>({})`.
- `handleRun()`:

```tsx
const handleRun = useCallback(async () => {
  setStepResults({});
  onChange({ ...graph, nodes: graph.nodes.map(n => ({ ...n, status: "pending" })) });
  const lookup = (id: string) => {
    const r = savedRequests.find((x: any) => x.id === id);
    return r ? savedRequestToConfig(r) : undefined;
  };
  await runFlow(graph, {
    sendRequest: async (payload) => {
      const res = await sendRequest(payload);
      return { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, time: res.time, error: res.error };
    },
    lookupConfig: lookup, env,
    onStatus: (id, status, meta) => {
      setNodeStatus(id, status); // maps into graph.nodes[].status via onChange
      if (meta?.result) setStepResults(prev => ({ ...prev, [id]: meta.result! }));
    },
  });
}, [graph, onChange, savedRequests, env, sendRequest]);
```

- Add "Add step" and "Run" buttons to the toolbar; render `<AddStepPicker>` when open; pass `stepResult={stepResults[selectedId]}` to `<Inspector>`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual verification**

`npm run dev`: Add step → GET creates a request node; add a Payload node; link a saved request; connect two nodes; click **Run** against a real endpoint (e.g. `https://httpbin.org/get`) → statuses animate idle→running→success; select a node → inspector shows Request/Response. Verify a downstream header `{{steps.<first>.response.data...}}` resolves in the second request's sent payload.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/AddStepPicker.tsx src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): add step picker and run wiring through Electron IPC"
```

---

## Task 13: App integration — per-request graph persistence

**Files:**
- Modify: `src/App.tsx` (import at `:55`, render site `:3324`)

**Interfaces:**
- Consumes: `DagFlowPane` props from Task 10/12; `migrateV1` from `./dag/migrate`; existing `interpolate`/env from `useEnvironmentState`; existing saved-requests list (flatten from `collections`); `window.api.sendRequest`.
- Produces: the DAG graph stored on the active request object (field `dagGraph: DagGraph`), read on mount and written on change, participating in the same save/sync as other request fields. One-time migration of the legacy `localStorage["portiq_dag_flow_state_v1"]` into the first DAG request opened after upgrade.

- [ ] **Step 1: Provide graph + deps to the pane**

At `src/App.tsx:3324`, replace the render with:

```tsx
{protocol === "dag" && (
  <DagFlowPane
    graph={currentDagGraph}
    onChange={setCurrentDagGraph}
    savedRequests={flatSavedRequests}
    env={getEnvVars()}
    sendRequest={(p) => window.api.sendRequest(p)}
  />
)}
```

- [ ] **Step 2: Derive `currentDagGraph` + setter**

Add near the request-state block in `App.tsx`:
- `flatSavedRequests`: flatten `collections` into `[{ id, name, method, url, headersText, bodyText, paramsText, pathVarsText }]` (reuse the existing collection flattening used by the old `AddStepPicker`; search for `flattenCollectionRequests` and reuse it).
- `currentDagGraph`: read `activeRequest.dagGraph` if present; else if legacy localStorage exists and not yet migrated, run `migrateV1(JSON.parse(localStorage.getItem("portiq_dag_flow_state_v1")))`, set the migration notes into app state (surface via existing toast/console), and mark migrated (`localStorage.setItem("portiq_dag_flow_migrated_v2", "1")`); else default `{ version: 2, nodes: [], edges: [], positions: {} }`.
- `setCurrentDagGraph(g)`: write `g` back onto the active request object (the same setter path other request fields use to trigger save/sync), so it persists per request.

- [ ] **Step 3: Remove the global-key writes from the pane**

Ensure the rewritten `DagFlowPane` no longer reads/writes `portiq_dag_flow_state_v1` (that responsibility now lives in `App.tsx` migration only). Grep to confirm:

Run: `grep -rn "portiq_dag_flow_state_v1" src/components/ProtocolPanes/DagFlowPane.tsx`
Expected: no matches.

- [ ] **Step 4: Verify build + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build && npm test`
Expected: build succeeds, all unit tests pass.

- [ ] **Step 5: Manual verification**

`npm run dev`:
1. Create request A, set protocol DAG Flow, build a 2-step flow, Run. Switch to another request and back → the flow persists on request A.
2. Create request B as DAG Flow → it has its own independent empty flow (multi-flow via request identity).
3. If a legacy v1 flow existed, confirm it was imported once and the migration note was surfaced.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): store flow graph per request and migrate legacy global flow"
```

---

## Task 14: Inline reference autocomplete + resolved preview

**Files:**
- Modify: `src/components/ProtocolPanes/dag/Inspector.tsx`
- Create: `src/components/ProtocolPanes/dag/refSuggest.ts`
- Test: `src/components/ProtocolPanes/dag/refSuggest.test.ts`

**Interfaces:**
- Consumes: `DagGraph`, `StepsContext`, `resolveTemplate`.
- Produces:
  - `suggestRefs(graph: DagGraph, currentNodeId: string, steps: StepsContext): string[]` — returns candidate `{{steps.<name>...}}` tokens for upstream nodes (by name), plus response-field paths when a prior run's `steps` data is available.
  - Inspector: a small helper below each override field showing the **resolved preview** of its value via `resolveTemplate(value, { steps, env })` (only when a run has populated `steps`), and a datalist of `suggestRefs(...)`.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/refSuggest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suggestRefs } from "./refSuggest";
import type { DagGraph, StepsContext } from "./types";

const g: DagGraph = {
  version: 2, positions: {},
  nodes: [
    { id: "a", type: "request", name: "login", label: "Login", data: { overrides: {} }, status: "idle" },
    { id: "b", type: "request", name: "me", label: "Me", data: { overrides: {} }, status: "idle" },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
};

describe("suggestRefs", () => {
  it("suggests upstream step names (not self)", () => {
    const s = suggestRefs(g, "b", {});
    expect(s).toContain("{{steps.login.response.body}}");
    expect(s.some(x => x.includes("steps.me"))).toBe(false);
  });
  it("suggests concrete response field paths from a prior run", () => {
    const steps: StepsContext = { login: { response: { status: 200, data: { token: "T", user: { id: 1 } } } } };
    const s = suggestRefs(g, "b", steps);
    expect(s).toContain("{{steps.login.response.data.token}}");
    expect(s).toContain("{{steps.login.response.data.user.id}}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- refSuggest`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/ProtocolPanes/dag/refSuggest.ts`:

```ts
import type { DagGraph, StepsContext } from "./types";

function upstreamOf(graph: DagGraph, nodeId: string): Set<string> {
  const parents: Record<string, string[]> = {};
  graph.edges.forEach(e => { (parents[e.to] ||= []).push(e.from); });
  const seen = new Set<string>(); const stack = [...(parents[nodeId] || [])];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); (parents[id] || []).forEach(p => stack.push(p)); }
  return seen;
}

function leafPaths(obj: unknown, prefix: string, out: string[], depth = 0): void {
  if (depth > 4 || obj == null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = `${prefix}.${k}`;
    if (v != null && typeof v === "object" && !Array.isArray(v)) leafPaths(v, path, out, depth + 1);
    else out.push(path);
  }
}

export function suggestRefs(graph: DagGraph, currentNodeId: string, steps: StepsContext): string[] {
  const ups = upstreamOf(graph, currentNodeId);
  const byId: Record<string, string> = Object.fromEntries(graph.nodes.map(n => [n.id, n.name]));
  const out: string[] = [];
  ups.forEach(id => {
    const name = byId[id];
    if (!name) return;
    out.push(`{{steps.${name}.response.body}}`);
    const data = steps[name]?.response?.data;
    if (data && typeof data === "object") {
      const paths: string[] = [];
      leafPaths(data, `steps.${name}.response.data`, paths);
      paths.forEach(p => out.push(`{{${p}}}`));
    }
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- refSuggest`
Expected: PASS.

- [ ] **Step 5: Add resolved preview + datalist to Inspector**

In `RequestInspector`, for each override field render a `<datalist>` populated from `suggestRefs(graph, node.id, steps)` (pass `graph` + `steps` down as props), wire it via `list=` on the field, and under each field show:

```tsx
{steps && value.includes("{{") && (
  <div style={{ fontSize: "0.62rem", color: "#2dd4bf" }}>→ {resolveTemplate(value, { steps, env })}</div>
)}
```

Thread `graph` and `steps` from `DagFlowPane` into `<Inspector>` (add to `InspectorProps`).

- [ ] **Step 6: Verify build + manual check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Then `npm run dev`: after a run, typing `{{` in a field offers upstream step paths; a resolved-value preview appears under fields containing references.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProtocolPanes/dag/refSuggest.ts src/components/ProtocolPanes/dag/refSuggest.test.ts src/components/ProtocolPanes/dag/Inspector.tsx src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): inline reference suggestions and resolved-value preview"
```

---

## Task 15: Skip-reason display + payload-as-body default

**Files:**
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx`
- Modify: `src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`

**Interfaces:**
- Consumes: `onStatus` `meta.reason` from the engine.
- Produces:
  - Node renderers show a compact reason badge when `status === "skipped"` (`upstream-error` → "skipped: upstream failed", `losing-branch` → "skipped: branch not taken", `upstream-skipped` → "skipped").
  - Payload-as-body default: when a Payload node is connected directly into a Request node **and** that request's body is empty, the request's effective body at run time is the payload's resolved content. Implement in `DagFlowPane` by, on connect from a payload → request, setting the request's `body` override to `{{steps.<payloadName>.response.body}}` if the body is currently empty (keeps it explicit + editable).

- [ ] **Step 1: Store skip reasons in state**

In `DagFlowPane`, add `const [skipReasons, setSkipReasons] = useState<Record<string,string>>({})`; in `handleRun`'s `onStatus`, when `status === "skipped"` set `setSkipReasons(prev => ({ ...prev, [id]: meta?.reason || "skipped" }))`. Reset it at run start. Pass `reason` into each rf node's `data`.

- [ ] **Step 2: Show reason badge in node renderers**

In `RequestNode.tsx` (and mirror in the other node renderers), add under the label:

```tsx
{d.status === "skipped" && d.reason && (
  <div style={{ fontSize: "0.58rem", color: "#64748b" }}>
    {d.reason === "upstream-error" ? "skipped: upstream failed" : d.reason === "losing-branch" ? "skipped: branch not taken" : "skipped"}
  </div>
)}
```

- [ ] **Step 3: Payload-as-body on connect**

In `onConnect`, after building the edge: if the source node is a `payload` and the target is a `request` whose effective body is empty (`resolveStepConfig(target.data).config.body` is `""` and no `overrides.body`), set the target request's `overrides.body = "{{steps." + sourceNode.name + ".response.body}}"` in the same `onChange` update.

- [ ] **Step 4: Verify build + manual check**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Then `npm run dev`:
- Build Login → Condition(true/false) → two branches; Run; confirm the not-taken branch node shows "skipped: branch not taken".
- Create a Payload node with `{"hello":"world"}`, connect it into an empty-body POST request; confirm the request body override auto-fills `{{steps.<payload>.response.body}}` and, on Run, the POST sends that body.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/DagFlowPane.tsx src/components/ProtocolPanes/dag/nodes
git commit -m "feat(dag): skip-reason badges and payload-as-body default on connect"
```

---

## Task 16: Cleanup, docs, final verification

**Files:**
- Modify: `README.md` (DAG Flow row/section if wording needs updating)
- Delete: any dead code left in the old pane (e.g. `onRunRequest`, `http-request` channel references)

- [ ] **Step 1: Remove dead transport code**

Run: `grep -rn "http-request\|onRunRequest" src`
Expected: no matches. If any remain, delete them.

- [ ] **Step 2: Full test + build + lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass (fix any lint errors introduced).

- [ ] **Step 3: Update README DAG Flow wording**

In `README.md` near the DAG Flow entry (line ~99), update the description to reflect explicit references + payload injection (e.g. "Visual multi-step flow editor with reference-based data passing and payload injection"). Keep it one line.

- [ ] **Step 4: Full manual smoke of the four goals**

`npm run dev` — verify end to end:
1. **Explicit references:** step B reads `{{steps.A.response.body.id}}`; preview + sent payload correct.
2. **Payload injection:** payload node → request body without a transform.
3. **Canvas UX:** pan/zoom/minimap, drag-connect, inspector editing, auto-layout.
4. **Debugging:** per-step Request/Response, resolved-ref preview, skip reasons.

- [ ] **Step 5: Commit**

```bash
git add README.md src
git commit -m "chore(dag): remove dead transport code and update docs"
```

---

## Self-Review Notes (author)

- **Spec coverage:** node types (T2), references incl. `{{= }}` (T3), live-link+overrides (T4), request build (T5), engine+branch/skip (T6), transform+loops (T7), migration (T8), react-flow canvas+nodes (T9–T10), inspector (T11), add/run+IPC transport (T12), per-request storage+multi-flow+migration wiring (T13), autocomplete+resolved preview (T14), skip reasons+payload-as-body (T15), cleanup/docs (T16). All spec sections mapped.
- **Transport fix:** T12 routes through `window.api.sendRequest`; T16 asserts no `http-request`/`onRunRequest`/`fetch` step execution remains.
- **Type consistency:** `RequestConfig`, `DagNode.data` union, `StepResult`, `StepsContext`, `RunDeps`, `SendResult` used consistently across T2–T15; engine `onStatus(nodeId, status, meta)` signature matches T12/T15 consumers.
