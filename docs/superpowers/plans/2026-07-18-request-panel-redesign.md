# Request Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the request panel UI/UX and the request/response JSON styling — new fonts, a light+dark theme system, one button/one dropdown, and a brand-tuned JSON viewer — while breaking the ~900-line `RequestEditor` monolith into focused units.

**Architecture:** Presentation + structure refactor, no data-flow changes. A token/theme foundation in `styles.css` + a `useTheme` hook drive light/dark via `document.documentElement.dataset.theme`. Shared `src/components/ui/` primitives (Button, Select, SegmentedControl, StatusPill, JsonView) replace the four competing styling systems. `RequestEditor` becomes a thin orchestrator over `RequestToolbar` + `RequestTabs` + `tabs/*`. `ResponseViewer` adopts the shared JsonView + StatusPill.

**Tech Stack:** React 19, TypeScript 6, Tailwind v4 (in-CSS `@theme`), CSS custom properties, Radix (`@radix-ui/react-select`), `@uiw/react-codemirror` + `@codemirror/*`, Vitest (node env, pure-logic `.test.ts`).

## Global Constraints

- **No new dependencies.** CodeMirror theme is hand-built from already-installed `@codemirror/view`, `@codemirror/language`, `@lezer/highlight`.
- **Tests are pure-logic `.test.ts`, node env.** No `@testing-library`, no `.tsx` tests. Logic that can break goes into pure functions that are unit-tested; presentational shells are verified by `npm run build` + `npm run lint` + manual spot-check.
- **Behavior-preserving.** Existing 53 tests stay green. No change to request/response data flow, IPC, or persistence.
- **Palette retained** (refine current identity): `--bg:#0f1115 --panel:#151924 --panel-2:#1c2233 --panel-3:#252b3d --accent:#ff7a59 --accent-2:#2ed3c6 --text:#e9edf5 --muted:#a2a9b8 --border:#2a3042`.
- **Fonts:** UI = `"Plus Jakarta Sans"`, code = `"Fira Code"`.
- **Syntax palette (dark):** key `#2ed3c6`, str `#8fe3a1`, num `#ff9d73`, bool/null `#b79cff`, punct `#5f6a80`. **(light):** key `#0e8f86`, str `#2f8a4a`, num `#d15a2c`, bool/null `#6b4fd0`, punct `#9aa2b0`.
- **Gates each task:** `npm run test` green, `npm run build` clean, `npm run lint` 0 errors. Commit after each task.

## File Structure

```
src/styles.css                          MODIFY  fonts, token scales, syntax vars, [data-theme="light"]
src/theme/theme.ts                      CREATE  pure theme-resolution logic + constants
src/theme/theme.test.ts                 CREATE  TDD for resolveTheme
src/theme/useTheme.ts                   CREATE  React hook (dataset + localStorage)
src/theme/codemirrorTheme.ts            CREATE  brandDark/brandLight CM extensions + selector
src/components/ui/statusMeta.ts         CREATE  pure status -> {label,tone}
src/components/ui/statusMeta.test.ts    CREATE  TDD for statusMeta
src/components/ui/tone.ts               CREATE  tone -> css var mapping (pure)
src/components/ui/tone.test.ts          CREATE  TDD for toneColor
src/components/ui/StatusPill.tsx        CREATE  consumes statusMeta + tone
src/components/ui/AppButton.tsx         CREATE  Button (primary|ghost|danger)
src/components/ui/UiSelect.tsx           CREATE  Radix select wrapper (export Select)
src/components/ui/SegmentedControl.tsx  CREATE  segmented tabs / toggle
src/components/ui/JsonView.tsx          CREATE  CodeMirror + chrome (gutter, Pretty/Raw slot)
src/components/ui/ui.module.css         CREATE  styles for the ui primitives
src/components/RequestPane/RequestEditor.tsx   MODIFY  slim to orchestrator (~150 lines)
src/components/RequestPane/RequestToolbar.tsx  CREATE  unified pill + Send
src/components/RequestPane/MethodSelect.tsx    CREATE  method dropdown (ui/Select)
src/components/RequestPane/RequestTabs.tsx     CREATE  ui/SegmentedControl
src/components/RequestPane/tabs/ParamsTab.tsx     CREATE
src/components/RequestPane/tabs/HeadersTab.tsx    CREATE
src/components/RequestPane/tabs/AuthTab.tsx       CREATE  rebuilt on ui/*
src/components/RequestPane/tabs/BodyTab.tsx       CREATE  ui/JsonView (editable)
src/components/RequestPane/tabs/TestsTab.tsx      CREATE
src/components/ResponsePane/ResponseViewer.tsx MODIFY  adopt JsonView + StatusPill + fonts
src/App.tsx                             MODIFY  mount theme toggle in top bar
```

