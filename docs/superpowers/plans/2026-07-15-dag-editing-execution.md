# DAG Editing & Execution Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DAG nodes editable, fix edge linking, and add per-step execution (run only / from / up-to, plus edit-and-retry after failure) with run state that persists across restarts.

**Architecture:** Pure logic first — a `traverse.ts` helper (descendants/ancestors) and a backward-compatible `RunOptions` argument on `runFlow` that restricts the executed node-set and seeds a prior `steps` context. Then the UI: a shared node action bar, enlarged handle hit-targets, generalized run dispatch in `DagFlowPane`, `DagGraph.lastRun` persistence/hydration, and an Inspector "Retry from here" affordance.

**Tech Stack:** React 18 + TypeScript, @xyflow/react v12, vitest, lucide-react (icons, already a dependency).

## Global Constraints

- Reference syntax is unchanged: `{{steps.<name>...}}`, `{{env.X}}`, `{{= expr}}`. Do not touch `resolver.ts`, `buildRequest.ts`, `linkResolve.ts`.
- Condition-node source handle ids MUST remain exactly `"true"` (bottom) and `"false"` (right) — engine branch logic and edge wiring depend on them.
- `runFlow`'s new options argument is optional; `mode` defaults to `"all"` and MUST reproduce today's behavior. All existing DAG unit tests (44) stay green.
- `DagGraph.lastRun` is optional and additive — do NOT bump `DagGraph.version` (stays `2`); `migrate.ts` is untouched.
- Use existing Portiq design tokens and `nodeStyles.ts`/`STATUS` colors — no ad-hoc hex. Icons come from `lucide-react`.
- After every task: `npx tsc --noEmit`, `npm run build`, and `npm run lint` are clean; `npm test` passes.
- Do not modify files outside `src/components/ProtocolPanes/` and `src/styles.css`.

---

### Task 1: Graph traversal helpers

**Files:**
- Create: `src/components/ProtocolPanes/dag/traverse.ts`
- Test: `src/components/ProtocolPanes/dag/traverse.test.ts`

**Interfaces:**
- Consumes: `DagGraph` from `./types`.
- Produces: `descendants(graph: DagGraph, id: string): Set<string>` and `ancestors(graph: DagGraph, id: string): Set<string>`. Both are **inclusive** of `id`, and both ignore self-edges (`e.from === e.to`).

- [ ] **Step 1: Write the failing test**

Create `src/components/ProtocolPanes/dag/traverse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { descendants, ancestors } from "./traverse";
import type { DagGraph } from "./types";

function g(edges: [string, string][]): DagGraph {
  const ids = Array.from(new Set(edges.flat()));
  return {
    version: 2,
    nodes: ids.map(id => ({ id, type: "request", name: id, label: id,
      data: { overrides: {}, inlineConfig: { method: "GET", url: id, headers: "", body: "", params: "", pathVars: "" } }, status: "idle" })),
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
    positions: {},
  };
}

describe("descendants", () => {
  it("includes the node and everything reachable downstream", () => {
    const graph = g([["a", "b"], ["b", "c"], ["b", "d"]]);
    expect(descendants(graph, "b")).toEqual(new Set(["b", "c", "d"]));
  });
  it("is just the node when it has no out-edges", () => {
    expect(descendants(g([["a", "b"]]), "b")).toEqual(new Set(["b"]));
  });
  it("ignores self-edges", () => {
    const graph = g([["a", "a"], ["a", "b"]]);
    expect(descendants(graph, "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("ancestors", () => {
  it("includes the node and everything that reaches it", () => {
    const graph = g([["a", "b"], ["b", "c"], ["x", "c"]]);
    expect(ancestors(graph, "c")).toEqual(new Set(["c", "b", "a", "x"]));
  });
  it("is just the node when it has no in-edges", () => {
    expect(ancestors(g([["a", "b"]]), "a")).toEqual(new Set(["a"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ProtocolPanes/dag/traverse.test.ts`
