# DAG Flow UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the DAG Flow pane to match Portiq's design language — token-aligned node cards (direction B), a proper toolbar + themed canvas, an inspector panel that replaces the textarea wall, and an onboarding empty state.

**Architecture:** Presentation-only change. Introduce one shared style module (`dag/nodes/nodeStyles.ts`) so the four node renderers stop duplicating hex, rewrite each renderer + the toolbar/canvas chrome in `DagFlowPane`, add an empty state, and restyle `Inspector` (with a small reusable `TokenField` for `{{…}}` highlighting). No engine, resolver, storage, data-model, or behavior changes — the 39 unit tests stay green.

**Tech Stack:** React 18, TypeScript, `@xyflow/react` v12, Portiq CSS variables, vitest (existing).

## Global Constraints

- **Use Portiq CSS variables, never ad-hoc hex.** Tokens: `--bg:#0f1115`, `--panel:#151924`, `--panel-2`, `--border:#2a3042`, `--text:#e9edf5`, `--muted:#a2a9b8`, `--accent:#ff7a59`. Method: `--method-get:#2ed3c6`, `--method-post:#ffcc00`, `--method-put:#599eff`, `--method-patch:#bd93f9`, `--method-delete:#ff5555`, HEAD/OPTIONS `--muted`. Mono: `--font-mono:"IBM Plex Mono"`.
- Status colors: idle/skipped `--muted`, running `#f1c40f`, success `#2ecc71`, error `#ff5555`.
- Tinted backgrounds via `color-mix(in srgb, <color> 15%, transparent)` (Electron 30 / Chromium supports it).
- **No behavior/data changes.** Node `data` contract unchanged (`method/label/name/status/reason/brokenLink`). `Inspector` props unchanged. `runFlow`, `resolveTemplate`, `suggestRefs`, `resolveStepConfig` untouched.
- Every task ends green: `npx tsc --noEmit -p tsconfig.json` clean, `npm run build` succeeds, `npm test` 39/39, `npm run lint` no NEW errors (repo baseline is 0 errors / 164 warnings).
- Branding "DAG Flow", protocol id `"dag"` unchanged.
- Reference mockups: `docs/superpowers/specs/assets/dag-ui-nodes.png`, `dag-ui-canvas.png`, `dag-ui-empty-inspector.png`.

## File Structure

- Create: `src/components/ProtocolPanes/dag/nodes/nodeStyles.ts` — shared token-based style helpers.
- Create: `src/components/ProtocolPanes/dag/TokenField.tsx` — highlighted `{{…}}` editor field.
- Create: `src/components/ProtocolPanes/dag/tokenize.ts` + `tokenize.test.ts` — pure template splitter (unit-tested).
- Rewrite: `dag/nodes/RequestNode.tsx`, `PayloadNode.tsx`, `TransformNode.tsx`, `ConditionNode.tsx`.
- Modify: `DagFlowPane.tsx` (toolbar, canvas chrome, zoom/fit, empty state), `dag/AddStepPicker.tsx` (restyle), `dag/Inspector.tsx` (restyle).
- Maybe modify: `src/styles.css` (only if a needed token is missing; prefer existing vars).

Presentation tasks are verified by build/tsc/lint + manual check (no unit tests for rendering). Only Task 7's pure `tokenize` function is TDD.

---

## Task 1: Shared node style module

**Files:**
- Create: `src/components/ProtocolPanes/dag/nodes/nodeStyles.ts`

**Interfaces:**
- Produces (imported by all node renderers + toolbar/inspector):
  - `METHOD_COLOR: Record<string,string>`, `STATUS: Record<string,{color:string;label:string}>`, `ACCENT: string`
  - `skipReasonText(reason?: string): string`
  - `tint(color: string, pct?: number): string`
  - `nodeCard: CSSProperties`, `handleStyle: CSSProperties`
  - `tile(color: string): CSSProperties`, `statusPill(status: string): CSSProperties`, `refTag: CSSProperties`, `urlText: CSSProperties`

- [ ] **Step 1: Write the module**

