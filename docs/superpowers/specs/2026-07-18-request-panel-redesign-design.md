# Request Panel Redesign — Design Spec

_Date: 2026-07-18 · Branch: `feat/request-panel-redesign` (off `perf/dag-render`)_

## Problem

The request panel's UI/UX is weak and the request/response JSON is poorly styled.
Concretely, the current implementation has:

- A cramped toolbar (`method | URL | Send` grid `90px minmax(0,1fr) 96px`) with a
  raw `<button>` Send and hardcoded `#ef4444` cancel color.
- Four competing styling systems (global CSS, CSS Modules, Tailwind v4, inline
  styles). The Auth tab (~200 lines) is entirely inline-styled with duplication.
- A ~900-line, ~60-prop `RequestEditor.tsx` monolith.
- Dark-only tokens with **no** type scale, spacing scale, or `--font-sans`.
- JSON rendered with imported `vscodeDark`, IBM Plex Mono, no line-number gutter,
  status not color-coded, request/response chrome inconsistent.

## Decisions (locked)

Visual decisions were validated live via the brainstorming visual companion.

| Area | Decision |
|------|----------|
| **UI font** | Plus Jakarta Sans (replaces Space Grotesk) |
| **Code font** | Fira Code (replaces IBM Plex Mono) |
| **Toolbar layout** | Unified method+URL **pill**, accent **Send** button, **segmented** tabs |
| **JSON palette** | **Brand-tuned** syntax colors (teal keys, green strings, coral numbers, lavender bool/null) |
| **JSON chrome** | Color-coded status pill, Pretty/Raw toggle, size + latency, line-number gutter, roomier line-height |
| **Theming** | Light + dark now; default to **OS preference**, user override persisted |
| **Decomposition** | **Full** — break the monolith into focused units + shared `ui/` primitives |
| **Response scope** | Response pane **adopts** shared `JsonView` + `StatusPill` + fonts + color-coded status. Table/Headers/Visualize sub-views **not** reworked this pass. |

Identity stays "refine current": the existing palette
(`--bg:#0f1115`, `--accent:#ff7a59`, `--accent-2:#2ed3c6`) is retained; the
change is cohesion (real scales, one button/one dropdown, tuned JSON), fonts, and
a light theme.

## Architecture

### 1. Token & theme foundation (`src/styles.css` + new `useTheme`)

- Keep `:root` = dark defaults. Add `:root[data-theme="light"]` block with the
  light values for every semantic token.
- **New token groups** (defined in both themes where color-dependent):
  - `--font-sans: "Plus Jakarta Sans", system-ui, sans-serif;`
  - `--font-mono: "Fira Code", monospace;`
  - Type scale: `--text-xs:11px --text-sm:12.5px --text-md:13px --text-lg:15px --text-xl:22px` (line-heights paired).
  - Spacing scale: `--space-1:4px … --space-6:24px`.
  - Radius scale: `--radius-sm:7px --radius-md:9px --radius-lg:14px`.
  - Syntax palette: `--syn-key --syn-str --syn-num --syn-bool --syn-null --syn-punct` (brand-tuned; per-theme values below).
- **Fonts:** update the Google Fonts `@import` (drop Space Grotesk + IBM Plex Mono,
  add Plus Jakarta Sans + Fira Code). Set `body { font-family: var(--font-sans) }`.
- **Syntax palette values:**
  - Dark: key `#2ed3c6`, str `#8fe3a1`, num `#ff9d73`, bool/null `#b79cff`, punct `#5f6a80`.
  - Light: key `#0e8f86`, str `#2f8a4a`, num `#d15a2c`, bool/null `#6b4fd0`, punct `#9aa2b0`.
- **`useTheme()` hook** (`src/theme/useTheme.ts`): reads `localStorage["theme"]`,
  falls back to `matchMedia("(prefers-color-scheme: light)")`; writes
  `document.documentElement.dataset.theme`; exposes `{ theme, toggle }`.
