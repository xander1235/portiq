# UX Quick Features: Light-Mode Checkboxes, Per-Request Panes, Search-to-Navigate

**Date:** 2026-07-21
**Status:** Approved

Three independent UX improvements, specified together so they can be built by
separate subagents. Feature 1 is fully isolated (`styles.css` only). Features 2
and 3 both edit `App.tsx` heavily, so they run **sequentially** (2 then 3) to
avoid merge conflicts.

---

## Feature 1 — Manage Collections checkboxes invisible in light mode

### Problem

In light theme, the checkboxes in the **Manage Collections** modal (and the
**Export** modal, which shares the same styles) are invisible until checked. The
unchecked box has no visible border or fill on a near-white panel.

### Root cause

The unchecked checkbox border and background are hardcoded to translucent
**white**, which has no contrast on the light theme's near-white surfaces
(`--panel: #f7f8fa`, `--bg: #ffffff`). There are no `:root[data-theme="light"]`
overrides for these rules, so the dark-oriented white values apply in both
themes. The **checked** state already uses theme tokens (`var(--text)` /
`var(--bg)`) and stays visible — only the unchecked state is broken.

Affected rules in `src/styles.css`:

- `.manage-modal .mc-check` (~line 2348): `border: 1px solid rgba(255,255,255,0.2)`,
  `background: rgba(255,255,255,0.05)`.
- `.export-row input[type="checkbox"]` (~line 2137): same two hardcoded values.
- `.manage-modal .mc-collection-item:hover` / `.active` (~lines 2341/2344):
  `rgba(255,255,255,0.03)` / `0.05` — invisible hover feedback in light mode
  (secondary symptom of the same pattern).

### Fix

Swap the hardcoded white values for theme tokens (which resolve correctly under
both themes). Keep the custom `appearance: none` look and the checked state
unchanged.

- Unchecked border `rgba(255,255,255,0.2)` → `var(--border)`.
- Unchecked background `rgba(255,255,255,0.05)` → `var(--panel-3)`.
- Apply to **both** `.manage-modal .mc-check` and `.export-row input[type="checkbox"]`.
- Hover/active row backgrounds → `var(--panel-2)` for visible hover in light mode.

### Files

- `src/styles.css` only.

### Acceptance

- Toggle light theme, open Manage Collections: every unchecked checkbox shows a
  visible box; checked state still shows the checkmark. Same in dark theme
  (no visual regression). Export modal checkboxes verified in both themes.

### Testing

- CSS-only; verified manually in both themes. No unit test.

---

## Feature 2 — Per-request pane sizes (travels with the request)

### Goal

Pane sizes are currently three **global** values in `localStorage`
(`ui_topHeight`, `ui_rightWidth`, `ui_leftWidth`, set in `App.tsx:512-514`).
Make the **request/response split** and the **tools pane** width remember their
size **per request**, so switching requests restores that request's layout. The
left sidebar stays global. Layout **travels with the request** via local
persistence and GitHub sync; the Postman-format export intentionally omits
this Portiq-internal field.

### Current mechanism

Hand-rolled CSS-grid splitter in `App.tsx`, no resize library:

- Outer grid columns `App.tsx:3006-3008`: `${leftWidth}px 10px 1fr 10px ${rightWidth}px`.
- Inner `main` rows `App.tsx:3049`: `${topHeight}px 10px 1fr` (single `1fr` for
  `protocol === "dag"`).
- Drag math `App.tsx:783-813` clamps: left `[150, innerWidth/2]`, right
  `[150, innerWidth/2]`, top `[100, innerHeight-150]`.
- Sizes read from `useLocalStorage` (`App.tsx:512-514`).

### Data model

Add an optional field to `RequestItem` (`src/hooks/useRequestState.ts:48-77`):

```ts
paneLayout?: { topHeight?: number; rightWidth?: number };
```

Because `RequestItem` is nested in the `collections` tree that is serialized into
the single `appState` blob (persisted via `savePersisted`, `App.tsx:918`) and
included in GitHub sync, storing layout here makes it travel with the request
automatically for local persistence and sync — no separate persistence path
needed. The Postman-format export intentionally omits Portiq-internal fields
like `paneLayout`, so it does not appear in exported JSON. `leftWidth` is
**not** part of `paneLayout`; it stays a global `useLocalStorage` value.