```ts
import type { CSSProperties } from "react";

export const METHOD_COLOR: Record<string, string> = {
  GET: "var(--method-get)", POST: "var(--method-post)", PUT: "var(--method-put)",
  PATCH: "var(--method-patch)", DELETE: "var(--method-delete)",
  HEAD: "var(--muted)", OPTIONS: "var(--muted)",
};

export const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: "var(--muted)", label: "Idle" },
  pending: { color: "var(--muted)", label: "…" },
  running: { color: "#f1c40f", label: "Run" },
  success: { color: "#2ecc71", label: "OK" },
  error: { color: "#ff5555", label: "Fail" },
  skipped: { color: "var(--muted)", label: "skipped" },
};

export const ACCENT = "var(--accent)";

/** Translucent tint of a (possibly var()) color for chip/tile backgrounds. */
export const tint = (color: string, pct = 15): string =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function skipReasonText(reason?: string): string {
  if (reason === "upstream-error") return "skipped · upstream failed";
  if (reason === "losing-branch") return "skipped · branch not taken";
  return "skipped";
}

export const nodeCard: CSSProperties = {
  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14,
  boxShadow: "0 8px 22px rgba(0,0,0,.4)", color: "var(--text)",
};

export const handleStyle: CSSProperties = {
  width: 9, height: 9, borderRadius: "50%", background: "var(--bg)",
  border: "2px solid var(--accent)",
};

export const tile = (color: string): CSSProperties => ({
  width: 34, height: 34, borderRadius: 9, flex: "none",
  display: "flex", alignItems: "center", justifyContent: "center",
  font: '800 9px/1 var(--font-mono, monospace)', letterSpacing: ".04em",
  background: tint(color), color,
});

export const statusPill = (status: string): CSSProperties => {
  const c = (STATUS[status] || STATUS.idle).color;
  return {
    font: "700 9px/1 system-ui", padding: "4px 8px", borderRadius: 20,
    background: tint(c, 18), color: c, whiteSpace: "nowrap",
  };
};

export const refTag: CSSProperties = {
  font: '500 10.5px/1 var(--font-mono, monospace)', color: "var(--muted)",
};

export const urlText: CSSProperties = {
  font: '400 10.5px/1.3 var(--font-mono, monospace)', color: "var(--muted)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 6,
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (module is unused so far — that's fine; it's consumed in Task 2+).

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtocolPanes/dag/nodes/nodeStyles.ts
git commit -m "feat(dag-ui): add shared token-based node style module"
```

---

## Task 2: RequestNode — direction B

**Files:**
- Rewrite: `src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`

**Interfaces:**
- Consumes: `nodeStyles` (Task 1). Reads `data.method/label/name/status/brokenLink/reason` (unchanged contract).

- [ ] **Step 1: Rewrite the renderer**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { METHOD_COLOR, STATUS, nodeCard, handleStyle, tile, statusPill, refTag, urlText, skipReasonText } from "./nodeStyles";