- **Theme toggle:** a sun/moon button in the existing app top bar.

### 2. CodeMirror themes (`src/theme/codemirrorTheme.ts`)

- Build `brandDark` and `brandLight` theme extensions from the syntax tokens
  (resolve CSS vars at build once, or hardcode the same hex to avoid runtime var
  reads in CM). Replace all `vscodeDark` usages.
- Shared editor config: Fira Code, `fontSize` 13px, `lineHeight` 1.7,
  `bracketMatching` on (request already has it; response was missing it — now
  consistent), line-number gutter for read views.

### 3. Component decomposition

```
src/components/
  ui/                         shared primitives (request + response)
    Button.tsx                variants: primary | ghost | danger
    Select.tsx                Radix-based single dropdown system
    SegmentedControl.tsx      tab / Pretty-Raw control
    StatusPill.tsx            color-coded HTTP/WS status
    JsonView.tsx              CodeMirror wrapper + chrome (gutter, toolbar slot)
  RequestPane/
    RequestEditor.tsx         orchestrator + layout only (target ~150 lines)
    RequestToolbar.tsx        unified pill (MethodSelect + URL EnvInput) + Send
    MethodSelect.tsx          method dropdown (uses ui/Select)
    RequestTabs.tsx           uses ui/SegmentedControl
    tabs/
      ParamsTab.tsx
      HeadersTab.tsx
      AuthTab.tsx             rebuilt on ui/* — no inline styles
      BodyTab.tsx             uses ui/JsonView (editable)
      TestsTab.tsx
  ResponsePane/
    ResponseViewer.tsx        adopts ui/JsonView + ui/StatusPill + fonts
```

- `RequestEditor` keeps its external prop contract with `App.tsx` (no App-side
  behavior change beyond mounting the theme toggle); internally it distributes
  props to the new children instead of holding ~60 flat props in one body.
- The Auth tab's inline styles are replaced by `ui/Button`, `ui/Select`, and
  token-based classes.

### 4. Button / Select consolidation

- One `Button` (primary = accent, ghost, danger = the old `#ef4444` cancel, now a
  token `--danger`). All raw `<button className="primary|ghost">` and inline
  buttons migrate to it.
- One `Select` (Radix) replaces the method dropdown and any ad-hoc selects in the
  panes being touched.

## Data flow

No change to request/response data flow, IPC, or persistence. This is a
presentation + structure refactor. `useTheme` is the only new stateful unit; it
reads/writes `localStorage` and a DOM attribute, independent of app data.

## Error handling

No new error surfaces. JSON that fails to parse falls back to Raw (existing
behavior preserved). Theme read guards against unavailable `matchMedia`/
`localStorage` (default dark).

## Testing / verification

- **Behavior-preserving refactor:** existing unit tests (53) stay green.
- **New render tests** for `ui/` primitives (Button variants, StatusPill color
  mapping, SegmentedControl selection, JsonView renders + gutter).
- **Gates:** `npm run build` clean, `npm run lint` 0 errors, full test suite green.
- **Manual spot-check (both themes):** send a request; toggle theme; exercise each
  request tab (Params/Headers/Auth/Body/Tests); confirm response status color +
  JSON palette in light and dark.

## Scope boundaries (YAGNI)

**In:** token/theme foundation, light+dark + toggle, fonts, full request-pane
decomposition, shared `ui/` primitives, brand-tuned JSON viewer, response pane
adopting the shared viewer + status pill.

**Out (this pass):** response Table/Headers/Visualize sub-view rework; DAG panel;
any non-request/response screens; new features. Other screens keep working on the
existing tokens (which still exist); they simply gain the light theme for free
where they already use semantic tokens.

## Rollout

Single branch `feat/request-panel-redesign`. Land token foundation first (keeps
app green), then `ui/` primitives, then request decomposition, then response
adoption, then theme toggle — each step independently buildable.
