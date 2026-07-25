import {
  HttpTransport, sendGraphQL as coreSendGraphQL, runSteps, summarizeTests, interpolate,
  buildGrpcPayload, normalizeGrpcResult,
  type GraphqlConfig, type HttpResult, type RequestItem, type RequestResponse, type ScriptStep, type TestEntry, type TestSummary, type NormalizedGrpcResponse,
} from "@portiq/core";
import { GrpcTransport } from "@portiq/core/grpc";
import { resolveHttpPayload } from "../resolve/httpPayload";
import type { ExecRequestView } from "../reporters";
import { RuntimeError } from "../errors";

export interface RunOutcome {
  request: ExecRequestView;
  response: HttpResult | null;
  error: string | null;
  tests: TestSummary | null;
  grpc?: NormalizedGrpcResponse | null;
}

export interface RunDeps {
  transport: HttpTransport;
  sendGraphQL: typeof coreSendGraphQL;
  now: () => number;
  grpcTransport: Pick<GrpcTransport, "send" | "cancel">;
}

export function defaultRunDeps(appVersion?: string): RunDeps {
  return { transport: new HttpTransport({ appVersion }), sendGraphQL: coreSendGraphQL, now: () => Date.now(), grpcTransport: new GrpcTransport() };
}

function isHttpResult(r: unknown): r is HttpResult {
  return !!r && typeof r === "object" && "status" in (r as object) && !("error" in (r as object) && (r as { status?: unknown }).status === undefined);
}

export async function runRequest(
  req: RequestItem,
  vars: Record<string, string>,
  deps: RunDeps,
  opts: { timeoutMs?: number; runTests?: boolean } = {}
): Promise<RunOutcome> {
  const protocol = req.protocol || "http";
  if (protocol === "websocket") {
    throw new RuntimeError(`Protocol "${protocol}" is not supported via the CLI (interactive/experimental).`);
  }
  if (protocol === "grpc") {
    const callType = req.grpcConfig?.callType || "UNARY";
    const url = interpolate(req.url || "", vars);
    const view: ExecRequestView = { protocol: "grpc", method: callType, url, headers: req.grpcConfig?.metadata ?? {} };
    const raw = await deps.grpcTransport.send(buildGrpcPayload(req, vars));
    const grpc = normalizeGrpcResult(raw, callType);
    return { request: view, response: null, error: grpc.error, tests: null, grpc };
  }
  const runTests = opts.runTests !== false;
  const entries: TestEntry[] = [];
  const env = { ...vars };
  const setEnvVar = (key: string, value: string) => { env[key] = value; };
  const sendForScripts = (payload: { method: string; url: string; headers?: Record<string, string>; body?: string }) =>
    deps.transport.send({ method: payload.method, url: payload.url, headers: payload.headers, body: payload.body, httpVersion: "auto" });

  if (protocol === "graphql") {
    const cfg = (req.graphqlConfig ?? {}) as GraphqlConfig;
    const url = interpolate(req.url || "", env);
    const raw = await deps.sendGraphQL({
      url,
      headers: cfg.headers,
      query: interpolate(cfg.query || "", env),
      variables: interpolate(cfg.variables || "", env),
      operationName: interpolate(cfg.operationName || "", env),
    });
    const view: ExecRequestView = { protocol, method: "POST", url, headers: cfg.headers ?? {} };
    if ("error" in raw) return { request: view, response: null, error: raw.error, tests: null };
    const response = raw as HttpResult;
    if (runTests) {
      const post: ScriptStep[] = req.testsPostSteps ?? [];
      entries.push(...await runSteps(post, { request: view, response: response as unknown as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "post" }));
    }
    return { request: view, response, error: null, tests: runTests ? summarizeTests(entries) : null };
  }

  // http (and default)
  const { payload, view } = resolveHttpPayload(req, env, { timeoutMs: opts.timeoutMs });
  const requestObj = { method: view.method, url: view.url, headers: { ...view.headers }, body: view.body };
  if (runTests) {
    entries.push(...await runSteps(req.testsPreSteps ?? [], { request: requestObj, response: {} as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "pre" }));
    payload.method = requestObj.method || payload.method;
    payload.url = requestObj.url || payload.url;
    payload.headers = requestObj.headers || payload.headers;
    payload.body = requestObj.body ?? payload.body;
  }
  const raw = await deps.transport.send(payload);
  if ("error" in raw && (raw as { status?: unknown }).status === undefined) {
    return { request: view, response: null, error: (raw as { error: string }).error, tests: runTests ? summarizeTests(entries) : null };
  }
  const response = raw as HttpResult;
  if (runTests) {
    entries.push(...await runSteps(req.testsPostSteps ?? [], { request: requestObj, response: response as unknown as RequestResponse, env, setEnvVar, sendRequest: sendForScripts, label: "post" }));
  }
  return { request: view, response, error: null, tests: runTests ? summarizeTests(entries) : null };
}

void isHttpResult;
