import {
  assembleRequest,
  type AssemblableRequest,
  type AssembleRequestOptions,
  type HttpSendPayload,
} from "@portiq/core";

/** Same shape core returns, but `headers` is guaranteed present. assembleRequest
 *  always populates it (even as `{}`); the core type leaves it optional because
 *  other HttpSendPayload producers may omit it. window.api.sendRequest's
 *  RequestConfig (src/types/global.d.ts) requires headers, so this is the type
 *  the renderer actually needs. */
export interface RendererHttpSendPayload extends HttpSendPayload {
  headers: Record<string, string>;
}

/**
 * Renderer-side wrapper around the canonical core assembler
 * (@portiq/core assembleRequest). Mirrors packages/cli/src/resolve/httpPayload.ts's
 * role: one call site translating a stored/edited request + active environment
 * into the wire payload. Throws core's InvalidJsonBodyError unchanged for a
 * malformed JSON body — callers (App.tsx handleSend) catch it and map it to
 * their own UI error state, exactly like the CLI maps it to UsageError.
 */
export function buildHttpSendPayload(
  req: AssemblableRequest,
  opts: AssembleRequestOptions = {},
): RendererHttpSendPayload {
  const payload = assembleRequest(req, opts);
  return { ...payload, headers: payload.headers ?? {} };
}
