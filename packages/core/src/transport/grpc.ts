import * as grpc from "@grpc/grpc-js";
import { loadProto, findService, metadataToObject } from "./grpcProto";

export interface GrpcSendPayload {
  requestId?: string;
  url: string;
  service: string;
  method: string;
  body?: Record<string, unknown> | string;
  metadata?: Record<string, string>;
  callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM";
  deadline?: number;
  tls?: boolean;
  protoContent?: string;
  protoPath?: string;
}

export interface GrpcSendResult {
  statusCode: number;
  statusMessage: string;
  duration: number;
  metadata: Record<string, string>;
  trailers: Record<string, string>;
  body: string;
  json: any;
  error: string | null;
  messages: any[];
}

function statusName(code: number): string {
  return grpc.status[code] ?? `UNKNOWN(${code})`;
}

function fail(code: number, message: string, duration = 0): GrpcSendResult {
  return {
    statusCode: code,
    statusMessage: statusName(code),
    duration,
    metadata: {},
    trailers: {},
    body: "",
    json: null,
    error: message,
    messages: [],
  };
}

/** Strip grpc:// / grpcs:// prefixes; grpcs:// implies TLS. Returns dial target + security. */
function normalizeTarget(url: string, tls?: boolean): { target: string; secure: boolean } {
  const lower = url.toLowerCase();
  if (lower.startsWith("grpcs://")) return { target: url.slice("grpcs://".length), secure: true };
  if (lower.startsWith("grpc://")) return { target: url.slice("grpc://".length), secure: tls === true };
  return { target: url, secure: tls === true };
}

function parseBody(body: GrpcSendPayload["body"]): Record<string, unknown> {
  if (body == null || body === "") return {};
  if (typeof body === "string") return JSON.parse(body) as Record<string, unknown>;
  return body;
}

function buildMetadata(entries: Record<string, string> | undefined): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const [key, value] of Object.entries(entries ?? {})) md.set(key, String(value));
  return md;
}

/** Resolve a client method by exact name or camelCase alias (grpc-js registers both). */
function resolveMethod(client: grpc.Client, method: string): ((...args: any[]) => grpc.ClientUnaryCall) | null {
  const camel = method.charAt(0).toLowerCase() + method.slice(1);
  const fn = (client as any)[method] ?? (client as any)[camel];
  return typeof fn === "function" ? fn : null;
}

export class GrpcTransport {
  private pending = new Map<string, { cancel: () => void }>();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  constructor(_opts: {} = {}) {}

  async send(payload: GrpcSendPayload): Promise<GrpcSendResult> {
    const { url, service, method } = payload || ({} as GrpcSendPayload);
    if (!url || !url.trim()) return fail(grpc.status.INVALID_ARGUMENT, "gRPC server address is required");
    if (!service || !service.trim()) return fail(grpc.status.INVALID_ARGUMENT, "Service name is required");
    if (!method || !method.trim()) return fail(grpc.status.INVALID_ARGUMENT, "Method name is required");

    let request: Record<string, unknown>;
    try {
      request = parseBody(payload.body);
    } catch {
      return fail(grpc.status.INVALID_ARGUMENT, "Request body must be valid JSON");
    }

    let client: grpc.Client;
    let fn: ((...args: any[]) => grpc.ClientUnaryCall) | null;
    try {
      const pkg = loadProto({ protoPath: payload.protoPath, protoContent: payload.protoContent });
      const ClientCtor = findService(pkg, service);
      const { target, secure } = normalizeTarget(url, payload.tls);
      const creds = secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      client = new ClientCtor(target, creds);
      fn = resolveMethod(client, method);
    } catch (err: any) {
      return fail(grpc.status.INVALID_ARGUMENT, err?.message || String(err));
    }
    if (!fn) return fail(grpc.status.UNIMPLEMENTED, `Method not found on service: ${method}`);

    const callType = payload.callType || "UNARY";
    const md = buildMetadata(payload.metadata);
    const deadlineMs = typeof payload.deadline === "number" && payload.deadline > 0 ? payload.deadline : 30000;
    const options: grpc.CallOptions = { deadline: new Date(Date.now() + deadlineMs) };

    if (callType === "UNARY") {
      return this.unary(client, fn, request, md, options, payload.requestId);
    }
    // SERVER_STREAM is added in Task 4; CLIENT_STREAM / BIDI_STREAM are deferred.
    try { client.close(); } catch { /* ignore */ }
    return fail(grpc.status.UNIMPLEMENTED, `gRPC call type not supported yet: ${callType}`);
  }

  cancel(requestId: string): { ok: true } | { error: string } {
    if (!requestId) return { error: "Missing request ID" };
    this.pending.get(requestId)?.cancel();
    return { ok: true };
  }

  private unary(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientUnaryCall,
    request: Record<string, unknown>,
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      let responseMsg: any = undefined;

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, request, md, options, (err: grpc.ServiceError | null, value: any) => {
        if (!err) responseMsg = value;
      });

      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });

      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        if (status.code === grpc.status.OK) {
          finish({
            statusCode: 0,
            statusMessage: "OK",
            duration,
            metadata: initialMd,
            trailers,
            body: JSON.stringify(responseMsg ?? {}),
            json: responseMsg ?? null,
            error: null,
            messages: [],
          });
        } else {
          finish({
            statusCode: status.code,
            statusMessage: statusName(status.code),
            duration,
            metadata: initialMd,
            trailers,
            body: "",
            json: null,
            error: status.details || `gRPC error ${status.code}`,
            messages: [],
          });
        }
      });

      // "error" always precedes a terminal "status"; swallow to avoid an unhandled emit.
      call.on("error", () => { /* terminal state handled by "status" */ });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }
    });
  }
}

export default GrpcTransport;