---

### Task 1: Token, font & theme-variable foundation

**Files:**
- Modify: `src/styles.css:1` (font import), `:36-62` (`:root` tokens), and add a new `:root[data-theme="light"]` block + `body` font-family.

**Interfaces:**
- Produces (CSS custom properties consumed by every later task): `--font-sans`, `--font-mono`, type scale `--text-xs|sm|md|lg|xl`, spacing `--space-1..6`, radius `--radius-sm|md|lg` (already partly present in `@theme`; add to `:root`), `--danger`, syntax `--syn-key|str|num|bool|null|punct`. Light overrides under `:root[data-theme="light"]`.

- [ ] **Step 1: Swap the font import.** Replace `src/styles.css:1` with:

```css
@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fira+Code:wght@400;500;700&display=swap");
```

- [ ] **Step 2: Extend the `:root` block.** Inside `:root { … }` (after line 52 `--font-mono`), set the mono var and add the new groups:

```css
  --font-sans: "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
  --font-mono: "Fira Code", "IBM Plex Mono", monospace;
  --danger: #ef4444;

  /* Type scale */
  --text-xs: 11px;
  --text-sm: 12.5px;
  --text-md: 13px;
  --text-lg: 15px;
  --text-xl: 22px;

  /* Spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  /* Syntax palette (dark) */
  --syn-key: #2ed3c6;
  --syn-str: #8fe3a1;
  --syn-num: #ff9d73;
  --syn-bool: #b79cff;
  --syn-null: #b79cff;
  --syn-punct: #5f6a80;
```

- [ ] **Step 3: Add the light theme block.** Immediately after the closing `}` of `:root` (after line 62), add:

```css
:root[data-theme="light"] {
  --bg: #ffffff;
  --panel: #f7f8fa;
  --panel-2: #eceef2;
  --panel-3: #e2e5ec;
  --accent: #ff7a59;
  --accent-2: #12a594;
  --accent-green: #2f8a4a;
  --accent-yellow: #b7791f;
  --accent-blue: #2563eb;
  --accent-purple: #6b4fd0;
  --accent-red: #d64545;
  --text: #1f2430;
  --muted: #5c6472;
  --text-muted: var(--muted);
  --border: #e3e6ec;
  --danger: #d64545;

  --syn-key: #0e8f86;
  --syn-str: #2f8a4a;
  --syn-num: #d15a2c;
  --syn-bool: #6b4fd0;
  --syn-null: #6b4fd0;
  --syn-punct: #9aa2b0;

  --method-get: #0e8f86;
  --method-post: #b7791f;
  --method-put: #2563eb;
  --method-patch: #6b4fd0;
  --method-delete: #d64545;
}
```

- [ ] **Step 4: Set the body font.** Find the existing `body` rule (search `body {`) and ensure it includes `font-family: var(--font-sans);`. If no `body` rule sets font-family, add one near the top-level base styles:

```css
body { font-family: var(--font-sans); }
```

- [ ] **Step 5: Verify build + lint.**

Run: `npm run build && npm run lint`
Expected: build succeeds, lint 0 errors. (No unit test — CSS-only task.)

- [ ] **Step 6: Commit.**

```bash
git add src/styles.css
git commit -m "feat(theme): fonts, type/spacing/syntax tokens, light theme block"
```

---

### Task 2: Theme resolution logic + `useTheme` hook

**Files:**
- Create: `src/theme/theme.ts`, `src/theme/theme.test.ts`, `src/theme/useTheme.ts`

**Interfaces:**
- Produces: `type Theme = "light" | "dark"`; `THEME_KEY = "theme"`; `resolveTheme(stored: string | null, prefersLight: boolean): Theme`; `applyTheme(theme: Theme): void`; hook `useTheme(): { theme: Theme; toggle: () => void }`.

- [ ] **Step 1: Write the failing test** — `src/theme/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("honors a stored dark preference over OS", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
  });
  it("honors a stored light preference over OS", () => {
    expect(resolveTheme("light", false)).toBe("light");
  });
  it("falls back to OS light when nothing stored", () => {
    expect(resolveTheme(null, true)).toBe("light");
  });
  it("falls back to OS dark when nothing stored", () => {
    expect(resolveTheme(null, false)).toBe("dark");
  });
  it("ignores an invalid stored value and uses OS", () => {
    expect(resolveTheme("purple", true)).toBe("light");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `npx vitest run src/theme/theme.test.ts`
Expected: FAIL — cannot find module `./theme`.

- [ ] **Step 3: Implement** `src/theme/theme.ts`:

```ts
export type Theme = "light" | "dark";
export const THEME_KEY = "theme";

