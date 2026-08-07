import { readFileSync } from "node:fs";
import { parseCurl, type RequestRow } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { type ResolvableRequest } from "../resolve/httpPayload";
import { resolveHttpPayload } from "../resolve/httpPayload";
import { runRequest, defaultRunDeps, type RunDeps } from "../exec/runRequest";
import { resolveVars } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";
import { UsageError } from "../errors";
import type { CommandOutput } from "../reporters";
import type { AppState, RequestItem } from "@portiq/core";

export interface ExecOptions {
  url?: string;
  method?: string;
  header: string[];
  data?: string;
  fromCurl?: string;
  grpc?: boolean;
  service?: string;
  proto?: string;
  callType?: string;
  message: string[];
  reflection?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  token?: string;
}

function headerRows(headers: string[]): RequestRow[] {
  return headers.map((h) => {
    const idx = h.indexOf(":");
    const key = idx === -1 ? h.trim() : h.slice(0, idx).trim();
    const value = idx === -1 ? "" : h.slice(idx + 1).trim();
    return { key, value, comment: "", enabled: true };
  });
}

export function buildExecRequest(opts: ExecOptions): ResolvableRequest {
  if (opts.fromCurl) {
    const parsed = parseCurl(opts.fromCurl);
    return applyTokenHeader(
      {
        protocol: "http", method: parsed.method, url: parsed.url,
        headersRows: parsed.headersRows, paramsRows: parsed.paramsRows,
        authType: parsed.authType, authConfig: parsed.authConfig,
        bodyType: parsed.bodyType, bodyText: parsed.bodyText, bodyRows: parsed.bodyRows,
      },
      opts.token
    );
  }
  if (!opts.url) throw new UsageError("exec requires a <url> or --from-curl");
  const method = opts.method ? opts.method.toUpperCase() : opts.data !== undefined ? "POST" : "GET";
  return applyTokenHeader(
    {
      protocol: "http", method, url: opts.url,
      headersRows: headerRows(opts.header),
      bodyType: opts.data !== undefined ? "raw" : "none",
      bodyText: opts.data,
    },
    opts.token
  );
}

/** Map --token to an HTTP `Authorization: Bearer` header unless one is already set. */
function applyTokenHeader(req: ResolvableRequest, token?: string): ResolvableRequest {
  if (!token) return req;
  const rows = req.headersRows ?? [];
  if (rows.some((r) => r.key.toLowerCase() === "authorization")) return req;
  return { ...req, headersRows: [...rows, { key: "Authorization", value: `Bearer ${token}`, comment: "", enabled: true }] };
}

export const execCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("exec [url]")
      .description("send an ad-hoc request (curl-like flags or --from-curl); not saved")
      .option("-X, --method <method>", "HTTP method")
      .option("-H, --header <header>", "request header 'Key: Value' (repeatable)", (v: string, p: string[]) => p.concat([v]), [])
      .option("-d, --data <body>", "request body")
      .option("--from-curl <command>", "parse a curl command string")
      .option("--grpc", "send a gRPC request (target = [url] as grpc://host:port, RPC method = -X, metadata = -H, body = -d)")
      .option("--service <name>", "gRPC service name (implies --grpc)")
      .option("--proto <file>", "path to a .proto file (gRPC)")
      .option("--call-type <type>", "gRPC call type: UNARY | SERVER_STREAM | CLIENT_STREAM | BIDI_STREAM", "UNARY")
      .option("--message <json>", "gRPC request message JSON (repeatable; for client/bidi streaming)", (v: string, p: string[]) => p.concat([v]), [])
      .option("--reflection", "resolve gRPC descriptors via server reflection (no --proto needed)")
      .option("--ca-cert <file>", "gRPC custom CA bundle (PEM)")
      .option("--client-cert <file>", "gRPC client certificate (PEM, for mTLS)")
      .option("--client-key <file>", "gRPC client private key (PEM, for mTLS)")
      .option("--token <token>", "bearer token: gRPC call credential, or HTTP Authorization: Bearer header")
      .action(async (url: string | undefined, opts: Omit<ExecOptions, "url">, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const isGrpc = !!opts.grpc || !!opts.service || (!!url && /^grpcs?:\/\//i.test(url));
        const vars = safeResolveVars(ctx, flags);
        const deps: RunDeps = defaultRunDeps();

        if (isGrpc) {
          if (!url) throw new UsageError("gRPC exec requires a <url> target (grpc://host:port)");
          if (!opts.service) throw new UsageError("gRPC exec requires --service <name>");
          const metadata: Record<string, string> = {};
          for (const h of opts.header) { const i = h.indexOf(":"); metadata[i === -1 ? h.trim() : h.slice(0, i).trim()] = i === -1 ? "" : h.slice(i + 1).trim(); }
          const item: RequestItem = {
            type: "request", id: "adhoc", name: "adhoc", description: "", tags: [],
            protocol: "grpc", method: "", url,
            grpcConfig: {
              service: opts.service, method: opts.method || "",
              requestBody: opts.data ?? "{}", metadata,
              callType: (opts.callType as import("@portiq/core").GrpcConfig["callType"]) || "UNARY",
              protoPath: opts.proto,
              messages: opts.message.length ? opts.message : undefined,
              useReflection: opts.reflection,
              tlsConfig: (opts.caCert || opts.clientCert || opts.clientKey)
                ? {
                    rootCertsPem: opts.caCert ? readFileSync(opts.caCert, "utf8") : undefined,
                    clientCertPem: opts.clientCert ? readFileSync(opts.clientCert, "utf8") : undefined,
                    clientKeyPem: opts.clientKey ? readFileSync(opts.clientKey, "utf8") : undefined,
                  }
                : undefined,
              callToken: opts.token,
            },
          };
          if (!item.grpcConfig!.method) throw new UsageError("gRPC exec requires -X <RpcMethod>");
          const outcome = await runRequest(item, vars, deps, { runTests: false });
          emit(ctx, flags, { kind: "execution", request: outcome.request, response: null, error: outcome.error, tests: null, grpc: outcome.grpc });
          if (outcome.error) process.exitCode = 1;
          return;
        }

        const req = buildExecRequest({ ...opts, url });
        if (flags.dryRun) {
          const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
          emit(ctx, flags, { kind: "entity", entity: { ...view } } as CommandOutput);
          return;
        }
        const item: RequestItem = { type: "request", id: "adhoc", name: "adhoc", description: "", tags: [], ...req } as RequestItem;
        const outcome = await runRequest(item, vars, deps, { timeoutMs: flags.timeout, runTests: false });
        emit(ctx, flags, { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: null });
        if (outcome.error) process.exitCode = 1;
      });
  },
};

function safeResolveVars(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  // exec works without a store; resolve vars best-effort.
  try {
    return withStateAsyncSync(ctx, flags);
  } catch {
    const vars: Record<string, string> = {};
    for (const pair of flags.var) {
      const idx = pair.indexOf("=");
      if (idx === -1) throw new UsageError(`Invalid --var "${pair}", expected key=value`);
      vars[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return vars;
  }
}

// Synchronous store read for var resolution (open+load+close are all sync in core).
function withStateAsyncSync(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  return withState(ctx, flags, (state: AppState) => resolveVars(state, flags));
}
