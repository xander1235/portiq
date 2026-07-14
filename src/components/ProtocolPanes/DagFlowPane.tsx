import { useCallback, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DagGraph, DagEdge, DagNode, DagPosition, RequestNodeData, StepResult } from "./dag/types";
import { RequestNode } from "./dag/nodes/RequestNode";
import { PayloadNode } from "./dag/nodes/PayloadNode";
import { ConditionNode } from "./dag/nodes/ConditionNode";
import { TransformNode } from "./dag/nodes/TransformNode";
import { autoLayout } from "./dag/layout";
import { resolveStepConfig, savedRequestToConfig } from "./dag/linkResolve";
import { slugify, uniqueName } from "./dag/migrate";
import { Inspector } from "./dag/Inspector";
import type { SendResult } from "./dag/engine";

const NODE_TYPES = { request: RequestNode, payload: PayloadNode, condition: ConditionNode, transform: TransformNode };

/** Monotonic id generator: Date.now() alone can collide when several edges/nodes are
 *  created within the same millisecond (e.g. programmatic batch edits), so append a
 *  strictly-increasing counter that's unique for the lifetime of this module instance. */
let idSeq = 0;
function genId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now()}-${idSeq}`;
}

export interface DagFlowPaneProps {
  graph: DagGraph;
  onChange: (g: DagGraph) => void;
  savedRequests: any[];
  env: Record<string, string>;
  sendRequest: (p: any) => Promise<SendResult>;
}

export function DagFlowPane({ graph, onChange, savedRequests, env, sendRequest }: DagFlowPaneProps) {
  // sendRequest is threaded through for the "Run flow" wiring landing in Task 12;
  // this task adds the inspector panel (selection, editing, detach).
  void sendRequest;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const savedRequestById = useMemo(() => {
    const map = new Map<string, any>();
    (savedRequests || []).forEach(r => { if (r && r.id != null) map.set(String(r.id), r); });
    return map;
  }, [savedRequests]);

  const lookupConfig = useCallback((id: string) => {
    const saved = savedRequestById.get(id);
    return saved ? savedRequestToConfig(saved) : undefined;
  }, [savedRequestById]);

  const rfNodes: Node[] = useMemo(() => graph.nodes.map(n => {
    let method: string | undefined;
    let brokenLink: boolean | undefined;
    if (n.type === "request") {
      const resolved = resolveStepConfig(n.data as RequestNodeData, lookupConfig);
      method = resolved.config.method;
      brokenLink = resolved.brokenLink;
    }
    return {
      id: n.id, type: n.type,
      position: graph.positions[n.id] || { x: 0, y: 0 },
      data: { label: n.label, name: n.name, status: n.status, method, brokenLink },
    };
  }), [graph, lookupConfig]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.branch === "true" ? "true" : e.branch === "false" ? "false" : undefined,
    label: e.branch ? (e.branch === "true" ? "Y" : "N") : e.runOnFailure ? "on-fail" : undefined,
  })), [graph]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, rfNodes);
    const keep = new Set(next.map(n => n.id));
    // Build positions fresh from the surviving nodes only, so deleted nodes' entries
    // don't linger forever in graph.positions.
    const positions: Record<string, DagPosition> = {};
    next.forEach(n => { positions[n.id] = n.position; });
    if (selectedId && !keep.has(selectedId)) setSelectedId(null);
    onChange({ ...graph, nodes: graph.nodes.filter(n => keep.has(n.id)), edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to)), positions });
  }, [graph, onChange, rfNodes, selectedId]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, rfEdges);
    const keep = new Set(next.map(e => e.id));
    onChange({ ...graph, edges: graph.edges.filter(e => keep.has(e.id)) });
  }, [graph, onChange, rfEdges]);

  const onConnect = useCallback((c: Connection) => {
    const branch = c.sourceHandle === "true" ? "true" : c.sourceHandle === "false" ? "false" : null;
    const edge: DagEdge = { id: genId("edge"), from: c.source!, to: c.target!, branch };
    onChange({ ...graph, edges: [...graph.edges, edge] });
  }, [graph, onChange]);

  const relayout = useCallback(() => onChange({ ...graph, positions: autoLayout(graph) }), [graph, onChange]);

  const onUpdate = useCallback((id: string, patch: Partial<DagNode>) => {
    const nodes = graph.nodes.map(n => {
      if (n.id !== id) return n;
      const merged: DagNode = { ...n, ...patch } as DagNode;
      if (patch.name !== undefined && patch.name !== n.name) {
        const used = new Set(graph.nodes.filter(o => o.id !== id).map(o => o.name));
        const base = slugify(patch.name);
        merged.name = uniqueName(base, used);
      }
      return merged;
    });
    onChange({ ...graph, nodes });
  }, [graph, onChange]);

  const onDetach = useCallback((id: string) => {
    const node = graph.nodes.find(n => n.id === id);
    if (!node || node.type !== "request") return;
    const data = node.data as RequestNodeData;
    const { config } = resolveStepConfig(data, lookupConfig);
    const nodes = graph.nodes.map(n => n.id === id
      ? { ...n, data: { linkedRequestId: undefined, overrides: {}, inlineConfig: config } as RequestNodeData }
      : n);
    onChange({ ...graph, nodes });
  }, [graph, onChange, lookupConfig]);

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) : undefined;
  const emptySteps = useMemo<Record<string, StepResult>>(() => ({}), []);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, display: "flex", gap: 8 }}>
          <button className="ghost" onClick={relayout}>Auto-layout</button>
          {/* Add-step + Run buttons wired in Task 12 */}
        </div>
        <ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)} fitView>
          <Background /><Controls /><MiniMap />
        </ReactFlow>
      </div>
      {selectedNode && (
        <Inspector
          node={selectedNode}
          stepResult={emptySteps[selectedNode.name]}
          savedRequests={savedRequests}
          env={env}
          steps={emptySteps}
          onUpdate={onUpdate}
          onDetach={onDetach}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default DagFlowPane;