### Save

- Keep `topHeight` / `rightWidth` as live React state driving the grid (so
  dragging stays smooth).
- On drag end (mouseup that ends a `main` or `right` drag), write the current
  `topHeight` / `rightWidth` into the **active request's** `paneLayout` in the
  `collections` tree via the existing request-update path
  (`updateRequestState(currentRequestId, ...)` pattern), so it persists like any
  edit. Writing on drag-end (not on every mousemove) avoids thrashing the tree
  and the persisted blob.
- If there is no active request (blank "New Request"), write to the global
  `ui_topHeight` / `ui_rightWidth` fallback instead.

### Restore

At the request-switch seam — `handleRequestClick` (`App.tsx:605`) and the
collection-switch effect (`App.tsx:654`):

- If the incoming request has `paneLayout.topHeight` / `.rightWidth`, apply them.
- Otherwise fall back to the global defaults (the `ui_topHeight` / `ui_rightWidth`
  values, defaulting to `innerHeight/2` and `260`).

### Guardrails

- **Clamp on restore** using the existing min/max math (top `[100, innerHeight-150]`,
  right `[150, innerWidth/2]`) so a layout saved on a large screen can't wedge
  panes off a smaller screen. This is the accepted mitigation for the "pixel
  sizes travel across machines" tradeoff of the travels-with-request choice.
- **DAG protocol** renders a single `1fr` row, so `topHeight` is ignored there;
  no special handling — the saved value simply isn't applied while in DAG view
  and is preserved for when the request returns to a split view.
- New/blank request → global defaults.

### Files

- `src/hooks/useRequestState.ts` — add `paneLayout` to `RequestItem`; if
  `loadRequest` is the cleanest apply point, restore there.
- `src/App.tsx` — drag-end save, restore at switch seams, keep grid reads.

### Acceptance

- Resize request/response split and tools width on request A; switch to request
  B (different sizes), then back to A → A's sizes restored. New request uses
  defaults. Reload the app (local persistence) or GitHub-sync a request with a
  saved layout → `paneLayout` present in the stored/synced JSON. A Postman-format
  export of the same request intentionally omits `paneLayout`. A layout saved
  wide then loaded on a narrow window is clamped, not broken.

### Testing

- Extract the clamp + "pick layout-or-default" logic into a small pure helper and
  unit-test it (vitest): returns saved values when present and in-range, clamps
  out-of-range values, falls back to defaults when absent.

---

## Feature 3 — Top-search suggestions dropdown + separate sidebar filter

### Goal

Today the top search input (`topSearch`, `App.tsx:482`, rendered `App.tsx:2963`)
is passed to the Sidebar and filters the active collection's tree
(`matchesQuery`, `Sidebar.tsx:172-193`). Change it to a **suggestions dropdown**
(command-palette style) anchored under the search input: matching requests,
folders, collections, and environments; selecting one **navigates** to it. The
existing tree-filter behavior moves to a **separate small filter input inside
the Sidebar**.

### Part A — Decouple + separate sidebar filter

- Stop passing `topSearch` into `Sidebar` for filtering.
- Add a new local filter input **inside** `Sidebar` with its own state (e.g.
  `treeFilter`), wired to the existing `matchesQuery` filter (`Sidebar.tsx:193`).
  Behavior of `matchesQuery` is unchanged; only its input source changes.
- `topSearch` now drives only the dropdown (Part B).

### Part B — Suggestions dropdown

- **Primitive:** no command-palette component exists; `@radix-ui/react-popover`
  and `cmdk` are **not** installed. `fuse.js` **is** installed and already used
  (`src/utils/fuzzySearch.ts`). Build a custom absolutely-positioned panel under
  the header `<Input>` (`App.tsx:2963`) — no new dependency, stays offline. Reuse
  styling cues from `src/components/ui/dropdown-menu.tsx`.
- **Index:** built with Fuse.js over a combined list:
  - requests + folders + collections — via `flattenCollections`
    (`src/utils/fuzzySearch.ts:3`) for requests (fields: name, url, method, tags,
    description), plus folder and collection names.
  - environments — from `environments` (`App.tsx:432`; type
    `src/hooks/useEnvironmentState.ts:12`), matched on name.
  Each result carries `{ type, id, collectionId?, label, sublabel }`.
