# DAG Flow Redesign — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorm), pending implementation plan
**Area:** `src/components/ProtocolPanes/DagFlowPane.tsx` (+ App/collection integration)

## Problem

The DAG Flow feature (a multi-step request workflow editor, protocol `"dag"`) is
functional but feels "dumb" and has poor UX. Three root causes:

1. **Data passing is a blind whole-object merge.** When a request node has an
   upstream node, the engine spreads the upstream context into the downstream
   request: `inCtx.body` *replaces* the body, `inCtx.headers` / `inCtx.params` /
   `inCtx.pathVars` are shallow-merged (`DagFlowPane.tsx:1341-1353`). To move a
   single field (e.g. `id` from step 1's response into step 2's URL) you are
   forced to insert a **Transform** node and write JavaScript (`emit({...})`).
   The only way to reshape data is to write code, and the flow you see on the
   canvas hides what actually moves along each edge.

2. **The DAG ignores the app's existing data-passing stack.** The app already
   has `{{var}}` interpolation (`useEnvironmentState.ts:63`) and a `pm`
   post-response scripting sandbox (`App.tsx:2815+`). The DAG reinvented its own
   context-merge engine and uses neither.

3. **Storage & transport are wrong for "a request type."** Although a DAG is a
   protocol type like http/graphql (`ProtocolPicker.tsx:42`), the pane receives
   no request identity and dumps the whole graph into one **global**
   `localStorage` key (`portiq_dag_flow_state_v1`), so every DAG tab shares one
   graph. Its run paths use the browser `fetch()` (CORS-bound, bypasses
   Electron) while the rest of the app uses Electron IPC (`http:sendRequest`,
   `electron/main.cjs:411`); the `onRunRequest` path even calls a non-existent
   `"http-request"` channel (dead code).

## Goals

- Explicit, visible data references instead of implicit merge.
- Inject a payload directly into a request without chaining request→request or
  writing a Transform script.
- A modern, legible canvas (pan/zoom/inspector) instead of modal-heavy SVG.
- Inline debugging: see what each step sent/received and what a reference
  resolved to; surface skip reasons.

## Non-goals (YAGNI, this pass)

- Multi-flow list UI (rides existing request/collection machinery once the graph
  is stored on the request — see Storage).
- GraphQL/WebSocket step types.
- Per-step `pm` post-response sandbox (future).
- Collaborative editing.

## Direction

Chosen approach (approved): **react-flow rewrite + reference-first data model.**
Edges become pure control flow (order, branch, loop, run-on-failure); data
binding becomes explicit references. The hand-rolled SVG canvas is replaced with
`@xyflow/react`.

## Data model

### Node types

| Node | Purpose |
|------|---------|
| **Request** | Calls an API. A **live link** to a saved request (by id) or a standalone inline request. Per-step field overrides. |
| **Payload** | Named JSON/text block (templated). Wired into a request it becomes the body by default; also referenceable field-by-field. |
| **Condition** | Branches the flow (`true`/`false` edges). Expression may use references. |
| **Transform** | JS `emit()` for real reshaping / fan-out only. Optional, not required. |

### Stored shape (on the DAG request object)

```
DagRequest (protocol: "dag")
  ├─ nodes[]      // graph nodes
  ├─ edges[]      // control flow only: order, branch, loop, runOnFailure
  └─ positions{}  // canvas layout
```

