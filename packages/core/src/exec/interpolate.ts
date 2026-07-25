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
