# Named Script Steps + Compact Tests Toolbar — Design

Date: 2026-07-19
Status: Approved

## Goal

Two follow-up improvements to the Tests tab, on top of the shipped
test-suites/visualize work:

1. **Compact, consistent toolbar** — the Tests-tab toolbar currently mixes
   three visual treatments at three sizes (outlined ghost pills for
   `Output`/`Test Input`, a boxed segmented control for the mode, a solid
   button for `Run`). Unify every control to one compact height, one font
   size, one radius, pulled from the shared `ui.module.css` tokens.
2. **Named step blocks for Pre-request & Post-response scripts** — replace the
   single script blob per phase with an ordered list of named steps. Each step
   is authored as its own small editor block, runs in order sharing one
   context, and reports its own pass/fail/error under its name in the Output
   panel. This applies the multi-step model (already used for `pm.test`
   results) to the *authoring* surface of the pre/post scripts.

Visualize stays a single script. Test Input (mock JSON) is unchanged.

## Current State

- `RequestItem.testsPreText?: string` / `testsPostText?: string` hold one
  script blob per phase (`src/hooks/useRequestState.ts:59-60`). These 4 script
  strings (`testsPreText`, `testsPostText`, `vizScriptText`, `testsInputText`)
  travel together through every persistence/serialization site.
- `runScript(code, context, output, label?, capture?)` compiles a phase's blob
  as one `AsyncFunction` and runs it (`src/App.tsx:2975`). Pre/post run once
  each on both send paths (HTTP `:2409/:2479`, GraphQL `:2534/:2583`) and in the
  manual `runTests()` (`:2931`).
- `createTestHarness(output, label, now?)` groups `pm.test` results by the
  enclosing `pm.describe` name, or `"Ungrouped"` when top-level
  (`src/services/testRunner.ts:18`). `summarizeTests` folds entries by `group`.
- `TestsTab.tsx` renders the toolbar and, per mode, a single CodeMirror editor.

## Data Model

New step shape (new module `src/services/scriptSteps.ts`):

```ts
export interface ScriptStep {
  id: string;      // stable, e.g. "step-<uuid>"
  name: string;    // user-editable label; groups the step's results
  script: string;  // JavaScript body (same sandbox as today)
}
```

`RequestItem` gains `testsPreSteps?: ScriptStep[]` and
`testsPostSteps?: ScriptStep[]`. The legacy `testsPreText?` / `testsPostText?`
fields REMAIN on the interface (read-only, for loading previously-saved
requests) but are no longer written.

**Migration** (`toSteps(steps, legacyText)`): if `steps` is a non-empty array,
use it; else if `legacyText` is non-empty, wrap it as a single step named
`"Step 1"`; else return `[]`. Applied at every load site (loadRequest,
applyPersistedState, githubSync import). Runtime state holds only the arrays.

## Execution

- `createTestHarness` gains a `defaultGroup = "Ungrouped"` param; `currentGroup`
  initializes to it. A step runs with `defaultGroup = step.name`, so the step's
  ungrouped `pm.test`s (and thrown script errors) land under the step name.
- `runScript` gains an optional trailing `group?: string`, threaded into
  `buildPm` → `createTestHarness(output, label, clock, group)`, and stamped onto
  the catch-block error entry so a step-level throw is attributed to the step.
- New `runSteps(steps, context, output, label)`: iterates steps in order,
  awaiting `runScript(step.script, context, output, label, undefined, step.name)`
  for each. **One shared `context`** across a phase's steps, so a variable/header
  set in step 1 is visible to step 2. A throw in one step is caught inside
  `runScript` and never aborts the next step.
- `runTests`, both HTTP send blocks, and both GraphQL send blocks call
  `runSteps(testsPreSteps|testsPostSteps, ...)` instead of `runScript(text, ...)`.
- The Output panel already groups by `group` via `summarizeTests`, so step
  names become the group headers with no output-rendering change.
- AI "generate tests" (`App.tsx:2692`) appends one step named `"AI Generated"`
  holding the joined script, instead of overwriting the post blob.

## UI

### Toolbar (compact + consistent)

One `space-between` row; every control at the same height and `--text-xs`:

- Left: mode `SegmentedControl size="sm"` — Pre-request · Post-response ·
  Visualize (the primary control).
- Right: `Output` and `Test Input` as compact toggle chips styled to match the
  segment height/radius exactly (active = accent tint), then a compact primary
  `Run` button.

### Step editor (`ScriptStepsEditor.tsx`, used for pre & post)

- A vertical list of step cards. Each card header: collapse chevron · editable
  name input · move-up / move-down · remove (×). Card body (when expanded): a
  compact CodeMirror JS editor bound to that step's `script`.
- `+ Add step` button below the list adds an empty step (`"Step N"`).
- Editing name/script, add, remove, and reorder each produce a new array passed
  to the phase's `onChange`. Collapse state is local component state.
- Empty list renders a single starter step so the surface is never blank.

Visualize mode keeps its existing single editor.

## Persistence / Serialization sites (all updated)

`useRequestState.ts`: localStorage init (`ui_testsPreSteps`/`ui_testsPostSteps`
`ScriptStep[]`), reset literal, loadRequest (migrate), syncDraftToCollection
draft, setter map, return object. `App.tsx`: destructure, applyPersistedState
(migrate), autosave + beforeunload payloads and dep arrays, both new-request
literals, TestsTab prop wiring. `githubSync.ts`: export writes `testsPreSteps`
JSON, import migrates (steps or legacy text). `RequestEditor.tsx`: prop
passthrough. `TestsTab.tsx`: prop types + step editor.

## Out of Scope

- Drag-and-drop reordering (up/down buttons only).
- Per-step enable/disable toggle.
- Changing Visualize or Test Input surfaces.
- DAG-flow execution changes.

## Testing

- `scriptSteps.test.ts`: `toSteps` — steps present wins; legacy text wraps to
  one `"Step 1"`; empty → `[]`; `emptyStep` shape; `genStepId` uniqueness.
- `testRunner.test.ts`: new `defaultGroup` — ungrouped tests and thrown errors
  land under the passed group; a `describe` inside still overrides it.
- Existing suites stay green (85/85 baseline).
