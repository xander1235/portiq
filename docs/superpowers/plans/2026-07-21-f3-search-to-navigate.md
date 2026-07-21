# F3: Search-to-Navigate Dropdown + Separate Sidebar Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NOTE:** This plan edits `src/App.tsx` heavily and MUST be executed AFTER F2 (`2026-07-21-f2-per-request-panes.md`) has landed on this branch, to avoid `App.tsx` conflicts.

**Goal:** Turn the top search box into a command-palette-style suggestions dropdown (requests, folders, collections, environments) whose selection navigates to the item; move the old tree-filtering behavior into a new dedicated filter input inside the Sidebar.

**Architecture:** A pure `searchIndex` util (Fuse.js) flattens collections + environments into typed entities and answers queries; it also finds a node's ancestor folder ids for "reveal". A presentational `SearchSuggestions` component renders the dropdown; `App.tsx` owns query/open/highlight state, keyboard handling, and a type-dispatch `handleSearchSelect`. Navigation to requests and folders goes through a `revealTarget` signal that both an App effect (open the request) and the Sidebar (expand ancestors + scroll + highlight) react to. The Sidebar gains its own `treeFilter` input driving the existing `matchesQuery`.

**Tech Stack:** React 18, TypeScript, `fuse.js` (already installed), CSS design tokens, vitest.

## Global Constraints

- No new dependencies. Use the installed `fuse.js` (`src/utils/fuzzySearch.ts` already imports it).
- History is explicitly OUT of the dropdown (no stable id).
- The dropdown closes and clears the query after any selection.
- Existing navigation functions must be reused, not reinvented: `handleCollectionSwitch(id)` (App.tsx:600), `handleRequestClick(req)` (App.tsx:605), `setActiveEnvId(id)` (from `useEnvironmentState`), `findRequestInItems(items, id)` (in App scope, used at App.tsx:665).
- Keyboard model matches existing inline inputs: Enter selects, Esc closes.

---

### Task 1: `searchIndex` util (entities + query + ancestor finder) + tests

**Files:**
- Create: `src/utils/searchIndex.ts`
- Test: `src/utils/searchIndex.test.ts`

**Interfaces:**
- Consumes: `fuse.js`.
- Produces:
  - `type SearchEntityType = "request" | "folder" | "collection" | "environment"`
  - `interface SearchEntity { type: SearchEntityType; id: string; label: string; sublabel?: string; keywords?: string; collectionId?: string; method?: string }`
  - `interface RevealTarget { type: "request" | "folder"; id: string; collectionId: string; nonce: number }`
  - `buildSearchEntities(collections: any[], environments: any[]): SearchEntity[]`
  - `searchEntities(entities: SearchEntity[], query: string, limit?: number): SearchEntity[]`
  - `findAncestorFolderIds(items: any[], targetId: string): string[] | null`

- [ ] **Step 1: Write the failing test**

Create `src/utils/searchIndex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSearchEntities, searchEntities, findAncestorFolderIds } from "./searchIndex";

const collections = [
  {
    id: "c1",
    name: "Payments API",
    items: [
      { type: "request", id: "r1", name: "Create charge", method: "POST", url: "https://api/charges", tags: ["billing"], description: "make a charge" },
      {
        type: "folder", id: "f1", name: "Refunds", items: [
          { type: "request", id: "r2", name: "Issue refund", method: "POST", url: "https://api/refunds" },
        ],
      },
    ],
  },
];
const environments = [{ id: "e1", name: "Production" }];

describe("buildSearchEntities", () => {
  it("flattens collections, folders, requests, and environments", () => {
    const ents = buildSearchEntities(collections, environments);
    const types = ents.map((e) => `${e.type}:${e.id}`);
    expect(types).toEqual([
      "collection:c1",
      "request:r1",
      "folder:f1",
      "request:r2",
      "environment:e1",
    ]);
  });
  it("attaches collectionId to requests and folders", () => {
    const ents = buildSearchEntities(collections, environments);
    expect(ents.find((e) => e.id === "r2")?.collectionId).toBe("c1");
    expect(ents.find((e) => e.id === "f1")?.collectionId).toBe("c1");
  });
  it("tolerates empty / missing input", () => {
    expect(buildSearchEntities([], [])).toEqual([]);
    expect(buildSearchEntities(undefined as any, undefined as any)).toEqual([]);
  });
});

describe("searchEntities", () => {
  const ents = buildSearchEntities(collections, environments);
  it("returns [] for an empty query", () => {
    expect(searchEntities(ents, "   ")).toEqual([]);
  });
  it("matches a request by name", () => {
    const hits = searchEntities(ents, "refund");
    expect(hits.some((h) => h.id === "r2")).toBe(true);
  });
  it("matches a request by url and by tag/description keywords", () => {
    expect(searchEntities(ents, "charges").some((h) => h.id === "r1")).toBe(true);
    expect(searchEntities(ents, "billing").some((h) => h.id === "r1")).toBe(true);
  });
  it("matches an environment by name", () => {
    expect(searchEntities(ents, "Production").some((h) => h.type === "environment")).toBe(true);
  });
  it("respects the limit", () => {
    expect(searchEntities(ents, "a", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("findAncestorFolderIds", () => {
  it("returns [] for a top-level item", () => {
    expect(findAncestorFolderIds(collections[0].items, "r1")).toEqual([]);
  });
  it("returns the folder chain for a nested request", () => {
    expect(findAncestorFolderIds(collections[0].items, "r2")).toEqual(["f1"]);
  });
  it("returns null when not found", () => {
    expect(findAncestorFolderIds(collections[0].items, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/searchIndex.test.ts`
