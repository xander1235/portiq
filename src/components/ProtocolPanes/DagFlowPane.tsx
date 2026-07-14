import React, { useCallback, useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DagGraph, DagEdge } from "./dag/types";
import { RequestNode } from "./dag/nodes/RequestNode";
import { PayloadNode } from "./dag/nodes/PayloadNode";
import { ConditionNode } from "./dag/nodes/ConditionNode";
import { TransformNode } from "./dag/nodes/TransformNode";
import { autoLayout } from "./dag/layout";
import { resolveStepConfig, savedRequestToConfig } from "./dag/linkResolve";
import type { SendResult } from "./dag/engine";

const NODE_TYPES = { request: RequestNode, payload: PayloadNode, condition: ConditionNode, transform: TransformNode };

export interface DagFlowPaneProps {
  graph: DagGraph;
  onChange: (g: DagGraph) => void;
  savedRequests: any[];
  env: Record<string, string>;
  sendRequest: (p: any) => Promise<SendResult>;
}

export function DagFlowPane({ graph, onChange, savedRequests, env, sendRequest }: DagFlowPaneProps) {
  // savedRequests/env/sendRequest are threaded through for the "Add step" picker and
  // "Run flow" wiring landing in Tasks 11-12; this task establishes the react-flow host.
  void savedRequests; void env; void sendRequest;

  const savedRequestById = useMemo(() => {
    const map = new Map<string, any>();
    (savedRequests || []).forEach(r => { if (r && r.id != null) map.set(String(r.id), r); });
    return map;
  }, [savedRequests]);

  const lookupConfig = useCallback((id: string) => {
    const saved = savedRequestById.get(id);
    return saved ? savedRequestToConfig(saved) : undefined;
  }, [savedRequestById]);

  const rfNodes: Node[] = useMemo(() => graph.nodes.map(n => ({
    id: n.id, type: n.type,
    position: graph.positions[n.id] || { x: 0, y: 0 },
    data: {
      label: n.label, name: n.name, status: n.status,
      method: n.type === "request" ? resolveStepConfig(n.data as any, lookupConfig).config.method : undefined,
      brokenLink: n.type === "request" ? resolveStepConfig(n.data as any, lookupConfig).brokenLink : undefined,
    },
  })), [graph, lookupConfig]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.branch === "true" ? "true" : e.branch === "false" ? "false" : undefined,
    label: e.branch ? (e.branch === "true" ? "Y" : "N") : e.runOnFailure ? "on-fail" : undefined,
  })), [graph]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, rfNodes);
    const positions = { ...graph.positions };
    next.forEach(n => { positions[n.id] = n.position; });
    // deletions
    const keep = new Set(next.map(n => n.id));
    onChange({ ...graph, nodes: graph.nodes.filter(n => keep.has(n.id)), edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to)), positions });
  }, [graph, onChange, rfNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, rfEdges);
    const keep = new Set(next.map(e => e.id));
    onChange({ ...graph, edges: graph.edges.filter(e => keep.has(e.id)) });
  }, [graph, onChange, rfEdges]);

  const onConnect = useCallback((c: Connection) => {
    const branch = c.sourceHandle === "true" ? "true" : c.sourceHandle === "false" ? "false" : null;
    const edge: DagEdge = { id: `edge-${Date.now()}`, from: c.source!, to: c.target!, branch };
    onChange({ ...graph, edges: [...graph.edges, edge] });
  }, [graph, onChange]);

  const relayout = useCallback(() => onChange({ ...graph, positions: autoLayout(graph) }), [graph, onChange]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, display: "flex", gap: 8 }}>
        <button className="ghost" onClick={relayout}>Auto-layout</button>
        {/* Add-step + Run buttons wired in Tasks 11-12 */}
      </div>
      <ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
        <Background /><Controls /><MiniMap />
      </ReactFlow>
    </div>
  );
}

export default DagFlowPane;
