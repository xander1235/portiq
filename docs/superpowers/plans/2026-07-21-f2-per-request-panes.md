# F2: Per-Request Pane Sizes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The request/response split height (`topHeight`) and tools-pane width (`rightWidth`) remember their size per request, saved on the request object (so they travel with export/GitHub sync); the left sidebar width stays global.

**Architecture:** Add a `paneLayout` field to `RequestItem`. Keep `topHeight`/`rightWidth` as live React state driving the CSS grid, initialized from a global-default stored in `localStorage`. On drag-end, write the sizes to the active request's `paneLayout` (or to the global default when no request is active). On request switch, resolve the incoming request's layout (clamped to the current window) or fall back to the global default.

**Tech Stack:** React 18, TypeScript, better-sqlite3-backed `appState` blob (the `collections` tree serializes into it automatically), `localStorage` for the global default, vitest for the pure helper.

## Global Constraints

- `leftWidth` (sidebar) stays a global `useLocalStorage("ui_leftWidth", 232)` value — do NOT make it per-request.
- Clamp bounds must match the existing drag math exactly: top `Math.max(100, Math.min(v, innerHeight - 150))`, right `Math.max(150, Math.min(v, innerWidth / 2))`.
- Per-request layout is written on drag-**end** (mouseup), never on every mousemove.
- DAG protocol renders a single-row layout; `topHeight` simply isn't applied while in DAG view. No special-casing needed — the saved value is preserved.
- All existing files live where they are; follow current patterns (the `updateRequestState(id, field, value)` path already used for field edits).

---

### Task 1: Pure `paneLayout` helper + tests

**Files:**
- Create: `src/utils/paneLayout.ts`
- Test: `src/utils/paneLayout.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface PaneLayout { topHeight?: number; rightWidth?: number }`
  - `interface PaneDefaults { topHeight: number; rightWidth: number }`
  - `interface WindowSize { width: number; height: number }`
  - `clampTopHeight(value: number, windowHeight: number): number`
  - `clampRightWidth(value: number, windowWidth: number): number`
  - `resolvePaneLayout(saved: PaneLayout | undefined, defaults: PaneDefaults, win: WindowSize): PaneDefaults`

- [ ] **Step 1: Write the failing test**

Create `src/utils/paneLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampTopHeight, clampRightWidth, resolvePaneLayout } from "./paneLayout";

const WIN = { width: 1600, height: 1000 };
const DEFAULTS = { topHeight: 500, rightWidth: 260 };

describe("clampTopHeight", () => {
  it("keeps an in-range value", () => {
    expect(clampTopHeight(500, 1000)).toBe(500);
  });
  it("floors at 100", () => {
    expect(clampTopHeight(10, 1000)).toBe(100);
  });
  it("caps at windowHeight - 150", () => {
    expect(clampTopHeight(9999, 1000)).toBe(850);
  });
});

describe("clampRightWidth", () => {
  it("keeps an in-range value", () => {
    expect(clampRightWidth(260, 1600)).toBe(260);
  });
  it("floors at 150", () => {
    expect(clampRightWidth(10, 1600)).toBe(150);
  });
  it("caps at windowWidth / 2", () => {
    expect(clampRightWidth(9999, 1600)).toBe(800);
  });
});

describe("resolvePaneLayout", () => {
  it("uses saved values when present and in-range", () => {
    expect(resolvePaneLayout({ topHeight: 400, rightWidth: 300 }, DEFAULTS, WIN))
      .toEqual({ topHeight: 400, rightWidth: 300 });
  });
  it("falls back to defaults when saved is undefined", () => {
    expect(resolvePaneLayout(undefined, DEFAULTS, WIN))
      .toEqual({ topHeight: 500, rightWidth: 260 });
  });
  it("uses default per-axis when only one axis is saved", () => {
    expect(resolvePaneLayout({ topHeight: 400 }, DEFAULTS, WIN))
      .toEqual({ topHeight: 400, rightWidth: 260 });
  });
  it("clamps a layout saved on a larger screen", () => {
    // saved on a tall/wide screen, now viewed on a small window
    expect(resolvePaneLayout({ topHeight: 900, rightWidth: 700 }, DEFAULTS, { width: 800, height: 600 }))
      .toEqual({ topHeight: 450, rightWidth: 400 });
  });
  it("ignores NaN / non-finite saved values", () => {
    expect(resolvePaneLayout({ topHeight: NaN, rightWidth: Infinity }, DEFAULTS, WIN))
      .toEqual({ topHeight: 500, rightWidth: 260 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/paneLayout.test.ts`