Expected: FAIL — cannot find module `./traverse`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/ProtocolPanes/dag/traverse.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ProtocolPanes/dag/traverse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ProtocolPanes/dag/traverse.ts src/components/ProtocolPanes/dag/traverse.test.ts
git commit -m "feat(dag): add descendants/ancestors graph traversal helpers"
```

---

### Task 2: Engine run modes (`RunOptions`)

**Files:**
- Modify: `src/components/ProtocolPanes/dag/types.ts` (add `RunMode`, `RunOptions`)
- Modify: `src/components/ProtocolPanes/dag/engine.ts` (`runFlow` signature + node-set restriction + seeding)
- Test: `src/components/ProtocolPanes/dag/engine.test.ts` (add mode tests)

**Interfaces:**
- Consumes: `descendants`, `ancestors` from `./traverse`; `StepsContext` from `./types`.
- Produces: `export type RunMode = "all" | "only" | "from" | "upTo";`, `export interface RunOptions { mode?: RunMode; targetId?: string; priorSteps?: StepsContext; }`, and `runFlow(graph: DagGraph, deps: RunDeps, options?: RunOptions): Promise<StepsContext>`.

- [ ] **Step 1: Add the types**

In `src/components/ProtocolPanes/dag/types.ts`, after the `StepsContext` type (line ~72), add:

```ts
export type RunMode = "all" | "only" | "from" | "upTo";

export interface RunOptions {
  mode?: RunMode;        // default "all"
  targetId?: string;     // node the mode is relative to (required for only/from/upTo)
  priorSteps?: StepsContext; // last run's results, reused by only/from
}
```

- [ ] **Step 2: Write the failing tests**

In `src/components/ProtocolPanes/dag/engine.test.ts`, append a new `describe` block:

```ts
import { descendants } from "./traverse"; // ensure traverse is importable in this suite

