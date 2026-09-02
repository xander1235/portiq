// Sandboxed script execution for flows (condition/transform) and test scripts.
//
// Headless consumers (MCP/CLI) run user/library-supplied scripts, so in Node we
// execute them inside a locked-down `node:vm` context with a FRESH global scope
// (no `process`, `fetch`, `require`, `Buffer`, timers, or other host globals)
// plus a hard CPU timeout. Only `steps`, `env` (and `emit`, for transforms) are
// injected as parameters. A timeout is treated as a script error.
//
// The renderer bundle (Vite) must never load `node:vm` — `node:vm` is only
// touched when running under Node (detected at call time), never in a browser.
// The import is guarded so bundlers externalize it without the renderer ever
// invoking it. In a browser we keep the historical `new Function` behavior (the
// user runs their own flows on their own machine).

import { createRequire } from "node:module";

export interface SandboxOptions {
  timeoutMs?: number;
}

export interface SandboxResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 3000;
const CONDITION_TIMEOUT_MS = 1000;

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    process !== null &&
    typeof (process as { versions?: { node?: string } }).versions?.node === "string"
  );
}

let cachedRequire: ((id: string) => unknown) | null | undefined;

/**
 * Obtain a `require` via `node:module`'s createRequire, which works in both CJS
 * and ESM; a bare path is enough for loading `node:` builtins. Only invoked when
 * running under Node.
 */
function resolveRequire(): ((id: string) => unknown) | null {
  try {
    return createRequire("/");
  } catch {
    return null;
  }
}

function getRequire(): ((id: string) => unknown) | null {
  if (cachedRequire === undefined) cachedRequire = resolveRequire();
  return cachedRequire;
}

function loadVm(): typeof import("node:vm") | null {
  if (!isNodeRuntime()) return null;
  try {
    const requireFn = getRequire();
    return requireFn ? (requireFn("node:vm") as typeof import("node:vm")) : null;
  } catch {
    return null;
  }
}

/**
 * Run `body` as a function `(params...)=>{...}` inside a sandboxed context.
 * `body` is the function BODY (not the full function source). Returns a
 * SandboxResult; a thrown error (including vm timeout) is reported via `error`.
 */
export function runSandboxed(
  body: string,
  params: string[],
  args: unknown[],
  opts: SandboxOptions = {}
): SandboxResult {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const vm = loadVm();
  if (vm) {
    // Inject the params as context globals so the FULL execution — function
    // creation AND invocation — happens inside a single vm.runInContext, which
    // is the only call the vm `timeout` actually bounds (it does not cover
    // later calls to functions created inside the context).
    const globals: Record<string, unknown> = {};
    params.forEach((p, i) => { globals[p] = args[i]; });
    const context = vm.createContext(globals);
    try {
      const value = vm.runInContext(`(function(){\n"use strict";\n${body}\n})();`, context, { timeout: timeoutMs });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Browser fallback: historical behavior.
  try {
    const fn = new Function(...params, `"use strict";\n${body}`);
    return { ok: true, value: fn(...args) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Variant for flow conditions: shorter timeout, boolean result coercion. */
export function evalConditionSandboxed(
  expression: string,
  steps: unknown,
  env: Record<string, string>
): { ok: boolean; value: boolean; error?: string } {
  const res = runSandboxed(
    expression.startsWith("return") ? expression : `return (${expression});`,
    ["steps", "env"],
    [steps, env],
    { timeoutMs: CONDITION_TIMEOUT_MS }
  );
  if (!res.ok) return { ok: false, value: false, error: res.error };
  return { ok: true, value: Boolean(res.value) };
}