export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersLight ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
```

- [ ] **Step 4: Run it, verify it passes.**

Run: `npx vitest run src/theme/theme.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement the hook** `src/theme/useTheme.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { Theme, THEME_KEY, resolveTheme, applyTheme } from "./theme";

function initial(): Theme {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
  const prefersLight =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches;
  return resolveTheme(stored, prefersLight);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
```

- [ ] **Step 6: Verify build.** Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit.**

```bash
git add src/theme/theme.ts src/theme/theme.test.ts src/theme/useTheme.ts
git commit -m "feat(theme): resolveTheme logic + useTheme hook"
```

---

### Task 3: Brand CodeMirror themes

**Files:**
- Create: `src/theme/codemirrorTheme.ts`

**Interfaces:**
- Consumes: `Theme` from `src/theme/theme.ts`; `--syn-*` values (hardcoded here to the Global Constraints hex — CM cannot read CSS vars at runtime reliably).
- Produces: `brandDark: Extension`, `brandLight: Extension`, `cmTheme(theme: Theme): Extension`.

- [ ] **Step 1: Implement** `src/theme/codemirrorTheme.ts`:

```ts
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { Theme } from "./theme";

type Palette = {
  bg: string; text: string; caret: string; selection: string;
  gutterBg: string; gutterText: string; border: string;
  key: string; str: string; num: string; bool: string; nul: string; punct: string;
};

const DARK: Palette = {
  bg: "#0c0e13", text: "#c9d1e0", caret: "#ff7a59", selection: "#2a3346",
  gutterBg: "#0a0c10", gutterText: "#5a6478", border: "#222839",
  key: "#2ed3c6", str: "#8fe3a1", num: "#ff9d73", bool: "#b79cff", nul: "#b79cff", punct: "#5f6a80",
};
const LIGHT: Palette = {
  bg: "#ffffff", text: "#2b3240", caret: "#d15a2c", selection: "#dbeafe",
  gutterBg: "#fafbfc", gutterText: "#b3bac6", border: "#eceef2",
  key: "#0e8f86", str: "#2f8a4a", num: "#d15a2c", bool: "#6b4fd0", nul: "#6b4fd0", punct: "#9aa2b0",
};

function build(p: Palette, dark: boolean): Extension {
  const view = EditorView.theme(
    {
      "&": { color: p.text, backgroundColor: p.bg, fontSize: "13px" },
      ".cm-content": { fontFamily: '"Fira Code", monospace', lineHeight: "1.7", caretColor: p.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: p.selection,
      },
      ".cm-gutters": { backgroundColor: p.gutterBg, color: p.gutterText, border: "none", borderRight: `1px solid ${p.border}` },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-activeLine": { backgroundColor: "transparent" },
    },
    { dark }
  );
  const highlight = syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.propertyName, t.definition(t.propertyName)], color: p.key },
      { tag: [t.string, t.special(t.string)], color: p.str },
      { tag: [t.number], color: p.num },
      { tag: [t.bool, t.keyword], color: p.bool },
      { tag: [t.null], color: p.nul },
      { tag: [t.punctuation, t.separator, t.brace, t.bracket], color: p.punct },
    ])
  );
  return [view, highlight];
}

export const brandDark = build(DARK, true);
export const brandLight = build(LIGHT, false);
export function cmTheme(theme: Theme): Extension {
  return theme === "light" ? brandLight : brandDark;
}
```

- [ ] **Step 2: Verify build.** Run: `npm run build` → succeeds (confirms imports resolve).

- [ ] **Step 3: Commit.**

```bash
git add src/theme/codemirrorTheme.ts
git commit -m "feat(theme): brand CodeMirror light/dark themes"
```

---

### Task 4: `StatusPill` + `statusMeta`/`tone` pure logic

**Files:**
- Create: `src/components/ui/statusMeta.ts`, `statusMeta.test.ts`, `tone.ts`, `tone.test.ts`, `StatusPill.tsx`, `ui.module.css`

**Interfaces:**
- Produces: `type Tone = "success" | "warn" | "error" | "info" | "muted"`; `statusMeta(status: number | "error" | "pending" | null): { label: string; tone: Tone }`; `toneColor(tone: Tone): string` (returns a `var(--…)` string); `<StatusPill status={…} />`.

- [ ] **Step 1: Failing tests** — `src/components/ui/statusMeta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { statusMeta } from "./statusMeta";

describe("statusMeta", () => {
  it("2xx is success", () => expect(statusMeta(200)).toEqual({ label: "200 OK", tone: "success" }));
  it("201 keeps its reason", () => expect(statusMeta(201).label).toBe("201 Created"));
  it("3xx is info", () => expect(statusMeta(304).tone).toBe("info"));
  it("4xx is warn", () => expect(statusMeta(404)).toEqual({ label: "404 Not Found", tone: "warn" }));
  it("5xx is error", () => expect(statusMeta(500).tone).toBe("error"));
  it("literal error", () => expect(statusMeta("error")).toEqual({ label: "Error", tone: "error" }));
  it("pending", () => expect(statusMeta("pending")).toEqual({ label: "…", tone: "muted" }));
  it("null is muted", () => expect(statusMeta(null).tone).toBe("muted"));
  it("unknown code still labels the number", () => expect(statusMeta(799).label).toBe("799"));
});
```

