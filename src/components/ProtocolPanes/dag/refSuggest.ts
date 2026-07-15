import type { DagGraph, StepsContext } from "./types";

/** Transitive ancestors of nodeId (never includes nodeId itself or downstream nodes). */
function upstreamOf(graph: DagGraph, nodeId: string): Set<string> {
  const parents: Record<string, string[]> = {};
  graph.edges.forEach(e => { (parents[e.to] ||= []).push(e.from); });
  const seen = new Set<string>(); const stack = [...(parents[nodeId] || [])];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); (parents[id] || []).forEach(p => stack.push(p)); }
  return seen;
}

/** Collect dotted leaf paths from a run result's data object, depth-limited. */
function leafPaths(obj: unknown, prefix: string, out: string[], depth = 0): void {
  if (depth > 4 || obj == null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = `${prefix}.${k}`;
    if (v != null && typeof v === "object" && !Array.isArray(v)) leafPaths(v, path, out, depth + 1);
    else out.push(path);
  }
}

/** Suggest `{{steps.<name>...}}` reference tokens for the upstream steps of currentNodeId,
 *  plus concrete leaf-field paths when prior run data is available in `steps`. */
export function suggestRefs(graph: DagGraph, currentNodeId: string, steps: StepsContext): string[] {
  const ups = upstreamOf(graph, currentNodeId);
  const byId: Record<string, string> = Object.fromEntries(graph.nodes.map(n => [n.id, n.name]));
  const out: string[] = [];
  ups.forEach(id => {
    const name = byId[id];
    if (!name) return;
    out.push(`{{steps.${name}.response.body}}`);
    const data = steps[name]?.response?.data ?? steps[name]?.response?.body;
    if (data && typeof data === "object") {
      const paths: string[] = [];
      leafPaths(data, `steps.${name}.response.body`, paths);
      paths.forEach(p => out.push(`{{${p}}}`));
    }
  });
  return out;
}