Expected: FAIL — module `./searchIndex` not found.

- [ ] **Step 3: Write the implementation**

Create `src/utils/searchIndex.ts`:

```ts
import Fuse from "fuse.js";

export type SearchEntityType = "request" | "folder" | "collection" | "environment";

export interface SearchEntity {
  type: SearchEntityType;
  id: string;
  label: string;        // display name
  sublabel?: string;    // context line (collection name, or "METHOD url")
  keywords?: string;    // hidden extra search text (tags + description)
  collectionId?: string;
  method?: string;
}

export interface RevealTarget {
  type: "request" | "folder";
  id: string;
  collectionId: string;
  nonce: number;
}

export function buildSearchEntities(collections: any[], environments: any[]): SearchEntity[] {
  const out: SearchEntity[] = [];

  const walk = (items: any[], collectionId: string, collectionName: string) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item?.type === "folder") {
        out.push({ type: "folder", id: item.id, label: item.name, sublabel: collectionName, collectionId });
        walk(item.items || [], collectionId, collectionName);
      } else if (item?.type === "request") {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const keywords = [...tags, item.description || ""].join(" ").trim();
        out.push({
          type: "request",
          id: item.id,
          label: item.name,
          sublabel: [item.method, item.url].filter(Boolean).join(" "),
          keywords: keywords || undefined,
          collectionId,
          method: item.method,
        });
      }
    }
  };

  for (const col of collections || []) {
    out.push({ type: "collection", id: col.id, label: col.name });
    walk(col.items || [], col.id, col.name);
  }
  for (const env of environments || []) {
    out.push({ type: "environment", id: env.id, label: env.name });
  }
  return out;
}

const FUSE_OPTIONS = {
  keys: ["label", "sublabel", "keywords"],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
};

export function searchEntities(entities: SearchEntity[], query: string, limit = 8): SearchEntity[] {
  const q = query.trim();
  if (!q) return [];
  const fuse = new Fuse(entities, FUSE_OPTIONS);
  return fuse.search(q).slice(0, limit).map((r) => r.item);
}

/**
 * Ancestor folder ids leading to `targetId` (root→leaf), excluding the target.
 * Returns [] for a top-level item, null when the target isn't found.
 */
export function findAncestorFolderIds(items: any[], targetId: string): string[] | null {
  const dfs = (nodes: any[], trail: string[]): string[] | null => {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (node?.id === targetId) return trail;
      if (node?.type === "folder") {
        const found = dfs(node.items || [], [...trail, node.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return dfs(items, []);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/searchIndex.test.ts`
Expected: PASS. (If a fuzzy assertion is flaky due to threshold, the query terms above — "refund", "charges", "billing", "Production" — are strong matches and should rank in the top results.)

- [ ] **Step 5: Commit**

```bash
git add src/utils/searchIndex.ts src/utils/searchIndex.test.ts
git commit -m "feat(search): entity index, fuzzy query, and ancestor-folder finder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `SearchSuggestions` dropdown component

**Files:**
- Create: `src/components/Search/SearchSuggestions.tsx`

**Interfaces:**
- Consumes: `SearchEntity` from `../../utils/searchIndex`.
- Produces (props):
  ```ts
  interface SearchSuggestionsProps {
    results: SearchEntity[];
    highlightedIndex: number;
    onHover: (index: number) => void;
    onSelect: (entity: SearchEntity) => void;
  }
  ```
  Default export `SearchSuggestions`.

- [ ] **Step 1: Write the component**

Create `src/components/Search/SearchSuggestions.tsx`:

```tsx
import React from "react";
import type { SearchEntity, SearchEntityType } from "../../utils/searchIndex";

