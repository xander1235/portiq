# Named Script Steps + Compact Tests Toolbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert pre-request/post-response scripts from single blobs into ordered named step blocks (each step runs in order sharing one context and reports pass/fail/error under its name), and unify the Tests-tab toolbar to one compact, consistent style.

**Architecture:** New pure `scriptSteps.ts` module (type + migration). `createTestHarness` gains a `defaultGroup` so a step's ungrouped results/errors group under the step name. `runSteps` iterates a phase's steps through the existing `runScript` sandbox with one shared context. UI: a reusable `ScriptStepsEditor` renders the step cards; the toolbar is rebuilt on shared `ui.module.css` tokens.

**Tech Stack:** Electron 30 + React 18 + Vite 5 + TypeScript + Vitest + CodeMirror.

## Global Constraints

- No new runtime dependencies. Charts/editors reuse existing libs.
- Preserve backward compatibility: previously-saved requests holding
  `testsPreText`/`testsPostText` blobs must still load (migrate to one step).
- The 4 script-adjacent fields (`testsPreText`, `testsPostText`,
  `vizScriptText`, `testsInputText`) are string-typed today; only the two
  pre/post fields become `ScriptStep[]`. `vizScriptText` and `testsInputText`
  stay strings, untouched.
- Steps in one phase share a single execution context (mutations persist across
  steps). A thrown error in one step never aborts later steps.
- Match existing code style (CSS Modules, `var(--token)` colors, `Button` /
  `SegmentedControl` primitives). No inline `<style>` blocks.

---

### Task 1: `scriptSteps.ts` pure module

**Files:**
- Create: `src/services/scriptSteps.ts`
- Test: `src/services/scriptSteps.test.ts`

**Interfaces:**
- Produces: `interface ScriptStep { id: string; name: string; script: string }`;
  `genStepId(): string`; `emptyStep(name: string): ScriptStep`;
  `toSteps(steps: ScriptStep[] | undefined, legacyText?: string): ScriptStep[]`.

- [ ] **Step 1: Write the failing test** — `src/services/scriptSteps.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { toSteps, emptyStep, genStepId, ScriptStep } from "./scriptSteps";

describe("toSteps", () => {
  it("returns existing steps when the array is non-empty", () => {
    const steps: ScriptStep[] = [{ id: "a", name: "One", script: "x" }];
    expect(toSteps(steps, "legacy")).toBe(steps);
  });

  it("wraps a legacy blob into a single Step 1", () => {
    const result = toSteps(undefined, "pm.test('t', () => {})");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Step 1");
    expect(result[0].script).toBe("pm.test('t', () => {})");
    expect(result[0].id).toBeTruthy();
  });

  it("ignores a whitespace-only legacy blob", () => {
    expect(toSteps(undefined, "   \n ")).toEqual([]);
  });

  it("returns [] when there is nothing to migrate", () => {
    expect(toSteps(undefined, undefined)).toEqual([]);
    expect(toSteps([], "")).toEqual([]);
  });
});

describe("emptyStep / genStepId", () => {
  it("emptyStep has the given name, empty script, and an id", () => {
    const s = emptyStep("Step 2");
    expect(s.name).toBe("Step 2");
    expect(s.script).toBe("");
    expect(s.id).toBeTruthy();
  });

  it("genStepId returns distinct ids", () => {
    expect(genStepId()).not.toBe(genStepId());
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/services/scriptSteps.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/services/scriptSteps.ts`

```ts
export interface ScriptStep {
  id: string;
  name: string;
  script: string;
}

let counter = 0;
export function genStepId(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return `step-${(crypto as any).randomUUID()}`;
  }
  counter += 1;
  return `step-${Date.now()}-${counter}`;
}

export function emptyStep(name: string): ScriptStep {
  return { id: genStepId(), name, script: "" };
}

/**
 * Resolve the steps for a phase. Prefer an existing steps array; otherwise
 * migrate a legacy single-blob script into one "Step 1"; otherwise empty.
 */
export function toSteps(
  steps: ScriptStep[] | undefined,
  legacyText?: string
): ScriptStep[] {
  if (Array.isArray(steps) && steps.length > 0) return steps;
  if (legacyText && legacyText.trim()) {
    return [{ id: genStepId(), name: "Step 1", script: legacyText }];
  }
  return [];
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/services/scriptSteps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/services/scriptSteps.ts src/services/scriptSteps.test.ts && git commit -m "feat(scripts): ScriptStep model + legacy migration helper"`