describe("runFlow modes", () => {
  function reqNode(id: string, url: string) {
    return { id, type: "request" as const, name: id, label: id,
      data: { overrides: {}, inlineConfig: { method: "GET", url, headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const };
  }
  const chain = () => graph({
    nodes: [reqNode("a", "a"), reqNode("b", "{{steps.a.response.body.v}}"), reqNode("c", "c")],
    edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "c" }],
  });

  it("mode 'only' runs just the target and reuses priorSteps", async () => {
    const send = vi.fn(async (p: any) => ({ status: 200, headers: {}, data: { echoed: p.url }, time: 1 }));
    const statuses: Record<string, string> = {};
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statuses[id] = s; } },
      { mode: "only", targetId: "b", priorSteps: { a: { response: { status: 200, body: { v: "X" }, data: { v: "X" } } } } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].url).toBe("X");   // b resolved a's reused result
    expect(statuses).toEqual({ b: expect.any(String) }); // only b got status updates
    expect(statuses.a).toBeUndefined();
  });

  it("mode 'from' runs target + descendants, reusing upstream", async () => {
    const send = vi.fn(async (p: any) => ({ status: 200, headers: {}, data: { echoed: p.url }, time: 1 }));
    const ran: string[] = [];
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { if (s === "success") ran.push(id); } },
      { mode: "from", targetId: "b", priorSteps: { a: { response: { status: 200, body: { v: "X" }, data: { v: "X" } } } } });
    expect(ran).toEqual(["b", "c"]);               // a not re-run
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("mode 'upTo' runs ancestors + target and stops", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: {}, time: 1 }));
    const ran: string[] = [];
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { if (s === "success") ran.push(id); } },
      { mode: "upTo", targetId: "b" });
    expect(ran).toEqual(["a", "b"]);               // c not run
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/ProtocolPanes/dag/engine.test.ts`
Expected: FAIL — `runFlow` ignores the 3rd argument (all three nodes run; assertions on call counts/statuses fail).

- [ ] **Step 4: Implement run modes in the engine**

In `src/components/ProtocolPanes/dag/engine.ts`:

1. Add imports at the top: `import { descendants, ancestors } from "./traverse";` and add `RunOptions` to the type import from `./types`.

2. Add this helper above `runFlow`:

```ts
function activeNodeSet(graph: DagGraph, mode: RunMode, targetId?: string): Set<string> {
  if (mode === "only") return new Set(targetId ? [targetId] : []);
  if (mode === "from") return targetId ? descendants(graph, targetId) : new Set();
  if (mode === "upTo") return targetId ? ancestors(graph, targetId) : new Set();
  return new Set(graph.nodes.map(n => n.id)); // "all"
}
```
(Import `RunMode` too, or inline the union — prefer importing `RunMode` from `./types`.)

3. Change the signature and the setup of `runFlow`:

```ts
export async function runFlow(graph: DagGraph, deps: RunDeps, options: RunOptions = {}): Promise<StepsContext> {
  const mode = options.mode ?? "all";
  const active = activeNodeSet(graph, mode, options.targetId);

  const nodeMap: Record<string, DagNode> = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const outEdges: Record<string, DagEdge[]> = {};
  graph.nodes.forEach(n => { outEdges[n.id] = []; });
  graph.edges.forEach(e => { outEdges[e.from]?.push(e); });

  // Seed prior results so run-only / run-from can reference upstream steps without re-calling them.
  const seed = (mode === "only" || mode === "from") ? (options.priorSteps ?? {}) : {};
  const steps: StepsContext = { ...seed };
  const skip = new Set<string>();
  const blockedEdges = new Set<string>();
  const order = topoSort(graph).filter(id => active.has(id));

  for (const id of order) {
    const node = nodeMap[id];
    if (!node) continue;

    // Only edges whose source is ALSO in the active set participate in skip/branch propagation.
    // Edges from outside the active set (reused upstream) are treated as already satisfied.
    const incoming = graph.edges.filter(e => e.to === id && e.from !== e.to && active.has(e.from));
    if (incoming.length > 0) {
      let reason: string | undefined;
      const allowed = incoming.some(e => {
        if (blockedEdges.has(e.id)) { reason = "losing-branch"; return false; }
        const src = nodeMap[e.from];
        if (src?.status === "error" && !e.runOnFailure) { reason = "upstream-error"; return false; }
        if (src?.status === "skipped" || skip.has(e.from)) { reason = "upstream-skipped"; return false; }
        return true;
      });
      if (!allowed) { skip.add(id); node.status = "skipped"; deps.onStatus(id, "skipped", { reason }); continue; }
    }

    // ... REST OF THE EXISTING LOOP BODY IS UNCHANGED (condition / payload / transform / request handling) ...
```

Everything from `const ctx: ResolveContext = ...` through the end of the loop and `return steps;` stays exactly as it is today. Only the three lines above (`mode`, `active`, `seed`/`order`) and the `incoming` filter (`&& active.has(e.from)`) change.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/ProtocolPanes/dag/engine.test.ts`
Expected: PASS — the new mode tests pass and every pre-existing engine test still passes (default `mode:"all"` is unchanged).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProtocolPanes/dag/types.ts src/components/ProtocolPanes/dag/engine.ts src/components/ProtocolPanes/dag/engine.test.ts
git commit -m "feat(dag): runFlow run modes (only/from/upTo) with prior-step reuse"
```

---

### Task 3: Shared node action bar + enlarged handle hit-targets

**Files:**
- Create: `src/components/ProtocolPanes/dag/nodes/NodeActions.tsx`
- Modify: `src/components/ProtocolPanes/dag/nodes/nodeStyles.ts` (add `handleDot`; widen hit-target)
- Modify: `src/components/ProtocolPanes/dag/nodes/RequestNode.tsx`, `PayloadNode.tsx`, `ConditionNode.tsx`, `TransformNode.tsx`
- Modify: `src/styles.css` (hover-reveal rule)

**Interfaces:**
- Produces: `NodeActionHandlers` and `NodeActions` component. `NodeActionHandlers = { onEdit?, onRunOnly?, onRunFrom?, onRunUpTo?, onDelete?, status?: string }` (all callbacks `() => void`). Node renderers read these off `data` (react-flow node `data`), and `DagFlowPane` (Task 4) populates them.
- Consumes: `STATUS` from `./nodeStyles`.

- [ ] **Step 1: Add `handleDot` and widen the handle hit-target**

In `src/components/ProtocolPanes/dag/nodes/nodeStyles.ts`, replace the `handleStyle` export with:

```ts
/** Handle rendered as a small visible dot centered inside a large transparent hit-target,
 *  so dragging to connect is easy without grabbing the card or panning the canvas. */
export const handleDot = (color = "var(--accent)"): CSSProperties => ({
  width: 18, height: 18, borderRadius: "50%", border: "none",
  background: `radial-gradient(circle, ${color} 0 4.5px, transparent 5.5px)`,
});

export const handleStyle: CSSProperties = handleDot();
```

- [ ] **Step 2: Point condition handles at `handleDot`**

In `src/components/ProtocolPanes/dag/nodes/ConditionNode.tsx`, import `handleDot` and change the two source handles (keep the ids exactly `"true"`/`"false"`):

```tsx
<Handle id="true" type="source" position={Position.Bottom} style={handleDot("#2ecc71")} />
<Handle id="false" type="source" position={Position.Right} style={handleDot("#ff5555")} />
```
(The target handle stays `style={handleStyle}`.)

- [ ] **Step 3: Create the shared action bar**

Create `src/components/ProtocolPanes/dag/nodes/NodeActions.tsx`:

```tsx
import { Pencil, Play, Circle, FlagTriangleRight, Trash2 } from "lucide-react";
import { STATUS } from "./nodeStyles";

export interface NodeActionHandlers {
  onEdit?: () => void;
  onRunOnly?: () => void;
  onRunFrom?: () => void;
  onRunUpTo?: () => void;
  onDelete?: () => void;
  status?: string;
}

const btn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22,
  border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--muted)",
  borderRadius: 6, cursor: "pointer", padding: 0,
};