Expected: FAIL — cannot resolve `./paneLayout` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/utils/paneLayout.ts`:

```ts
export interface PaneLayout {
  topHeight?: number;
  rightWidth?: number;
}

export interface PaneDefaults {
  topHeight: number;
  rightWidth: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function clampTopHeight(value: number, windowHeight: number): number {
  return Math.max(100, Math.min(value, windowHeight - 150));
}

export function clampRightWidth(value: number, windowWidth: number): number {
  return Math.max(150, Math.min(value, windowWidth / 2));
}

/**
 * Resolve the pane sizes for a request: use its saved layout when a given axis
 * is present and finite, otherwise the global default. Always clamped to the
 * current window so a layout saved on a large screen can't wedge the panes off
 * a smaller one.
 */
export function resolvePaneLayout(
  saved: PaneLayout | undefined,
  defaults: PaneDefaults,
  win: WindowSize
): PaneDefaults {
  const rawTop = isFiniteNumber(saved?.topHeight) ? (saved!.topHeight as number) : defaults.topHeight;
  const rawRight = isFiniteNumber(saved?.rightWidth) ? (saved!.rightWidth as number) : defaults.rightWidth;
  return {
    topHeight: clampTopHeight(rawTop, win.height),
    rightWidth: clampRightWidth(rawRight, win.width),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/paneLayout.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/paneLayout.ts src/utils/paneLayout.test.ts
git commit -m "feat(panes): add paneLayout resolve/clamp helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Add `paneLayout` to the request type

**Files:**
- Modify: `src/hooks/useRequestState.ts` (the `RequestItem` interface, ~line 48-77)

**Interfaces:**
- Consumes: `PaneLayout` shape (inline; do not import from the util to keep the type module dependency-free — declare the field inline).
- Produces: `RequestItem.paneLayout?: { topHeight?: number; rightWidth?: number }`.

- [ ] **Step 1: Add the field**

In `src/hooks/useRequestState.ts`, inside the `RequestItem` interface, after `dagGraph?: DagGraph;` add:

```ts
    paneLayout?: { topHeight?: number; rightWidth?: number };
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (the optional field breaks nothing).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRequestState.ts
git commit -m "feat(panes): add optional paneLayout field to RequestItem

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Decouple pane-size state from global localStorage

Today `topHeight`/`rightWidth` are `useLocalStorage` values (App.tsx:512-514), so every programmatic `setTopHeight` persists globally. We need them to be live state that can be freely overwritten per request, with a *separate* global default in localStorage used only as the fallback.

**Files:**
- Modify: `src/App.tsx` (pane-size state declarations ~line 512-514; add a small ref + helpers nearby)

**Interfaces:**
- Consumes: `resolvePaneLayout` (used in Task 5), the existing `updateRequestState` from the request hook (used in Task 4).
- Produces (module-local to App): `readGlobalPaneDefaults(): PaneDefaults`, `persistGlobalPaneDefaults(next: PaneDefaults): void`, and a `paneSizeRef` mirroring the live sizes.

- [ ] **Step 1: Import the helper and defaults type**

At the top of `src/App.tsx`, add to the imports:

```ts
import { resolvePaneLayout, type PaneDefaults } from "./utils/paneLayout";
```

- [ ] **Step 2: Add global-default read/write helpers**

Near the other top-level helpers in `src/App.tsx` (module scope, above the component), add:

```ts
const PANE_TOP_KEY = "ui_topHeight";
const PANE_RIGHT_KEY = "ui_rightWidth";

function readGlobalPaneDefaults(): PaneDefaults {
  const read = (key: string, fallback: number): number => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const n = JSON.parse(raw);
      return typeof n === "number" && Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    topHeight: read(PANE_TOP_KEY, window.innerHeight / 2),
    rightWidth: read(PANE_RIGHT_KEY, 260),
  };
}

function persistGlobalPaneDefaults(next: PaneDefaults): void {
  try {
    localStorage.setItem(PANE_TOP_KEY, JSON.stringify(next.topHeight));
    localStorage.setItem(PANE_RIGHT_KEY, JSON.stringify(next.rightWidth));
  } catch {
    /* ignore quota/serialization errors */
  }
}
```

- [ ] **Step 3: Convert the state declarations**

In `src/App.tsx`, replace lines 513-514:

```ts
  const [rightWidth, setRightWidth] = useLocalStorage("ui_rightWidth", 260);
  const [topHeight, setTopHeight] = useLocalStorage("ui_topHeight", window.innerHeight / 2);
```

with:

```ts
  const [rightWidth, setRightWidth] = useState<number>(() => readGlobalPaneDefaults().rightWidth);
  const [topHeight, setTopHeight] = useState<number>(() => readGlobalPaneDefaults().topHeight);
```

Leave `leftWidth` (line 512) exactly as-is (`useLocalStorage("ui_leftWidth", 232)`).

- [ ] **Step 4: Add a ref mirroring live sizes**

After the `draggingRef` declaration/effect (App.tsx:518-522), add:

```ts
  const paneSizeRef = useRef<PaneDefaults>({ topHeight, rightWidth });
  useEffect(() => {
    paneSizeRef.current = { topHeight, rightWidth };
  }, [topHeight, rightWidth]);
```

(If `useState`/`useRef`/`useEffect` are not already imported at the top of `App.tsx`, they are — this file already uses all three.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(panes): decouple live pane sizes from global localStorage default

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Save pane sizes on drag-end

**Files:**
- Modify: `src/App.tsx` (the resizing effect, ~line 782-813)

**Interfaces:**
- Consumes: `updateRequestState` (from the `useRequestState` hook, already destructured in App), `currentRequestId`, `paneSizeRef`, `persistGlobalPaneDefaults`, `clampTopHeight`/`clampRightWidth` (import the two clamp fns alongside `resolvePaneLayout`).
- Produces: nothing new.

- [ ] **Step 1: Extend the clamp import**

Update the import added in Task 3 Step 1 to:

```ts
import { resolvePaneLayout, clampTopHeight, clampRightWidth, type PaneDefaults } from "./utils/paneLayout";
```

- [ ] **Step 2: Use the shared clamps in mousemove and write per-request on mouseup**

In `src/App.tsx`, replace the resizing effect body (the `handleMouseMove` + `handleMouseUp` definitions, lines 784-798) with:

```ts
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current.left) {
        setLeftWidth(Math.max(150, Math.min(e.clientX, window.innerWidth / 2)));
      } else if (draggingRef.current.right) {
        const w = clampRightWidth(window.innerWidth - e.clientX, window.innerWidth);
        setRightWidth(w);
        paneSizeRef.current.rightWidth = w;
      } else if (draggingRef.current.main) {
        const h = clampTopHeight(e.clientY - 60, window.innerHeight);
        setTopHeight(h);
        paneSizeRef.current.topHeight = h;
      }
    };

    const handleMouseUp = () => {
      const wasMain = draggingRef.current.main;
      const wasRight = draggingRef.current.right;
      setDraggingLeft(false);
      setDraggingRight(false);
      setDraggingMain(false);
      if (wasMain || wasRight) {
        const sizes = paneSizeRef.current;
        if (currentRequestId) {
          // Per-request: rides along in the appState blob + export/sync.
          updateRequestState(currentRequestId, "paneLayout", {
            topHeight: sizes.topHeight,
            rightWidth: sizes.rightWidth,
          });
        } else {
          // No active request (blank New Request) → update the global default.
          persistGlobalPaneDefaults(sizes);
        }
      }
    };
