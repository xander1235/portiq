import type { DagGraph, DagNode, DagEdge, StepsContext, StepResult, NodeStatus, RequestConfig, RunMode, RunOptions } from "./types";
import { resolveStepConfig } from "./linkResolve";
import { buildSendPayload } from "./buildRequest";
import { resolveTemplate, type ResolveContext } from "./resolver";
import { descendants, ancestors } from "./traverse";

export interface SendResult {
  status: number; statusText?: string; headers?: Record<string, string>;
  data?: unknown; time?: number; error?: string;
}

export interface RunDeps {
  sendRequest: (payload: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs?: number }) => Promise<SendResult>;
  lookupConfig: (id: string) => RequestConfig | undefined;
  env: Record<string, string>;
  onStatus: (nodeId: string, status: NodeStatus, meta?: { reason?: string; result?: StepResult }) => void;
}

export function topoSort(graph: DagGraph): string[] {
  const inDeg: Record<string, number> = {};
  graph.nodes.forEach(n => { inDeg[n.id] = 0; });
  const out: Record<string, DagEdge[]> = {};
  graph.nodes.forEach(n => { out[n.id] = []; });
  graph.edges.filter(e => e.from !== e.to).forEach(e => {
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
    out[e.from]?.push(e);
  });
  let queue = graph.nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  if (!queue.length && graph.nodes.length) queue = [graph.nodes[0].id];
  const order: string[] = [], seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!; if (seen.has(cur)) continue; seen.add(cur); order.push(cur);
    (out[cur] || []).forEach(e => {
      if (inDeg[e.to] === undefined) return;
      inDeg[e.to]--;
      if (inDeg[e.to] <= 0 && !seen.has(e.to)) queue.push(e.to);
    });
  }
  graph.nodes.forEach(n => { if (!seen.has(n.id)) order.push(n.id); });
  return order;
}

function evalCondition(expr: string, ctx: ResolveContext): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("steps", "env", `"use strict"; return (${expr});`);
    return !!fn(ctx.steps, ctx.env);
  } catch { return false; }
}

function activeNodeSet(graph: DagGraph, mode: RunMode, targetId?: string): Set<string> {
  if (mode === "only") return new Set(targetId ? [targetId] : []);
  if (mode === "from") return targetId ? descendants(graph, targetId) : new Set();
  if (mode === "upTo") return targetId ? ancestors(graph, targetId) : new Set();
  return new Set(graph.nodes.map(n => n.id)); // "all"
}

export async function runFlow(graph: DagGraph, deps: RunDeps, options: RunOptions = {}): Promise<StepsContext> {
  const mode = options.mode ?? "all";
  const active = activeNodeSet(graph, mode, options.targetId);

  const nodeMap: Record<string, DagNode> = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const outEdges: Record<string, DagEdge[]> = {};
  graph.nodes.forEach(n => { outEdges[n.id] = []; });
  graph.edges.forEach(e => { outEdges[e.from]?.push(e); });

  // Seed prior results so run-only / run-from can reference upstream steps without re-calling them.
  const seed = (mode === "only" || mode === "from") ? (options.priorSteps ?? {}) : {};
  const steps: StepsContext = { ...seed };
  const skip = new Set<string>();
  const blockedEdges = new Set<string>();
  const order = topoSort(graph).filter(id => active.has(id));

  for (const id of order) {
    const node = nodeMap[id];
    if (!node) continue;

    // Only edges whose source is ALSO in the active set participate in skip/branch propagation.
    // Edges from outside the active set (reused upstream) are treated as already satisfied.
    const incoming = graph.edges.filter(e => e.to === id && e.from !== e.to && active.has(e.from));
    if (incoming.length > 0) {
      let reason: string | undefined;
      const allowed = incoming.some(e => {
        if (blockedEdges.has(e.id)) { reason = "losing-branch"; return false; }
        const src = nodeMap[e.from];
        if (src?.status === "error" && !e.runOnFailure) { reason = "upstream-error"; return false; }
        if (src?.status === "skipped" || skip.has(e.from)) { reason = "upstream-skipped"; return false; }
        return true;
      });
      if (!allowed) { skip.add(id); node.status = "skipped"; deps.onStatus(id, "skipped", { reason }); continue; }
    }

    const ctx: ResolveContext = { steps, env: deps.env };

    if (node.type === "condition") {
      node.status = "running"; deps.onStatus(id, "running");
      const expr = (node.data as { expression: string }).expression || "";
      const result = evalCondition(expr, ctx);
      steps[node.name] = { response: { status: result ? 1 : 0 } };
      (outEdges[id] || []).forEach(e => {
        if (e.from === e.to) return;
        if (e.branch === "true" && !result) blockedEdges.add(e.id);
        if (e.branch === "false" && result) blockedEdges.add(e.id);
      });
      node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      continue;
    }

    if (node.type === "payload") {
      node.status = "running"; deps.onStatus(id, "running");
      const raw = resolveTemplate((node.data as { content: string }).content || "", ctx);
      let data: unknown = raw;
      try { data = JSON.parse(raw); } catch { /* keep as text */ }
      steps[node.name] = { response: { status: 200, data, body: data } };
      node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      continue;
    }

    if (node.type === "transform") {
      node.status = "running"; deps.onStatus(id, "running");
      const script = (node.data as { script: string }).script || "";
      const emissions: unknown[] = [];
      const emit = (d: unknown) => emissions.push(d);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function("steps", "env", "emit", `"use strict"; ${script}`);
        fn(steps, deps.env, emit);
        const data = emissions.length <= 1 ? emissions[0] : emissions;
        steps[node.name] = { response: { status: 200, data, body: data } };
        node.status = "success"; deps.onStatus(id, "success", { result: steps[node.name] });
      } catch (err) {
        steps[node.name] = { response: { status: 0, error: (err as Error).message } };
        node.status = "error"; deps.onStatus(id, "error", { result: steps[node.name] });
      }
      continue;
    }

    // request node
    node.status = "running"; deps.onStatus(id, "running");
    const selfEdge = (outEdges[id] || []).find(e => e.from === e.to);
    const maxIter = selfEdge ? (selfEdge.maxIterations ?? 10) : 1;
    let lastResult: StepResult | undefined;
    for (let iter = 1; iter <= maxIter; iter++) {
      const { config } = resolveStepConfig(node.data as any, deps.lookupConfig);
      const payload = buildSendPayload(config, { steps, env: deps.env });
      try {
        const res = await deps.sendRequest({ ...payload, timeoutMs: 30000 });
        lastResult = {
          request: { method: payload.method, url: payload.url, headers: payload.headers, body: payload.body },
          response: { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, body: res.data, error: res.error, time: res.time },
          loopIteration: selfEdge ? iter : undefined,
        };
        steps[node.name] = lastResult;
        if (res.error || res.status === 0) break;
      } catch (err) {
        lastResult = { request: { method: payload.method, url: payload.url }, response: { status: 0, error: (err as Error).message, time: 0 }, loopIteration: selfEdge ? iter : undefined };
        steps[node.name] = lastResult;
        break;
      }
      if (selfEdge && selfEdge.terminateWhen && evalCondition(selfEdge.terminateWhen, { steps, env: deps.env })) break;
      if (!selfEdge) break;
    }
    if (lastResult?.response?.error || lastResult?.response?.status === 0) { node.status = "error"; deps.onStatus(id, "error", { result: lastResult }); }
    else { node.status = "success"; deps.onStatus(id, "success", { result: lastResult }); }
    continue;
  }
  return steps;
}