function stop(fn?: () => void) {
  return (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); fn?.(); };
}

export function NodeActions(h: NodeActionHandlers) {
  const failed = h.status === "error";
  return (
    <div className="dag-node-actions" style={{ position: "absolute", top: -12, right: 6, display: "flex", gap: 4, zIndex: 3 }}>
      {h.onEdit && <button type="button" title="Edit" style={btn} onClick={stop(h.onEdit)}><Pencil size={12} /></button>}
      {h.onRunFrom && (
        <button type="button" title={failed ? "Retry from here" : "Run from here"} onClick={stop(h.onRunFrom)}
          style={{ ...btn, color: failed ? STATUS.error.color : "var(--accent)", borderColor: failed ? STATUS.error.color : "var(--accent)" }}>
          <Play size={12} />
        </button>
      )}
      {h.onRunOnly && <button type="button" title="Run only this step" style={btn} onClick={stop(h.onRunOnly)}><Circle size={11} /></button>}
      {h.onRunUpTo && <button type="button" title="Run up to here" style={btn} onClick={stop(h.onRunUpTo)}><FlagTriangleRight size={12} /></button>}
      {h.onDelete && <button type="button" title="Delete step" style={{ ...btn, color: STATUS.error.color }} onClick={stop(h.onDelete)}><Trash2 size={12} /></button>}
    </div>
  );
}
```

- [ ] **Step 4: Add the hover-reveal CSS**

In `src/styles.css`, append:

```css
.dag-node-actions { opacity: 0; transition: opacity 120ms ease; }
.react-flow__node:hover .dag-node-actions,
.react-flow__node.selected .dag-node-actions { opacity: 1; }
```

- [ ] **Step 5: Render the action bar in each node**

In each of `RequestNode.tsx`, `PayloadNode.tsx`, `ConditionNode.tsx`, `TransformNode.tsx`:
1. Import: `import { NodeActions } from "./NodeActions";`
2. Ensure the node's outermost element has `position: "relative"` (RequestNode/Payload/Transform cards already sit in a relatively-positioned wrapper via their card div — if the outer element is not `position:relative`, wrap it). ConditionNode's outer div is already `position: "relative"`.
3. As the first child of the outer element, render:

```tsx
<NodeActions
  onEdit={(data as any).onEdit}
  onRunFrom={(data as any).onRunFrom}
  onRunOnly={(data as any).onRunOnly}
  onRunUpTo={(data as any).onRunUpTo}
  onDelete={(data as any).onDelete}
  status={(data as any).status}
