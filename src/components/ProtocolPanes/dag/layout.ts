import dagre from "dagre";
import type { DagGraph } from "./types";

const NODE_W = 200, NODE_H = 60;

export function autoLayout(graph: DagGraph): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  graph.edges.filter(e => e.from !== e.to).forEach(e => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  graph.nodes.forEach(n => {
    const p = g.node(n.id);
    out[n.id] = { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) };
  });
  return out;
}