- **Rendering:** grouped or type-tagged rows (e.g. a small badge: Request /
  Folder / Collection / Env), showing name + context (e.g. collection name, or
  method+url for requests). Empty query → dropdown closed. No matches → a single
  "No results" row.
- **Keyboard:** ArrowUp/ArrowDown move the highlighted row, Enter selects it, Esc
  closes and clears highlight, click selects, blur closes. Model Enter/Esc on the
  existing inline-input pattern (`Sidebar.tsx:359-366`).

### On select — dispatch by type

| Type | Action |
|------|--------|
| request | `handleCollectionSwitch(collectionId)` then `handleRequestClick(req)` (`App.tsx:600` / `605`) |
| collection | `handleCollectionSwitch(id)` (`App.tsx:600`) |
| folder | reveal (see below) |
| environment | `setActiveEnvId(id)` (`useEnvironmentState.ts:26`) |

After select: close dropdown and clear `topSearch`.

### Folder reveal (the one structural change)

Folder open/closed state (`collapsedFolders` Set) is currently **private to
Sidebar** (`Sidebar.tsx:130-141`, persisted to `localStorage["vaaya_collapsedFolders"]`);
a folder is open when its id is **absent** from the set. To reveal a folder from
the dropdown:

- Introduce a `revealTarget` signal from `App` → `Sidebar` (prop:
  `{ type, id, collectionId }` plus a nonce so repeated reveals of the same
  target re-fire).
- A `Sidebar` effect reacts: switch to `collectionId` if needed, compute the
  ancestor folder ids via a tree-path finder, **remove** those ids from
  `collapsedFolders` (expand them), then scroll the target node into view and
  briefly highlight it.
- This same reveal path is reused for the **request** case so an opened request
  is also scrolled into view within its (possibly collapsed) folder.

### Files

- `src/components/Search/SearchSuggestions.tsx` (new) — the dropdown panel +
  keyboard handling.
- `src/utils/fuzzySearch.ts` — extend with a combined-entity index builder (or a
  new `src/utils/searchIndex.ts` that composes it), returning typed results.
- `src/App.tsx` — dropdown open/highlight state next to `topSearch`, render the
  panel under the header input, the select-dispatch, and the `revealTarget`
  state passed to Sidebar. Remove the `topSearch` → Sidebar filter wiring.
- `src/components/Sidebar/Sidebar.tsx` — new tree-filter input + state; accept
  and honor `revealTarget`; expose/adjust `collapsedFolders` handling; add a
  tree-path finder + scroll-into-view + highlight.

### Acceptance

- Typing in the top search shows a dropdown of matching requests/folders/
  collections/environments; the sidebar does **not** filter from it.
- Selecting a request opens it (switching collection first if needed) and scrolls
  it into view. Selecting a collection switches to it. Selecting a folder switches
  collection, expands ancestors, scrolls it into view. Selecting an environment
  makes it active.
- ↑/↓ move highlight, Enter opens highlighted, Esc closes. Selecting clears the
  query.
- The new sidebar filter input filters the active collection's tree exactly as
  the old `topSearch` did.

### Testing

- Unit-test the index builder + result mapping (vitest): given fixture
  collections/environments and a query, returns expected typed results in ranked
  order; the tree-path finder returns correct ancestor ids for a nested folder.
- Dispatch and reveal wiring verified manually.

---

## Execution / parallelization

- **Feature 1** (checkbox) — runs immediately, in parallel; isolated to
  `styles.css`.
- **Feature 2** (per-request panes) — runs next; edits `App.tsx` +
  `useRequestState.ts`.
- **Feature 3** (search dropdown) — runs after Feature 2 lands, on the same
  branch, because it also edits `App.tsx` heavily and would otherwise conflict.

Per the subagent-driven workflow: a low-but-capable model performs each edit;
Opus reviews before commit. Each feature verified with `eslint` (0 new errors),
`tsc --noEmit`, and `npm test` (vitest) before moving on.

## Out of scope (YAGNI)

- History in the search dropdown (explicitly excluded; no stable id, noisy).
- Making `leftWidth` (sidebar) per-request.
- Storing pane sizes as ratios instead of pixels (pixels + clamp is sufficient).
- A shared command palette / global hotkey to open search (separate feature).