And `src/components/ui/tone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toneColor } from "./tone";

describe("toneColor", () => {
  it("maps success to accent-2", () => expect(toneColor("success")).toBe("var(--accent-2)"));
  it("maps error to danger", () => expect(toneColor("error")).toBe("var(--danger)"));
  it("maps muted", () => expect(toneColor("muted")).toBe("var(--muted)"));
});
```

- [ ] **Step 2: Run, verify fail.** Run: `npx vitest run src/components/ui/statusMeta.test.ts src/components/ui/tone.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement** `src/components/ui/tone.ts`:

```ts
export type Tone = "success" | "warn" | "error" | "info" | "muted";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "success": return "var(--accent-2)";
    case "warn": return "var(--accent-yellow)";
    case "error": return "var(--danger)";
    case "info": return "var(--accent-blue)";
    case "muted": return "var(--muted)";
  }
}
```

`src/components/ui/statusMeta.ts`:

```ts
import type { Tone } from "./tone";

const REASON: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  409: "Conflict", 422: "Unprocessable", 429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
};

export function statusMeta(status: number | "error" | "pending" | null): { label: string; tone: Tone } {
  if (status === null) return { label: "—", tone: "muted" };
  if (status === "pending") return { label: "…", tone: "muted" };
  if (status === "error") return { label: "Error", tone: "error" };
  const reason = REASON[status];
  const label = reason ? `${status} ${reason}` : String(status);
  let tone: Tone = "muted";
  if (status >= 200 && status < 300) tone = "success";
  else if (status >= 300 && status < 400) tone = "info";
  else if (status >= 400 && status < 500) tone = "warn";
  else if (status >= 500) tone = "error";
  return { label, tone };
}
```

- [ ] **Step 4: Run, verify pass.** Run: `npx vitest run src/components/ui/statusMeta.test.ts src/components/ui/tone.test.ts` → PASS.

- [ ] **Step 5: Implement** `src/components/ui/StatusPill.tsx`:

```tsx
import { statusMeta } from "./statusMeta";
import { toneColor } from "./tone";
import styles from "./ui.module.css";