/>
```
(Each renderer already destructures `data` from `NodeProps`.)

- [ ] **Step 6: Typecheck + build + lint**

Run: `npx tsc --noEmit && npm run build && npm run lint`
Expected: clean (no type errors, build succeeds, no new lint errors).

- [ ] **Step 7: Commit**

```bash
git add src/components/ProtocolPanes/dag/nodes/ src/styles.css
git commit -m "feat(dag-ui): shared node action bar + larger handle hit-targets"
```

---

### Task 4: DagFlowPane — run-mode dispatch, action wiring, selection & connect fixes

**Files:**
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx`

**Interfaces:**
- Consumes: `runFlow(graph, deps, options)` (Task 2), `NodeActionHandlers` shape (Task 3), `descendants` if needed.
- Produces: `runWithMode(mode: RunMode, targetId?: string)`; rfNodes `data` now carries `onEdit/onRunOnly/onRunFrom/onRunUpTo/onDelete`.

- [ ] **Step 1: Generalize `handleRun` into `runWithMode`**

Replace the `handleRun` callback (`DagFlowPane.tsx:230-258`) with a mode-aware version. It resets status/results **only for the nodes in the active set** and passes the current `runSteps` as `priorSteps`:

```tsx
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
```

Add imports at the top of the file: `import { runFlow, type SendResult } from "./dag/engine";` already exists — extend it and add `import { descendants, ancestors } from "./dag/traverse";` and add `RunMode`, `StepResult` to the `./dag/types` import.

- [ ] **Step 2: Pass action handlers into rfNodes `data`**

In the `rfNodes` useMemo (`DagFlowPane.tsx:73-86`), extend the returned `data` object with the per-node handlers:

```tsx
data: {
  label: n.label, name: n.name, status: statusMap[n.id] ?? n.status, method, brokenLink, reason: skipReasons[n.id],
  onEdit: () => setSelectedId(n.id),
  onRunOnly: () => runWithMode("only", n.id),
  onRunFrom: () => runWithMode("from", n.id),
  onRunUpTo: () => runWithMode("upTo", n.id),
  onDelete: () => onDelete({ nodes: [{ id: n.id } as any], edges: [] }),
},
```

Add `runWithMode` and `onDelete` to the `rfNodes` useMemo dependency array.

**Ordering (required):** the `rfNodes` useMemo currently sits at `:73`, but `onDelete` is declared at `:127` and `runWithMode` replaces `handleRun` at `:230`. A `useMemo` dependency array is evaluated at its call site, so referencing `runWithMode`/`onDelete` there before they are declared throws `Cannot access 'runWithMode' before initialization` at first render. Fix by **moving the `rfNodes` useMemo down to sit after both `onDelete` and `runWithMode` are declared** (rfNodes only feeds the `<ReactFlow>` render at `:325`, so it can be defined later). Keep `rfEdges` with `rfNodes`. After the change, load the pane and confirm there is no "before initialization" runtime error.

- [ ] **Step 3: Fix node-click selection and connection reliability**

This is the reported "clicking a card opens nothing" bug — reproduce it first (see Step 4), then apply the fix. On the `<ReactFlow>` element (`DagFlowPane.tsx:325-329`):
1. Add `onSelectionChange={({ nodes }) => setSelectedId(nodes[0]?.id ?? selectedId)}` as a selection-driven fallback to `onNodeClick`, and keep `onNodeClick={(_, n) => setSelectedId(n.id)}`.
2. Add `selectNodesOnDrag={false}` and `connectionRadius={40}` (larger snap radius so connections latch onto handles reliably).
3. Ensure `nodesDraggable`, `nodesConnectable`, and `elementsSelectable` are not disabled (they default to `true`; do not set them `false`).