interface SearchSuggestionsProps {
  results: SearchEntity[];
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (entity: SearchEntity) => void;
}

const BADGE: Record<SearchEntityType, string> = {
  request: "REQ",
  folder: "DIR",
  collection: "COL",
  environment: "ENV",
};

export function SearchSuggestions({ results, highlightedIndex, onHover, onSelect }: SearchSuggestionsProps) {
  return (
    <div
      role="listbox"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        width: 340,
        maxHeight: 360,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        zIndex: 50,
        padding: 4,
      }}
    >
      {results.length === 0 ? (
        <div style={{ padding: "8px 10px", color: "var(--muted)", fontSize: "0.8rem" }}>No results</div>
      ) : (
        results.map((entity, i) => (
          <div
            key={`${entity.type}-${entity.id}`}
            role="option"
            aria-selected={i === highlightedIndex}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus so blur-close doesn't cancel the click
              onSelect(entity);
            }}
            onMouseEnter={() => onHover(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: i === highlightedIndex ? "var(--panel-2)" : "transparent",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "1px 4px",
                width: 30,
                textAlign: "center",
              }}
            >
              {BADGE[entity.type]}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {entity.label || "(untitled)"}
              </div>
              {entity.sublabel && (
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entity.sublabel}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default SearchSuggestions;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/Search/SearchSuggestions.tsx
git commit -m "feat(search): presentational suggestions dropdown component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the dropdown into the header + dispatch navigation

**Files:**
- Modify: `src/App.tsx` (imports; state near `topSearch` ~line 482; header search input ~line 2962-2968; add an App effect for request-open; Sidebar props ~line 3011-3024)

**Interfaces:**
- Consumes: `buildSearchEntities`, `searchEntities`, `SearchEntity`, `RevealTarget` (from `./utils/searchIndex`); `SearchSuggestions` (from `./components/Search/SearchSuggestions`); existing `handleCollectionSwitch`, `handleRequestClick`, `setActiveEnvId`, `findRequestInItems`, `getActiveCollection`, `activeCollectionId`, `collections`, `environments`.
- Produces: `revealTarget` state passed to Sidebar (Task 4 consumes it).

- [ ] **Step 1: Add imports**

At the top of `src/App.tsx` add:

```ts
import { buildSearchEntities, searchEntities, type SearchEntity, type RevealTarget } from "./utils/searchIndex";
import SearchSuggestions from "./components/Search/SearchSuggestions";
```

- [ ] **Step 2: Add dropdown + reveal state**

Immediately after the `topSearch` state (`const [topSearch, setTopSearch] = useState("");`, App.tsx:482) add:

```ts
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
  const revealNonceRef = useRef(0);

  const searchIndexEntities = useMemo(
    () => buildSearchEntities(collections, environments),
    [collections, environments]
  );
  const searchResults = useMemo(
    () => searchEntities(searchIndexEntities, topSearch, 8),
    [searchIndexEntities, topSearch]
  );
  useEffect(() => {
    setSearchHighlight(0);
  }, [topSearch]);
```

- [ ] **Step 3: Add the select-dispatch and keydown handlers**

Inside the `App` component (e.g. just above the `return (` of the render, alongside other handlers), add:

```ts
  function handleSearchSelect(entity: SearchEntity) {
    setSearchOpen(false);
    setTopSearch("");
    if (entity.type === "environment") {
      setActiveEnvId(entity.id);
      return;
    }
    if (entity.type === "collection") {
      handleCollectionSwitch(entity.id);
      return;
    }
    // request or folder → switch collection if needed, then reveal (and open, for requests)
    if (entity.collectionId && entity.collectionId !== activeCollectionId) {
      handleCollectionSwitch(entity.collectionId);
    }
    setRevealTarget({
      type: entity.type,
      id: entity.id,
      collectionId: entity.collectionId ?? "",
      nonce: ++revealNonceRef.current,
    });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSearchOpen(false);
      return;
    }
    if (!searchOpen || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchHighlight((h) => Math.min(h + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = searchResults[searchHighlight] || searchResults[0];
      if (sel) handleSearchSelect(sel);
    }
  }
```

- [ ] **Step 4: Add the App effect that opens a request from `revealTarget`**

This effect MUST be declared AFTER the collection-switch effect (App.tsx:654-709), so that when both fire on a cross-collection open, the intended request wins over the collection's last-active. Add it right after that effect closes (after line 709):

```ts
  // Open a request selected from the top-search dropdown. Runs after the
  // collection-switch effect so a cross-collection open wins over last-active.
  useEffect(() => {
    if (!revealTarget || revealTarget.type !== "request") return;
    const col =
      collections.find((c) => c.id === revealTarget.collectionId) || getActiveCollection();
    const located = col ? findRequestInItems(col.items || [], revealTarget.id) : null;
    if (located?.request) handleRequestClick(located.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTarget?.nonce]);
```

- [ ] **Step 5: Replace the header search input with an anchored dropdown**

Replace the header `<Input ... />` block (App.tsx:2963-2968) with:

```tsx
          <div style={{ position: "relative" }}>
            <Input
              className="w-[240px] h-8 bg-panel-2 border-border text-sm"
              placeholder="Search requests, folders, collections, environments"
              value={topSearch}
              onChange={(e) => {
                setTopSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={handleSearchKeyDown}
            />
            {searchOpen && topSearch.trim() && (
              <SearchSuggestions
                results={searchResults}
                highlightedIndex={searchHighlight}
                onHover={setSearchHighlight}
                onSelect={handleSearchSelect}
              />
            )}
          </div>
```

- [ ] **Step 6: Pass `revealTarget` to the Sidebar and stop passing `topSearch` for filtering**

In the `<Sidebar ... />` props (App.tsx:3011+):
- Remove the line `topSearch={topSearch}` (App.tsx:3013).
- Add: `revealTarget={revealTarget}`.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. (Sidebar prop type changes are handled in Task 4; if Task 4 is done in the same session, tsc passes after both. If checking after this task alone, expect a prop-type error on `revealTarget`/removed `topSearch` — resolved by Task 4. Proceed to Task 4 before committing the final wiring.)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(search): top-search suggestions dropdown with type-dispatch navigation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Sidebar — dedicated filter input + reveal (expand/scroll/highlight)

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx` (props interface + destructure ~line 59-124; `collapsedFolders` ~130; `matchesQuery` application ~193; folder/request row rendering ~200-;)

**Interfaces:**
- Consumes: `RevealTarget`, `findAncestorFolderIds` (from `../../utils/searchIndex`); existing `collections` prop, `getActiveCollection`, `collapsedFolders`/`setCollapsedFolders`.
- Produces: a `treeFilter` local state; honors `revealTarget`.

- [ ] **Step 1: Import the util**

At the top of `src/components/Sidebar/Sidebar.tsx` add:

```ts
import { findAncestorFolderIds, type RevealTarget } from "../../utils/searchIndex";
```

- [ ] **Step 2: Swap the `topSearch` prop for `revealTarget` in the props type**

In the `SidebarProps` interface, remove the `topSearch: string;` prop declaration and add:

```ts
    revealTarget?: RevealTarget | null;
```

In the destructured params (the `}: SidebarProps` block ending ~line 124), remove `topSearch,` and add `revealTarget,`.

- [ ] **Step 3: Add the `treeFilter` state and a highlighted-node state**

Near the other Sidebar `useState` declarations (after `collapsedFolders`, ~line 141) add:

```ts
    const [treeFilter, setTreeFilter] = useState("");
    const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
```

- [ ] **Step 4: Point the tree filter at `treeFilter`**

In `renderCollectionItems` (Sidebar.tsx:193), change:

```ts
        const filtered = items.filter((item) => matchesQuery(item, topSearch));
```
to
```ts
        const filtered = items.filter((item) => matchesQuery(item, treeFilter));
```

- [ ] **Step 5: Add the filter input above the tree**

Find where the collection tree is rendered (`renderCollectionItems(getActiveCollection()?.items || [])`, ~Sidebar.tsx:604). Immediately before that render, add a filter input. Use the existing input styling class used elsewhere in the sidebar; a minimal token-styled input is:

```tsx
        <input
          className="input"
          value={treeFilter}
          onChange={(e) => setTreeFilter(e.target.value)}
          placeholder="Filter this collection"
          aria-label="Filter collection tree"
          style={{ width: "100%", marginBottom: 8, height: 28, fontSize: "0.8rem" }}
        />
```

(If the surrounding JSX is a list/fragment, wrap the input and the tree in a fragment `<>...</>` as needed. Place the input inside the collections panel container, not the history panel.)

- [ ] **Step 6: Tag folder and request rows for reveal targeting**

On the folder row element (the `<div className={`${styles.treeFolder} ...`}` at Sidebar.tsx:204) add a `data-node-id` attribute and a highlight outline:

```tsx
                            data-node-id={item.id}
                            style={highlightedNodeId === item.id ? { outline: "2px solid var(--accent-2)", outlineOffset: -2, borderRadius: 6 } : undefined}
```

Do the same on each **request** row element (the request `<div>` rendered in the `requests.map(...)` block below the folders): add `data-node-id={item.id}` and the same conditional highlight `style`. (If the row already has a `style`, merge the highlight into it rather than overwriting.)

- [ ] **Step 7: React to `revealTarget` — expand ancestors, scroll, highlight**

Add this effect near the other Sidebar effects (after the `collapsedFolders` persistence effect, ~line 141):

```ts
    useEffect(() => {
      if (!revealTarget) return;
      const col =
        (collections || []).find((c: any) => c.id === revealTarget.collectionId) || getActiveCollection();
      const items = col?.items || [];
      const ancestors = findAncestorFolderIds(items, revealTarget.id) || [];
      if (ancestors.length) {
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          ancestors.forEach((id) => next.delete(id));
          return next;
        });
      }
      setHighlightedNodeId(revealTarget.id);
      const raf = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-node-id="${revealTarget.id}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      const timer = setTimeout(() => setHighlightedNodeId(null), 1500);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealTarget?.nonce]);
```

(`collections` and `getActiveCollection` are already available in the Sidebar — `getActiveCollection()` is used at line 604. If `collections` is not currently a prop, use `getActiveCollection()` alone as the source: `const items = getActiveCollection()?.items || []` — the collection was already switched by App before the reveal fired.)

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (App + Sidebar prop types now agree).

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all suites pass (including `searchIndex.test.ts`).

- [ ] **Step 10: Lint (no new warnings/errors on touched files)**

Run: `npx eslint src/App.tsx src/components/Sidebar/Sidebar.tsx src/components/Search/SearchSuggestions.tsx src/utils/searchIndex.ts`
Expected: exit 0 (pre-existing `react-hooks` warnings elsewhere are not introduced by these files).

- [ ] **Step 11: Manual verification**

Run the app.
1. Type in the top search → a dropdown appears under it with matching requests/folders/collections/environments; the sidebar tree does NOT filter from it.
2. ArrowDown/ArrowUp move the highlight; Enter opens the highlighted item; Esc closes; clicking a row selects it. The query clears after selection.
3. Select a **request** in another collection → collection switches, the request opens, and it scrolls into view + briefly highlights (ancestor folders expanded).
4. Select a **folder** → collection switches, folder expands + scrolls into view + highlights.
5. Select a **collection** → it becomes active.
6. Select an **environment** → it becomes the active environment (header env selector reflects it).
7. The new "Filter this collection" input inside the sidebar filters the tree exactly as the old top search did.

- [ ] **Step 12: Commit**

```bash
git add src/components/Sidebar/Sidebar.tsx
git commit -m "feat(search): dedicated sidebar filter + reveal (expand/scroll/highlight)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Self-Review

- **Spec coverage:** decouple top search from sidebar filter → Task 3 Step 6 + Task 4 Steps 2/4; separate sidebar filter input → Task 4 Steps 3/5; Fuse.js dropdown over requests/folders/collections/environments → Tasks 1/2/3; keyboard nav (↑/↓/Enter/Esc) → Task 3 Step 3; type-dispatch (request/collection/folder/environment) → Task 3 Step 3 `handleSearchSelect`; folder reveal via lifted `revealTarget` + ancestor finder → Tasks 1/3/4; clears query on select → Task 3 Step 3. History excluded → not indexed (Task 1). Covered.
- **Placeholder scan:** none. (Task 4 Steps 5/6 give exact code but note "merge into existing style" — this is a concrete instruction, not a placeholder, because the exact sibling markup must be read in-file; the code to add is fully specified.)
- **Type consistency:** `SearchEntity`, `RevealTarget`, `buildSearchEntities`, `searchEntities`, `findAncestorFolderIds` used with identical signatures across Tasks 1/3/4. `handleSearchSelect(entity: SearchEntity)`, `handleSearchKeyDown` defined once in Task 3 and referenced by the input in Task 3 Step 5. `revealTarget?.nonce` is the effect trigger in both App (Task 3 Step 4) and Sidebar (Task 4 Step 7).
```
