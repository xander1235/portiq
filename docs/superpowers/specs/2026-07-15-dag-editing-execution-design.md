# DAG Editing & Execution Controls — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorm), pending implementation plan
**Area:** `src/components/ProtocolPanes/DagFlowPane.tsx`, `src/components/ProtocolPanes/dag/engine.ts`, `dag/nodes/*`, `dag/nodeStyles.ts`, `dag/Inspector.tsx`, `dag/types.ts`, `dag/migrate.ts`
**Builds on:** the reference-first DAG redesign and the DAG UI redesign (see `2026-07-14-dag-flow-redesign-design.md`, `2026-07-15-dag-flow-ui-redesign-design.md`).

## Problem

The redesigned DAG flow looks right but is not usable:

1. **Nodes are not editable.** Clicking a node/card opens nothing — no editor, no actions. (User-confirmed: "nothing opens at all.") In the code `onNodeClick` is wired to open the Inspector, but selection never takes effect in the running app; there are also no per-node action affordances anywhere.
2. **Edge linking is inconsistent.** Dragging to connect two steps grabs the card (moves the node) or the canvas (pans) instead of drawing an edge — the handle hit-target (a 9px dot, `nodeStyles.handleStyle`) is too small to grab reliably.
3. **Re-run does not cleanly restart.** User reports a re-run "is not running from the first node." `handleRun` resets state before running, so the root cause is unconfirmed — must be reproduced and fixed.
4. **No partial execution.** `runFlow` (`dag/engine.ts`) only ever runs the whole graph in topological order and discards its `steps` context afterward. There is no way to run a single step, run from a step, run up to a step, or resume after a mid-flow failure.
5. **No edit-and-retry.** After a request fails mid-flow, the user cannot fix that step's config (payload, host, headers, body) and continue from it — the only option is re-running everything from the top.

## Goals (approved decisions)