---

### Task 2: `createTestHarness` `defaultGroup` param

**Files:**
- Modify: `src/services/testRunner.ts:18-23` (signature + `currentGroup` init)
- Test: `src/services/testRunner.test.ts` (append cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createTestHarness(output, label, now?, defaultGroup?: string)` —
  `defaultGroup` defaults to `"Ungrouped"`; ungrouped tests and describe-less
  errors are attributed to it.

- [ ] **Step 1: Write failing tests** — append to `src/services/testRunner.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createTestHarness, summarizeTests, TestEntry } from "./testRunner";

describe("createTestHarness defaultGroup", () => {
  it("groups ungrouped tests under the provided default group", async () => {
    const out: TestEntry[] = [];
    const h = createTestHarness(out, "post-script", () => 0, "Login step");
    await h.test("status is 200", () => {});
    const summary = summarizeTests(out);
    expect(summary.groups.map((g) => g.name)).toEqual(["Login step"]);
    expect(summary.groups[0].passed).toBe(1);
  });

  it("a describe inside still overrides the default group", async () => {
    const out: TestEntry[] = [];
    const h = createTestHarness(out, "post-script", () => 0, "Login step");
    await h.describe("Headers", () => {
      h.test("has content-type", () => {});
    });
    await h.test("top-level check", () => {});
    const summary = summarizeTests(out);
    expect(summary.groups.map((g) => g.name)).toEqual(["Headers", "Login step"]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/services/testRunner.test.ts`
Expected: FAIL (extra arg ignored → first test lands under "Ungrouped").

- [ ] **Step 3: Implement** — edit `src/services/testRunner.ts`

Change the signature and the `currentGroup` initializer:

```ts
export function createTestHarness(
  output: TestEntry[],
  label: string,
  now: () => number = clock,
  defaultGroup: string = "Ungrouped"
): TestHarness {
  let currentGroup = defaultGroup;
```

(Everything else in the function is unchanged.)

- [ ] **Step 4: Run all runner tests, verify pass**

Run: `npx vitest run src/services/testRunner.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit** — `git add src/services/testRunner.ts src/services/testRunner.test.ts && git commit -m "feat(testRunner): defaultGroup for per-step result grouping"`

---

### Task 3: CSS — compact toolbar + step cards

**Files:**
- Modify: `src/components/RequestPane/RequestEditor.module.css` (append classes)

**Interfaces:**
- Produces CSS class names consumed by Tasks 4 & 5: `.testsToolbar`,
  `.toolbarChip`, `.toolbarChipOn`, `.stepsList`, `.stepCard`, `.stepHeader`,
  `.stepName`, `.stepIconBtn`, `.stepBody`, `.stepAdd`.

- [ ] **Step 1: Append classes** — end of `src/components/RequestPane/RequestEditor.module.css`

```css
/* Tests-tab compact toolbar --------------------------------------------- */
.testsToolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}
.testsToolbar .toolbarRight {
    display: flex;
    align-items: center;
    gap: 6px;
}
.toolbarChip {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background .12s, border-color .12s, color .12s;
}
.toolbarChip:hover { background: var(--panel-2); }
.toolbarChipOn {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
}

/* Named script step blocks ---------------------------------------------- */
.stepsList {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow: auto;
}
.stepCard {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-2);
    overflow: hidden;
}
.stepHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: color-mix(in srgb, var(--border) 22%, transparent);
}
.stepName {
    flex: 1;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: 3px 6px;
}
.stepName:hover { border-color: var(--border); }
.stepName:focus { outline: none; border-color: var(--accent); background: var(--panel); }
.stepIconBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
}
.stepIconBtn:hover:not(:disabled) { background: var(--panel-3); color: var(--text); }
.stepIconBtn:disabled { opacity: .35; cursor: default; }
.stepBody {
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 120px;
}
.stepAdd {
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    height: 28px;
    padding: 0 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
}
.stepAdd:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 2: Verify build** — Run: `npx tsc --noEmit` Expected: exit 0 (CSS-only change, no TS impact).

- [ ] **Step 3: Commit** — `git add src/components/RequestPane/RequestEditor.module.css && git commit -m "style(tests): compact toolbar + step-card classes"`

---

### Task 4: `ScriptStepsEditor` component

**Files:**
- Create: `src/components/RequestPane/tabs/ScriptStepsEditor.tsx`

**Interfaces:**
- Consumes: `ScriptStep`, `emptyStep` from `../../../services/scriptSteps`;
  `.step*` CSS from `../RequestEditor.module.css`; `cmTheme`, `Theme`.
- Produces: `ScriptStepsEditor({ steps, onChange, theme, placeholder })` where
  `steps: ScriptStep[]`, `onChange: (next: ScriptStep[]) => void`,
  `theme: Theme`, `placeholder?: string`.

- [ ] **Step 1: Implement** — `src/components/RequestPane/tabs/ScriptStepsEditor.tsx`

```tsx
import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { search } from "@codemirror/search";
import { createCustomSearchPanel, customSearchKeymap } from "../../../utils/codemirror/customSearchPanel";
import styles from "../RequestEditor.module.css";
import { cmTheme } from "../../../theme/codemirrorTheme";
import type { Theme } from "../../../theme/theme";
import { ScriptStep, emptyStep } from "../../../services/scriptSteps";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap,
];

interface ScriptStepsEditorProps {
    steps: ScriptStep[];
    onChange: (next: ScriptStep[]) => void;
    theme: Theme;
    placeholder?: string;
}

export function ScriptStepsEditor({ steps, onChange, theme, placeholder }: ScriptStepsEditorProps) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const patch = (id: string, fields: Partial<ScriptStep>) =>
        onChange(steps.map((s) => (s.id === id ? { ...s, ...fields } : s)));
    const remove = (id: string) => onChange(steps.filter((s) => s.id !== id));
    const move = (index: number, delta: number) => {
        const next = [...steps];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };
    const add = () => onChange([...steps, emptyStep(`Step ${steps.length + 1}`)]);
    const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

    return (
        <div className={styles.stepsList}>
            {steps.map((step, index) => {
                const isCollapsed = !!collapsed[step.id];
                return (
                    <div className={styles.stepCard} key={step.id}>
                        <div className={styles.stepHeader}>
                            <button
                                className={styles.stepIconBtn}
                                title={isCollapsed ? "Expand" : "Collapse"}
                                onClick={() => toggle(step.id)}
                            >
                                {isCollapsed ? "▸" : "▾"}
                            </button>
                            <input
                                className={styles.stepName}
                                value={step.name}
                                spellCheck={false}
                                placeholder={`Step ${index + 1}`}
                                onChange={(e) => patch(step.id, { name: e.target.value })}
                            />
                            <button className={styles.stepIconBtn} title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                            <button className={styles.stepIconBtn} title="Move down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>↓</button>
                            <button className={styles.stepIconBtn} title="Remove step" onClick={() => remove(step.id)}>✕</button>
                        </div>
                        {!isCollapsed && (
                            <div className={styles.stepBody}>
                                <CodeMirror
                                    value={step.script}
                                    theme={cmTheme(theme)}
                                    extensions={[javascript(), ...searchWithReplace()]}
                                    onChange={(value) => patch(step.id, { script: value })}
                                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                    style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: "13px" }}
                                    placeholder={placeholder}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
            <button className={styles.stepAdd} onClick={add}>+ Add step</button>
        </div>
    );
}
```

- [ ] **Step 2: Verify build** — Run: `npx tsc --noEmit` Expected: exit 0 (new file; unused until Task 5 — compiles standalone).

- [ ] **Step 3: Commit** — `git add src/components/RequestPane/tabs/ScriptStepsEditor.tsx && git commit -m "feat(tests): ScriptStepsEditor step-block component"`

---

### Task 5: Integration — steps model wired through state, execution, and UI

This is the atomic switch from blobs to steps. It touches 5 files together so
the build goes green→green. Legacy `testsPreText`/`testsPostText` are dropped
from runtime state but KEPT on the `RequestItem` interface for migration reads.

**Files:**
- Modify: `src/hooks/useRequestState.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/RequestPane/RequestEditor.tsx`
- Modify: `src/components/RequestPane/tabs/TestsTab.tsx`
- Modify: `src/services/githubSync.ts`

**Interfaces:**
- Consumes: `ScriptStep`, `toSteps`, `emptyStep` (`scriptSteps.ts`);
  `ScriptStepsEditor` (Task 4); `.testsToolbar/.toolbarChip*` CSS (Task 3);
  `createTestHarness(..., defaultGroup)` (Task 2).
- Produces: hook exposes `testsPreSteps: ScriptStep[]`, `setTestsPreSteps`,
  `testsPostSteps`, `setTestsPostSteps` (replacing the `*Text` pre/post pair).

#### 5A — `useRequestState.ts`

- [ ] **Interface fields** (`:59-60`): keep `testsPreText?`/`testsPostText?`
  (deprecated, migration read) and add after them:

```ts
    testsPreText?: string;   // deprecated: migrated to testsPreSteps
    testsPostText?: string;  // deprecated: migrated to testsPostSteps
    testsPreSteps?: ScriptStep[];
    testsPostSteps?: ScriptStep[];
```
  Add import at top of file: `import { ScriptStep, toSteps } from "../services/scriptSteps";`

- [ ] **State init** (`:101-102`) — replace the two `useLocalStorage<string>`
  lines with:

```ts
    const [testsPreSteps, setTestsPreSteps] = useLocalStorage<ScriptStep[]>("ui_testsPreSteps", []);
    const [testsPostSteps, setTestsPostSteps] = useLocalStorage<ScriptStep[]>("ui_testsPostSteps", []);
```

- [ ] **Reset literal** (`:237-238`) — replace `testsPreText: ""`,
  `testsPostText: ""` with `testsPreSteps: []`, `testsPostSteps: []`.

- [ ] **loadRequest** (`:349-350`) — replace the two setters with:

```ts
        setTestsPreSteps(toSteps(req.testsPreSteps, req.testsPreText));
        setTestsPostSteps(toSteps(req.testsPostSteps, req.testsPostText));
```

- [ ] **syncDraftToCollection draft** (`:408-409`) — replace `testsPreText`,
  `testsPostText` with `testsPreSteps`, `testsPostSteps`.

- [ ] **Setter map** (`:476-477`) — replace with
  `testsPreSteps: setTestsPreSteps,` and `testsPostSteps: setTestsPostSteps,`.

- [ ] **Return object** (`:954-955`) — replace with
  `testsPreSteps, setTestsPreSteps,` and `testsPostSteps, setTestsPostSteps,`.

#### 5B — `App.tsx`

- [ ] **Import** (top, near other service imports): add
  `import { ScriptStep, toSteps, emptyStep } from "./services/scriptSteps";`
  (If `toSteps`/`ScriptStep` already imported transitively, import only what's missing.)

- [ ] **Hook destructure** (`:224-225`) — replace `testsPreText, setTestsPreText,`
  and `testsPostText, setTestsPostText,` with
  `testsPreSteps, setTestsPreSteps,` and `testsPostSteps, setTestsPostSteps,`.
  Also update the `:947-948` reference list the same way (these are in the
  destructure block — replace both names).

- [ ] **applyPersistedState** (`:899-900`) — replace with:

```ts
      if (state.testsPreSteps !== undefined || state.testsPreText !== undefined)
        setTestsPreSteps(toSteps(state.testsPreSteps, state.testsPreText));
      if (state.testsPostSteps !== undefined || state.testsPostText !== undefined)
        setTestsPostSteps(toSteps(state.testsPostSteps, state.testsPostText));
```

- [ ] **Autosave payload** (`:1022-1023`) — replace `testsPreText,` `testsPostText,`
  with `testsPreSteps,` `testsPostSteps,`. **Dep array** (`:1066-1067`) — same replacement.

- [ ] **beforeunload payload** (`:1143-1144`) and **dep array** (`:1187-1188`) —
  same replacement (`testsPreSteps,` `testsPostSteps,`).

- [ ] **New-request literal** (`:1528-1529`) — replace `testsPreText: ""`,
  `testsPostText: ""` with `testsPreSteps: []`, `testsPostSteps: []`.

- [ ] **AI new-request literal** (`:2854-2855`) — same: `testsPreSteps: []`,
  `testsPostSteps: []`.

- [ ] **AI generate-tests** (`:2692`) — replace
  `setTestsPostText(tests.join("\n"));` with:

```ts
    setTestsPostSteps((prev) => [...(prev || []), { ...emptyStep("AI Generated"), script: tests.join("\n") }]);
```

- [ ] **`runScript` signature + harness wiring** (`:2975`, `:2980`, `:3003-3011`):
  add a trailing `group?: string` param; pass it into `buildPm`; stamp it on the
  catch error entry:

```ts
  async function runScript(code: string, context: any, output: any[], label?: string, capture?: { vizSpec?: any }, group?: string) {
    if (!code || !code.trim()) return;
    const safeOutput = output || [];
    const request = context.request || {};
    const response = context.response || {};
    const pm = buildPm(request, response, safeOutput, label || "script", capture, group);
    // ...unchanged api/AsyncFunction...
    try {
      await fn({ request, response }, api, pm, safeOutput);
    } catch (err: any) {
      safeOutput.push({
        type: "error",
        text: `Script Error: ${err.message}`,
        label: label || "script",
        group,
        errorType: err.name,
        stack: err.stack
      });
    }
  }
```

- [ ] **`buildPm` signature + harness** (`:3014`, `:3056`): add trailing
  `group?: string`; pass to the harness:

```ts
  function buildPm(request: any, response: any, output: any[], label: string, capture?: { vizSpec?: any }, group?: string) {
    // ...unchanged...
    const harness = createTestHarness(output, label, undefined, group);
```

  Note: `createTestHarness`'s 3rd param is `now`; pass `undefined` to keep the
  default clock, `group` as the 4th (`defaultGroup`). When `group` is
  undefined the harness falls back to `"Ungrouped"` (existing behavior for viz).

- [ ] **`runSteps` helper** — add near `runScript` (e.g. just above it):

```ts
  async function runSteps(steps: ScriptStep[], context: any, output: any[], label: string) {
    for (const step of steps || []) {
      const name = (step.name || "").trim() || "Untitled step";
      await runScript(step.script, context, output, label, undefined, name);
    }
  }
```

- [ ] **`runTests`** (`:2947-2951`) — replace the pre/post branch with:

```ts
      if (testsMode === "pre") {
        await runSteps(testsPreSteps, ctx, out, "pre-script");
      } else {
        await runSteps(testsPostSteps, ctx, out, "post-script");
      }
```

- [ ] **HTTP send pre** (`:2409`) — replace
  `await runScript(testsPreText, preContext, preOutput);` with
  `await runSteps(testsPreSteps, preContext, preOutput, "pre-script");`
  (the payload copy-back at `:2410-2413` is unchanged — `preContext` is shared).

- [ ] **HTTP send post** (`:2479`) — replace
  `await runScript(testsPostText, { request: payload, response: result }, postOutput);`
  with `await runSteps(testsPostSteps, { request: payload, response: result }, postOutput, "post-script");`

- [ ] **GraphQL pre** (`:2534`) — replace with
  `await runSteps(testsPreSteps, preContext, preOutput, "pre-script");`

- [ ] **GraphQL post** (`:2583`) — replace with
  `await runSteps(testsPostSteps, { request: preContext.request, response: result }, postOutput, "post-script");`

- [ ] **TestsTab prop wiring** (`:3418-3421`) — replace the four lines with:

```tsx
                  testsPreSteps={testsPreSteps}
                  setTestsPreSteps={setTestsPreSteps}
                  testsPostSteps={testsPostSteps}
                  setTestsPostSteps={setTestsPostSteps}
```

#### 5C — `RequestEditor.tsx`

- [ ] **Prop interface** (`:73-75`) — replace `testsPreText: string;` /
  `setTestsPreText` / `testsPostText: string;` / `setTestsPostText` with:

```ts
    testsPreSteps: ScriptStep[];
    setTestsPreSteps: (next: ScriptStep[]) => void;
    testsPostSteps: ScriptStep[];
    setTestsPostSteps: (next: ScriptStep[]) => void;
```
  Add import: `import { ScriptStep } from "../../services/scriptSteps";`

- [ ] **Destructure** (`:141-143`) — replace the pre/post text names with the
  four steps names above.

- [ ] **Passthrough to `<TestsTab>`** (`:317-320`) — replace with:

```tsx
                        testsPreSteps={testsPreSteps}
                        setTestsPreSteps={setTestsPreSteps}
                        testsPostSteps={testsPostSteps}
                        setTestsPostSteps={setTestsPostSteps}
```

#### 5D — `TestsTab.tsx`

- [ ] **Prop type** (`:32-35`) — replace the four `testsPreText/…PostText` string
  props with:

```ts
    testsPreSteps: ScriptStep[];
    setTestsPreSteps: (next: ScriptStep[]) => void;
    testsPostSteps: ScriptStep[];
    setTestsPostSteps: (next: ScriptStep[]) => void;
```
  Add imports: `import { ScriptStep } from "../../../services/scriptSteps";`
  and `import { ScriptStepsEditor } from "./ScriptStepsEditor";`
  Update the destructure in the function signature accordingly.

- [ ] **Toolbar** — replace the toolbar `<div>` (`:65-108`) with the compact,
  consistent layout (mode on the left; chips + Run on the right):

```tsx
            <div className={styles.testsToolbar}>
                <SegmentedControl
                    value={testsMode}
                    onChange={setTestsMode}
                    size="sm"
                    options={[
                        { value: "pre", label: "Pre-request" },
                        { value: "post", label: "Post-response" },
                        { value: "viz", label: "Visualize" }
                    ]}
                />
                <div className="toolbarRight" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                        className={`${styles.toolbarChip} ${showTestOutput ? styles.toolbarChipOn : ''}`}
                        onClick={() => setShowTestOutput((prev) => !prev)}
                    >Output</button>
                    <button
                        className={`${styles.toolbarChip} ${showTestInput ? styles.toolbarChipOn : ''}`}
                        onClick={() => setShowTestInput((prev) => !prev)}
                    >Test Input</button>
                    <Button
                        variant="primary"
                        className="compact"
                        style={{ height: '28px', padding: '0 12px', fontSize: 'var(--text-xs)', fontWeight: 600 }}
                        onClick={testsMode === 'viz' ? runVizScript : runTests}
                    >{testsMode === 'viz' ? 'Run Visualization' : 'Run Tests'}</Button>
                </div>
            </div>
```
  (`.toolbarRight` gap is also in CSS from Task 3; the inline style is a harmless
  duplicate — prefer removing the inline `style` and relying on the CSS class.
  Keep whichever is cleaner; do not add new inline color values.)

- [ ] **Pre/Post editors** — replace the two single-editor blocks (`:125-150`,
  the `testsMode === "pre"` and `"post"` blocks) with step editors:

```tsx
                {testsMode === "pre" && (
                    <ScriptStepsEditor
                        steps={testsPreSteps}
                        onChange={setTestsPreSteps}
                        theme={theme}
                        placeholder="// Pre-request step (JavaScript)"
                    />
                )}
                {testsMode === "post" && (
                    <ScriptStepsEditor
                        steps={testsPostSteps}
                        onChange={setTestsPostSteps}
                        theme={theme}
                        placeholder="// Post-response step (JavaScript)"
                    />
                )}
```
  The `testsMode === "viz"` single-editor block and the Test Input / Output
  blocks are unchanged.

#### 5E — `githubSync.ts`

- [ ] **Export** (`:405-406`) — replace the two lines with:

```ts
            testsPreSteps: appState.testsPreSteps || [],
            testsPostSteps: appState.testsPostSteps || [],
```

- [ ] **Import** (`:668-669`) — replace with (migrating legacy blobs too):

```ts
    setStorageJson("ui_testsPreSteps", toSteps(appState.testsPreSteps, appState.testsPreText));
    setStorageJson("ui_testsPostSteps", toSteps(appState.testsPostSteps, appState.testsPostText));
```
  Add import at top: `import { toSteps } from "./scriptSteps";`
  (Adjust the relative path — `githubSync.ts` is in `src/services/`, so
  `"./scriptSteps"`.)

#### Verification

- [ ] **Step V1: Typecheck** — Run: `npx tsc --noEmit` Expected: exit 0.
- [ ] **Step V2: Full tests** — Run: `npx vitest run` Expected: all pass (85 baseline + new).
- [ ] **Step V3: Lint** — Run: `npx eslint src --ext .ts,.tsx` Expected: 0 errors.
- [ ] **Step V4: Commit** — `git add -A && git commit -m "feat(tests): named script steps for pre/post + compact toolbar"`

---

## Self-Review Notes

- **Spec coverage:** toolbar (Task 3/5D), step model (Task 1), harness grouping
  (Task 2), step editor (Task 4), execution + persistence + migration (Task 5),
  githubSync (5E). All spec sections mapped.
- **Type consistency:** `ScriptStep` from `scriptSteps.ts` used identically in
  hook, App, RequestEditor, TestsTab, ScriptStepsEditor. `setTestsPreSteps`
  signature `(next: ScriptStep[]) => void` matches the `useLocalStorage` setter
  (accepts value or updater — the AI-generate site uses the updater form).
- **Migration:** `toSteps` applied at loadRequest, applyPersistedState, and
  githubSync import — every path that reads a persisted request.
- **Backward-compat:** legacy `testsPreText`/`testsPostText` retained on the
  interface (read-only) so old saved requests and old GitHub drafts still load.
