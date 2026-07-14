# DAG Flow UI/UX Redesign — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorm), pending implementation plan
**Area:** `src/components/ProtocolPanes/DagFlowPane.tsx`, `src/components/ProtocolPanes/dag/nodes/*`, `dag/Inspector.tsx`, `dag/AddStepPicker.tsx`
**Builds on:** the reference-first DAG redesign ([2026-07-14-dag-flow-redesign-design.md](2026-07-14-dag-flow-redesign-design.md)). This is a **visual/interaction layer** change only — no engine, resolver, storage, or data-model changes.

## Problem

The reference-first DAG flow works, but the UI is unpolished and reads as "not part of Portiq." Four issues (all confirmed with the user):

1. **Visual polish** — nodes/toolbar/inspector use ad-hoc inline styles and an off-palette (e.g. GET rendered green `#22c55e`, accent `#fb923c`) that does **not** match Portiq's design tokens (GET is teal `#2ed3c6`, accent coral `#ff7a59`, panels `#151924`, mono = IBM Plex Mono).
2. **Interaction / flow-building** — bare floating `.ghost` buttons; connecting, adding, and branching feel clumsy.
3. **Clarity / readability** — hard to see node state, what data flows where, and why a step skipped.
4. **Onboarding / empty state** — a new DAG request is a blank canvas with no guidance.

## Design tokens (bind all work)

Use Portiq's CSS variables, never ad-hoc hex:
`--bg:#0f1115` · `--panel:#151924` · `--panel-2` · `--border:#2a3042` · `--text:#e9edf5` · `--muted:#a2a9b8` · `--accent:#ff7a59` (coral) · mono `--font-mono:"IBM Plex Mono"` · radius `0.5rem`.
Method colors: GET `--method-get:#2ed3c6` · POST `--method-post:#ffcc00` · PUT `--method-put:#599eff` · PATCH `--method-patch:#bd93f9` · DELETE `--method-delete:#ff5555` · HEAD/OPTIONS `--muted`.
Status colors: idle `--muted` · running `#f1c40f` · success `#2ecc71` · error `#ff5555` · skipped dimmed `--muted`.

## Approved direction (mockups)

Reference renders (also in `assets/`):
- Nodes — `assets/dag-ui-nodes.png` (direction **B** chosen)
- Assembled canvas + toolbar — `assets/dag-ui-canvas.png`
- Empty state + inspector — `assets/dag-ui-empty-inspector.png`

### 1. Node design — direction B ("icon tile + status pill")

All four node renderers adopt a shared card language:
- Card: `--panel` bg, `1px --border`, radius `14px`, subtle shadow.
- **Request node:** leading 38px **method tile** (bg = method color @ ~14% alpha, fg = method color), title (label), right-aligned **status pill** (idle/Run/OK/Fail/skipped, colored), a mono **reference tag** row (`@login`), and a muted mono **URL preview** (truncated). Broken linked-request shows a ⚠ affordance.
- **Payload node:** teal-tinted card, `{ } PAYLOAD` kicker, title, `@name`.
- **Condition node:** violet diamond (`--method-patch`), centered expression, green (`true`, bottom) + red (`false`, right) source handles.
- **Transform node:** teal dashed card, `ƒ Transform` kicker, title.
- **Handles:** coral (`--accent`) dots, enlarged (~9px) for easier connecting.
- **Skipped state:** dimmed + grayscale, pill reads "skipped".

### 2. Canvas + toolbar

- **Toolbar** (top bar, `--panel` with bottom border): left = flow name + "N steps" chip; right = `+ Add step ▾`, `Auto-layout`, `Fit`, a zoom stepper (`− 100% +`), and a prominent coral **▶ Run flow** button (disabled → "Running…" while running).
- **Canvas:** dotted-grid background (`--bg` + radial dots), react-flow `Background`/`Controls`/`MiniMap` themed to tokens (dark minimap, node color by status).
- **Edges (control flow):** neutral grey = order; green `Y` / red `N` pills = condition branches; teal `→ body` = payload injection; a running edge animates (dashed/coral) during a run. Edge labels are small pills.

### 3. Inspector panel (replaces textarea wall)

Right-docked panel (~360px, `--panel`, 2px left border):
- **Header:** editable node title + `✕`; a `@reference` tag (coral-tinted) with hint "used as `{{name.…}}`".
- **Tabs:** Config · Request · Response.
- **Config tab:**
  - **Linked request** row: method chip + saved-request name + `▾`, with a **Detach to copy** action. (Absent → inline fields.)
  - Per-field **override editors** (URL, Headers, Body, Params, Path vars): mono field on `#0f1420`, `{{…}}` tokens syntax-highlighted (coral), a live **`→ resolved`** preview line (teal) shown when the field contains `{{` and a run has populated context, and a row of clickable **reference chips** (upstream `@step.path` tokens from `suggestRefs`) that insert into the field.
  - Payload/Condition/Transform get their type-specific editor (content / expression / script), same visual language.
- **Request / Response tabs:** the step's actual sent request and received response after a run (status · time · size header).

### 4. Empty state (onboarding)

When the flow has no nodes, the canvas centers an onboarding panel:
- Coral link badge, heading **"Build a request flow"**, one-line explainer mentioning `{{references}}`, branching, and looping.
- Four quick-add cards (Request / Payload / Condition / Transform) each with icon + one-liner; clicking adds that node.
- Primary coral **+ Link a saved request** button.

## Scope & non-goals

- **In scope:** visual/interaction rework of the four node renderers, `DagFlowPane` toolbar + canvas chrome + empty state, and `Inspector` layout. Move ad-hoc inline hex to Portiq tokens. Enlarge handles; theme react-flow chrome. Toolbar zoom/fit wired to react-flow's `useReactFlow` (`zoomIn`/`zoomOut`/`fitView`).
- **Non-goals (unchanged):** the engine, resolver, `buildRequest`, `linkResolve`, `migrate`, per-request storage, transport, reference syntax, and all existing behavior/tests. This is a presentation change; the 39 unit tests must stay green.
- **YAGNI:** no theming system, no light mode (app is dark-only), no custom edge-routing beyond react-flow defaults, no node-resize.

## Consistency notes

- Introduce a small shared style module (e.g. `dag/nodes/nodeStyles.ts` or a `dag.css`) for the token-based node/pill/handle styles so the four renderers don't duplicate hex. Prefer CSS variables already defined in `styles.css`; add DAG-specific vars there if needed rather than hardcoding.
- Keep node data contract unchanged (renderers read `data.method/label/name/status/reason/brokenLink/io`); this is styling + a few added fields already present.

## Testing

- Pure-logic tests unchanged (39 green).
- `npm run build` + `npx tsc --noEmit` clean; `npm run lint` no new errors.
- Manual verification (the four goals): nodes match tokens; toolbar zoom/fit/run work; inspector edits + resolved previews + chips; empty state appears for a new DAG request and quick-adds work; skipped/branch states render.
