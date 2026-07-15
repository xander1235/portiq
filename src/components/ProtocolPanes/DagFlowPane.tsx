import { useCallback, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  DagGraph, DagEdge, DagNode, DagNodeType, DagPosition, RequestNodeData,
  PayloadNodeData, ConditionNodeData, TransformNodeData, StepResult, StepsContext, NodeStatus, RunMode,
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
import { descendants, ancestors } from "./dag/traverse";

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
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const savedRequestById = useMemo(() => {
    const map = new Map<string, any>();
    (savedRequests || []).forEach(r => { if (r && r.id != null) map.set(String(r.id), r); });
    return map;
  }, [savedRequests]);

  const lookupConfig = useCallback((id: string) => {
    const saved = savedRequestById.get(id);
    return saved ? savedRequestToConfig(saved) : undefined;
  }, [savedRequestById]);

  // Single source of truth for all node/edge deletions (delete key, multi-select
  // delete, deleting a node that has connected edges). React Flow computes the full
  // set of nodes AND edges to remove (including edges implied by deleted nodes) and
  // reports them together here, so we can apply everything in one onChange call
  // instead of racing separate onNodesChange/onEdgesChange updates.
  const onDelete = useCallback(({ nodes: delNodes, edges: delEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const nodeIds = new Set(delNodes.map(n => n.id));
    const edgeIds = new Set(delEdges.map(e => e.id));
    const nodes = graph.nodes.filter(n => !nodeIds.has(n.id));
    const edges = graph.edges.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to));
    const positions: Record<string, DagPosition> = {};
    nodes.forEach(n => { positions[n.id] = graph.positions[n.id] || { x: 0, y: 0 }; });
    if (selectedId && nodeIds.has(selectedId)) setSelectedId(null);
    onChange({ ...graph, nodes, edges, positions });
  }, [graph, onChange, selectedId]);

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

  const runWithMode = useCallback(async (mode: RunMode, targetId?: string) => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const active = mode === "all"
        ? new Set(graph.nodes.map(n => n.id))
        : mode === "only" ? new Set(targetId ? [targetId] : [])
        : mode === "from" ? descendants(graph, targetId!)
        : ancestors(graph, targetId!);

      // Reset status/results for the nodes about to run; leave others as-is.
      setStatusMap(prev => {
        const next = { ...prev };
        active.forEach(id => { next[id] = "pending"; });
        return next;
      });
      if (mode === "all") { setStepResults({}); setSkipReasons({}); }

      const priorSteps = runSteps;
      // Collect this run's final results/statuses/skips locally (race-free) so Task 5 can persist
      // them without reading React state that may not have flushed yet.
      const collected: Record<string, StepResult> = {};
      const collectedStatus: Record<string, NodeStatus> = {};
      const collectedSkips: Record<string, string> = {};
      const result = await runFlow({ ...graph, nodes: graph.nodes.map(n => ({ ...n })) }, {
        sendRequest: async (payload) => {
          const res = await sendRequest(payload);
          return { status: res.status, statusText: res.statusText, headers: res.headers, data: res.data, time: res.time, error: res.error };
        },
        lookupConfig, env,
        onStatus: (id, status, meta) => {
          collectedStatus[id] = status;
          setStatusMap(prev => ({ ...prev, [id]: status }));
          if (meta?.result) { collected[id] = meta.result; setStepResults(prev => ({ ...prev, [id]: meta.result! })); }
          if (status === "skipped") { collectedSkips[id] = meta?.reason || "skipped"; setSkipReasons(prev => ({ ...prev, [id]: meta?.reason || "skipped" })); }
        },
      }, { mode, targetId, priorSteps });
      setRunSteps(prev => ({ ...prev, ...result }));
      // (Task 5 inserts lastRun persistence here, using collectedStatus / collectedSkips / result / runSteps.)
    } finally {
      setIsRunning(false);
    }
  }, [graph, lookupConfig, env, sendRequest, isRunning, runSteps]);

  const handleRun = useCallback(() => runWithMode("all"), [runWithMode]);

  // rfNodes/rfEdges must be declared after onDelete and runWithMode (above), since their
  // per-node `data` wires onEdit/onRunOnly/onRunFrom/onRunUpTo/onDelete to those callbacks;
  // referencing them earlier in the function body would throw "Cannot access before
  // initialization" (TDZ) on first render. onNodesChange/onEdgesChange are declared
  // immediately after rfNodes/rfEdges for the same reason (they read rfNodes/rfEdges to
  // compute the next node/edge list via applyNodeChanges/applyEdgeChanges).
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
      data: {
        label: n.label, name: n.name, status: statusMap[n.id] ?? n.status, method, brokenLink, reason: skipReasons[n.id],
        onEdit: () => setSelectedId(n.id),
        onRunOnly: () => runWithMode("only", n.id),
        onRunFrom: () => runWithMode("from", n.id),
        onRunUpTo: () => runWithMode("upTo", n.id),
        onDelete: () => onDelete({ nodes: [{ id: n.id } as any], edges: [] }),
      },
    };
  }), [graph, lookupConfig, statusMap, skipReasons, runWithMode, onDelete]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.branch === "true" ? "true" : e.branch === "false" ? "false" : undefined,
    label: e.branch ? (e.branch === "true" ? "Y" : "N") : e.runOnFailure ? "on-fail" : undefined,
  })), [graph]);

  // Node/edge *removal* is handled exclusively by onDelete (React Flow v12's unified
  // deletion callback) above, which applies node deletions, edge deletions, and edges
  // implied by deleted nodes in a single onChange update. If onNodesChange and
  // onEdgesChange each also applied "remove" changes via their own onChange calls,
  // React Flow firing both in the same tick (e.g. deleting a node with connected
  // edges) would clobber one update with the other, since both close over the same
  // `graph` snapshot. So here we only ever apply non-remove changes (position,
  // dimension, select, etc.).
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const filtered = changes.filter(c => c.type !== "remove");
    if (!filtered.length) return;
    const next = applyNodeChanges(filtered, rfNodes);
    const keep = new Set(next.map(n => n.id));
    // Build positions fresh from the surviving nodes only, so deleted nodes' entries
    // don't linger forever in graph.positions.
    const positions: Record<string, DagPosition> = {};
    next.forEach(n => { positions[n.id] = n.position; });
    onChange({ ...graph, nodes: graph.nodes.filter(n => keep.has(n.id)), edges: graph.edges.filter(e => keep.has(e.from) && keep.has(e.to)), positions });
  }, [graph, onChange, rfNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const filtered = changes.filter(c => c.type !== "remove");
    if (!filtered.length) return;
    const next = applyEdgeChanges(filtered, rfEdges);
    const keep = new Set(next.map(e => e.id));
    onChange({ ...graph, edges: graph.edges.filter(e => keep.has(e.id)) });
  }, [graph, onChange, rfEdges]);

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) : undefined;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, right: 10, display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <span style={{ font: "650 12.5px/1 system-ui" }}>DAG Flow</span>
          <span style={{ font: '500 10.5px/1 var(--font-mono, monospace)', color: "var(--muted)", background: "var(--panel-2)",
            border: "1px solid var(--border)", padding: "4px 8px", borderRadius: 6 }}>{graph.nodes.length} steps</span>
          <span style={{ flex: 1 }} />
          <button className="ghost" onClick={() => setShowPicker(v => !v)}>+ Add step</button>
          <button className="ghost" onClick={relayout}>Auto-layout</button>
          <button className="ghost" onClick={() => rfRef.current?.fitView({ padding: 0.2 })}>Fit</button>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <button className="ghost" style={{ border: "none", borderRadius: 0 }} onClick={() => rfRef.current?.zoomOut()}>−</button>
            <button className="ghost" style={{ border: "none", borderRadius: 0 }} onClick={() => rfRef.current?.zoomIn()}>+</button>
          </div>
          <button onClick={handleRun} disabled={isRunning}
            style={{ font: "700 12px/1 system-ui", border: "none", borderRadius: 8, padding: "8px 14px",
              background: isRunning ? "var(--panel-2)" : "var(--accent)", color: isRunning ? "var(--muted)" : "#1a0f0a",
              cursor: isRunning ? "default" : "pointer" }}>
            {isRunning ? "Running…" : "▶ Run flow"}
          </button>
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
        {graph.nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, zIndex: 4, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ width: 460, textAlign: "center", pointerEvents: "auto" }}>
              <div style={{ width: 52, height: 52, margin: "0 auto 14px", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, background: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" }}>🔗</div>
              <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>Build a request flow</h3>
              <p style={{ margin: "0 auto 18px", maxWidth: 400, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
                Chain API calls, pass data between steps with <code style={{ fontFamily: "var(--font-mono, monospace)", background: "var(--panel-2)", padding: "1px 6px", borderRadius: 5, color: "#ffb59c" }}>{"{{references}}"}</code>, and branch or loop on responses.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 400, margin: "0 auto 14px" }}>
                {[
                  { fg: "var(--method-post)", ic: "API", t: "Request", d: "Call an endpoint", on: () => onAddRequest("GET") },
                  { fg: "var(--method-get)", ic: "{ }", t: "Payload", d: "Inject a JSON body", on: onAddPayload },
                  { fg: "var(--method-patch)", ic: "◆", t: "Condition", d: "Branch on a response", on: onAddCondition },
                  { fg: "var(--method-get)", ic: "ƒ", t: "Transform", d: "Reshape data (JS)", on: onAddTransform },
                ].map(c => (
                  <button key={c.t} onClick={c.on} style={{ display: "flex", gap: 10, alignItems: "center", textAlign: "left",
                    border: "1px solid var(--border)", background: "var(--panel-2)", borderRadius: 10, padding: "10px 12px", color: "var(--text)", cursor: "pointer" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                      font: '800 9px/1 var(--font-mono, monospace)', background: `color-mix(in srgb, ${c.fg} 15%, transparent)`, color: c.fg }}>{c.ic}</span>
                    <span><span style={{ display: "block", font: "650 12.5px/1.1 system-ui" }}>{c.t}</span><span style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)" }}>{c.d}</span></span>
                  </button>
                ))}
              </div>
              <button onClick={() => setShowPicker(true)} style={{ font: "700 13px/1 system-ui", border: "none", borderRadius: 9,
                padding: "11px 18px", background: "var(--accent)", color: "#1a0f0a", cursor: "pointer" }}>＋ Link a saved request</button>
            </div>
          </div>
        )}
        <ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onDelete={onDelete} onNodeClick={(_, n) => setSelectedId(n.id)}
          onSelectionChange={({ nodes }) => setSelectedId(nodes[0]?.id ?? selectedId)}
          nodeClickDistance={5} selectNodesOnDrag={false} connectionRadius={40} fitView
          proOptions={{ hideAttribution: true }}>
          <Background color="#222838" gap={19} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.6)"
            style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
            nodeColor={(n) => {
              const s = (n.data as any)?.status;
              return s === "success" ? "#2ecc71" : s === "error" ? "#ff5555" : s === "running" ? "#f1c40f" : "#2a3042";
            }} />
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