export function RequestNode({ data, selected }: NodeProps) {
  const d = data as any;
  const method = (d.method || "GET").toUpperCase();
  const color = METHOD_COLOR[method] || "var(--muted)";
  const status = d.status || "idle";
  return (
    <div style={{ ...nodeCard, width: 226, padding: 12, display: "flex", gap: 11,
      outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={tile(color)}>{method}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "650 13.5px/1.15 system-ui", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          {d.brokenLink && <span title="Linked request missing" style={{ color: "#ff5555" }}>⚠</span>}
          <span style={statusPill(status)}>{(STATUS[status] || STATUS.idle).label}</span>
        </div>
        <div style={{ ...refTag, marginTop: 4 }}>@{d.name}</div>
        {d.io && <div style={urlText}>{d.io}</div>}
        {status === "skipped" && (
          <div style={{ font: "500 10px/1 system-ui", color: "var(--muted)", marginTop: 4 }}>{skipReasonText(d.reason)}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtocolPanes/dag/nodes/RequestNode.tsx
git commit -m "feat(dag-ui): redesign RequestNode (method tile + status pill + reference tag)"
```

---

## Task 3: Payload & Transform nodes

**Files:**
- Rewrite: `src/components/ProtocolPanes/dag/nodes/PayloadNode.tsx`
- Rewrite: `src/components/ProtocolPanes/dag/nodes/TransformNode.tsx`

**Interfaces:**
- Consumes: `nodeStyles`. Reads `data.label/name/status/reason`.

- [ ] **Step 1: Rewrite PayloadNode**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeCard, handleStyle, refTag, skipReasonText, tint } from "./nodeStyles";

const TEAL = "var(--method-get)";

export function PayloadNode({ data, selected }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ ...nodeCard, width: 190, padding: "11px 12px", background: tint(TEAL, 7),
      border: `1px solid ${TEAL}`, outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ font: '800 10px/1 var(--font-mono, monospace)', letterSpacing: ".04em", color: TEAL }}>{"{ } PAYLOAD"}</div>
      <div style={{ font: "650 13px/1.15 system-ui", marginTop: 5 }}>{d.label}</div>
      <div style={{ ...refTag, marginTop: 4 }}>@{d.name}</div>
      {d.status === "skipped" && <div style={{ font: "500 10px/1 system-ui", color: "var(--muted)", marginTop: 4 }}>{skipReasonText(d.reason)}</div>}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite TransformNode**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeCard, handleStyle, refTag, skipReasonText, tint } from "./nodeStyles";

const TEAL = "var(--method-get)";

export function TransformNode({ data, selected }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ ...nodeCard, width: 160, padding: "10px 12px", background: tint(TEAL, 8),
      border: `1px dashed ${TEAL}`, outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ font: '800 10px/1 var(--font-mono, monospace)', color: TEAL }}>ƒ TRANSFORM</div>
      <div style={{ font: "650 12.5px/1.15 system-ui", marginTop: 4 }}>{d.label}</div>
      <div style={{ ...refTag, marginTop: 3 }}>@{d.name}</div>
      {d.status === "skipped" && <div style={{ font: "500 10px/1 system-ui", color: "var(--muted)", marginTop: 4 }}>{skipReasonText(d.reason)}</div>}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

```bash
git add src/components/ProtocolPanes/dag/nodes/PayloadNode.tsx src/components/ProtocolPanes/dag/nodes/TransformNode.tsx
git commit -m "feat(dag-ui): redesign Payload and Transform nodes to shared card language"
```

---

## Task 4: ConditionNode

**Files:**
- Rewrite: `src/components/ProtocolPanes/dag/nodes/ConditionNode.tsx`

**Interfaces:**
- Consumes: `nodeStyles`. Keeps handle ids `"true"` (bottom) and `"false"` (right) — the engine/edge wiring depends on these ids; do NOT rename them.

- [ ] **Step 1: Rewrite the diamond**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleStyle, skipReasonText, tint } from "./nodeStyles";

const VIOLET = "var(--method-patch)";

export function ConditionNode({ data, selected }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ position: "relative", width: 74, height: 74 }}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: tint(VIOLET),
        border: `1.5px solid ${VIOLET}`, borderRadius: 9, outline: selected ? "2px solid var(--accent)" : "none" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        font: '700 8.5px/1.2 var(--font-mono, monospace)', color: VIOLET, textAlign: "center", padding: 6, wordBreak: "break-word" }}>{d.label}</div>
      {d.status === "skipped" && (
        <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 120,
          textAlign: "center", font: "500 10px/1 system-ui", color: "var(--muted)", whiteSpace: "nowrap", marginTop: 4 }}>{skipReasonText(d.reason)}</div>
      )}
      <Handle id="true" type="source" position={Position.Bottom} style={{ ...handleStyle, borderColor: "#2ecc71" }} />
      <Handle id="false" type="source" position={Position.Right} style={{ ...handleStyle, borderColor: "#ff5555" }} />
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

```bash
git add src/components/ProtocolPanes/dag/nodes/ConditionNode.tsx
git commit -m "feat(dag-ui): restyle ConditionNode diamond to tokens (violet, themed Y/N handles)"
```

---

## Task 5: Toolbar, canvas chrome, zoom/fit, picker restyle

**Files:**
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx` (toolbar + `<ReactFlow>` chrome)
- Rewrite: `src/components/ProtocolPanes/dag/AddStepPicker.tsx`

**Interfaces:**
- Consumes: `useReactFlow` is NOT used (avoids provider requirement); instead capture the instance via `onInit`.
- Produces: a styled toolbar with working zoom/fit/run and a token-styled picker popover.

- [ ] **Step 1: Capture the react-flow instance + toolbar state**

In `DagFlowPane.tsx`, add near the other hooks:

```tsx
import { ReactFlow, Background, Controls, MiniMap, type ReactFlowInstance } from "@xyflow/react";
import { useRef } from "react";
// ...
const rfRef = useRef<ReactFlowInstance | null>(null);
```

- [ ] **Step 2: Replace the toolbar markup**

Replace the current toolbar `<div>` (the one containing the three `.ghost` buttons) with:

```tsx
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
```

- [ ] **Step 3: Theme the canvas chrome**

Update the `<ReactFlow>` element to capture the instance and theme minimap/controls:

```tsx
<ReactFlow nodeTypes={NODE_TYPES} nodes={rfNodes} edges={rfEdges}
  onInit={(inst) => { rfRef.current = inst; }}
  onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
  onDelete={onDelete} onNodeClick={(_, n) => setSelectedId(n.id)} fitView
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
```

Note: the toolbar is `position:absolute` over the canvas, so add top padding to keep nodes clear — set the canvas container to `paddingTop` is not needed (react-flow pans); leave `fitView` to frame nodes below the toolbar.

- [ ] **Step 4: Restyle AddStepPicker**

Rewrite `AddStepPicker.tsx` body to use tokens and a cleaner layout (popover under the toolbar). Keep the same props/handlers:

```tsx
import React from "react";

export interface AddStepPickerProps {
  savedRequests: any[];
  onAddRequest: (method: string) => void;
  onLinkRequest: (req: any) => void;
  onAddPayload: () => void;
  onAddCondition: () => void;
  onAddTransform: () => void;
  onClose: () => void;
}

const card: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", textAlign: "left",
  width: "100%", border: "1px solid var(--border)", background: "var(--panel-2)", borderRadius: 10, padding: "9px 11px", color: "var(--text)", cursor: "pointer", marginBottom: 6 };
const ic = (bg: string, fg: string): React.CSSProperties => ({ width: 28, height: 28, borderRadius: 8, flex: "none",
  display: "flex", alignItems: "center", justifyContent: "center", font: '800 8.5px/1 var(--font-mono, monospace)',
  background: `color-mix(in srgb, ${fg} 15%, transparent)`, color: fg });

export function AddStepPicker(p: AddStepPickerProps) {
  return (
    <div style={{ position: "absolute", zIndex: 20, top: 60, left: 10, width: 300, background: "var(--panel)",
      border: "1px solid var(--border)", borderRadius: 12, padding: 12, maxHeight: 460, overflow: "auto", boxShadow: "0 10px 30px rgba(0,0,0,.45)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <b style={{ fontSize: "0.85rem" }}>Add step</b><button className="ghost" onClick={p.onClose}>✕</button>
      </div>
      <button style={card} onClick={() => { p.onAddRequest("GET"); p.onClose(); }}>
        <span style={ic("", "var(--method-post)")}>API</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Request</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Call an endpoint</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddPayload(); p.onClose(); }}>
        <span style={ic("", "var(--method-get)")}>{"{ }"}</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Payload</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Inject a JSON body</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddCondition(); p.onClose(); }}>
        <span style={ic("", "var(--method-patch)")}>◆</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Condition</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Branch on a response</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddTransform(); p.onClose(); }}>
        <span style={ic("", "var(--method-get)")}>ƒ</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Transform</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Reshape data (JS)</div></div>
      </button>
      <label style={{ font: "600 10px/1 system-ui", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", display: "block", margin: "10px 0 6px" }}>Link a saved request</label>
      {p.savedRequests.map(r => (
        <button key={r.id} className="ghost" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
          onClick={() => { p.onLinkRequest(r); p.onClose(); }}>{r.name || r.url}</button>
      ))}
    </div>
  );
}

export default AddStepPicker;
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds. If `ReactFlowInstance` import errors, import from `@xyflow/react` (it is exported there).

- [ ] **Step 6: Commit**

```bash
git add src/components/ProtocolPanes/DagFlowPane.tsx src/components/ProtocolPanes/dag/AddStepPicker.tsx
git commit -m "feat(dag-ui): redesign toolbar (coral Run, zoom/fit), theme canvas chrome, restyle step picker"
```

---

## Task 6: Empty state (onboarding)

**Files:**
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx`

**Interfaces:**
- Consumes: existing `onAddRequest/onAddPayload/onAddCondition/onAddTransform`, `setShowPicker`.

- [ ] **Step 1: Add the empty-state overlay**

Inside the canvas container (the `<div style={{ flex: 1, position: "relative" }}>`), render this overlay when `graph.nodes.length === 0`, above `<ReactFlow>`:

```tsx
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
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag-ui): add onboarding empty state with quick-add cards"
```

---

## Task 7: TokenField (highlighted {{…}} editor)

**Files:**
- Create: `src/components/ProtocolPanes/dag/tokenize.ts`
- Test: `src/components/ProtocolPanes/dag/tokenize.test.ts`
- Create: `src/components/ProtocolPanes/dag/TokenField.tsx`

**Interfaces:**
- Produces:
  - `splitTemplate(s: string): { ref: boolean; text: string }[]` — splits a string into literal/`{{…}}` segments (pure, unit-tested).
  - `TokenField({ value, onChange, rows, placeholder }): JSX` — a textarea with a highlighted overlay showing `{{…}}` in accent color.

- [ ] **Step 1: Write the failing test**

`src/components/ProtocolPanes/dag/tokenize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitTemplate } from "./tokenize";

describe("splitTemplate", () => {
  it("returns a single literal when there are no tokens", () => {
    expect(splitTemplate("hello")).toEqual([{ ref: false, text: "hello" }]);
  });
  it("splits a token in the middle", () => {
    expect(splitTemplate("Bearer {{login.body.token}}!")).toEqual([
      { ref: false, text: "Bearer " },
      { ref: true, text: "{{login.body.token}}" },
      { ref: false, text: "!" },
    ]);
  });
  it("handles adjacent and multiple tokens", () => {
    expect(splitTemplate("{{a}}{{b}}")).toEqual([
      { ref: true, text: "{{a}}" },
      { ref: true, text: "{{b}}" },
    ]);
  });
  it("returns empty array for empty string", () => {
    expect(splitTemplate("")).toEqual([]);
  });
  it("keeps an unclosed brace as a literal", () => {
    expect(splitTemplate("a {{b")).toEqual([{ ref: false, text: "a {{b" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tokenize`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tokenize.ts`**

```ts
/** Split a template string into literal and {{...}} reference segments (in order). */
export function splitTemplate(s: string): { ref: boolean; text: string }[] {
  const out: { ref: boolean; text: string }[] = [];
  if (!s) return out;
  const re = /\{\{[\s\S]*?\}\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ ref: false, text: s.slice(last, m.index) });
    out.push({ ref: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ ref: false, text: s.slice(last) });
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tokenize`
Expected: PASS.

- [ ] **Step 5: Implement `TokenField.tsx`**

```tsx
import { splitTemplate } from "./tokenize";

export function TokenField({ value, onChange, rows = 2, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  const shared: React.CSSProperties = {
    margin: 0, padding: "9px 11px", border: 0, width: "100%", boxSizing: "border-box",
    font: '400 11.5px/1.5 var(--font-mono, monospace)', whiteSpace: "pre-wrap", wordBreak: "break-word",
    gridArea: "1 / 1", background: "transparent", letterSpacing: 0,
  };
  return (
    <div style={{ display: "grid", background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div aria-hidden style={{ ...shared, color: "var(--text)", pointerEvents: "none" }}>
        {splitTemplate(value).map((seg, i) => seg.ref
          ? <span key={i} style={{ color: "#ffb59c" }}>{seg.text}</span>
          : <span key={i}>{seg.text}</span>)}
        {"​"}
      </div>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        spellCheck={false} style={{ ...shared, color: "transparent", caretColor: "var(--text)", resize: "vertical", outline: "none" }} />
    </div>
  );
}

export default TokenField;
```

- [ ] **Step 6: Verify build + commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build && npm test`
Expected: build succeeds; tests pass (39 + 5 new tokenize = 44).

```bash
git add src/components/ProtocolPanes/dag/tokenize.ts src/components/ProtocolPanes/dag/tokenize.test.ts src/components/ProtocolPanes/dag/TokenField.tsx
git commit -m "feat(dag-ui): add TokenField with {{…}} highlighting (tokenize unit-tested)"
```

---

## Task 8: Inspector redesign

**Files:**
- Modify: `src/components/ProtocolPanes/dag/Inspector.tsx`

**Interfaces:**
- Consumes: `nodeStyles` (Task 1), `TokenField` (Task 7). Props and all behavior unchanged (name-on-blur commit, `patchOverride`, `onDetach`, `suggestRefs`, `resolveTemplate`, `buildResolvedPreview`, tabs).

- [ ] **Step 1: Restyle the panel shell + header**

Widen to 360, add reference tag + hint. Replace the outer wrapper and header block:

```tsx
<div style={{ width: 360, borderLeft: "2px solid var(--border)", background: "var(--panel)", overflow: "auto" }}>
  <div style={{ padding: "14px 15px 0" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input value={node.label} onChange={e => onUpdate(node.id, { label: e.target.value })}
        style={{ font: "650 15px/1 system-ui", flex: 1, background: "transparent", border: "none", color: "var(--text)", outline: "none" }} />
      <button className="ghost" onClick={onClose}>✕</button>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
      <input value={nameDraft} onChange={e => setNameDraft(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
        onBlur={commitName} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ font: '600 11px/1 var(--font-mono, monospace)', color: "#ff9f88",
          background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          padding: "4px 8px", borderRadius: 6, width: 120 }} />
      <span style={{ font: "400 10.5px/1 system-ui", color: "var(--muted)" }}>used as {"{{"}{nameDraft}.…{"}}"}</span>
    </div>
  </div>
  <div style={{ padding: 15 }}>
    {/* per-type editors (steps below) */}
  </div>
</div>
```

Keep the existing `useState`/`useEffect`/`commitName`/`patchData`/`patchOverride`/`lookupConfig` logic exactly as-is.

- [ ] **Step 2: Restyle RequestInspector fields with TokenField + chips + preview**

In `RequestInspector`, replace the linked-request `<select>` block and the `FIELDS.map` body. Linked-request row:

```tsx
<div style={{ marginBottom: 15 }}>
  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, font: "600 10.5px/1 system-ui", color: "var(--muted)" }}>
    <span>Linked request</span>
    {linked && <span onClick={onDetach} style={{ color: "#ff9f88", cursor: "pointer", fontWeight: 600 }}>Detach to copy</span>}
  </div>
  <select value={data.linkedRequestId || ""} onChange={e => patchData({ linkedRequestId: e.target.value || undefined })}
    style={{ width: "100%", background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", color: "var(--text)" }}>
    <option value="">(inline / none)</option>
    {savedRequests.map((r: any) => <option key={r.id} value={r.id}>{r.name || r.url}</option>)}
  </select>
</div>
<div style={{ marginBottom: 15 }}>
  <label style={{ font: "600 10.5px/1 system-ui", color: "var(--muted)" }}>Method {linked ? "(override)" : ""}</label>
  <select value={val("method") || "GET"} onChange={e => patchOverride("method", e.target.value)}
    style={{ display: "block", marginTop: 6, background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)" }}>
    {["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].map(m => <option key={m}>{m}</option>)}
  </select>
</div>
```

Then the fields loop, using `TokenField` and moving chips + resolved preview under each:

```tsx
{FIELDS.map(([k, lbl]) => {
  const fieldValue = val(k);
  return (
    <div key={k} style={{ marginBottom: 15 }}>
      <label style={{ display: "block", font: "600 10.5px/1 system-ui", color: "var(--muted)", marginBottom: 6 }}>{lbl} {linked ? "(override)" : ""}</label>
      <TokenField value={fieldValue} onChange={(v) => patchOverride(k, v)} rows={k === "body" || k === "headers" ? 4 : 2}
        placeholder={k === "headers" ? '{"Authorization":"Bearer {{login.body.token}}"}' : ""} />
      {hasRunData && fieldValue.includes("{{") && (
        <div style={{ font: '400 10.5px/1.4 var(--font-mono, monospace)', color: "#4fdccf", marginTop: 6 }}>→ {resolveTemplate(fieldValue, resolveCtx)}</div>
      )}
      {refSuggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {refSuggestions.map(s => (
            <button key={s} type="button" title={`Insert ${s}`} onClick={() => patchOverride(k, fieldValue + s)}
              style={{ font: '500 10px/1 var(--font-mono, monospace)', color: "#8fd7cf", cursor: "pointer",
                background: "color-mix(in srgb, var(--method-get) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--method-get) 28%, transparent)",
                padding: "4px 7px", borderRadius: 6 }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
})}
```

Import `TokenField` at the top: `import { TokenField } from "./TokenField";`

- [ ] **Step 3: Restyle Payload/Condition/Transform editors + tabs**

Use `TokenField` for the payload content and condition/transform editors (they accept `{{…}}` too), and give the tab buttons the token look (active tab = coral bottom-border). Payload:

```tsx
<TokenField value={data.content || ""} onChange={(v) => patchData({ content: v })} rows={12}
  placeholder='{"key": "{{login.body.token}}"}' />
```

Condition/Transform: same `TokenField` with rows 4 / 12 and their existing placeholders.

For `ResultTabs`, style the tab row:

```tsx
<div style={{ display: "flex", gap: 2, marginBottom: 8, borderBottom: "1px solid var(--border)" }}>
  {(["resolved","request","response"] as ResultTab[]).map(t => (
    <button key={t} onClick={() => setTab(t)} style={{ font: "600 12px/1 system-ui", background: "none", border: "none",
      color: tab === t ? "var(--text)" : "var(--muted)", padding: "9px 12px", cursor: "pointer",
      borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent" }}>{t}</button>
  ))}
</div>
```

- [ ] **Step 4: Verify build + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build && npm test`
Expected: build succeeds; 44 tests pass (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/Inspector.tsx
git commit -m "feat(dag-ui): redesign inspector (reference tag, TokenField fields, chips, resolved preview, styled tabs)"
```

---

## Task 9: Verification, screenshot, docs

**Files:**
- Modify: `README.md` (only if the DAG screenshot/wording is stale)

- [ ] **Step 1: Full gate**

Run: `npm test && npm run build && npm run lint`
Expected: 44 tests pass; build succeeds; lint 0 errors (164 warnings baseline — no NEW errors from these files).

- [ ] **Step 2: Manual smoke of the four goals**

`npm run dev` (or open the packaged app). Verify against the mockups in `docs/superpowers/specs/assets/`:
1. **Polish:** create a DAG request → empty state appears; add a request → node uses method tile + status pill + `@name`, colors match app tokens.
2. **Flow-building:** toolbar Add step / Auto-layout / Fit / zoom / coral Run all work; drag-connect uses coral handles; condition Y/N branch.
3. **Clarity:** run the flow → status pills animate; inspector shows highlighted `{{…}}`, `→ resolved` preview, chips; a skipped branch shows its reason.
4. **Onboarding:** empty state quick-add cards + Link a saved request work.

- [ ] **Step 3: Update README wording if needed**

If `README.md`'s DAG row/screenshot references the old look, update the one-line description (keep it one line). Do not regenerate screenshots unless asked.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(dag-ui): final verification and README wording"
```

---

## Self-Review Notes (author)

- **Spec coverage:** tokens/shared styles (T1), node B for all four types (T2–T4), toolbar+canvas+zoom/fit+picker (T5), empty state (T6), TokenField highlighting (T7), inspector redesign (T8), verification/docs (T9). All four pain areas + all spec sections mapped.
- **No behavior change:** node `data` contract, `Inspector` props, engine/resolver/storage untouched; only Task 7 adds a pure tested function. 39 existing tests unaffected (44 total after tokenize).
- **Type consistency:** `nodeStyles` exports (`METHOD_COLOR`, `STATUS`, `tint`, `tile`, `statusPill`, `handleStyle`, `nodeCard`, `refTag`, `urlText`, `skipReasonText`) used verbatim in T2–T5/T8; `splitTemplate`/`TokenField` signatures match between T7 and T8; condition handle ids `"true"`/`"false"` preserved (engine depends on them).
- **Risk:** `color-mix` requires the Electron Chromium in use (30+ → fine). `ReactFlowInstance` import + `onInit` capture avoids the `useReactFlow` provider requirement.