```

(Leave the `if (draggingLeft || draggingRight || draggingMain)` attach/detach block and the `return () => {...}` cleanup below unchanged. `leftWidth` resizing still only updates the global sidebar width via its own `useLocalStorage` setter — unchanged.)

- [ ] **Step 3: Confirm the effect dependency array still lists the dragging flags**

The effect's dependency array (currently `[draggingLeft, draggingRight, draggingMain]`) is correct: the effect re-subscribes when a drag starts, capturing the current `currentRequestId` and `updateRequestState`. Since a request cannot be switched mid-drag, this is safe. Leave the dependency array as-is.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(panes): save request/response + tools pane sizes on drag-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Restore pane sizes on request switch

Restore happens in App.tsx at the two switch seams: `handleRequestClick` (~line 605) and the collection-switch effect (~line 654). A small local helper keeps it DRY.

**Files:**
- Modify: `src/App.tsx` (`handleRequestClick` ~605; collection-switch effect ~654)

**Interfaces:**
- Consumes: `resolvePaneLayout`, `readGlobalPaneDefaults`, `setTopHeight`, `setRightWidth`.
- Produces: local `applyPaneLayout(req: { paneLayout?: { topHeight?: number; rightWidth?: number } } | null): void`.

- [ ] **Step 1: Add the local apply helper**

Inside the `App` component (near `handleRequestClick`, before it), add:

```ts
  function applyPaneLayout(req: { paneLayout?: { topHeight?: number; rightWidth?: number } } | null) {
    const resolved = resolvePaneLayout(
      req?.paneLayout,
      readGlobalPaneDefaults(),
      { width: window.innerWidth, height: window.innerHeight }
    );
    setTopHeight(resolved.topHeight);
    setRightWidth(resolved.rightWidth);
  }