export function StatusPill({ status }: { status: number | "error" | "pending" | null }) {
  const { label, tone } = statusMeta(status);
  const color = toneColor(tone);
  return (
    <span className={styles.statusPill} style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {label}
    </span>
  );
}
```

Create `src/components/ui/ui.module.css` with (append across later tasks):

```css
.statusPill {
  font-size: var(--text-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  white-space: nowrap;
}
```

- [ ] **Step 6: Verify build + lint.** Run: `npm run build && npm run lint` → clean.

- [ ] **Step 7: Commit.**

```bash
git add src/components/ui/
git commit -m "feat(ui): StatusPill + statusMeta/tone logic"
```

---

### Task 5: `Button` primitive

**Files:**
- Create: `src/components/ui/Button.tsx`; Modify: `src/components/ui/ui.module.css`

**Interfaces:**
- Produces: `<Button variant="primary"|"ghost"|"danger" {...buttonProps} />` (defaults `primary`). Forwards all native button props.

- [ ] **Step 1: Implement** `src/components/ui/Button.tsx`:

```tsx
import { ButtonHTMLAttributes } from "react";
import styles from "./ui.module.css";

type Variant = "primary" | "ghost" | "danger";
export function Button({ variant = "primary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...rest} className={[styles.btn, styles[`btn_${variant}`], className].filter(Boolean).join(" ")} />;
}
```

- [ ] **Step 2: Add styles** to `ui.module.css`:

```css
.btn { font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 700;
  border: 1px solid transparent; border-radius: var(--radius-md); padding: 9px 18px; cursor: pointer;
  transition: background .12s, border-color .12s, opacity .12s; }
.btn:disabled { opacity: .5; cursor: default; }
.btn_primary { background: var(--accent); color: #1a0f0a; }
.btn_primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, #fff); }
.btn_ghost { background: transparent; border-color: var(--border); color: var(--text); }
.btn_ghost:hover:not(:disabled) { background: var(--panel-2); }
.btn_danger { background: var(--danger); color: #fff; }
```

- [ ] **Step 3: Verify build + lint.** Run: `npm run build && npm run lint` → clean.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/Button.tsx src/components/ui/ui.module.css
git commit -m "feat(ui): Button primitive (primary/ghost/danger)"
```

---

### Task 6: `Select` + `SegmentedControl` primitives

**Files:**
- Create: `src/components/ui/Select.tsx`, `src/components/ui/SegmentedControl.tsx`; Modify: `ui.module.css`

**Interfaces:**
- Produces:
  - `<Select value options onChange placeholder? />` where `options: { value: string; label: string; color?: string }[]`, `onChange: (v: string) => void`. Radix-based.
  - `<SegmentedControl value options onChange size?="sm"|"md" />` where `options: { value: string; label: string }[]`, `onChange: (v: string) => void`.

- [ ] **Step 1: Implement** `src/components/ui/Select.tsx` (Radix `@radix-ui/react-select`, already installed):

```tsx
import * as RS from "@radix-ui/react-select";
import styles from "./ui.module.css";

export type Option = { value: string; label: string; color?: string };
export function Select({ value, options, onChange, placeholder }: {
  value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <RS.Root value={value} onValueChange={onChange}>
      <RS.Trigger className={styles.selectTrigger} aria-label={placeholder ?? "Select"}>
        <RS.Value placeholder={placeholder}>
          <span style={active?.color ? { color: active.color, fontWeight: 700 } : undefined}>{active?.label ?? placeholder}</span>
        </RS.Value>
        <RS.Icon className={styles.selectCaret}>▾</RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className={styles.selectContent} position="popper" sideOffset={4}>
          <RS.Viewport>
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} className={styles.selectItem}>
                <RS.ItemText><span style={o.color ? { color: o.color, fontWeight: 700 } : undefined}>{o.label}</span></RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
```

- [ ] **Step 2: Implement** `src/components/ui/SegmentedControl.tsx`:

```tsx
import styles from "./ui.module.css";

export function SegmentedControl({ value, options, onChange, size = "md" }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; size?: "sm" | "md";
}) {
  return (
    <div className={[styles.segmented, size === "sm" ? styles.segmentedSm : ""].filter(Boolean).join(" ")} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value}
          className={[styles.segment, o.value === value ? styles.segmentOn : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add styles** to `ui.module.css`:

```css
.selectTrigger { display: inline-flex; align-items: center; gap: 6px; background: transparent;
  border: none; color: var(--method-get); font-family: var(--font-sans); font-weight: 700;
  font-size: var(--text-sm); cursor: pointer; padding: 0; }
.selectCaret { opacity: .6; font-size: 10px; }
.selectContent { background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--radius-md);
  padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.35); z-index: 50; }
.selectItem { font-size: var(--text-sm); padding: 7px 12px; border-radius: var(--radius-sm);
  color: var(--text); cursor: pointer; outline: none; }
.selectItem[data-highlighted] { background: var(--panel-3); }

.segmented { display: inline-flex; background: var(--panel-2); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 3px; gap: 2px; }
.segment { font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 500; color: var(--muted);
  background: transparent; border: none; border-radius: var(--radius-sm); padding: 7px 13px; cursor: pointer; }
.segmentOn { background: var(--panel-3); color: var(--text); font-weight: 600; }
.segmentedSm .segment { padding: 5px 10px; font-size: var(--text-xs); }
```

- [ ] **Step 4: Verify build + lint.** Run: `npm run build && npm run lint` → clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/Select.tsx src/components/ui/SegmentedControl.tsx src/components/ui/ui.module.css
git commit -m "feat(ui): Select + SegmentedControl primitives"
```

---

### Task 7: `JsonView` primitive

**Files:**
- Create: `src/components/ui/JsonView.tsx`; Modify: `ui.module.css`

**Interfaces:**
- Consumes: `cmTheme` from `src/theme/codemirrorTheme.ts`; `Theme`.
- Produces: `<JsonView value theme editable? onChange? toolbar? gutter?=true />`. `value: string`, `theme: Theme`, `editable?: boolean`, `onChange?: (v: string) => void`, `toolbar?: React.ReactNode` (rendered in the chrome bar), `gutter?: boolean`.

- [ ] **Step 1: Implement** `src/components/ui/JsonView.tsx`:

```tsx
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { lineNumbers } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { cmTheme } from "../../theme/codemirrorTheme";
import type { Theme } from "../../theme/theme";
import styles from "./ui.module.css";

export function JsonView({ value, theme, editable = false, onChange, toolbar, gutter = true }: {
  value: string; theme: Theme; editable?: boolean; onChange?: (v: string) => void;
  toolbar?: React.ReactNode; gutter?: boolean;
}) {
  const extensions = [json(), EditorView.lineWrapping];
  if (gutter) extensions.push(lineNumbers());
  return (
    <div className={styles.jsonView}>
      {toolbar && <div className={styles.jsonBar}>{toolbar}</div>}
      <CodeMirror
        value={value}
        theme={cmTheme(theme)}
        extensions={extensions}
        editable={editable}
        readOnly={!editable}
        onChange={onChange}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
```

Note: `basicSetup.lineNumbers:false` avoids double gutters — the explicit `lineNumbers()` extension (added only when `gutter`) is the single source.

- [ ] **Step 2: Add styles** to `ui.module.css`:

```css
.jsonView { border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--panel); }
.jsonBar { display: flex; align-items: center; gap: var(--space-3); padding: 8px 12px;
  border-bottom: 1px solid var(--border); font-size: var(--text-xs); color: var(--muted); }
```

- [ ] **Step 3: Verify build + lint.** Run: `npm run build && npm run lint` → clean.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/JsonView.tsx src/components/ui/ui.module.css
git commit -m "feat(ui): JsonView CodeMirror wrapper with chrome"
```

---

### Task 8: Thread `theme` to the panes + mount the toggle

**Files:**
- Modify: `src/App.tsx` (import `useTheme`, render a toggle in the top bar, pass `theme` down to `RequestEditor` and `ResponseViewer`).

**Interfaces:**
- Produces: `theme: Theme` prop added to `RequestEditor` and `ResponseViewer` (both accept and forward it; consumed in Tasks 9–11).

- [ ] **Step 1: Add the hook.** In `src/App.tsx`, import and call the hook in the top-level component:

```tsx
import { useTheme } from "./theme/useTheme";
// inside the component body:
const { theme, toggle: toggleTheme } = useTheme();
```

- [ ] **Step 2: Render the toggle** in the existing top bar (locate the app header row). Insert:

```tsx
<button className="ghost" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle light/dark">
  {theme === "dark" ? "☀" : "☾"}
</button>
```

- [ ] **Step 3: Pass `theme`** to the mounted `<RequestEditor … />` (App.tsx:3325-3389 region) and `<ResponseViewer … />` (App.tsx:3468+): add `theme={theme}` to both prop lists.

- [ ] **Step 4: Accept the prop (temporary passthrough).** In `RequestEditor` and `ResponseViewer` prop types, add `theme: Theme;` (import `Theme`). Leave unused for now (consumed next tasks) — add `// eslint-disable-next-line` only if lint flags unused; prefer wiring it in the same task if trivial.

- [ ] **Step 5: Verify build + lint + tests.** Run: `npm run build && npm run lint && npm run test` → all green.

- [ ] **Step 6: Commit.**

```bash
git add src/App.tsx src/components/RequestPane/RequestEditor.tsx src/components/ResponsePane/ResponseViewer.tsx
git commit -m "feat(theme): mount theme toggle, thread theme to panes"
```

---

### Task 9: `RequestToolbar` + `MethodSelect` (unified pill + Send)

**Files:**
- Create: `src/components/RequestPane/MethodSelect.tsx`, `src/components/RequestPane/RequestToolbar.tsx`
- Modify: `src/components/RequestPane/RequestEditor.tsx` (replace the current `.requestBar` region — method dropdown `:251-270`, URL `EnvInput` `:271-282`, Send button `:283-289` — with `<RequestToolbar/>`).

**Interfaces:**
- Consumes: `Button`, `Select`; existing `EnvInput` component (keep using it for the URL field); the method-color tokens `--method-*`.
- Produces:
  - `<MethodSelect value onChange />` — wraps `ui/Select` with the HTTP method list, each option colored via `--method-{method}`.
  - `<RequestToolbar method onMethodChange url onUrlChange onSend sending onCancel envProps… />` — renders the unified pill (MethodSelect + URL EnvInput inside one framed container) and the Send/Cancel `Button`.

- [ ] **Step 1: Implement** `src/components/RequestPane/MethodSelect.tsx`:

```tsx
import { Select } from "../ui/UiSelect";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const color = (m: string) => `var(--method-${m.toLowerCase()})`;

export function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onChange={onChange} options={METHODS.map((m) => ({ value: m, label: m, color: color(m) }))} />;
}
```

- [ ] **Step 2: Implement** `src/components/RequestPane/RequestToolbar.tsx`. Read the current Send/cancel logic in `RequestEditor.tsx:283-289` and the `EnvInput` usage at `:271-282`; port them verbatim into:

```tsx
import { MethodSelect } from "./MethodSelect";
import { Button } from "../ui/AppButton";
import styles from "./RequestToolbar.module.css";
// import EnvInput from its existing path (copy the import from RequestEditor.tsx)

export function RequestToolbar(props: {
  method: string; onMethodChange: (m: string) => void;
  sending: boolean; onSend: () => void; onCancel: () => void;
  urlField: React.ReactNode; // the existing <EnvInput/> element, passed in from RequestEditor to avoid re-threading its ~10 props
}) {
  const { method, onMethodChange, sending, onSend, onCancel, urlField } = props;
  return (
    <div className={styles.bar}>
      <div className={styles.pill}>
        <div className={styles.methodSeg}><MethodSelect value={method} onChange={onMethodChange} /></div>
        <div className={styles.urlSeg}>{urlField}</div>
      </div>
      {sending
        ? <Button variant="danger" onClick={onCancel}>Cancel</Button>
        : <Button variant="primary" onClick={onSend}>Send</Button>}
    </div>
  );
}
```

Create `src/components/RequestPane/RequestToolbar.module.css`:

```css
.bar { display: flex; align-items: center; gap: var(--space-3); }
.pill { flex: 1; display: flex; align-items: stretch; background: var(--panel-2);
  border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; min-width: 0; }
.methodSeg { display: flex; align-items: center; background: var(--panel-3);
  padding: 0 14px; border-right: 1px solid var(--border); }
.urlSeg { flex: 1; min-width: 0; display: flex; align-items: center; padding: 4px 12px; }
```

- [ ] **Step 3: Wire into `RequestEditor`.** Replace the JSX from the method dropdown through the Send button (`:251-289`) with:

```tsx
<RequestToolbar
  method={method} onMethodChange={setMethod}
  sending={isSending} onSend={handleSend} onCancel={handleCancel}
  urlField={/* the existing <EnvInput … /> element moved here unchanged */}
/>
```

Use the actual state/handler names from the current file (e.g. whatever `method`, send handler, and cancel handler are called). Keep the `EnvInput` element and its props exactly as they were.

- [ ] **Step 4: Verify build + lint + tests + manual.** Run: `npm run build && npm run lint && npm run test`. Then manually: dropdown opens, method colors show, URL edits, Send/Cancel toggle works.

- [ ] **Step 5: Commit.**

```bash
git add src/components/RequestPane/MethodSelect.tsx src/components/RequestPane/RequestToolbar.tsx src/components/RequestPane/RequestToolbar.module.css src/components/RequestPane/RequestEditor.tsx
git commit -m "feat(request): unified method+URL pill toolbar"
```

---

### Task 10: `RequestTabs` segmented control

**Files:**
- Create: `src/components/RequestPane/RequestTabs.tsx`
- Modify: `RequestEditor.tsx` (replace the current sub-tab strip — CSS-module `.tab` buttons — with `<RequestTabs/>`).

**Interfaces:**
- Consumes: `SegmentedControl`.
- Produces: `<RequestTabs active onChange tabs={["Body","Params","Headers","Auth","Tests"]} />` → `onChange: (tab: string) => void`.

- [ ] **Step 1: Implement** `src/components/RequestPane/RequestTabs.tsx`:

```tsx
import { SegmentedControl } from "../ui/SegmentedControl";

export function RequestTabs({ active, tabs, onChange }: { active: string; tabs: string[]; onChange: (t: string) => void }) {
  return <SegmentedControl value={active} onChange={onChange} options={tabs.map((t) => ({ value: t, label: t }))} />;
}
```

- [ ] **Step 2: Wire into `RequestEditor`.** Replace the existing tab-strip JSX with `<RequestTabs active={activeTab} tabs={requestTabs} onChange={setActiveTab} />` using the current tab-state names. (Do not change the tab-content switch yet — Task 11 extracts the panels.)

- [ ] **Step 3: Verify build + lint + manual.** Tabs switch, active state shows.

- [ ] **Step 4: Commit.**

```bash
git add src/components/RequestPane/RequestTabs.tsx src/components/RequestPane/RequestEditor.tsx
git commit -m "feat(request): segmented tab control"
```

---

### Task 11: Extract request tab panels into `tabs/*` + slim `RequestEditor`

**Files:**
- Create: `src/components/RequestPane/tabs/ParamsTab.tsx`, `HeadersTab.tsx`, `AuthTab.tsx`, `BodyTab.tsx`, `TestsTab.tsx`
- Modify: `RequestEditor.tsx` (move each tab's JSX + its directly-related handlers into the matching file; render `<XTab {...props}/>` from the content switch).

**Interfaces:**
- Consumes: `JsonView` (BodyTab), `Button`/`Select` (AuthTab rebuild).
- Produces: one component per tab, each taking exactly the props its panel already uses (lift the relevant subset from `RequestEditorProps`). `BodyTab` signature: `<BodyTab value onChange theme />` using `JsonView` (editable). `AuthTab` rebuilt with `ui/*` — same auth state/handlers, zero inline styles.

- [ ] **Step 1: Extract `BodyTab` first** (smallest, highest value). Create `tabs/BodyTab.tsx`:

```tsx
import { JsonView } from "../../ui/JsonView";
import type { Theme } from "../../../theme/theme";

export function BodyTab({ value, onChange, theme }: { value: string; onChange: (v: string) => void; theme: Theme }) {
  return <JsonView value={value} onChange={onChange} theme={theme} editable gutter />;
}
```

Replace the body CodeMirror block (`RequestEditor.tsx:719-742`) with `<BodyTab value={body} onChange={setBody} theme={theme} />` (use the actual body state names).

- [ ] **Step 2: Extract `AuthTab`** — move the inline-styled auth block (`RequestEditor.tsx:462-664`) into `tabs/AuthTab.tsx`, replacing inline styles with `ui/Select` (auth-type dropdown), `ui/Button`, and token-based classes in a new `AuthTab.module.css`. Preserve every auth field, state prop, and handler exactly. Prop type = the subset of `RequestEditorProps` the auth block reads.

- [ ] **Step 3: Extract `ParamsTab`, `HeadersTab`, `TestsTab`** — move each panel's JSX into its file with the props it uses. These are structural moves; keep markup/behavior, swap any raw buttons for `ui/Button`.

- [ ] **Step 4: Slim `RequestEditor`.** The content switch now renders the five `<*Tab/>` components. Confirm the file is materially smaller (target orchestration + layout only).

- [ ] **Step 5: Verify build + lint + tests + manual.** Run all gates. Manually exercise every request tab and send a request.

- [ ] **Step 6: Commit.**

```bash
git add src/components/RequestPane/
git commit -m "refactor(request): extract tab panels, slim RequestEditor to orchestrator"
```

---

### Task 12: `ResponseViewer` adopts `JsonView` + `StatusPill`

**Files:**
- Modify: `src/components/ResponsePane/ResponseViewer.tsx` — replace `renderCodeMirror` (`:254-267`, `theme={vscodeDark}`) with `JsonView`; replace the plain muted status/latency/size `<div>`s (`:694-706`) with `StatusPill` + token-styled meta; remove the `vscodeDark` import.

**Interfaces:**
- Consumes: `JsonView`, `StatusPill`, `theme` (threaded in Task 8).

- [ ] **Step 1: Swap the JSON renderer.** Replace the `renderCodeMirror` body so it returns `<JsonView value={text} theme={theme} gutter />` (read-only). Keep the Pretty/Raw/XML mode selection by passing a `toolbar` node (e.g. a `SegmentedControl` for Pretty/Raw) if the current UI has one; otherwise leave existing tab controls above it.

- [ ] **Step 2: Color-code status.** Replace the status `<div>` (`:694`) with `<StatusPill status={httpStatus} />` (map the component's status value to `number | "error" | "pending" | null`). Keep latency/size as sibling meta styled with `var(--muted)` + `var(--text-xs)`.

- [ ] **Step 3: Remove** the now-unused `import { vscodeDark } …` at `ResponseViewer.tsx:3`.

- [ ] **Step 4: Verify build + lint + tests + manual.** Response JSON uses Fira Code + brand palette; status pill is color-coded; toggling theme restyles the response.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ResponsePane/ResponseViewer.tsx
git commit -m "feat(response): adopt JsonView + color-coded StatusPill"
```

---

### Task 13: Final verification pass (both themes)

**Files:** none (verification only).

- [ ] **Step 1:** Run full gates: `npm run test && npm run build && npm run lint` → 53+ tests green, build clean, 0 lint errors.
- [ ] **Step 2:** Manual spot-check in **dark**: send a request; check toolbar pill, segmented tabs, each request tab, response status pill + JSON palette.
- [ ] **Step 3:** Toggle to **light**: repeat; confirm CodeMirror switches to `brandLight`, tokens flip, no unreadable contrast.
- [ ] **Step 4:** Reload the app — theme persists (localStorage); first-run with no stored value follows OS preference.
- [ ] **Step 5: Commit** any final fixes.

```bash
git commit -am "chore: request panel redesign verification fixes" # only if changes
```

---

## Self-Review

**Spec coverage:** tokens/fonts (T1) · light+dark + toggle + OS default (T1,T2,T8) · CM themes (T3) · Button/Select/Segmented consolidation (T5,T6) · brand JSON viewer + chrome + gutter (T7) · status color-coding (T4,T12) · full decomposition (T9–T11) · response adoption, table view untouched (T12) · verification both themes (T13). All spec sections mapped.

**Placeholder scan:** no TBD/TODO; refactor tasks reference exact current line ranges and say to port existing state/handler names verbatim (the implementer reads the file). Pure-logic tasks carry full code + tests.

**Type consistency:** `Theme` (theme.ts) used everywhere; `Tone`/`statusMeta`/`toneColor` names consistent T4→T12; `cmTheme(theme)` consistent T3→T7; `JsonView` prop shape consistent T7→T11→T12.