If reproduction shows a different root cause (e.g. an overlay intercepting clicks), fix that root cause instead and note it in the task report.

- [ ] **Step 4: Reproduce + verify in the running app (controller-assisted)**

Because react-flow canvas interactions are not covered by the vitest suite, verification is by driving the app. Use the project's `verify`/`run` approach or a Vite+Playwright harness that mounts `DagFlowPane` with a seeded multi-node graph. Confirm:
- Clicking a node opens the Inspector (selection works).
- Hovering a node reveals the action bar; **Edit** opens the Inspector; **Run from / Run only / Run up to** trigger runs scoped correctly (watch status pills).
- Dragging from a node's handle to another node creates an edge (not a card move / canvas pan).
- Clicking **Run flow** after a prior run restarts cleanly from the root nodes (addresses the "re-run doesn't start from the first node" report).

Record the evidence (screenshots / status transitions) in the task report.

- [ ] **Step 5: Typecheck + build + lint + tests**

Run: `npx tsc --noEmit && npm run build && npm run lint && npm test`
Expected: clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): per-step run dispatch, node action wiring, fix node selection + edge connect"
```

---

### Task 5: Persist run state (`DagGraph.lastRun`) + hydration

**Files:**
- Modify: `src/components/ProtocolPanes/dag/types.ts` (add `DagLastRun`, `DagGraph.lastRun`)
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx` (write on run, hydrate on load, stale hint)

**Interfaces:**
- Produces: `export interface DagLastRun { steps: StepsContext; statuses: Record<string, NodeStatus>; skipReasons: Record<string, string>; ranAt: string; }` and optional `lastRun?: DagLastRun` on `DagGraph`.
- Consumes: the `runWithMode` callback from Task 4 and its run-local maps `collected` / `collectedStatus` / `collectedSkips` and locals `result`, `runSteps`, `active` (all in scope inside `runWithMode`). This task edits that same function to persist `lastRun`.

- [ ] **Step 1: Add the type**

In `src/components/ProtocolPanes/dag/types.ts`, add before `DagGraph` (or right after it) and extend `DagGraph`:

```ts
export interface DagLastRun {
  steps: StepsContext;                     // results keyed by node.name
  statuses: Record<string, NodeStatus>;    // keyed by node.id
  skipReasons: Record<string, string>;     // keyed by node.id
  ranAt: string;                           // ISO timestamp
}
```
And add to the `DagGraph` interface: `lastRun?: DagLastRun;` (do NOT change `version`).

- [ ] **Step 2: Persist `lastRun` at the end of a run**

In `runWithMode` (Task 4), replace the placeholder comment line (`// (Task 5 inserts lastRun persistence here, ...)`) immediately after `setRunSteps(...)` with a merge that overlays this run's collected results/statuses/skips onto the previously-persisted `lastRun`, then persists via `onChange`. Use the run-local maps collected during the run (no refs, no async-state reads):

```tsx
const nextSteps = { ...runSteps, ...result };
const mergedStatuses = { ...(graph.lastRun?.statuses ?? {}), ...collectedStatus };
const mergedSkips = { ...(graph.lastRun?.skipReasons ?? {}), ...collectedSkips };
onChange({ ...graph, lastRun: { steps: nextSteps, statuses: mergedStatuses, skipReasons: mergedSkips, ranAt: new Date().toISOString() } });
```

`collectedStatus`, `collectedSkips`, `result`, and `runSteps` are already in scope inside `runWithMode` (defined in Task 4). No new refs are needed.

- [ ] **Step 3: Hydrate from `graph.lastRun` on mount**

Add a mount-time effect that seeds the ephemeral run state from the persisted `lastRun` so statuses/results survive a reload. Map `steps` (by name) into `stepResults` (by id):

```tsx
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
```

- [ ] **Step 4: Show a "previous run" hint**

In the toolbar (`DagFlowPane.tsx:265-284`), when `graph.lastRun` exists and `!isRunning`, render a small muted label after the "N steps" chip:

