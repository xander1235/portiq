# F1: Light-Mode Checkbox Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unchecked checkboxes (and row hover) in the Manage Collections and Export modals visible in light theme by replacing hardcoded white values with theme tokens.

**Architecture:** CSS-only change in `src/styles.css`. Four value swaps across two checkbox rules and two row-state rules. No JS, no new tokens.

**Tech Stack:** CSS custom properties (design tokens), dark-first with `:root[data-theme="light"]` overrides.

## Global Constraints

- Do not touch the `:checked` rules — they already use `var(--text)` / `var(--bg)` and render correctly in both themes.
- Use only tokens that already exist in both `:root` (dark) and `:root[data-theme="light"]`: `--border`, `--panel-2`, `--panel-3`.
- No new dependencies. No new CSS selectors.

---

### Task 1: Swap hardcoded white for theme tokens

**Files:**
- Modify: `src/styles.css` (4 lines: ~2141, ~2143, ~2341, ~2344, ~2353, ~2355)

**Interfaces:**
- Consumes: existing tokens `--border`, `--panel-2`, `--panel-3`.
- Produces: nothing (leaf change).

- [ ] **Step 1: Fix the Export-modal checkbox (`.export-row input[type="checkbox"]`)**

In `src/styles.css`, in the `.export-row input[type="checkbox"]` block, change:

```css
  border: 1px solid rgba(255, 255, 255, 0.2);
```
to
```css
  border: 1px solid var(--border);
```

and change:

```css
  background: rgba(255, 255, 255, 0.05);
```
to
```css
  background: var(--panel-3);
```

- [ ] **Step 2: Fix the Manage-modal checkbox (`.manage-modal .mc-check`)**

In the `.manage-modal .mc-check` block, change:

```css
  border: 1px solid rgba(255, 255, 255, 0.2);
```
to
```css
  border: 1px solid var(--border);
```

and change:

```css
  background: rgba(255, 255, 255, 0.05);
```
to
```css
  background: var(--panel-3);
```

- [ ] **Step 3: Fix the Manage-modal collection row hover/active**

In `.manage-modal .mc-collection-item:hover`, change:

```css
  background: rgba(255, 255, 255, 0.03);
```
to
```css
  background: var(--panel-2);
```

In `.manage-modal .mc-collection-item.active`, change:

```css
  background: rgba(255, 255, 255, 0.05);
```
to
```css
  background: var(--panel-2);
```

(Leave the `border-color: var(--border);` line in the `.active` block as-is.)

- [ ] **Step 4: Type-check sanity (unaffected but confirm no accidental edit elsewhere)**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Manual verification in both themes**

Run the app (`npm run dev` if not already running). Toggle to **light** theme (☾/☀ button in the header).
- Open **Manage Collections**: every unchecked checkbox shows a visible bordered box; hovering a collection row shows a visible background; the active row is highlighted. Check one — the checkmark still shows.
- Open the **Export** modal: unchecked checkboxes are visible.
- Toggle back to **dark** theme and confirm no regression (boxes, hover, checked state all still look right).

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "fix(ux): light-mode visibility for Manage Collections & Export checkboxes

Swap hardcoded translucent-white border/background for theme tokens
(var(--border)/var(--panel-3)) so unchecked boxes and row hover are
visible on light-theme surfaces. Checked state already tokenized.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Self-Review

- **Spec coverage:** F1 root cause (hardcoded white unchecked border/bg on `.mc-check` + `.export-row input`) → Steps 1-2; secondary hover/active symptom → Step 3. Covered.
- **Placeholder scan:** none.
- **Type consistency:** N/A (CSS).
