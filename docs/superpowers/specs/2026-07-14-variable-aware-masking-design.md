# Variable-Aware Masking in Secret Input Sections

**Date:** 2026-07-14
**Status:** Approved

## Problem

Input sections in Portiq (headers, query params, custom auth, form body) render
through `TableEditor` → `EnvInput`, which supports `{{variable}}` interpolation
with highlighting, hover tooltips, double-click-to-edit, and autocomplete.

A section can be **maskable** (`isMaskable` — today only the custom-auth table).
When a maskable row is masked, its value currently renders in a plain
`<input type="password">`. This has two problems:

1. It masks **everything**, including any `{{variable}}` reference — so the user
   can't see which variable a secret field points at.
2. An empty masked field still renders as a password input (visually a masked
   box for no content).

## Rule

In a maskable (secret) section that supports variables:

- If the value contains a `{{variable}}` → **show the variable reference**
  (do not mask it).
- Literal (non-variable) text → **mask it**, but only when non-empty.
- Empty value → show the placeholder only, no masking bullets.

Mixed values are handled **per-part**: `Bearer {{token}}` → `••••••{{token}}`.

## Design

Masking is **display-only**. Values are stored and sent unchanged;
`redactSecrets` (network/AI redaction) is untouched.

### 1. `EnvInput` — new `maskLiterals?: boolean` prop

`EnvInput` layers a transparent real `<input>` (text `color: transparent`, caret
visible) over a highlight `<div>`. The real characters are never painted, so
masking is purely a concern of `renderHighlighted()`:

- **Empty value** → render placeholder only. No bullets.
- **`{{variable}}` parts** → rendered exactly as today (highlight color, hover
  tooltip, double-click-to-edit, autocomplete unchanged).
- **Literal parts** → replaced with `•` repeated once per character, instead of
  the real text.

Examples (masked):
- `Bearer {{token}}` → `••••••` + highlighted `{{token}}`
- `abc123` → `••••••`
- `{{apiKey}}` → highlighted `{{apiKey}}` only, no bullets
- `` (empty) → placeholder only

When `maskLiterals` is false/absent, `EnvInput` behaves exactly as it does today.

### 2. `TableEditor` — maskable path uses `EnvInput`

Replace the `<input type="password">` branch in the `isMaskable` render path
with `<EnvInput … maskLiterals={isMasked} />`. The existing eye toggle still
flips `isMasked`:

- masked → per-part masking via `maskLiterals`
- unmasked → normal `EnvInput`

This also gives masked fields the variable autocomplete/highlight they currently
lack.

## Scope

- Affects `isMaskable` sections (today: custom-auth table in `RequestEditor`).
- No storage/wire format change.
- No change to `redactSecrets`, GitHub-sync secret placeholders, or the `secret`
  (GitHub Secret) row flag.

## Testing

Manual, in the custom-auth section. Add rows with:

1. empty value → placeholder shown, no bullets
2. literal only (`abc123`) → all bullets
3. variable only (`{{apiKey}}`) → variable visible, no bullets
4. mixed (`Bearer {{token}}`) → literal bullets + visible variable

For each: confirm the eye toggle reveals the real value, and that editing /
caret positioning / autocomplete still work while masked.