```tsx
{graph.lastRun && !isRunning && (
  <span style={{ font: "500 10px/1 system-ui", color: "var(--muted)" }}>
    · results from last run
  </span>
)}
```

- [ ] **Step 5: Verify persistence (controller-assisted)**

Drive the app: run the flow, confirm status pills show; reload the flow (re-open the DAG request / restart) and confirm the node statuses and results are restored from `lastRun` and the "results from last run" hint shows. Record evidence in the task report.

- [ ] **Step 6: Typecheck + build + lint + tests**

Run: `npx tsc --noEmit && npm run build && npm run lint && npm test`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProtocolPanes/dag/types.ts src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): persist and rehydrate last-run state (statuses + results)"
```

---

### Task 6: Edit-and-retry after failure (Inspector)

**Files:**
- Modify: `src/components/ProtocolPanes/dag/Inspector.tsx` (add `status` + `onRunFrom` props, render Retry)
- Modify: `src/components/ProtocolPanes/DagFlowPane.tsx` (pass `status` + `onRunFrom` to `<Inspector>`)

**Interfaces:**
- Consumes: `runWithMode("from", id)` (Task 4), `statusMap` (Task 4), `STATUS` from `nodeStyles`.
- Produces: Inspector renders a "Retry from here" button in its header when the selected node's status is `"error"`.

- [ ] **Step 1: Extend Inspector props**

In `src/components/ProtocolPanes/dag/Inspector.tsx`, add to `InspectorProps` (line ~11):

```ts
  status?: string;
  onRunFrom?: (id: string) => void;
```
Destructure them in the `Inspector({ ... })` signature.

- [ ] **Step 2: Render "Retry from here" on failure**

In the Inspector header block, immediately after the label/close-row `</div>` (after `DagFlowPane`-style header at `Inspector.tsx:75`), add:

```tsx
{status === "error" && onRunFrom && (
  <button type="button" onClick={() => onRunFrom(node.id)}
    style={{ marginTop: 10, width: "100%", font: "700 12px/1 system-ui", border: `1px solid ${STATUS.error.color}`,
      background: tint(STATUS.error.color, 14), color: STATUS.error.color, borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>
    ↻ Retry from here
  </button>
)}
```
Import `STATUS` and `tint` from `./nodes/nodeStyles` at the top of `Inspector.tsx`.

- [ ] **Step 3: Wire from DagFlowPane**

In the `<Inspector .../>` render (`DagFlowPane.tsx:340-351`), add:

```tsx
status={statusMap[selectedNode.id] ?? selectedNode.status}
onRunFrom={(id) => runWithMode("from", id)}
```

- [ ] **Step 4: Verify (controller-assisted)**

Drive the app with a flow that fails mid-path (e.g. a request to an unreachable host): confirm the failed node shows error, the Inspector shows **Retry from here**, editing the failed step's config (URL/host, body) and clicking Retry re-runs from that step downstream reusing upstream results, and success clears the error. Record evidence.

- [ ] **Step 5: Typecheck + build + lint + tests**

Run: `npx tsc --noEmit && npm run build && npm run lint && npm test`
Expected: clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProtocolPanes/dag/Inspector.tsx src/components/ProtocolPanes/DagFlowPane.tsx
git commit -m "feat(dag): edit-and-retry — Retry from here on failed steps"
```

---

## Notes for the implementer

- **No component-test infra exists** for react-flow in this repo (all current DAG tests are pure logic). Tasks 1–2 are strict TDD. Tasks 3–6 are verified by typecheck/build/lint/`npm test` plus controller-assisted manual runs (harness or `verify`/`run` skill) — do not fabricate unit tests that assert nothing just to have a test.
- **Keep the ephemeral vs persisted split:** `statusMap`/`stepResults`/`runSteps`/`skipReasons` remain React state during a run (the existing rationale in `DagFlowPane.tsx:44-58`); `lastRun` is the persisted mirror written via `onChange` at the end of a run and read once on mount.
- **Do not** feed `selected` back into rf nodes or otherwise change the delete/onChange race handling documented in `DagFlowPane.tsx:94-136`.
