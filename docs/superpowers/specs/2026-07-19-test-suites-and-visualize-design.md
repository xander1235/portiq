# Test Suites & Data Visualization — Design

Date: 2026-07-19
Status: Approved

## Goal

Two independent improvements to Portiq's request/response tooling:

1. **Test suites** — redesign scripting tests so a user can define multiple,
   independently-run test steps grouped into named suites, and clearly see
   *which* test case failed. No test may block another; a thrown error in one
   step or one group never aborts the rest.
2. **Data visualization** — a dedicated visualization module and a separate
   visualization script, surfaced through the existing **Visualize** button that
   sits beside Raw/Pretty/XML/Table/Headers. Auto chart builder by default, with
   an optional user-authored viz script that overrides it.

## Current State

- `runScript()` / `buildPm()` in `src/App.tsx` build a Postman-like `pm` object.
  `pm.test(name, fn)` runs `fn`; a throw → `{type:"fail"}`, else `{type:"pass"}`,
  pushed to a flat `output` array. Tests are already isolated at the `pm.test`
  level, but there is no grouping and the UI is a flat log.
- `TestsTab.tsx` renders `testsOutput` as a flat list of log rows.
- `TestsPane.tsx` (right rail) tries to count passed/failed by matching the
  string `"Test Passed"` / `"Test Failed"` — text the runner never emits, so the
  counters are **always 0** (bug to fix).
- Scripts tab has a segmented control: **Pre-request · Post-response**.
- `responseTabs = ["Pretty","Raw","XML","Table","Visualize","Headers"]`
  (`App.tsx:61`). The `Visualize` tab already exists but renders a basic panel
  (summary/rows/status + a crude div-bar chart from an inline `chartConfig`).
- No chart or templating library is installed. Charts will use dependency-free
  inline SVG.

## Part 1 — Test Suites

### `pm` API additions (in `buildPm`, `src/App.tsx`)

- `pm.describe(groupName, fn)` — opens a named group. `pm.test()` calls executed
  during `fn` attach to `groupName`. If `fn` itself throws (setup error), record
  a group-level `{type:"error"}` entry for that group and continue; other groups
  and top-level tests still run. Supports sync or async `fn` (awaited).
- `pm.test(name, fn)` — unchanged pass/fail semantics, but each result now
  records: `group` (current group or `"Ungrouped"`), `duration` (ms), and on
  failure `errorType` + `errorMessage`. Fully isolated — a throw is caught and
  recorded, never propagated.
- Grouping is tracked via a `currentGroup` variable in the runner closure;
  `describe` sets it for the duration of `fn` and restores the previous value
  after (supporting nested/sequential describes).

### Output data model

Each entry (unchanged shape, new optional fields):

```
{
  type: "pass" | "fail" | "error" | "log" | "info",
  text: string,          // test/group/log name
  label: string,         // "pre-script" | "post-script" | "script"
  group?: string,        // "Ungrouped" when top-level
  duration?: number,     // ms, for test rows
  errorType?: string,
  errorMessage?: string,
}
```

Back-compat: entries without `group` render under "Ungrouped".

### UI redesign

`TestsTab.tsx` output area and `TestsPane.tsx`:

- **Summary bar**: total ✓ passed / ✗ failed / ⚠ errored, plus total duration.
- **Collapsible group cards**: each group shows a header with its own
  passed/failed badge. Inside, one row per test: status pill (PASS/FAIL/ERROR) ·
  name · assertion detail (`errorMessage`) · duration.
- `log`/`info` entries render in a "Console" section (or under their group).
- **Fix `TestsPane` counters**: count by `type === "pass"` / `"fail"` /
  `"error"` instead of the never-matched `"Test Passed"` string. Show the same
  grouped breakdown (compact variant).

### Testing

Unit-test the grouping/isolation logic. Extract the group-tracking + result
shaping so it is testable without React (a helper the runner uses). Cover:
one group with mixed pass/fail, a throwing `describe` body not aborting others,
top-level tests landing in "Ungrouped", nested describes restoring context.

## Part 2 — Data Visualization

### Dedicated module — `src/services/visualize.ts` (pure, unit-tested)

- `autoChartConfig(rows): VizSpec | null` — detects a categorical/label column
  and numeric value column(s) from the response table rows and returns a
  sensible default spec. Reuses the existing detection heuristics.
- `normalizeVizSpec(spec, rows): VizSpec | null` — validates a user-provided
  spec (type in {bar,line,pie}, resolves x/y/series against available columns,
  clamps point counts), returning a safe normalized spec or `null` with reason.
- `VizSpec` type: `{ type: "bar"|"line"|"pie", x: string, y: string | string[],
  series?: string, title?: string, points?: {label,value}[] }`.

### SVG chart renderer

A shared presentational component (e.g. `src/components/ResponsePane/VizChart.tsx`)
rendering **bar / line / pie** from a normalized `VizSpec` using inline SVG — no
new dependency. Follows the `dataviz` skill for palette, contrast (light+dark),
axes, and legend. Used by BOTH the auto builder and the user-script path so the
output reads as one system.

### Separate visualization script

- Add a third mode to the Scripts tab segmented control:
  **Pre-request · Post-response · Visualize**. The Visualize editor holds a JS
  script (`vizScriptText`, persisted per request like the other scripts).
- Runner exposes `pm.visualizer.set(spec)` (structured chart spec — **not**
  arbitrary HTML). The viz script runs against the current response; the last
  `set(...)` spec is captured, normalized via `normalizeVizSpec`, and stored in
  app state (`vizSpec`).
- Invalid specs surface an error message in the Visualize tab rather than
  throwing.

### Visualize tab behavior

The `Visualize` tab (already beside Raw/Pretty/XML/Table/Headers):

- If a user viz-script spec is present → render **that** via `VizChart`
  (script overrides).
- Otherwise → **auto chart builder**: controls to pick chart type + X / Y /
  series fields (populated from response columns), live-rendered from table rows
  via `autoChartConfig` seed. Keep the existing summary/rows/status cards.
- A small "Run visualization" affordance re-runs the viz script on demand.

### Rendering choice (decided)

User scripts return a **structured chart spec** via `pm.visualizer.set(spec)`,
rendered by our own SVG renderer. Rationale: no new dependency, no arbitrary
HTML/JS injection into the DOM, and visual consistency with the auto builder.
(The Postman-style arbitrary-HTML-in-sandboxed-iframe escape hatch was
considered and deferred.)

### Testing

Unit-test `visualize.ts`: `autoChartConfig` picks the right label/value columns
for representative shapes; `normalizeVizSpec` accepts valid specs and rejects/
repairs invalid ones (unknown columns, bad type, empty rows).

## Out of Scope

- Arbitrary HTML/Handlebars visualization templates (iframe sandbox).
- New charting dependency.
- Changes to DAG-flow test execution beyond reusing the shared runner.

## Files Touched (anticipated)

- `src/App.tsx` — `buildPm` (add `describe`, `visualizer`, enrich `test`),
  `runScript`, viz-script state, wire `vizSpec` to ResponseViewer, extract
  testable helpers.
- `src/components/RequestPane/tabs/TestsTab.tsx` — grouped output UI + Visualize
  script mode.
- `src/components/RightRail/TestsPane.tsx` — fixed counters + grouped summary.
- `src/services/visualize.ts` — new module (+ `visualize.test.ts`).
- `src/components/ResponsePane/VizChart.tsx` — new SVG renderer.
- `src/components/ResponsePane/ResponseViewer.tsx` — Visualize tab wired to
  `VizChart` + auto builder controls.
- Test grouping helper + `*.test.ts`.