Stored **on the request** (like an HTTP request's body), so it saves and
GitHub-syncs through existing machinery. Each DAG request = one independent
flow → multi-flow "for free."

### Request node (live link + overrides)

`{ linkedRequestId?, overrides{}, inlineConfig? }`

- With `linkedRequestId`: at run time resolve the **current** config of that
  saved request, then apply `overrides` (e.g. header
  `Authorization: Bearer {{steps.login.response.body.token}}`). Original
  request untouched.
- **Detach to copy** snapshots current config into `inlineConfig`, drops link.
- Deleted linked request → step shows a broken-link state (no silent drift).

### References (core change)

Any field (URL, header, param, path var, body, condition expression, payload)
resolves through the app's existing `{{}}` engine, extended with a `steps.`
namespace:

```
{{steps.login.response.body.token}}
{{steps.search.response.headers.x-request-id}}
{{env.BASE_URL}}                                  # existing env vars still work
{{= steps.list.response.body.items.filter(i => i.active)[0].id }}  # expression escape
```

- `steps.<name>` keyed by a **stable, unique, editable step name** (auto-slugged
  from the label).
- Typing `{{` opens autocomplete: upstream step names, then their response
  fields (real fields once a step has run; otherwise a saved example shape).
- `{{= ... }}` evaluates a JS expression against the same context — for the
  occasional filter/map without a full Transform node.
- **The implicit whole-object merge (`DagFlowPane.tsx:1341-1353`) is removed.**
  Data flows only where explicitly referenced.

### Payload node

- Holds templated JSON/text (supports `{{}}`: env + `steps.`).
- Wired into a request → becomes that request's body by default.
- Sub-fields referenceable elsewhere via `{{steps.<payloadName>.foo}}`.

## Canvas UX (`@xyflow/react`)

- Pan / zoom / fit-view / minimap; drag-to-connect on typed handles;
  multi-select; keyboard delete.
- Custom node renderers keep the current visual language (request rectangle,
  condition diamond, transform hex, new payload block), reusing `STATUS` and
  `METHOD_COLORS`.
- Edge labels show control-flow role (branch `Y`/`N`, `on-fail`, loop `×N`).
- Auto-layout via `dagre` (replaces hand-rolled BFS `autoLayout`).
- Add-step picker: blank request by method, **link a saved request** (live
  link), or add Payload / Condition / Transform.
- Config moves from stacked modals to a **right-side inspector panel** editing
  the selected node in place.

## Debugging & visibility

- **Inline reference preview:** a `{{steps...}}` token shows its resolved value
  on hover / in the inspector once upstream has run.
- **Per-step I/O:** each node shows a chip (status · time · size); inspector has
  Request / Response / Resolved-refs tabs (extends existing
  `StepInspectorModal` content).
- **Skip reasons surfaced:** blocked/skipped nodes show *why* (upstream error,
  losing branch) instead of a silent grey node.

## Execution engine & transport

- Keep topo-sort + branch/loop/`runOnFailure` semantics.
- **Transport fix:** route every step through Electron IPC (`http:sendRequest`)
  like normal requests, replacing browser `fetch()`. Delete dead `onRunRequest`
  / `"http-request"` channel.
- **Reuse infra:** field resolution goes through the extended `interpolate()`
  (env + `steps.`).
- Resolver builds a `steps` context map keyed by step name as each node
  completes; references and `{{= }}` expressions evaluate against it.

## Rollout / migration

- Bump storage to `..._v2`, stored **on the request object**, not the global
  key.
- **One-time migration:** existing global-key graph → imported as a single DAG
  request so nothing is lost; old implicit-merge edges converted to explicit
  references where inferable, flagged in the inspector where not.
- Branding stays "DAG Flow"; no protocol-picker change.

## Testing

- **Unit:** reference resolver (paths, `{{= }}` expressions, missing refs),
  payload-as-body injection, live-link + override merge, migration converter.
- **Engine:** topo order, branch blocking, loop termination, `runOnFailure`,
  skip-reason propagation.
- Add a `vitest` setup scoped to pure logic (resolver / engine / migration), not
  canvas rendering (no test setup exists today).

## Key files

- `src/components/ProtocolPanes/DagFlowPane.tsx` — main pane (rewrite).
- `src/App.tsx:3324` — `<DagFlowPane collections={...} />` render site; must pass
  request identity + persisted graph.
- `src/hooks/useEnvironmentState.ts:63` — `interpolate()` to extend with `steps.`.
- `electron/main.cjs:411` — `http:sendRequest` IPC (target transport).
- `src/components/ProtocolPicker.tsx:42` — protocol registration (unchanged).
