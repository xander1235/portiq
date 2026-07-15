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

  const headers: Record<string, string> = {};
  const headersText = resolveTemplate(config.headers || "", ctx).trim();
  if (headersText) {
    try {
      const parsed = JSON.parse(headersText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) headers[k] = String(v);
      }
    } catch { /* leave headers empty on invalid JSON */ }
  }

  let url = resolveTemplate(config.url || "", ctx);
  const pathVars = parseKvLines(config.pathVars || "", ctx);
  for (const [k, v] of Object.entries(pathVars)) {
    const enc = encodeURIComponent(v);
    url = url.split(`:${k}`).join(enc).split(`{${k}}`).join(enc);
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
