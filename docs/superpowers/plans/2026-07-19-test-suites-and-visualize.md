# Test Suites & Data Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped, isolated test suites (`pm.describe`/`pm.test`) with a clear per-step results UI, and a data-visualization feature (auto chart builder + optional user viz script) rendered by a dependency-free SVG chart component behind the existing Visualize tab.

**Architecture:** Two pure, unit-tested modules — `src/services/testRunner.ts` (group tracking + result shaping) and `src/services/visualize.ts` (chart-spec detection/validation) — hold the logic. `src/App.tsx` `buildPm`/`runScript` consume them. React surfaces (`TestsTab`, `TestsPane`, `ResponseViewer`, new `VizChart`) render the shaped data. No new npm dependency; charts use inline SVG.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (pure `*.test.ts` files, jsdom-free), CodeMirror editors, existing `pm.*` script sandbox via `AsyncFunction`.

## Global Constraints

- No new runtime dependency — charts must use inline SVG.
- TypeScript strict; match existing code style (2-space indent, `.tsx`/`.ts`).
- Vitest tests are pure logic only (no React render) — file pattern `*.test.ts` next to source, matching existing tests like `src/services`/`dag/*.test.ts`.
- Test entries keep the existing shape; new fields are optional and additive (back-compat with entries lacking `group`).
- Every `pm.test` / `pm.describe` is isolated: a throw is caught and recorded, never aborts sibling tests or other groups.
- Run tests with `npx vitest run <path>`.
- Follow the `dataviz` skill for chart palette/contrast/legend when writing `VizChart`.

---

### Task 1: Pure test-runner module (grouping + summary)

**Files:**
- Create: `src/services/testRunner.ts`
- Test: `src/services/testRunner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TestEntry = { type: "pass"|"fail"|"error"|"log"|"info"; text: string; label: string; group?: string; duration?: number; errorType?: string; errorMessage?: string }`
  - `createTestHarness(output: TestEntry[], label: string, now?: () => number): { describe(name: string, fn: () => any): Promise<void>; test(name: string, fn: () => any): Promise<void> }`
  - `type TestSummary = { passed: number; failed: number; errored: number; duration: number; groups: { name: string; passed: number; failed: number; errored: number; duration: number; entries: TestEntry[] }[]; console: TestEntry[] }`
  - `summarizeTests(entries: TestEntry[]): TestSummary`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/testRunner.test.ts
import { describe, it, expect } from "vitest";
import { createTestHarness, summarizeTests, type TestEntry } from "./testRunner";

describe("createTestHarness", () => {
  it("records pass and fail independently without aborting siblings", async () => {
    const out: TestEntry[] = [];
    const t = 100;
    const pm = createTestHarness(out, "post-script", () => t);
    await pm.test("a passes", () => {});
    await pm.test("b fails", () => { throw new Error("boom"); });
    await pm.test("c passes", () => {});
    expect(out.map(e => [e.text, e.type])).toEqual([
      ["a passes", "pass"],
      ["b fails", "fail"],
      ["c passes", "pass"],
    ]);
    expect(out[1].errorMessage).toBe("boom");
    expect(out.every(e => e.group === "Ungrouped")).toBe(true);
    expect(out.every(e => e.duration === 0)).toBe(true);
  });

  it("attaches tests to the active describe group and restores after", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("Auth", async () => {
      await pm.test("has token", () => {});
    });
    await pm.test("top level", () => {});
    expect(out[0].group).toBe("Auth");
    expect(out[1].group).toBe("Ungrouped");
  });

  it("records a group-level error when a describe body throws but keeps other groups", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("Broken", () => { throw new Error("setup failed"); });
    await pm.describe("Fine", async () => { await pm.test("ok", () => {}); });
    expect(out[0]).toMatchObject({ type: "error", group: "Broken", errorMessage: "setup failed" });
    expect(out[1]).toMatchObject({ type: "pass", group: "Fine", text: "ok" });
  });

  it("captures the group synchronously at test-call time for async bodies", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("G", async () => {
      await pm.test("async work", async () => { await Promise.resolve(); });
    });
    expect(out[0].group).toBe("G");
  });
});

