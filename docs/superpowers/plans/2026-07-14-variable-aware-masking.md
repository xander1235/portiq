# Variable-Aware Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In maskable (secret) input sections, show `{{variable}}` references in the clear while masking literal text, and show nothing for empty values.

**Architecture:** Masking becomes a render-only concern of `EnvInput`. `EnvInput` already layers a transparent real `<input>` (text `color: transparent`, caret visible) over a highlight `<div>`, so the real characters are never painted — masking only changes what `renderHighlighted()` draws. `TableEditor`'s maskable branch switches from `<input type="password">` to `<EnvInput maskLiterals={isMasked} />`.

**Tech Stack:** React 18 + TypeScript, Vite, Electron. No component test framework in this repo; verification is `tsc --noEmit`, `eslint`, `vite build`, and manual checks in `npm run dev` (consistent with the existing codebase, which has no unit tests).

## Global Constraints

- Display-only change. Do NOT alter stored values, wire format, or `redactSecrets` in `src/hooks/useEnvironmentState.ts`.
- Do NOT change the `secret` (GitHub Secret) row flag or GitHub-sync secret placeholders.
- Follow existing inline-style conventions in `src/components/TableEditor.tsx` (no CSS modules there).
- Variable syntax is `{{name}}` (see the split regex `/(\{\{.*?\}\})/g` already used in `renderHighlighted`).

---

### Task 1: Add `maskLiterals` rendering to `EnvInput`

