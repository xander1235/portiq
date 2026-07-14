import { EMPTY_REQUEST_CONFIG, type DagGraph, type DagNode, type DagEdge, type RequestConfig } from "./types";

export function slugify(label: string): string {
  return (label || "step").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
}

export function uniqueName(base: string, used: Set<string>): string {
  let name = base, i = 2;
  while (used.has(name)) name = `${base}-${i++}`;
  used.add(name);
  return name;
}

export function migrateV1(oldState: unknown): { graph: DagGraph; notes: string[] } {
  const notes: string[] = [];
  const legacy = (oldState || {}) as { nodes?: any[]; edges?: any[]; positions?: Record<string, any> };
  const used = new Set<string>();
  const nodes: DagNode[] = (legacy.nodes || []).map((n: any) => {
    const name = uniqueName(slugify(n.label), used);
    if (n.type === "condition") {
      return { id: n.id, type: "condition", name, label: n.label || "Condition", data: { expression: n.conditionConfig?.expression || "" }, status: "idle" };
    }
    if (n.type === "transform") {
      return { id: n.id, type: "transform", name, label: n.label || "Transform", data: { script: n.transformConfig?.script || "" }, status: "idle" };
    }
    const cfg: RequestConfig = { ...EMPTY_REQUEST_CONFIG, ...(n.config || {}) };
    return { id: n.id, type: "request", name, label: n.label || "Request", data: { overrides: {}, inlineConfig: cfg }, status: "idle" };
  });

  const edges: DagEdge[] = (legacy.edges || []).map((e: any) => ({
    id: e.id, from: e.from, to: e.to,
    branch: e.branch ?? null, runOnFailure: e.runOnFailure,
    maxIterations: e.maxIterations, terminateWhen: e.terminateWhen ?? e.condition,
  }));

  if (edges.length > 0) {
    notes.push("Data no longer flows automatically along edges. Add explicit references like {{steps.<name>.response.body.field}} where a step used to inherit the previous step's body/headers.");
  }

  return { graph: { version: 2, nodes, edges, positions: legacy.positions || {} }, notes };
}
