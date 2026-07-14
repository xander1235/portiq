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
