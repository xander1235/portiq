# Curl Paste → Build Current Request

**Date:** 2026-07-20
**Status:** Approved

## Goal

When a user pastes a curl command into the request URL input, detect it, parse
it, and (after a confirmation step) populate the **current** HTTP request —
method, URL, query params, headers, body, and auth — instead of dropping the raw
curl text into the URL field.

## User Flow

1. User pastes text into the URL input (`EnvInput` in the request toolbar).
2. An `onPaste` handler reads the pasted text.
   - If it does **not** look like curl → default paste behavior (text lands in
     the URL field as normal). No modal.
   - If it **does** look like curl → `preventDefault()` (raw curl never lands in
     the field), parse it, and open a confirmation modal.
3. The confirmation modal shows a short preview (method + URL + a summary line
   such as "4 headers · JSON body · Bearer auth").
4. **Import** → parsed fields overwrite the current request via existing
   setters. **Cancel** → nothing changes.

Confirm-first is intentional: pasting overwrites the current request, so the
user gets one click to avoid an accidental clobber.

## Components

### 1. `src/services/curlParser.ts` (new, pure, unit-tested)

Pure module with no React/DOM dependencies.

**Exports**

- `looksLikeCurl(text: string): boolean` — trims, returns true if it begins with
  `curl` followed by whitespace or end-of-token. Cheap gate run on every paste.
- `parseCurl(input: string): ParsedCurl | null` — returns `null` when the input
  is not a parseable curl command.

**`ParsedCurl` shape** (normalized, maps 1:1 to the UI request state):

```ts
interface ParsedCurl {
  method: string;                       // GET, POST, ...
  url: string;
  headers: { name: string; value: string }[];
  queryParams: { name: string; value: string }[];
  body:
    | { type: "none" }
    | { type: "json" | "raw"; text: string }
    | { type: "form" | "multipart"; rows: { key: string; value: string }[] };
  authType: "none" | "bearer" | "basic";
  authConfig: AuthConfig;               // same AuthConfig used elsewhere
}
```

**Tokenizer** — shell-aware, handling:

- single quotes `'...'` (literal, no escapes inside)
- double quotes `"..."` (backslash escapes for `"`, `\`, `` ` ``, `$`)
- backslash-escaped chars outside quotes
- `\`-followed-by-newline line continuations (curl commands are often multiline)
- collapses whitespace between tokens

**Flags handled (Common + extended)**

| Flag | Behavior |
|------|----------|
| `-X`, `--request <M>` | set method |
| `-H`, `--header <h>` | add header (split on first `:`) |
| `-d`, `--data`, `--data-raw`, `--data-ascii`, `--data-binary <d>` | append to body (join multiple with `&`); implies POST if method unset |
| `--data-urlencode <d>` | form body row; implies POST |
| `-F`, `--form <f>` | multipart body row (split on first `=`); implies POST |
| `-u`, `--user <u:p>` | basic auth |
| `-b`, `--cookie <c>` | `Cookie` header |
| `-G`, `--get` | move accumulated data into query params; method GET |
| `--url <u>` | set URL |
| bare token | set URL |
| `-L`,`-k`,`-s`,`-i`,`--compressed`,`--location`,`--insecure`, other unknown flags | ignored silently |

**Inference rules**

- Body/data present and no explicit `-X` → method `POST`.
- `-G` present → all `-d`/`--data*` values are parsed as `k=v` query params, and
  method becomes `GET`.
- `body.type` is chosen from the `Content-Type` header:
  `application/json` → `json`; `application/x-www-form-urlencoded` → `form`
  (rows split on `&` then `=`); `-F` present → `multipart`; otherwise `raw`.
- `Authorization` header: `Bearer <t>` → `authType: "bearer"`; `Basic <b64>` →
  decode to username/password → `authType: "basic"`. `-u user:pass` → basic.
  When auth is extracted, the `Authorization` header is removed from `headers`
  (mirrors the existing HTTPie import logic in `useRequestState.ts`).

### 2. `src/components/Modals/CurlImportModal.tsx` (new)

Confirmation dialog using the existing `modal-backdrop` / `modal` CSS classes
(same pattern as the Export Code Snippet modal in `App.tsx`).

Props: `{ parsed: ParsedCurl; onConfirm: () => void; onCancel: () => void }`.

Renders: title "Import from curl", a read-only preview (`METHOD URL` line + a
summary line of counts: headers / body type / auth), and **Cancel** / **Import**
buttons. Backdrop click and ✕ = cancel.

### 3. `EnvInput` (`src/components/TableEditor.tsx`) — extend

Add an optional `onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void`
prop, forwarded to the inner `<input>`. When absent, behavior is unchanged (all
existing call sites keep working).

### 4. Wiring (`RequestEditor.tsx` + `App.tsx`)

- `RequestEditor` receives an `onCurlPaste(e)` callback and attaches it to the
  URL `EnvInput`'s new `onPaste` prop.
- `App.tsx`:
  - holds `pendingCurl: ParsedCurl | null` state.
  - `onCurlPaste` reads `e.clipboardData.getData("text")`; if `looksLikeCurl`,
    calls `parseCurl`; if it returns non-null, `e.preventDefault()` and set
    `pendingCurl`.
  - renders `CurlImportModal` when `pendingCurl` is set.
  - on confirm, `applyParsedCurl(parsed)` calls existing setters and
    `updateRequestState(currentRequestId, ...)` for each field so the change
    persists like any manual edit:
    - `setMethod` / `updateRequestMethod`
    - `setUrl` + params via `setParamsRows`
    - `setHeadersRows` (via `handleHeadersRowsChange`)
    - `setBodyType` + `setContentType` + `setBodyText` / `setBodyRows`
    - `setAuthType` + `setAuthConfig`
  - Empty collections (no headers/params/body) fall back to the default single
    empty row, matching how imports normalize (`[{ key:"", value:"", comment:"", enabled:true }]`).

## Testing

`src/services/curlParser.test.ts` (vitest, matching `visualize.test.ts` style):

- bare URL → GET, that URL
- `-X POST -H 'Content-Type: application/json' -d '{...}'` → POST, JSON body, header
- multiple `-H`
- `--data-urlencode` / `application/x-www-form-urlencoded` → form rows
- `-F a=1 -F b=2` → multipart rows, POST
- `-u user:pass` → basic auth (username/password)
- `Authorization: Bearer xyz` header → bearer auth, header removed
- `-G -d q=1 -d r=2` → GET with query params
- multiline curl with `\` line continuations
- `looksLikeCurl` returns false for a plain URL / JSON / random text
- `parseCurl` returns null for non-curl input

## Out of Scope (YAGNI)

- File references: `-d @file` and `-F field=@file` are treated as literal string
  values, not read from disk.
- Cookie jars (`-c`/`--cookie-jar`).
- Multiple requests in one paste.
- `--data-binary` with `@file`.

These are rare in pasted curls; if needed later they extend the parser without
changing the flow.