- Node cards are **editable** and expose **explicit action affordances** (not reliant on react-flow's card-click).
- **Edge linking works reliably** via handle drag, with click-to-connect as a fallback.
- **Four run modes:** run whole flow, run only this step, run from this step, run up to this step.
- **Resume reuses previous results:** running from a step seeds the engine with the last run's `steps` context; upstream successful steps are not re-called.
- **Edit-and-retry:** a failed step can be edited and re-run from that point ("Retry from here").
- **Run state persists across app restarts** so resume/retry survive reopening the flow.

## Non-goals

- No new protocols, no parallel/concurrent step execution, no backend, no multi-flow orchestration.
- No change to the reference syntax (`{{steps.<name>...}}`, `{{env.X}}`, `{{= expr}}`), resolver, `buildRequest`, `linkResolve`, or transport.
- No visual redesign of the node cards beyond adding the action bar and enlarging handle hit-targets.

## Design

### A. Node editing & action affordances (`nodes/*`, `nodeStyles.ts`, `DagFlowPane`)

Each node card gains a compact **action bar**, shown on hover or when selected, rendered inside the node with its own click handlers that call `stopPropagation()` so they work regardless of react-flow's node-click behavior:

- **Edit** — opens the Inspector for that node (sets `selectedId`).
- **Run ▾** — a small menu: *Run only this* · *Run from here* · *Run up to here* (see C). On a request node these are always available; on payload/condition/transform the same modes apply.
- **⋯ (overflow)** — Rename, Duplicate, Delete.

The action-bar buttons are the primary, discoverable path. In addition, **card-click selection must be repaired** so clicking the card body also opens the Inspector: reproduce the failure in the running app and fix the react-flow wiring (e.g. verify `onNodeClick`/`onSelectionChange` fire; ensure nodes are selectable and nothing swallows the event). Both paths set the same `selectedId` state.

Node action handlers are passed into the node renderers via react-flow node `data` (the renderers already read `data.*`), keeping the renderers presentational.

### B. Edge linking (`nodeStyles.ts`, node handles, `DagFlowPane`)

- **Enlarge the handle hit-target:** wrap each `Handle` so it has a ~22px transparent interactive area around the ~10px visible dot (via handle sizing/padding), making drag-to-connect easy without grabbing the card or panning.
- **Click-to-connect fallback:** ensure react-flow `connectOnClick` behavior works (click a source handle, then a target handle/node). Verify it is enabled.
- Keep node dragging and canvas panning, but a drag that starts on a handle reliably initiates a connection (react-flow default when the handle is actually hit — the fix is the hit-target size).
- Preserve the existing branch-handle contract: condition source handles keep ids `"true"` (bottom) and `"false"` (right); payload→request auto-body-injection on connect (`onConnect`) stays.

### C. Execution controls & engine (`dag/engine.ts`, `DagFlowPane`)

`runFlow` gains a backward-compatible options argument:

```
runFlow(graph, deps, options?)
options = {
  mode?: "all" | "only" | "from" | "upTo",   // default "all" (current behavior)
  targetId?: string,                          // node the mode is relative to
  priorSteps?: StepsContext,                  // last run's results to seed/reuse
}
```

Node-set per mode (computed from the graph edges, ignoring self-edges for traversal):

- **all** — every node, current behavior; `steps` starts empty.
- **only** — `[targetId]`; `steps` seeded from `priorSteps`; other nodes' status untouched.
- **from** — `targetId` + all descendants (nodes reachable by following out-edges); `steps` seeded from `priorSteps`; upstream nodes are neither re-run nor re-called.
- **upTo** — `targetId` + all ancestors (nodes that can reach `targetId`); `steps` starts empty; downstream nodes are not run.

Rules:
- Skip/branch logic (`upstream-error`, `losing-branch`, `upstream-skipped`) is evaluated only among nodes in the active set; for **from**/**only**, an upstream node absent from the set is treated as already-succeeded if `priorSteps` has its result, otherwise its reference resolves empty (a non-fatal warning is surfaced in the Inspector's resolved preview).
- Only nodes in the active set have their status/results updated; nodes outside keep their persisted status/results.

`DagFlowPane.handleRun` is generalized to `runWithMode(mode, targetId?)`, wiring the toolbar **Run flow** to `mode:"all"` and the node action bar to the other three, passing the persisted `lastRun.steps` as `priorSteps`.

### D. Edit-and-retry after failure (`Inspector`, nodes, `DagFlowPane`)

- A node whose last status is `error` renders a prominent **Retry from here** affordance (in the Inspector header and on the node action bar), equivalent to *Run from this step* with `priorSteps` = persisted results.
- The Inspector already edits request config (URL/host, headers, body, params, path vars) and the payload/condition/transform editors; no new editor is needed — the failed step is edited there, then Retry runs from it downstream reusing upstream results.

### E. Persist run state (`dag/types.ts`, `dag/migrate.ts`, `DagFlowPane`, storage)

Add an optional field to `DagGraph` (additive; no `version` bump — `migrate.ts` leaves it undefined for old graphs):

```
lastRun?: {
  steps: StepsContext;                       // results keyed by node.name
  statuses: Record<string /*nodeId*/, NodeStatus>;
  skipReasons: Record<string /*nodeId*/, string>;
  ranAt: string;                             // ISO timestamp
}
```

- `lastRun` is written into the graph via `onChange` at the end of every run (all/only/from/upTo — merging updated nodes into the existing map), so it is persisted through the existing per-request `dagGraph` storage (SQLite `kv`/localStorage, via `useRequestState`/`updateRequestState`). No new storage channel.
- On mount/graph load, `DagFlowPane` hydrates `statusMap`, `stepResults`, `runSteps`, and `skipReasons` from `graph.lastRun` so statuses/results and resume/retry survive a restart.
- Staleness is surfaced, not enforced: the pane shows a small "results from previous run · <relative time>" hint derived from `ranAt`. Editing a node does not auto-clear results.

### F. Re-run correctness

- Reproduce the "re-run doesn't start from the first node" report in the running app. Ensure `mode:"all"` clears the active-set nodes' statuses/results (to `pending`) and starts from the roots each time. Fix the confirmed root cause.

## Data model & compatibility

- `DagGraph.lastRun` is optional and additive; existing flows load unchanged (`lastRun` undefined → no hydration, all statuses `idle`).
- `runFlow`'s new `options` arg is optional; existing call sites and the 44 current tests keep working with `mode` defaulting to `"all"`.
- No change to `RequestNodeData`/`PayloadNodeData`/`ConditionNodeData`/`TransformNodeData` or the reference syntax.

## Testing

- **Engine unit tests** (`engine.test.ts`): `only` runs one node using `priorSteps`; `from` runs target+descendants and reuses upstream; `upTo` runs ancestors+target and stops; resume seeds `steps`; error propagation/skip logic within a restricted set; `all` unchanged (regression).
- **Migration/hydration**: a graph without `lastRun` loads clean; a graph with `lastRun` hydrates statuses/results.
- **Manual verification in the running app** (the parts unit tests can't cover): clicking a node opens the Inspector; the action bar's Edit/Run/⋯ work; dragging a handle reliably connects two steps; a full Run restarts from roots; a mid-flow failure can be edited and retried from the failed step reusing upstream results; run state survives an app restart.
- All existing DAG unit tests stay green; `npm run build` + `npx tsc --noEmit` clean; `npm run lint` no new errors.
