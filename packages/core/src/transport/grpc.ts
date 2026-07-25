import * as grpc from "@grpc/grpc-js";
import { loadProto, findService, metadataToObject } from "./grpcProto";
import { loadProtoViaReflection } from "./grpcReflection";

export interface GrpcSendPayload {
  requestId?: string;
  url: string;
  service: string;
  method: string;
  body?: Record<string, unknown> | string;
  messages?: unknown[];
  metadata?: Record<string, string>;
  callType?: "UNARY" | "SERVER_STREAM" | "CLIENT_STREAM" | "BIDI_STREAM";
  deadline?: number;
  tls?: boolean;
  protoContent?: string;
  protoPath?: string;
  useReflection?: boolean;
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

/**
 * Resolve a client method by exact name or camelCase alias (grpc-js registers both).
 * Return type is deliberately `any` — the same method lookup feeds both the unary
 * (`grpc.ClientUnaryCall`) and server-streaming (`grpc.ClientReadableStream`) call
 * paths, and grpc-js selects the concrete call type dynamically based on the method.
 */
function resolveMethod(client: grpc.Client, method: string): ((...args: any[]) => any) | null {
  const camel = method.charAt(0).toLowerCase() + method.slice(1);
  const fn = (client as any)[method] ?? (client as any)[camel];
  return typeof fn === "function" ? fn : null;
}

/** Real streaming shape declared by the .proto for a resolved method, or null if unknown. */
function resolveMethodDef(
  ClientCtor: grpc.ServiceClientConstructor,
  method: string
): { requestStream: boolean; responseStream: boolean } | null {
  const service = (ClientCtor as any)?.service as Record<string, any> | undefined;
  if (!service) return null;
  if (service[method]) return service[method];
  const camel = method.charAt(0).toLowerCase() + method.slice(1);
  const key = Object.keys(service).find(
    (k) => k === method || k.charAt(0).toLowerCase() + k.slice(1) === camel
  );
  return key ? service[key] : null;
}

/** Map a method's real requestStream/responseStream flags to our callType union. */
function callTypeForMethodDef(def: { requestStream: boolean; responseStream: boolean }): GrpcSendPayload["callType"] {
  if (def.requestStream && def.responseStream) return "BIDI_STREAM";
  if (def.responseStream) return "SERVER_STREAM";
  if (def.requestStream) return "CLIENT_STREAM";
  return "UNARY";
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

    const streamMessages: unknown[] =
      Array.isArray(payload.messages) && payload.messages.length ? payload.messages : [request];

    let client: grpc.Client;
    let fn: ((...args: any[]) => any) | null;
    let ClientCtor: grpc.ServiceClientConstructor;
    try {
      const { target, secure } = normalizeTarget(url, payload.tls);
      const creds = secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      const hasProto = !!(payload.protoPath || (payload.protoContent && payload.protoContent.trim()));
      const pkg = hasProto && !payload.useReflection
        ? loadProto({ protoPath: payload.protoPath, protoContent: payload.protoContent })
        : await loadProtoViaReflection(target, creds, service);
      ClientCtor = findService(pkg, service);
      client = new ClientCtor(target, creds);
      fn = resolveMethod(client, method);
    } catch (err: any) {
      return fail(grpc.status.INVALID_ARGUMENT, err?.message || String(err));
    }
    if (!fn) {
      try { client.close(); } catch { /* ignore */ }
      return fail(grpc.status.UNIMPLEMENTED, `Method not found on service: ${method}`);
    }

    const callType = payload.callType || "UNARY";
    const methodDef = resolveMethodDef(ClientCtor, method);
    if (methodDef) {
      const expected = callTypeForMethodDef(methodDef);
      if (expected !== callType) {
        try { client.close(); } catch { /* ignore */ }
        return fail(
          grpc.status.INVALID_ARGUMENT,
          `Method "${method}" is ${expected}, but the request declared callType ${callType}`
        );
      }
    }

    const md = buildMetadata(payload.metadata);
    const deadlineMs = typeof payload.deadline === "number" && payload.deadline > 0 ? payload.deadline : 30000;
    const options: grpc.CallOptions = { deadline: new Date(Date.now() + deadlineMs) };

    if (callType === "UNARY") {
      return this.unary(client, fn, request, md, options, payload.requestId);
    }
    if (callType === "SERVER_STREAM") {
      return this.serverStream(client, fn, request, md, options, payload.requestId);
    }
    if (callType === "CLIENT_STREAM") {
      return this.clientStream(client, fn, streamMessages, md, options, payload.requestId);
    }
    if (callType === "BIDI_STREAM") {
      return this.bidiStream(client, fn, streamMessages, md, options, payload.requestId);
    }
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

  private serverStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientReadableStream<any>,
    request: Record<string, unknown>,
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      const messages: any[] = [];

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, request, md, options) as grpc.ClientReadableStream<any>;
      call.on("data", (chunk: any) => { messages.push(chunk); });
      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
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
            body: JSON.stringify(messages),
            json: null,
            error: null,
            messages,
          });
        } else {
          finish({
            statusCode: status.code,
            statusMessage: statusName(status.code),
            duration,
            metadata: initialMd,
            trailers,
            body: JSON.stringify(messages),
            json: null,
            error: status.details || `gRPC error ${status.code}`,
            messages,
          });
        }
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }
    });
  }

  private clientStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientWritableStream<any>,
    messages: unknown[],
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

      const call = fn.call(client, md, options, (err: grpc.ServiceError | null, value: any) => {
        if (!err) responseMsg = value;
      }) as grpc.ClientWritableStream<any>;

      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        if (status.code === grpc.status.OK) {
          finish({ statusCode: 0, statusMessage: "OK", duration, metadata: initialMd, trailers,
            body: JSON.stringify(responseMsg ?? {}), json: responseMsg ?? null, error: null, messages: [] });
        } else {
          finish({ statusCode: status.code, statusMessage: statusName(status.code), duration, metadata: initialMd, trailers,
            body: "", json: null, error: status.details || `gRPC error ${status.code}`, messages: [] });
        }
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }

      for (const m of messages) call.write(m);
      call.end();
    });
  }

  private bidiStream(
    client: grpc.Client,
    fn: (...args: any[]) => grpc.ClientDuplexStream<any, any>,
    messages: unknown[],
    md: grpc.Metadata,
    options: grpc.CallOptions,
    requestId?: string
  ): Promise<GrpcSendResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let initialMd: Record<string, string> = {};
      const replies: any[] = [];

      const finish = (result: GrpcSendResult) => {
        if (settled) return;
        settled = true;
        if (requestId) this.pending.delete(requestId);
        try { client.close(); } catch { /* ignore */ }
        resolve(result);
      };

      const call = fn.call(client, md, options) as grpc.ClientDuplexStream<any, any>;
      call.on("data", (chunk: any) => { replies.push(chunk); });
      call.on("metadata", (m: grpc.Metadata) => { initialMd = metadataToObject(m); });
      call.on("error", () => { /* terminal state handled by "status" */ });
      call.on("status", (status: grpc.StatusObject) => {
        const duration = Date.now() - startedAt;
        const trailers = metadataToObject(status.metadata);
        finish({
          statusCode: status.code === grpc.status.OK ? 0 : status.code,
          statusMessage: statusName(status.code),
          duration, metadata: initialMd, trailers,
          body: JSON.stringify(replies), json: null,
          error: status.code === grpc.status.OK ? null : (status.details || `gRPC error ${status.code}`),
          messages: replies,
        });
      });

      if (requestId) {
        this.pending.set(requestId, { cancel: () => { try { call.cancel(); } catch { /* ignore */ } } });
      }

      for (const m of messages) call.write(m);
      call.end();
    });
  }
}

export default GrpcTransport;
