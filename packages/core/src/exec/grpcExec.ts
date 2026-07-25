import { GrpcProtocol } from "../protocols/grpc";
import { interpolate } from "./interpolate";
import type { RequestItem } from "../model/request";
// Type-only: erased at runtime, so this module never pulls @grpc/* into the barrel.
import type { GrpcSendPayload, GrpcSendResult } from "../transport/grpc";

/**
 * Canonical gRPC payload builder (peer to assembleRequest for HTTP): interpolate the
 * saved request's dynamic fields against `vars`, then reuse the renderer-safe
 * GrpcProtocol.buildRequest so there is exactly one gRPC payload shape in the codebase.
 */
export function buildGrpcPayload(
  item: RequestItem,
  vars: Record<string, string>,
  requestId?: string
): GrpcSendPayload {
  const cfg = item.grpcConfig ?? { service: "", method: "" };
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.metadata ?? {})) metadata[k] = interpolate(String(v), vars);
  const built = GrpcProtocol.buildRequest({
    url: interpolate(item.url ?? "", vars),
    service: cfg.service,
    method: cfg.method,
    requestBody: interpolate(cfg.requestBody ?? "{}", vars),
    metadata,
    callType: cfg.callType || "UNARY",
    deadline: cfg.deadline || 30000,
    // Explicit true/false always wins; only an unset tls falls back to scheme
    // detection so a plaintext grpc:// target isn't silently forced onto TLS
    // (GrpcProtocol.buildRequest itself defaults tls to true when undefined).
    tls: cfg.tls !== undefined ? cfg.tls : /^grpcs:\/\//i.test(item.url ?? ""),
    protoContent: cfg.protoContent || "",
    protoPath: cfg.protoPath,
  });
  const messages = (cfg.messages ?? []).map((m) => {
    const s = interpolate(m, vars);
    try { return JSON.parse(s) as unknown; } catch { return {}; }
  });
  return {
    ...built,
    requestId,
    ...(messages.length ? { messages } : {}),
    useReflection: cfg.useReflection,
    tlsConfig: cfg.tlsConfig,
    callToken: cfg.callToken ? interpolate(cfg.callToken, vars) : undefined,
  } as GrpcSendPayload;
}

export interface NormalizedGrpcResponse {
  protocol: "grpc";
  callType: string;
  statusCode: number;
  statusMessage: string;
  duration: number;
  metadata: Record<string, string>;
  trailers: Record<string, string>;
  messages: unknown[];
  json: unknown;
  body: string;
  streamed: boolean;
  error: string | null;
}

/** Normalize a raw GrpcSendResult into the headless response shape CLI/MCP return. */
export function normalizeGrpcResult(raw: GrpcSendResult, callType: string): NormalizedGrpcResponse {
  return {
    protocol: "grpc",
    callType,
    statusCode: raw.statusCode,
    statusMessage: raw.statusMessage,
    duration: raw.duration,
    metadata: raw.metadata ?? {},
    trailers: raw.trailers ?? {},
    messages: raw.messages ?? [],
    json: raw.json ?? null,
    body: raw.body ?? "",
    streamed: callType !== "UNARY",
    error: raw.error ?? null,
  };
}