**Files:**
- Modify: `src/components/TableEditor.tsx` (the `EnvInput` component: props interface ~lines 6-14, `renderHighlighted` ~lines 131-217)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EnvInput` accepts an optional `maskLiterals?: boolean` prop. When true, non-variable text in the highlight overlay renders as `•` bullets (one per character); `{{variable}}` parts render unchanged; empty value renders the placeholder only. When false/absent, behavior is identical to today.

- [ ] **Step 1: Add the prop to `EnvInputProps`**

In the `EnvInputProps` interface (currently lines 6-14), add the optional flag:

```tsx
interface EnvInputProps {
    value: any;
    onChange: (val: any) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    envVars?: Record<string, string>;
    onUpdateEnvVar?: (key: string, val: string) => void;
    maskLiterals?: boolean;
}
```

- [ ] **Step 2: Destructure the prop in the component signature**

Change the signature (currently line 16) to include `maskLiterals`:

```tsx
export function EnvInput({ value, onChange, placeholder, className, style, envVars, onUpdateEnvVar, maskLiterals }: EnvInputProps) {
```

- [ ] **Step 3: Mask literal parts in `renderHighlighted`**

In `renderHighlighted` (starts ~line 131), the literal (non-variable) branch is the final `return` inside the `parts.map`, currently:

```tsx
            return <span key={i} style={{ pointerEvents: "none" }}>{part}</span>;
```

Replace it with a version that masks literals when `maskLiterals` is set:

```tsx
            const literalText = maskLiterals ? "•".repeat(part.length) : part;
            return <span key={i} style={{ pointerEvents: "none" }}>{literalText}</span>;
```

The empty-value case (the `if (!valStr)` block returning the placeholder span, ~lines 133-135) already returns before this map runs, so empty values render the placeholder only — no bullets. Leave it unchanged. The `{{variable}}` branch (the `if (part.startsWith("{{") ...)` block) is also unchanged, so variables stay visible.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors referencing `TableEditor.tsx`).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS (no new errors in `TableEditor.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/TableEditor.tsx
git commit -m "feat: add maskLiterals rendering to EnvInput"
```

---

### Task 2: Use `EnvInput` with `maskLiterals` in `TableEditor`'s maskable branch

**Files:**
- Modify: `src/components/TableEditor.tsx` (the `isMaskable` render branch inside the rows `.map`, ~lines 501-534)

**Interfaces:**
- Consumes: `EnvInput`'s `maskLiterals` prop from Task 1; `isMasked` is already computed at ~line 483 (`const isMasked = isMaskable && row.masked !== false && !unmaskedRows[index];`).
- Produces: masked rows render via `EnvInput` (variable-aware) instead of `<input type="password">`.

- [ ] **Step 1: Replace the password-input branch**

The current maskable branch (~lines 501-534) is:

```tsx
                            {isMaskable ? (
                                isMasked ? (
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type="password"
                                            className="input table-input"
                                            value={row.value}
                                            placeholder={valuePlaceholder || "Value"}
                                            onChange={(e) => updateRow(index, "value", e.target.value)}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                ) : (
                                    <EnvInput
                                        className="input table-input"
                                        value={row.value}
                                        placeholder={valuePlaceholder || "Value"}
                                        onChange={(val) => updateRow(index, "value", val)}
                                        envVars={envVars}
                                        onUpdateEnvVar={onUpdateEnvVar}
                                        style={{ width: "100%" }}
                                    />
                                )
                            ) : (
                                <EnvInput
                                    className="input table-input"
                                    value={row.value}
                                    placeholder={valuePlaceholder || "Value"}
                                    onChange={(val) => updateRow(index, "value", val)}
                                    envVars={envVars}
                                    onUpdateEnvVar={onUpdateEnvVar}
                                    style={{ width: "100%" }}
                                />
                            )}
```

Both branches now render `EnvInput`; the only difference is `maskLiterals`. Collapse to a single `EnvInput` (the outer `isMaskable ?` ternary becomes unnecessary since a non-maskable table passes `isMasked === false`):

```tsx
                            <EnvInput
                                className="input table-input"
                                value={row.value}
                                placeholder={valuePlaceholder || "Value"}
                                onChange={(val) => updateRow(index, "value", val)}
                                envVars={envVars}
                                onUpdateEnvVar={onUpdateEnvVar}
                                maskLiterals={isMasked}
                                style={{ width: "100%" }}
                            />
```

Note: `isMasked` is `false` whenever `isMaskable` is false (see its definition at ~line 483), so non-maskable tables are unaffected.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS. If eslint flags `React` or `ReactDOM` as now-unused, that is not caused by this change (both are still used elsewhere in the file) — do not remove imports.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (Vite build completes without errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/TableEditor.tsx
git commit -m "feat: variable-aware masking in TableEditor maskable rows"
```

---

### Task 3: Manual verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: the behavior from Tasks 1-2.
- Produces: confirmed working feature.

- [ ] **Step 1: Launch the app**

Run: `npm run dev`

- [ ] **Step 2: Open the custom-auth section**

In a request, open the **Auth** tab and choose auth type **Custom** (renders the `isMaskable` `TableEditor` — see `src/components/RequestPane/RequestEditor.tsx:688-701`). Ensure an active environment has at least one variable (e.g. `apiKey`, `token`) so `{{...}}` references resolve; use the environment modal if needed.

- [ ] **Step 3: Verify each value shape (masked, i.e. eye = hidden)**

Add rows and confirm the masked rendering:

| Value entered      | Expected masked display                          |
|--------------------|--------------------------------------------------|
| (empty)            | placeholder only, no bullets                     |
| `abc123`           | `••••••` (6 bullets)                              |
| `{{apiKey}}`       | highlighted `{{apiKey}}`, no bullets             |
| `Bearer {{token}}` | `•••••••` for `Bearer ` (7 bullets) + `{{token}}`|

- [ ] **Step 4: Verify the eye toggle**

Click the eye icon on a masked row → the real value is shown via normal `EnvInput` (variables highlighted, literals visible). Click again → masking returns.

- [ ] **Step 5: Verify editing still works while masked**

With a row masked, click into the value and type; confirm the caret positions correctly and characters are accepted (they stay hidden as bullets). Confirm `{{` triggers the variable autocomplete dropdown and selecting a suggestion inserts `{{name}}` visibly.

- [ ] **Step 6: Confirm no regression in non-maskable tables**

Open the **Headers** or **Params** tab (non-maskable `TableEditor`) and confirm values render normally with no bullets.