describe("summarizeTests", () => {
  it("aggregates totals, per-group breakdown, and console entries", () => {
    const entries: TestEntry[] = [
      { type: "pass", text: "a", label: "l", group: "G1", duration: 5 },
      { type: "fail", text: "b", label: "l", group: "G1", duration: 3, errorMessage: "x" },
      { type: "error", text: "G2", label: "l", group: "G2" },
      { type: "log", text: "hello", label: "l", group: "Ungrouped" },
    ];
    const s = summarizeTests(entries);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errored).toBe(1);
    expect(s.duration).toBe(8);
    expect(s.groups.find(g => g.name === "G1")).toMatchObject({ passed: 1, failed: 1, duration: 8 });
    expect(s.console).toHaveLength(1);
    expect(s.console[0].text).toBe("hello");
  });

  it("treats entries with no group as Ungrouped", () => {
    const s = summarizeTests([{ type: "pass", text: "a", label: "l" }]);
    expect(s.groups[0].name).toBe("Ungrouped");
    expect(s.passed).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/testRunner.test.ts`
Expected: FAIL — `Failed to resolve import "./testRunner"`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/testRunner.ts
export interface TestEntry {
  type: "pass" | "fail" | "error" | "log" | "info";
  text: string;
  label: string;
  group?: string;
  duration?: number;
  errorType?: string;
  errorMessage?: string;
}

export interface TestHarness {
  describe(name: string, fn: () => any): Promise<void>;
  test(name: string, fn: () => any): Promise<void>;
}

const clock = (): number => Date.now();

export function createTestHarness(
  output: TestEntry[],
  label: string,
  now: () => number = clock
): TestHarness {
  let currentGroup = "Ungrouped";

  const describe = async (name: string, fn: () => any): Promise<void> => {
    const prev = currentGroup;
    currentGroup = name;
    try {
      await fn();
    } catch (err: any) {
      output.push({
        type: "error",
        text: name,
        label,
        group: name,
        errorType: err?.name,
        errorMessage: err?.message ?? String(err),
      });
    } finally {
      currentGroup = prev;
    }
  };

  const test = async (name: string, fn: () => any): Promise<void> => {
    const group = currentGroup; // capture synchronously at call time
    const start = now();
    try {
      await fn();
      output.push({ type: "pass", text: name, label, group, duration: now() - start });
    } catch (err: any) {
      output.push({
        type: "fail",
        text: name,
        label,
        group,
        duration: now() - start,
        errorType: err?.name,
        errorMessage: err?.message ?? String(err),
      });
    }
  };

  return { describe, test };
}

export interface TestGroupSummary {
  name: string;
  passed: number;
  failed: number;
  errored: number;
  duration: number;
  entries: TestEntry[];
}

export interface TestSummary {
  passed: number;
  failed: number;
  errored: number;
  duration: number;
  groups: TestGroupSummary[];
  console: TestEntry[];
}

export function summarizeTests(entries: TestEntry[]): TestSummary {
  const groups: TestGroupSummary[] = [];
  const byName = new Map<string, TestGroupSummary>();
  const console: TestEntry[] = [];
  let passed = 0, failed = 0, errored = 0, duration = 0;

  for (const e of entries) {
    if (e.type === "log" || e.type === "info") {
      console.push(e);
      continue;
    }
    const name = e.group || "Ungrouped";
    let g = byName.get(name);
    if (!g) {
      g = { name, passed: 0, failed: 0, errored: 0, duration: 0, entries: [] };
      byName.set(name, g);
      groups.push(g);
    }
    g.entries.push(e);
    if (typeof e.duration === "number") {
      g.duration += e.duration;
      duration += e.duration;
    }
    if (e.type === "pass") { g.passed++; passed++; }
    else if (e.type === "fail") { g.failed++; failed++; }
    else if (e.type === "error") { g.errored++; errored++; }
  }

  return { passed, failed, errored, duration, groups, console };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/testRunner.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/testRunner.ts src/services/testRunner.test.ts
git commit -m "feat(tests): pure test-runner harness with grouping + summary"
```

---

### Task 2: Wire grouped harness into the pm sandbox

**Files:**
- Modify: `src/App.tsx` — `runScript` (~2944-2981) and `buildPm` (~2983-3130)

**Interfaces:**
- Consumes: `createTestHarness`, `TestEntry` from Task 1.
- Produces: `pm.describe(name, fn)` and enriched `pm.test(name, fn)` (records `group`/`duration`) available to all scripts. `runScript` unchanged signature.

- [ ] **Step 1: Import the harness**

At the top of `src/App.tsx` with the other imports, add:

```typescript
import { createTestHarness } from "./services/testRunner";
```

- [ ] **Step 2: Create a harness inside `buildPm` and expose describe/test**

In `buildPm`, before `const pm = {`, add:

```typescript
    const harness = createTestHarness(output, label);
```

Then replace the existing `test:` property inside the `pm` object (currently ~3073-3086) with:

```typescript
      describe: (name: string, fn: () => any) => harness.describe(name, fn),
      test: (name: string, fn: () => any) => harness.test(name, fn),
```

(Leave `pm.expect`, `pm.response`, etc. unchanged.)

- [ ] **Step 3: Make pre/post scripts await async tests**

`runScript` already `await`s `fn(...)`. Because `pm.test`/`pm.describe` now return promises, scripts that `await pm.test(...)` work; scripts that don't await still record results synchronously at call time (group captured up front). No signature change needed. Confirm `runScript` still `await fn(...)` — no edit required beyond Step 2.

- [ ] **Step 4: Manual verification (no unit test — React/state wiring)**

Run: `npm run dev`
In a request's Scripts tab → Post-response, enter:

```javascript
pm.describe("Status", () => {
  pm.test("is 200", () => pm.response.to.have.status(200));
  pm.test("always fails", () => { throw new Error("nope"); });
});
pm.test("ungrouped ok", () => pm.expect(1).to.equal(1));
```

Click **Run Tests**. Expected in Output: three results — `Status` group has one PASS + one FAIL (message "nope"), plus one PASS `ungrouped ok`. The FAIL must not stop the ungrouped test from running.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(tests): expose pm.describe and grouped pm.test in sandbox"
```

---

### Task 3: Grouped results UI (TestsTab output + TestsPane counters)

**Files:**
- Modify: `src/components/RequestPane/tabs/TestsTab.tsx` (output block ~141-156)
- Modify: `src/components/RightRail/TestsPane.tsx` (whole file)

**Interfaces:**
- Consumes: `summarizeTests`, `TestSummary` from Task 1; `testsOutput: TestEntry[]` prop (already passed).
- Produces: grouped visual output. No new props required (both components already receive `testsOutput`).

- [ ] **Step 1: Replace the flat output list in TestsTab**

In `src/components/RequestPane/tabs/TestsTab.tsx`, add at top with the other imports:

```typescript
import { summarizeTests } from "../../../services/testRunner";
```

Replace the `{showTestOutput && ( ... )}` block (currently rendering `testsOutput.map(...)` flat, ~141-156) with:

```tsx
                {showTestOutput && (() => {
                    const summary = summarizeTests(testsOutput);
                    return (
                        <div className={styles.testsOutput}>
                            <div style={{ display: 'flex', gap: '12px', padding: '6px 8px', marginBottom: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                <span style={{ color: 'var(--success)' }}>✓ {summary.passed} passed</span>
                                <span style={{ color: summary.failed ? 'var(--error)' : 'var(--muted)' }}>✗ {summary.failed} failed</span>
                                {summary.errored > 0 && <span style={{ color: 'var(--error)' }}>⚠ {summary.errored} errored</span>}
                                <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{summary.duration} ms</span>
                            </div>
                            {summary.groups.map((group) => (
                                <div key={group.name} style={{ marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'color-mix(in srgb, var(--border) 30%, transparent)', fontSize: '0.75rem', fontWeight: 700 }}>
                                        <span>{group.name}</span>
                                        <span style={{ color: 'var(--success)' }}>{group.passed}✓</span>
                                        {group.failed > 0 && <span style={{ color: 'var(--error)' }}>{group.failed}✗</span>}
                                        {group.errored > 0 && <span style={{ color: 'var(--error)' }}>{group.errored}⚠</span>}
                                    </div>
                                    {group.entries.map((entry, index) => (
                                        <div className={`log ${entry.type}`} key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px' }}>
                                            <span className="log-type">
                                                {entry.type === "pass" ? "PASS" : entry.type === "fail" ? "FAIL" : "ERROR"}
                                            </span>
                                            <span className="log-text">{entry.text}</span>
                                            {entry.errorMessage && <span className="log-error">— {entry.errorMessage}</span>}
                                            {typeof entry.duration === "number" && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem' }}>{entry.duration} ms</span>}
                                        </div>
                                    ))}
                                </div>
                            ))}
                            {summary.console.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Console</div>
                                    {summary.console.map((entry, index) => (
                                        <div className={`log ${entry.type}`} key={index}>
                                            <span className="log-type">{entry.type.toUpperCase()}</span>
                                            <span className="log-text">{entry.text}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
```

- [ ] **Step 2: Fix the broken counters in TestsPane**

Replace the whole body of `src/components/RightRail/TestsPane.tsx` with:

```tsx
import React from "react";
import rightRailStyles from "../Layout/RightRail.module.css";
import { summarizeTests, type TestEntry } from "../../services/testRunner";

interface TestsPaneProps {
    testsOutput: TestEntry[];
    setShowRightRail: (show: boolean) => void;
}

export function TestsPane({ testsOutput, setShowRightRail }: TestsPaneProps) {
    const summary = summarizeTests(Array.isArray(testsOutput) ? testsOutput : []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.paneHero}>
                <div className={rightRailStyles.paneHeroTop}>
                    <div className={rightRailStyles.paneHeroMeta}>
                        <div className={rightRailStyles.paneHeroIcon}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 3H15M10 9H14M3 14H21M14 3V8.8C14 9.11828 14.1264 9.42352 14.3515 9.64853L19.5 14.7971C20.1332 15.4303 20.3705 16.3537 20.1171 17.2289C19.8637 18.1041 19.162 18.8 18.2868 19.0534C17.4116 19.3068 16.4882 19.0695 15.855 18.4363L11.5173 14.0986C11.3121 13.8934 10.9796 13.8934 10.7744 14.0986L6.4367 18.4363C5.80348 19.0695 4.88006 19.3068 4.00486 19.0534C3.12966 18.8 2.4279 18.1041 2.17449 17.2289C1.92107 16.3537 2.15842 15.4303 2.79164 14.7971L7.94017 9.64853C8.16527 9.42352 8.29167 9.11828 8.29167 8.8V3"></path>
                            </svg>
                        </div>
                        <div>
                            <div className={rightRailStyles.paneEyebrow}>Test Results</div>
                            <div className={rightRailStyles.paneTitle}>Script and assertion output</div>
                        </div>
                    </div>
                    <button className={`ghost icon-button ${rightRailStyles.paneHeaderButton}`} onClick={() => setShowRightRail(false)} title="Collapse">
                        →
                    </button>
                </div>
            </div>

            <div className={rightRailStyles.paneSurface} style={{ padding: '12px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)' }}>{summary.passed}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Passed</div>
                    </div>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: summary.failed > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{summary.failed}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Failed</div>
                    </div>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: summary.errored > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{summary.errored}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Errored</div>
                    </div>
                </div>

                {summary.groups.map((group) => (
                    <div key={group.name} style={{ marginBottom: '12px' }}>
                        <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', display: 'flex', gap: '8px' }}>
                            <span>{group.name}</span>
                            <span style={{ color: 'var(--success)' }}>{group.passed}✓</span>
                            {group.failed > 0 && <span style={{ color: 'var(--error)' }}>{group.failed}✗</span>}
                        </h4>
                        {group.entries.map((entry, index) => (
                            <div key={index} style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ color: entry.type === 'pass' ? 'var(--success)' : 'var(--error)', fontWeight: 600, minWidth: '44px' }}>
                                    {entry.type.toUpperCase()}
                                </span>
                                <span style={{ flex: 1 }}>{entry.text}</span>
                                {entry.errorMessage && <span style={{ color: 'var(--error)', fontSize: '0.72rem' }}>{entry.errorMessage}</span>}
                            </div>
                        ))}
                    </div>
                ))}

                {summary.groups.length === 0 && (
                    <pre style={{ margin: 0, padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minHeight: '100px' }}>
                        No test output available for this request.
                    </pre>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from these two files.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Re-run the Task 2 Step 4 script. Expected: TestsTab output shows a "Status" group card (1✓ 1✗) and an "Ungrouped" card (1✓), with a top summary bar; the right-rail Tests pane shows Passed=2, Failed=1, Errored=0 with per-group rows (counters no longer stuck at 0).

- [ ] **Step 5: Commit**

```bash
git add src/components/RequestPane/tabs/TestsTab.tsx src/components/RightRail/TestsPane.tsx
git commit -m "feat(tests): grouped results UI and fixed pass/fail counters"
```

---

### Task 4: Pure visualization module (auto config + spec validation)

**Files:**
- Create: `src/services/visualize.ts`
- Test: `src/services/visualize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type VizPoint = { label: string; value: number }`
  - `type VizSpec = { type: "bar"|"line"|"pie"; x: string; y: string; series?: string; title?: string; points: VizPoint[] }`
  - `autoChartConfig(rows: any[]): VizSpec | null`
  - `normalizeVizSpec(spec: any, rows: any[]): VizSpec | null`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/visualize.test.ts
import { describe, it, expect } from "vitest";
import { autoChartConfig, normalizeVizSpec } from "./visualize";

const rows = [
  { name: "Alpha", revenue: 100, region: "US" },
  { name: "Beta", revenue: 250, region: "EU" },
  { name: "Gamma", revenue: 75, region: "US" },
];

describe("autoChartConfig", () => {
  it("returns null for empty or non-array input", () => {
    expect(autoChartConfig([])).toBeNull();
    expect(autoChartConfig(null as any)).toBeNull();
  });

  it("picks a label column and a numeric value column", () => {
    const spec = autoChartConfig(rows)!;
    expect(spec.type).toBe("bar");
    expect(spec.y).toBe("revenue");
    expect(spec.x).toBe("name");
    expect(spec.points).toEqual([
      { label: "Alpha", value: 100 },
      { label: "Beta", value: 250 },
      { label: "Gamma", value: 75 },
    ]);
  });

  it("caps points at 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ k: `r${i}`, v: i }));
    expect(autoChartConfig(many)!.points.length).toBe(20);
  });
});

describe("normalizeVizSpec", () => {
  it("accepts a valid spec and resolves points from rows", () => {
    const spec = normalizeVizSpec({ type: "line", x: "name", y: "revenue", title: "Rev" }, rows)!;
    expect(spec.type).toBe("line");
    expect(spec.title).toBe("Rev");
    expect(spec.points[1]).toEqual({ label: "Beta", value: 250 });
  });

  it("falls back to bar for an unknown chart type", () => {
    const spec = normalizeVizSpec({ type: "donut", x: "name", y: "revenue" }, rows)!;
    expect(spec.type).toBe("bar");
  });

  it("returns null when the value column is missing or non-numeric", () => {
    expect(normalizeVizSpec({ type: "bar", x: "name", y: "region" }, rows)).toBeNull();
    expect(normalizeVizSpec({ type: "bar", x: "name", y: "nope" }, rows)).toBeNull();
  });

  it("accepts an explicit points array without rows", () => {
    const spec = normalizeVizSpec({ type: "pie", points: [{ label: "a", value: 1 }] }, [])!;
    expect(spec.type).toBe("pie");
    expect(spec.points).toEqual([{ label: "a", value: 1 }]);
  });

  it("returns null for null/garbage spec", () => {
    expect(normalizeVizSpec(null, rows)).toBeNull();
    expect(normalizeVizSpec({}, rows)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/visualize.test.ts`
Expected: FAIL — `Failed to resolve import "./visualize"`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/visualize.ts
export interface VizPoint {
  label: string;
  value: number;
}

export type VizType = "bar" | "line" | "pie";

export interface VizSpec {
  type: VizType;
  x: string;
  y: string;
  series?: string;
  title?: string;
  points: VizPoint[];
}

const MAX_POINTS = 20;
const VALID_TYPES: VizType[] = ["bar", "line", "pie"];

function isNumeric(v: any): boolean {
  return typeof v === "number" && !Number.isNaN(v);
}

function buildPoints(rows: any[], labelKey: string, valueKey: string): VizPoint[] {
  return rows.slice(0, MAX_POINTS).map((row, i) => ({
    label: String(row?.[labelKey] ?? `#${i + 1}`),
    value: Number(row?.[valueKey]),
  })).filter((p) => isNumeric(p.value));
}

export function autoChartConfig(rows: any[]): VizSpec | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const keys = Object.keys(rows[0] || {});
  const valueKey = keys.find((k) => rows.some((r) => isNumeric(r?.[k])));
  if (!valueKey) return null;
  const labelKey = keys.find((k) => k !== valueKey && typeof rows[0]?.[k] !== "object") || keys[0] || valueKey;
  const points = buildPoints(rows, labelKey, valueKey);
  if (points.length === 0) return null;
  return { type: "bar", x: labelKey, y: valueKey, title: valueKey, points };
}

export function normalizeVizSpec(spec: any, rows: any[]): VizSpec | null {
  if (!spec || typeof spec !== "object") return null;

  const type: VizType = VALID_TYPES.includes(spec.type) ? spec.type : "bar";
  const title = typeof spec.title === "string" ? spec.title : undefined;
  const series = typeof spec.series === "string" ? spec.series : undefined;

  // Explicit points win.
  if (Array.isArray(spec.points) && spec.points.length > 0) {
    const points = spec.points
      .map((p: any) => ({ label: String(p?.label ?? ""), value: Number(p?.value) }))
      .filter((p: VizPoint) => isNumeric(p.value))
      .slice(0, MAX_POINTS);
    if (points.length === 0) return null;
    return { type, x: String(spec.x ?? "label"), y: String(spec.y ?? "value"), series, title, points };
  }

  // Otherwise resolve against rows.
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const x = typeof spec.x === "string" ? spec.x : Object.keys(rows[0] || {})[0];
  const y = typeof spec.y === "string" ? spec.y : "";
  if (!y || !rows.some((r) => isNumeric(r?.[y]))) return null;
  const points = buildPoints(rows, x, y);
  if (points.length === 0) return null;
  return { type, x, y, series, title, points };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/visualize.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/visualize.ts src/services/visualize.test.ts
git commit -m "feat(viz): pure visualization module (auto config + spec validation)"
```

---

### Task 5: SVG chart renderer component

**Files:**
- Create: `src/components/ResponsePane/VizChart.tsx`

**Interfaces:**
- Consumes: `VizSpec`, `VizPoint` from Task 4.
- Produces: `export function VizChart({ spec }: { spec: VizSpec }): JSX.Element` — renders bar/line/pie via inline SVG.

- [ ] **Step 1: Read the dataviz skill for palette/contrast guidance**

Invoke the `dataviz` skill (Skill tool, `skill: "dataviz"`) and use its categorical palette + axis/legend rules for the values below. Keep it dependency-free (inline SVG only).

- [ ] **Step 2: Write the component**

```tsx
// src/components/ResponsePane/VizChart.tsx
import React from "react";
import type { VizSpec, VizPoint } from "../../services/visualize";

// Brand-neutral categorical palette (swap per dataviz skill if a project palette exists).
const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"];

const W = 640;
const H = 280;
const PAD = { top: 24, right: 16, bottom: 48, left: 48 };

function BarChart({ points }: { points: VizPoint[] }) {
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const bw = plotW / points.length;
  return (
    <>
      {points.map((p, i) => {
        const h = (p.value / max) * plotH;
        const x = PAD.left + i * bw + bw * 0.15;
        const y = PAD.top + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw * 0.7} height={h} rx={3} fill={PALETTE[i % PALETTE.length]} />
            <text x={x + bw * 0.35} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {p.label.length > 8 ? p.label.slice(0, 7) + "…" : p.label}
            </text>
            <text x={x + bw * 0.35} y={y - 4} textAnchor="middle" fontSize="10" fill="var(--text)">{p.value}</text>
          </g>
        );
      })}
    </>
  );
}

function LineChart({ points }: { points: VizPoint[] }) {
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: PAD.left + i * step,
    y: PAD.top + plotH - (p.value / max) * plotH,
    p,
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  return (
    <>
      <path d={path} fill="none" stroke={PALETTE[0]} strokeWidth={2} />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={3} fill={PALETTE[0]} />
          <text x={c.x} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {c.p.label.length > 8 ? c.p.label.slice(0, 7) + "…" : c.p.label}
          </text>
        </g>
      ))}
    </>
  );
}

function PieChart({ points }: { points: VizPoint[] }) {
  const total = points.reduce((s, p) => s + p.value, 0) || 1;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 40;
  let angle = -Math.PI / 2;
  return (
    <>
      {points.map((p, i) => {
        const slice = (p.value / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += slice;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        const large = slice > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
            fill={PALETTE[i % PALETTE.length]}
            stroke="var(--bg)"
            strokeWidth={1}
          />
        );
      })}
    </>
  );
}

export function VizChart({ spec }: { spec: VizSpec }) {
  if (!spec || !spec.points || spec.points.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.8rem", padding: "16px" }}>No data to chart.</div>;
  }
  return (
    <div>
      {spec.title && <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "8px" }}>{spec.title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title || `${spec.type} chart`}>
        {spec.type === "bar" && <BarChart points={spec.points} />}
        {spec.type === "line" && <LineChart points={spec.points} />}
        {spec.type === "pie" && <PieChart points={spec.points} />}
      </svg>
      {spec.type === "pie" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
          {spec.points.map((p, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", color: "var(--muted)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} />
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `VizChart.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ResponsePane/VizChart.tsx
git commit -m "feat(viz): dependency-free SVG chart renderer (bar/line/pie)"
```

---

### Task 6: Visualization script — state, sandbox API, and Scripts-tab mode

**Files:**
- Modify: `src/App.tsx` — add `vizScriptText` state + per-request serialization; add `pm.visualizer`; add `runVizScript`; compute `vizSpec`.
- Modify: `src/components/RequestPane/tabs/TestsTab.tsx` — add "Visualize" segmented option + editor.
- Modify: `src/components/RequestPane/RequestEditor.tsx` — thread `vizScriptText`/`setVizScriptText` props.

**Interfaces:**
- Consumes: `normalizeVizSpec`, `VizSpec` from Task 4.
- Produces: `vizSpec: VizSpec | null` state and `vizScriptText`/`setVizScriptText` available to render the Visualize tab (Task 7). New pm API `pm.visualizer.set(spec)` records the raw spec into a per-run capture.

- [ ] **Step 1: Add state and imports in App.tsx**

Near the other imports:

```typescript
import { normalizeVizSpec, type VizSpec } from "./services/visualize";
```

Near `const [testsMode, setTestsMode] = useLocalStorage("ui_testsMode", "post");` add:

```typescript
  const [vizScriptText, setVizScriptText] = useState<string>("");
  const [vizSpec, setVizSpec] = useState<VizSpec | null>(null);
```

- [ ] **Step 2: Persist `vizScriptText` with the rest of per-request state**

Wherever `testsPostText` is read from / written to saved request state (the `if (state.testsPostText !== undefined) setTestsPostText(...)` block near line 891, the state object literals that include `testsPostText,` near lines 1012/1055/1131/1174, and the reset literals near 1514/2839), add a sibling `vizScriptText` entry:

- In the restore block (near 891): `if (state.vizScriptText !== undefined) setVizScriptText(state.vizScriptText);`
- In each state snapshot object that lists `testsPostText,` add `vizScriptText,` right after it.
- In each dependency array that lists `testsPostText,` add `vizScriptText,`.
- In the two reset literals that set `testsPostText: "",` add `vizScriptText: "",`.

- [ ] **Step 3: Add `pm.visualizer` to buildPm**

`buildPm` needs to capture the spec. Add a parameter-free capture via a closure the caller reads. Simplest: attach the last spec onto the `output` array is wrong (output is entries). Instead, thread a capture object. Change `runScript` to accept an optional `capture` and pass it to `buildPm`:

In `runScript` signature and body:

```typescript
  async function runScript(code: string, context: any, output: any[], label?: string, capture?: { vizSpec?: any }) {
    if (!code || !code.trim()) return;
    const safeOutput = output || [];
    const request = context.request || {};
    const response = context.response || {};
    const pm = buildPm(request, response, safeOutput, label || "script", capture);
    // ...unchanged...
  }
```

In `buildPm` signature: `function buildPm(request: any, response: any, output: any[], label: string, capture?: { vizSpec?: any })`.

Inside the `pm` object, add:

```typescript
      visualizer: {
        set: (spec: any) => { if (capture) capture.vizSpec = spec; }
      },
```

- [ ] **Step 4: Add `runVizScript` and recompute vizSpec**

Add a function near `runTests`:

```typescript
  async function runVizScript() {
    const capture: { vizSpec?: any } = {};
    const out: any[] = [];
    const rows = Array.isArray(tableRows) ? tableRows : [];
    try {
      await runScript(vizScriptText, { request: {}, response }, out, "viz-script", capture);
    } catch {
      // script errors are surfaced via the tab; ignore here
    }
    const spec = normalizeVizSpec(capture.vizSpec, rows);
    setVizSpec(spec);
  }
```

(If `tableRows` is not in scope in App, use the same source ResponseViewer receives for `tableRows`; search for where `tableRows` is computed/derived and reuse it. If it lives only in ResponseViewer, pass `response`-derived rows instead — see Task 7 which already has `tableRows`.)

- [ ] **Step 5: Auto-run viz after each response**

Find where a response is set after send (near the `cacheResponseForRequest(currentRequestId, response, responseSummary);` calls ~669/717). After the response state settles, clearing the previous spec is enough; the Visualize tab will lazily run. Add right after those cache calls:

```typescript
      setVizSpec(null);
```

- [ ] **Step 6: Add "Visualize" mode to the Scripts tab**

In `src/components/RequestPane/tabs/TestsTab.tsx`, extend the props interface with:

```typescript
    vizScriptText: string;
    setVizScriptText: (text: string) => void;
    runVizScript: () => void;
```

Add them to the destructured params. In the `SegmentedControl` options add a third entry:

```tsx
                        { value: "viz", label: "Visualize" }
```

Add a run affordance: when `testsMode === "viz"`, render a "Run Visualization" button next to Run Tests (or reuse the primary button conditionally). Then add the editor block after the `post` block:

```tsx
                {testsMode === "viz" && (
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <CodeMirror
                            value={vizScriptText}
                            theme={cmTheme(theme)}
                            extensions={[javascript(), ...searchWithReplace()]}
                            onChange={(value) => setVizScriptText(value)}
                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                            placeholder={"// Visualization script — build a chart spec and call:\n// pm.visualizer.set({ type: 'bar', x: 'name', y: 'revenue' });"}
                        />
                    </div>
                )}
```

Wire the primary button so in `viz` mode it calls `runVizScript`:

```tsx
                <Button variant="primary" className="compact" style={{ padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600 }} onClick={testsMode === 'viz' ? runVizScript : runTests}>
                    {testsMode === 'viz' ? 'Run Visualization' : 'Run Tests'}
                </Button>
```

- [ ] **Step 7: Thread props through RequestEditor and App**

In `src/components/RequestPane/RequestEditor.tsx`: add `vizScriptText`, `setVizScriptText`, `runVizScript` to `RequestEditorProps`, destructure them, and pass to `<TestsTab ... vizScriptText={vizScriptText} setVizScriptText={setVizScriptText} runVizScript={runVizScript} />`.

In `src/App.tsx` where `<RequestEditor ... />` is rendered (the block passing `testsPostText`, ~line 3369-3398), add `vizScriptText={vizScriptText} setVizScriptText={setVizScriptText} runVizScript={runVizScript}`.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/RequestPane/tabs/TestsTab.tsx src/components/RequestPane/RequestEditor.tsx
git commit -m "feat(viz): visualization script mode + pm.visualizer.set sandbox API"
```

---

### Task 7: Visualize tab — render VizChart + auto builder controls

**Files:**
- Modify: `src/components/ResponsePane/ResponseViewer.tsx` — replace the `Visualize` tab body (~649-692); add props.
- Modify: `src/App.tsx` — pass `vizSpec` and `setVizSpec` (or a `runVizScript`) to `<ResponseViewer />` (~3483-3528).

**Interfaces:**
- Consumes: `VizChart` (Task 5), `autoChartConfig`, `normalizeVizSpec`, `VizSpec` (Task 4), `vizSpec` prop (Task 6), existing `tableRows` in ResponseViewer.
- Produces: rendered Visualize tab.

- [ ] **Step 1: Add props to ResponseViewer**

In the props interface, add:

```typescript
    vizSpec: VizSpec | null;
```

Destructure `vizSpec` in the component params. Add imports:

```typescript
import { VizChart } from "./VizChart";
import { autoChartConfig, normalizeVizSpec, type VizSpec } from "../../services/visualize";
```

- [ ] **Step 2: Add local auto-builder state**

Near the existing `chartConfig` useMemo (~317), add builder state:

```typescript
    const [builderType, setBuilderType] = useState<"bar" | "line" | "pie">("bar");
    const [builderX, setBuilderX] = useState<string>("");
    const [builderY, setBuilderY] = useState<string>("");

    const columns = useMemo(
        () => (Array.isArray(tableRows) && tableRows[0] ? Object.keys(tableRows[0]) : []),
        [tableRows]
    );
    const numericColumns = useMemo(
        () => columns.filter((k) => tableRows.some((r: any) => typeof r[k] === "number" && !Number.isNaN(r[k]))),
        [columns, tableRows]
    );

    const autoSpec = useMemo(() => autoChartConfig(tableRows), [tableRows]);

    const builderSpec = useMemo(() => {
        const x = builderX || autoSpec?.x || columns[0] || "";
        const y = builderY || autoSpec?.y || numericColumns[0] || "";
        return normalizeVizSpec({ type: builderType, x, y }, tableRows);
    }, [builderType, builderX, builderY, autoSpec, columns, numericColumns, tableRows]);

    const activeSpec = vizSpec || builderSpec;
```

- [ ] **Step 3: Replace the Visualize tab body**

Replace the `{activeResponseTab === "Visualize" && ( ... )}` block (~649-692) with:

```tsx
            {activeResponseTab === "Visualize" && (
                <div className={styles.visualize}>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Summary</div>
                        <div className={styles.vizValue}>{responseSummary.summary}</div>
                    </div>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Rows</div>
                        <div className={styles.vizValue}>{tableRows.length}</div>
                    </div>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Status</div>
                        <div className={styles.vizValue}>{response?.status || "-"}</div>
                    </div>
                    <div className={styles.vizCard} style={{ gridColumn: "1 / -1" }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <div className={styles.vizTitle} style={{ marginRight: 'auto' }}>
                                {vizSpec ? "Chart (from visualization script)" : "Chart builder"}
                            </div>
                            {!vizSpec && (
                                <>
                                    <select value={builderType} onChange={(e) => setBuilderType(e.target.value as any)} className="ghost compact">
                                        <option value="bar">Bar</option>
                                        <option value="line">Line</option>
                                        <option value="pie">Pie</option>
                                    </select>
                                    <select value={builderX || autoSpec?.x || ""} onChange={(e) => setBuilderX(e.target.value)} className="ghost compact">
                                        {columns.map((c) => <option key={c} value={c}>x: {c}</option>)}
                                    </select>
                                    <select value={builderY || autoSpec?.y || ""} onChange={(e) => setBuilderY(e.target.value)} className="ghost compact">
                                        {numericColumns.map((c) => <option key={c} value={c}>y: {c}</option>)}
                                    </select>
                                </>
                            )}
                        </div>
                        {activeSpec
                            ? <VizChart spec={activeSpec} />
                            : <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No chartable data. Return an array of objects with a numeric field, or write a visualization script.</div>}
                    </div>
                </div>
            )}
```

- [ ] **Step 4: Ensure `useState`/`useMemo` are imported**

Confirm `import { useState, useMemo } from "react"` (or `React.useState`) exists at the top of ResponseViewer; they already are (file uses `useState` at line 157 and `useMemo` at 317). No edit if present.

- [ ] **Step 5: Pass `vizSpec` from App**

In `src/App.tsx` where `<ResponseViewer ... responseSummary={responseSummary} .../>` is rendered (~3483-3528), add `vizSpec={vizSpec}`.

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Send a request returning a JSON array of objects with a numeric field (e.g. a list endpoint). Open the **Visualize** tab beside Raw/Pretty/Table:
- With no viz script: the chart builder renders a bar chart; switching type to Line/Pie and changing X/Y updates it live.
- Add a Scripts → Visualize script `pm.visualizer.set({ type: 'pie', x: 'name', y: 'revenue' })`, click **Run Visualization**, reopen Visualize: it renders the script's pie chart and hides the builder controls (labelled "from visualization script").

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/ResponsePane/ResponseViewer.tsx
git commit -m "feat(viz): Visualize tab renders SVG charts with builder + script override"
```

---

### Task 8: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS, including the two new suites (`testRunner.test.ts`, `visualize.test.ts`).

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint` (if defined in package.json; otherwise `npx eslint src`)
Expected: no new errors in touched files.

- [ ] **Step 4: Final commit if anything was fixed**

```bash
git add -A
git commit -m "chore: regression fixes for test suites + visualize"
```
