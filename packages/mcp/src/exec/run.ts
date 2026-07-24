import {
  sendGraphQL,
  runSteps,
  summarizeTests,
  interpolate,
  assembleRequest,
  resolveVars,
  type Environment,
  type HttpResult,
  type HttpTransport,
  type RequestItem,
  type RequestResponse,
  type TestEntry,
  type TestSummary,
} from "@portiq/core";

export interface NormalizedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  json: unknown;
  time: number;
  httpVersion?: string;
  error?: string;
  cancelled?: boolean;
  timedOut?: boolean;
}

export interface RunContext {
  transport: HttpTransport;
  env?: Environment | null;
  vars?: Record<string, string>;
}

export interface RunResult {
  response: NormalizedResponse;
  tests: TestSummary;
}

type SendOutcome =
  | HttpResult
  | { error: string }
  | { cancelled: true; error: string }
  | { timedOut: true; error: string };

function normalize(r: SendOutcome): NormalizedResponse {
  if ("cancelled" in r && r.cancelled) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, cancelled: true, error: r.error };
  }
  if ("timedOut" in r && r.timedOut) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, timedOut: true, error: r.error };
  }
  if ("error" in r) {
    return { status: 0, statusText: "", headers: {}, body: "", json: null, time: 0, error: r.error };
  }
  return {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
    body: r.body,
    json: r.json,
    time: r.time,
    httpVersion: r.httpVersion,
  };
}

export async function runRequestItem(item: RequestItem, ctx: RunContext): Promise<RunResult> {
  const vars = resolveVars(ctx.env, ctx.vars); // shared mutable map: pm.environment.set chains across steps
  const entries: TestEntry[] = [];
  const setEnvVar = (key: string, value: string) => { vars[key] = value; };

  // Pre-scripts (side effects + tests; request mutation not wired in v1).
  if (item.testsPreSteps?.length) {
    entries.push(...await runSteps(item.testsPreSteps, {
      request: { method: item.method, url: item.url, headers: {}, body: item.bodyText },
      response: null as never,
      env: vars,
      setEnvVar,
      sendRequest: async () => ({}),
      label: "pre-script",
    }));
  }

  const protocol = (item.protocol || "http").toLowerCase();
  let outcome: SendOutcome;
  if (protocol === "http" || protocol === "") {
    const payload = assembleRequest(item, { env: ctx.env, vars });
    outcome = await ctx.transport.send(payload);
  } else if (protocol === "graphql") {
    const gql = item.graphqlConfig;
    outcome = await sendGraphQL({
      url: interpolate(item.url ?? "", vars),
      headers: { ...compileGraphqlHeaders(item, vars) },
      query: interpolate(gql?.query ?? "", vars),
      variables: interpolate(gql?.variables ?? "", vars),
      operationName: gql?.operationName || undefined,
    });
  } else {
    throw new Error(`Protocol '${protocol}' is not supported headlessly yet`);
  }

  const response = normalize(outcome);

  // Post-scripts / tests.
  if (item.testsPostSteps?.length) {
    entries.push(...await runSteps(item.testsPostSteps, {
      request: { method: item.method, url: item.url, headers: {}, body: item.bodyText },
      // NormalizedResponse deliberately narrows RequestResponse (no duration/size);
      // pm.ts reads response fields defensively via `as any`, so this cast is safe.
      response: response as unknown as RequestResponse,
      env: vars,
      setEnvVar,
      sendRequest: async () => ({}),
      label: "post-script",
    }));
  }

  return { response, tests: summarizeTests(entries) };
}

function compileGraphqlHeaders(item: RequestItem, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(item.graphqlConfig?.headers ?? {})) {
    out[k] = interpolate(String(v), vars);
  }
  return out;
}
