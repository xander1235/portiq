import type { HttpTransport, RequestItem, RequestRow } from "@portiq/core";
import {
  runFlow,
  type DagGraph,
  type RequestConfig,
  type RunDeps,
  type SendResult,
  type StepsContext,
} from "@portiq/core/flows";

function rawHeaders(rows: RequestRow[] | undefined): string {
  const obj: Record<string, string> = {};
  for (const r of rows ?? []) {
    if (r.key && r.enabled !== false) obj[r.key] = r.value ?? "";
  }
  return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

function rawParams(rows: RequestRow[] | undefined): string {
  return (rows ?? [])
    .filter((r) => r.key && r.enabled !== false)
    .map((r) => `${r.key}=${r.value ?? ""}`)
    .join("\n");
}

export function toFlowRequestConfig(item: RequestItem): RequestConfig {
  return {
    method: (item.method || "GET").toUpperCase(),
    url: item.url ?? "",
    headers: rawHeaders(item.headersRows),
    body: item.bodyText ?? "",
    params: rawParams(item.paramsRows),
    pathVars: "",
  };
}

export interface FlowRunContext {
  transport: HttpTransport;
  env: Record<string, string>;
  lookupRequest: (id: string) => RequestItem | undefined;
}

export async function runSavedFlow(graph: DagGraph, ctx: FlowRunContext): Promise<StepsContext> {
  const deps: RunDeps = {
    env: ctx.env,
    lookupConfig: (id) => {
      const item = ctx.lookupRequest(id);
      return item ? toFlowRequestConfig(item) : undefined;
    },
    sendRequest: async (payload): Promise<SendResult> => {
      const r = await ctx.transport.send({
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        timeoutMs: payload.timeoutMs,
      });
      // Check the specific cancelled/timedOut variants before the generic
      // {error} catch-all — both also carry `error`, so a generic-first check
      // would swallow them and leave the later checks unreachable.
      if ("cancelled" in r) return { status: 0, error: r.error };
      if ("timedOut" in r) return { status: 0, error: r.error };
      if ("error" in r) return { status: 0, error: r.error };
      return { status: r.status, statusText: r.statusText, headers: r.headers, data: r.json ?? r.body, time: r.time };
    },
    onStatus: () => { /* headless: statuses are reflected on graph nodes in-place */ },
  };
  return runFlow(graph, deps);
}