```

- [ ] **Step 2: Apply on `handleRequestClick`**

In `handleRequestClick` (App.tsx:605), immediately after the `loadRequest(req);` call (line 613), add:

```ts
    applyPaneLayout(req);
```

- [ ] **Step 3: Apply in the collection-switch effect**

In the effect at App.tsx:654, there are three `loadRequest(...)` calls. After each, apply the matching layout:

- After `loadRequest(req);` (the located-request branch, ~line 668) add:
  ```ts
          applyPaneLayout(req);
  ```
- After `loadRequest(null);` in the `else` branch (~line 698) add:
  ```ts
          applyPaneLayout(null);
  ```
- After `loadRequest(null);` in the outer `else` (~line 704) add:
  ```ts
        applyPaneLayout(null);
  ```

(`applyPaneLayout(null)` resolves to the global default — correct for the blank/new-request state.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `npm test`
Expected: all suites pass (including the new `paneLayout.test.ts`).

- [ ] **Step 6: Manual verification**

Run the app. In collection with ≥2 requests:
1. Open request A, drag the request/response splitter and the right (tools) resizer to distinctive sizes.
2. Open request B — its layout differs (or defaults). Resize B differently.
3. Return to A → A's sizes are restored; return to B → B's sizes are restored.
4. Create a New Request (no id) → sizes fall back to the global default; resizing it updates that default.
5. Export a request that has a saved layout and inspect the JSON → `paneLayout` present. (Sync path rides the same blob.)
6. Shrink the window very small, then switch to a request whose layout was saved wide → panes are clamped, not broken.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(panes): restore per-request pane sizes on switch (clamped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Self-Review

- **Spec coverage:** data model (`paneLayout` on `RequestItem`) → Task 2; travels-with-request (rides `collections`→`appState` blob + export/sync, and `syncDraftToCollection` preserves it via `{...item, ...draft}` since `draft` omits `paneLayout`) → Tasks 2+4; save on drag-end → Task 4; restore-with-clamp at both seams → Tasks 1+5; global default fallback + no-active-request write → Tasks 3+4; `leftWidth` stays global → Task 3 constraint; DAG single-row untouched → Global Constraints. Covered.
- **Placeholder scan:** none.
- **Type consistency:** `PaneDefaults`/`PaneLayout`/`WindowSize` and `resolvePaneLayout`/`clampTopHeight`/`clampRightWidth` used identically across Tasks 1/3/4/5. `updateRequestState(id, field, value)` matches the signature at `useRequestState.ts:449`. `applyPaneLayout` defined once (Task 5 Step 1) and reused.
