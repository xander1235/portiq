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

export interface JsonCommentRange {
  from: number;
  to: number;
}

/**
 * Scans JSON text for comments that appear OUTSIDE double-quoted string
 * literals and returns their [from, to) ranges. Line comments (two slashes)
 * extend to the end of the line (the newline itself is NOT included, so
 * stripping leaves the line structure intact); block comments (slash followed
 * by star ... star followed by slash) cover the whole block. String escapes
 * are respected (a backslash-quote or backslash-backslash does not close the
 * string), so "//" or slash-star text inside string values (URLs, paths,
 * regexes, ...) is never treated as a comment.
 */
export function findJsonCommentRanges(text: string): JsonCommentRange[] {
  const ranges: JsonCommentRange[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      ranges.push({ from: start, to: i });
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      let end = text.length;
      for (; i + 1 < text.length; i++) {
        if (text[i] === "*" && text[i + 1] === "/") {
          end = i + 2;
          break;
        }
      }
      ranges.push({ from: start, to: end });
      i = end - 1;
      continue;
    }
  }
  return ranges;
}

/** Strips every comment reported by {@link findJsonCommentRanges}. */
export function stripJsonComments(text: string): string {
  let out = "";
  let cursor = 0;
  for (const { from, to } of findJsonCommentRanges(text)) {
    out += text.slice(cursor, from);
    cursor = to;
  }
  out += text.slice(cursor);
  return out;
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
