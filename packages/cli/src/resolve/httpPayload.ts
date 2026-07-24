import {
  assembleRequest,
  stripJsonComments,
  InvalidJsonBodyError,
  type AssemblableRequest,
  type HttpSendPayload,
} from "@portiq/core";
import type { ExecRequestView } from "../reporters";
import { UsageError } from "../errors";

/** The CLI's resolvable request is exactly core's AssemblableRequest. */
export type ResolvableRequest = AssemblableRequest;

/** Re-export core's canonical helper so existing CLI imports keep resolving. */
export { stripJsonComments };

/**
 * Thin wrapper over the canonical core assembler (Phase 0.5). Delegates
 * assembly to `assembleRequest`, then derives the CLI's dry-run `view`.
 * Core's `InvalidJsonBodyError` is mapped to the CLI's `UsageError` (exit 3).
 */
export function resolveHttpPayload(
  req: ResolvableRequest,
  vars: Record<string, string>,
  opts: { requestId?: string; timeoutMs?: number } = {}
): { payload: HttpSendPayload; view: ExecRequestView } {
  let payload: HttpSendPayload;
  try {
    payload = assembleRequest(req, { vars, requestId: opts.requestId, timeoutMs: opts.timeoutMs });
  } catch (err) {
    if (err instanceof InvalidJsonBodyError) throw new UsageError(err.message);
    throw err;
  }
  const view: ExecRequestView = {
    protocol: req.protocol || "http",
    method: payload.method,
    url: payload.url,
    headers: payload.headers ?? {},
    body: payload.body,
  };
  return { payload, view };
}
