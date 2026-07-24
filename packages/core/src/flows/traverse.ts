import type { DagGraph } from "./types";

/** Node ids reachable from `id` by following out-edges (self-edges ignored), inclusive of `id`. */
export function descendants(graph: DagGraph, id: string): Set<string> {
  const out: Record<string, string[]> = {};
  graph.edges.forEach(e => { if (e.from !== e.to) (out[e.from] ||= []).push(e.to); });
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    (out[cur] || []).forEach(next => { if (!seen.has(next)) stack.push(next); });
  }
  return seen;
}

/** Node ids that can reach `id` by following out-edges (self-edges ignored), inclusive of `id`. */
export function ancestors(graph: DagGraph, id: string): Set<string> {
  const inc: Record<string, string[]> = {};
  graph.edges.forEach(e => { if (e.from !== e.to) (inc[e.to] ||= []).push(e.from); });
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    (inc[cur] || []).forEach(prev => { if (!seen.has(prev)) stack.push(prev); });
  }
  return seen;
}
