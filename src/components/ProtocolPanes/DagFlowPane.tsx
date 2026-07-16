import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, applyNodeChanges, MarkerType, useNodesState,
  type Node, type Edge, type Connection, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
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

// Module-scope so these object/function identities never change across renders — passed
// straight through to <MiniMap>/<ReactFlow> props so they never trigger prop-identity churn.
const MINIMAP_STYLE: React.CSSProperties = { background: "var(--panel)", border: "1px solid var(--border)" };
const PRO_OPTIONS = { hideAttribution: true };
function miniMapNodeColor(n: Node): string {
  const s = (n.data as any)?.status;
  return s === "success" ? "#2ecc71" : s === "error" ? "#ff5555" : s === "running" ? "#f1c40f" : "#2a3042";
}

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

  // Always-current view of the `graph` prop. runWithMode's closure captures `graph`
  // once at call time, but a run can be slow (network) and the user can edit the
  // graph meanwhile (drag/connect/Inspector — none are disabled mid-run). The
  // post-run lastRun persist must build off the LATEST graph, not the pre-run
  // snapshot, or the onChange would revert any edits made during the run.
  const graphRef = useRef(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);

  // Seed the ephemeral run state (statuses/results) from the persisted `lastRun`
  // once on mount, so a reload of the same flow restores what's on screen. Old
  // graphs with no `lastRun` are unaffected and stay idle.
  useEffect(() => {
    const lr = graph.lastRun;
    if (!lr) return;
    setRunSteps(lr.steps || {});
    setStatusMap(lr.statuses || {});
    setSkipReasons(lr.skipReasons || {});
    const byId: Record<string, StepResult> = {};
    graph.nodes.forEach(n => { const r = lr.steps?.[n.name]; if (r) byId[n.id] = r; });
    setStepResults(byId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // hydrate once on mount for the loaded flow

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

  // Always-current ref to the latest onDelete, so the per-node action bundles built in
  // getActionsFor (below) can stay referentially stable across renders (their identity
  // never needs to change) while still calling the latest onDelete behavior.
  const onDeleteRef = useRef(onDelete);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

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
      // Build the persisted lastRun off the LATEST graph (via graphRef), not the
      // pre-run `graph` closure, so edits made during a slow run aren't reverted.
      const nextSteps = { ...runSteps, ...result };
      const mergedStatuses = { ...(graphRef.current.lastRun?.statuses ?? {}), ...collectedStatus };
      const mergedSkips = { ...(graphRef.current.lastRun?.skipReasons ?? {}), ...collectedSkips };
      onChange({ ...graphRef.current, lastRun: { steps: nextSteps, statuses: mergedStatuses, skipReasons: mergedSkips, ranAt: new Date().toISOString() } });
    } finally {
      setIsRunning(false);
    }
  }, [graph, lookupConfig, env, sendRequest, isRunning, runSteps, onChange]);

  // Always-current ref, mirroring onDeleteRef above, so getActionsFor's bound closures
  // stay stable identities while always invoking the latest runWithMode.
  const runWithModeRef = useRef(runWithMode);
  useEffect(() => { runWithModeRef.current = runWithMode; }, [runWithMode]);

  const handleRun = useCallback(() => runWithMode("all"), [runWithMode]);

  // Per-node id -> stable action-handler bundle. Each bundle's function identities never
  // change for the lifetime of a given node id (they close over the *ref*, not the
  // callback itself), so a node's `data` object can embed them without ever needing to be
  // rebuilt just because runWithMode/onDelete got new identities upstream. This is what
  // lets derivedNodes (below) reuse the same `data` reference across renders whenever a
  // node's actual visible inputs haven't changed — the crux of making React.memo on the
  // node components effective (Fix #2).
  const nodeActionsCacheRef = useRef(new Map<string, {
    onEdit: () => void; onRunOnly: () => void; onRunFrom: () => void; onRunUpTo: () => void; onDelete: () => void;
  }>());
  const getActionsFor = useCallback((id: string) => {
    const cache = nodeActionsCacheRef.current;
    let actions = cache.get(id);
    if (!actions) {
      actions = {
        onEdit: () => setSelectedId(id),
        onRunOnly: () => runWithModeRef.current("only", id),
        onRunFrom: () => runWithModeRef.current("from", id),
        onRunUpTo: () => runWithModeRef.current("upTo", id),
        onDelete: () => onDeleteRef.current({ nodes: [{ id } as any], edges: [] }),
      };
      cache.set(id, actions);
    }
    return actions;
  }, []);

  // Per-node id -> last computed `data` object, keyed by a cheap signature of that node's
  // *meaningful* inputs (label/name/method/brokenLink/status/skip-reason). When a node's
  // signature hasn't changed since last time, we reuse the exact same `data` object
  // reference instead of allocating a new one — so React.memo on the node components can
  // bail out for every node except the one(s) whose inputs actually changed.
  const nodeDataCacheRef = useRef(new Map<string, { sig: string; data: Record<string, unknown> }>());

  // derivedNodes/rfEdges must be declared after onDelete and runWithMode (above), since
  // getActionsFor's lazily-created bundles call through onDeleteRef/runWithModeRef which
  // must already exist; referencing them earlier would throw "Cannot access before
  // initialization" (TDZ) on first render.
  //
  // Note this intentionally does NOT depend on `selectedId`: selection is tracked directly
  // on the local react-flow node's own `selected` flag (synced in a separate, targeted
  // effect below) rather than folded into `data`, so selecting a node never invalidates
  // every other node's `data` identity.
  const derivedNodes: Node[] = useMemo(() => {
    const cache = nodeDataCacheRef.current;
    const seen = new Set<string>();
    const nodes = graph.nodes.map(n => {
      seen.add(n.id);
      let method: string | undefined;
      let brokenLink: boolean | undefined;
      if (n.type === "request") {
        const resolved = resolveStepConfig(n.data as RequestNodeData, lookupConfig);
        method = resolved.config.method;
        brokenLink = resolved.brokenLink;
      }
      const status = statusMap[n.id] ?? n.status;
      const reason = skipReasons[n.id];
      const sig = JSON.stringify([n.label, n.name, method, brokenLink, status, reason]);
      const cached = cache.get(n.id);
      let data: Record<string, unknown>;
      if (cached && cached.sig === sig) {
        data = cached.data;
      } else {
        data = { label: n.label, name: n.name, status, method, brokenLink, reason, ...getActionsFor(n.id) };
        cache.set(n.id, { sig, data });
      }
      return {
        id: n.id, type: n.type,
        position: graph.positions[n.id] || { x: 0, y: 0 },
        data,
      };
    });
    // Prune caches for nodes that no longer exist so long sessions with lots of add/delete
    // churn don't leak entries forever.
    for (const id of Array.from(cache.keys())) if (!seen.has(id)) cache.delete(id);
    for (const id of Array.from(nodeActionsCacheRef.current.keys())) if (!seen.has(id)) nodeActionsCacheRef.current.delete(id);
    return nodes;
  }, [graph, lookupConfig, statusMap, skipReasons, getActionsFor]);

  // Local react-flow node state: react-flow owns live position/dimension updates here
  // during a drag (via onNodesChangeInternal below), so dragging one node never writes to
  // `graph`/localStorage on every frame (Fix #1). Seeded with derivedNodes's *initial*
  // value so the very first mount already has real nodes (preserving `fitView`-on-load).
  const [rfNodes, setRfNodes] = useNodesState<Node>(derivedNodes);

  // Sync derivedNodes (graph/status/skip-reason driven) into the local node state,
  // preserving each node's live `position` while it's actively being dragged (so a
  // concurrent graph update — e.g. an Inspector edit mid-drag — can't yank the node out
  // from under the user's cursor), and otherwise adopting the latest graph position (so
  // auto-layout, undo, etc. still visibly move nodes). Nodes whose data/position/type are
  // all unchanged keep their exact previous object reference.
  const draggingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    setRfNodes(prev => {
      if (prev === derivedNodes) return prev;
      const prevById = new Map(prev.map(n => [n.id, n]));
      return derivedNodes.map(dn => {
        const p = prevById.get(dn.id);
        if (!p) return dn; // brand-new node: use its derived (graph) position as-is
        const position = draggingIdsRef.current.has(dn.id) ? p.position : dn.position;
        if (p.data === dn.data && p.position === position && p.type === dn.type) return p;
        return { ...p, data: dn.data, type: dn.type, position };
      });
    });
  }, [derivedNodes, setRfNodes]);

  // Selection is applied directly to react-flow's own per-node `selected` flag rather than
  // folded into `data` (see derivedNodes above). This effect only touches the (at most two)
  // nodes whose selected state actually flips, so selecting a node doesn't recreate every
  // other node's object identity either.
  useEffect(() => {
    setRfNodes(prev => {
      let changed = false;
      const next = prev.map(n => {
        const shouldSelect = n.id === selectedId;
        if (!!n.selected === shouldSelect) return n;
        changed = true;
        return { ...n, selected: shouldSelect };
      });
      return changed ? next : prev;
    });
  }, [selectedId, setRfNodes]);

  const rfEdges: Edge[] = useMemo(() => graph.edges.map(e => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.branch === "true" ? "true" : e.branch === "false" ? "false" : undefined,
    label: e.branch ? (e.branch === "true" ? "Y" : "N") : e.runOnFailure ? "on-fail" : undefined,
    // Directional arrowhead so the flow's entry→exit direction is visible on every edge.
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#8a94a6" },
  })), [graph]);

  // Node/edge *removal* is handled exclusively by onDelete (React Flow v12's unified
  // deletion callback) above, which applies node deletions, edge deletions, and edges
  // implied by deleted nodes in a single onChange update. Edge creation is handled by
  // onConnect. There is intentionally no onEdgesChange: edges are managed entirely by
  // onConnect/onDelete, and edge selection isn't part of our persisted model.
  //
  // Position/dimension changes (including every frame of a drag) are applied to the LOCAL
  // `rfNodes` state ONLY, never persisted to `graph`/localStorage here — that's the whole
  // point of Fix #1. Position is persisted exactly once, in onNodeDragStop below. `select`
  // changes are dropped: selection is driven exclusively by our own onNodeClick/onPaneClick
  // + selectedId (see the effect above), so multi-select gestures don't leak a second
  // notion of "selected" into the UI (preserving the original single-select behavior).
  const onNodesChangeInternal = useCallback((changes: NodeChange[]) => {
    const filtered = changes.filter(c => c.type !== "select");
    if (!filtered.length) return;
    setRfNodes(nds => applyNodeChanges(filtered, nds));
  }, [setRfNodes]);

  const onNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, _node: Node, draggedNodes: Node[]) => {
    draggedNodes.forEach(n => draggingIdsRef.current.add(n.id));
  }, []);

  // Persist final positions exactly once per drag, off the LATEST graph (via graphRef) so
  // mid-run edits made while a slow drag was in progress aren't reverted (same invariant
  // runWithMode's post-run persist relies on).
  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, _node: Node, draggedNodes: Node[]) => {
    draggedNodes.forEach(n => draggingIdsRef.current.delete(n.id));
    const g = graphRef.current;
    const positions: Record<string, DagPosition> = { ...g.positions };
    draggedNodes.forEach(n => { positions[n.id] = n.position; });
    onChange({ ...g, positions });
  }, [onChange]);

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) : undefined;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", zIndex: 5, top: 10, left: 10, right: 10, display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <span style={{ font: "650 12.5px/1 system-ui" }}>DAG Flow</span>
          <span style={{ font: '500 10.5px/1 var(--font-mono, monospace)', color: "var(--muted)", background: "var(--panel-2)",
            border: "1px solid var(--border)", padding: "4px 8px", borderRadius: 6 }}>{graph.nodes.length} steps</span>
          {graph.lastRun && !isRunning && (
            <span style={{ font: "500 10px/1 system-ui", color: "var(--muted)" }}>
              · results from last run
            </span>
          )}
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
          onNodesChange={onNodesChangeInternal} onConnect={onConnect}
          onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
          onDelete={onDelete} onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeClickDistance={5} selectNodesOnDrag={false} connectionRadius={40} fitView
          proOptions={PRO_OPTIONS}>
          <Background color="#222838" gap={19} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.6)" style={MINIMAP_STYLE} nodeColor={miniMapNodeColor} />
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
          status={statusMap[selectedNode.id] ?? selectedNode.status}
          onRunFrom={(id) => runWithMode("from", id)}
        />
      )}
    </div>
  );
}

export default DagFlowPane;
