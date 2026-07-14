import { useCallback, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  DagGraph, DagEdge, DagNode, DagNodeType, DagPosition, RequestNodeData,
  PayloadNodeData, ConditionNodeData, TransformNodeData, StepResult, StepsContext, NodeStatus,
} from "./dag/types";
import { EMPTY_REQUEST_CONFIG } from "./dag/types";
import { RequestNode } from "./dag/nodes/RequestNode";
import { PayloadNode } from "./dag/nodes/PayloadNode";
import { ConditionNode } from "./dag/nodes/ConditionNode";
import { TransformNode } from "./dag/nodes/TransformNode";
import { autoLayout } from "./dag/layout";
import { resolveStepConfig, savedRequestToConfig } from "./dag/linkResolve";
import { slugify, uniqueName } from "./dag/migrate";
import { Inspector } from "./dag/Inspector";
import { AddStepPicker } from "./dag/AddStepPicker";
import { runFlow, type SendResult } from "./dag/engine";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  // The engine's `steps` context, keyed by node.name (not id) — this is what
  // {{steps.<name>...}} templates resolve against, and what the Inspector's
  // suggestion/preview features read from once a run has populated it.
  const [runSteps, setRunSteps] = useState<StepsContext>({});
  // Run status is rendered from this ephemeral map rather than persisted onto
  // graph.nodes[].status: handleRun's closure captures a single `graph` snapshot
  // for the whole async run, so repeated `onChange({ ...graph, ... })` calls would
  // each rebuild off that same stale pre-run snapshot and clobber one another's
  // updates. A separate state (updated with the functional setState form) avoids
  // that entirely and keeps "pending"/"running" statuses purely UI-side.
  const [statusMap, setStatusMap] = useState<Record<string, NodeStatus>>({});
  // Ephemeral, like statusMap: captures the engine's skip reason (meta.reason) for
  // nodes that end up "skipped" during a run, so the node renderers can show a
  // compact explanation. Never persisted onto the graph.
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);

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
      data: { label: n.label, name: n.name, status: statusMap[n.id] ?? n.status, method, brokenLink, reason: skipReasons[n.id] },
    };
  }), [graph, lookupConfig, statusMap, skipReasons]);

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

    const sourceNode = graph.nodes.find(n => n.id === c.source);
    const targetNode = graph.nodes.find(n => n.id === c.target);
    let nodes = graph.nodes;
    if (sourceNode?.type === "payload" && targetNode?.type === "request") {
      const targetData = targetNode.data as RequestNodeData;
      const { config } = resolveStepConfig(targetData, lookupConfig);
      if (config.body === "" && targetData.overrides.body === undefined) {
        const bodyRef = `{{steps.${sourceNode.name}.response.body}}`;
        nodes = graph.nodes.map(n => n.id === targetNode.id
          ? { ...n, data: { ...targetData, overrides: { ...targetData.overrides, body: bodyRef } } as RequestNodeData }
          : n);
      }
    }

    onChange({ ...graph, nodes, edges: [...graph.edges, edge] });
  }, [graph, onChange, lookupConfig]);

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

  const defaultDataFor = useCallback((type: DagNodeType, method?: string): DagNode["data"] => {
    if (type === "request") {
      return { overrides: {}, inlineConfig: { ...EMPTY_REQUEST_CONFIG, method: method || "GET" } } as RequestNodeData;
    }
    if (type === "payload") return { content: "{}", contentType: "json" } as PayloadNodeData;
    if (type === "condition") return { expression: "" } as ConditionNodeData;
    return { script: "" } as TransformNodeData;
  }, []);

  const makeNode = useCallback((type: DagNodeType, partial?: { data?: DagNode["data"]; label?: string }) => {
    const used = new Set(graph.nodes.map(n => n.name));
    const label = partial?.label || `${type[0].toUpperCase()}${type.slice(1)}`;
    const name = uniqueName(slugify(label), used);
    const node: DagNode = {
      id: genId("node"),
      type,
      name,
      label,
      data: partial?.data ?? defaultDataFor(type),
      status: "idle",
    };
    const existingPositions = Object.values(graph.positions);
    const maxY = existingPositions.length ? Math.max(...existingPositions.map(p => p.y)) : 0;
    const position: DagPosition = { x: 80, y: maxY + 120 };
    onChange({
      ...graph,
      nodes: [...graph.nodes, node],
      positions: { ...graph.positions, [node.id]: position },
    });
    return node;
  }, [graph, onChange, defaultDataFor]);

  const onAddRequest = useCallback((method: string) => {
    makeNode("request", { data: { overrides: {}, inlineConfig: { ...EMPTY_REQUEST_CONFIG, method } } as RequestNodeData, label: method });
  }, [makeNode]);

  const onLinkRequest = useCallback((req: any) => {
    makeNode("request", { data: { linkedRequestId: req.id, overrides: {} } as RequestNodeData, label: req.name || req.url || "Request" });
  }, [makeNode]);

  const onAddPayload = useCallback(() => { makeNode("payload"); }, [makeNode]);
  const onAddCondition = useCallback(() => { makeNode("condition"); }, [makeNode]);
  const onAddTransform = useCallback(() => { makeNode("transform"); }, [makeNode]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      setStepResults({});
      setRunSteps({});
      setSkipReasons({});
      setStatusMap(Object.fromEntries(graph.nodes.map(n => [n.id, "pending" as NodeStatus])));
      // Clone the graph (and its nodes) before handing it to runFlow: the engine mutates
      // node.status in place, and graph.nodes are the same objects held in the parent's
      // React state. Without this clone, a run would silently corrupt persisted state.
      const result = await runFlow({ ...graph, nodes: graph.nodes.map(n => ({ ...n })) }, {
        sendRequest: async (payload) => {
          const res = await sendRequest(payload);
          return { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, time: res.time, error: res.error };
        },
        lookupConfig,
        env,
        onStatus: (id, status, meta) => {
          setStatusMap(prev => ({ ...prev, [id]: status }));
          if (meta?.result) setStepResults(prev => ({ ...prev, [id]: meta.result! }));
          if (status === "skipped") setSkipReasons(prev => ({ ...prev, [id]: meta?.reason || "skipped" }));
        },
      });
      setRunSteps(result);
    } finally {
      setIsRunning(false);
    }
  }, [graph, lookupConfig, env, sendRequest, isRunning]);

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) : undefined;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, display: "flex", gap: 8 }}>
          <button className="ghost" onClick={relayout}>Auto-layout</button>
          <button className="ghost" onClick={() => setShowPicker(v => !v)}>+ Add step</button>
          <button className="ghost" onClick={handleRun} disabled={isRunning}>{isRunning ? "Running…" : "Run"}</button>
        </div>
        {showPicker && (
          <AddStepPicker
            savedRequests={savedRequests}
            onAddRequest={onAddRequest}
            onLinkRequest={onLinkRequest}
            onAddPayload={onAddPayload}
            onAddCondition={onAddCondition}
            onAddTransform={onAddTransform}
            onClose={() => setShowPicker(false)}
          />
        )}
        <ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)} fitView>
          <Background /><Controls /><MiniMap />
        </ReactFlow>
      </div>
      {selectedNode && (
        <Inspector
          node={selectedNode}
          stepResult={stepResults[selectedNode.id]}
          savedRequests={savedRequests}
          env={env}
          steps={runSteps}
          graph={graph}
          onUpdate={onUpdate}
          onDetach={onDetach}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default DagFlowPane;
