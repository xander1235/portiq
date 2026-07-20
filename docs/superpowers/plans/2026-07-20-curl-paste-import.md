# Curl Paste → Build Current Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting a curl command into the request URL input parses it and, after a confirmation dialog, populates the current HTTP request (method, URL, params, headers, body, auth).

**Architecture:** Extract the existing in-component curl parser (`tokenizeShellCommand` + `parseCurlCommand` in `App.tsx`) into a pure, unit-tested `src/services/curlParser.ts`, fixing its missing-return bug and adding Auth-tab extraction (Bearer/Basic) + `-b/--cookie`. Repoint the existing "Import from cURL" modal at it, then add an `onPaste` interception on the URL `EnvInput` that opens a confirmation modal and applies the parsed request to the current request via existing state setters.

**Tech Stack:** React + TypeScript, Vite, Vitest, Electron. Existing patterns: `modal-backdrop`/`modal` CSS classes, `RequestRow`/`AuthConfig` types from `src/hooks/useRequestState.ts`.

## Global Constraints

- Types `RequestRow` and `AuthConfig` are defined in `src/hooks/useRequestState.ts` — import from there, do not redefine.
- `RequestRow` shape: `{ key: string; value: string; comment: string; enabled: boolean; kind?: "text"|"file"; fileName?: string; mimeType?: string; fileBase64?: string }`.
- `AuthConfig` shape: `{ bearer: { token: string }; basic: { username: string; password: string }; api_key: { key: string; value: string; add_to: "header"|"query" } }`.
- Empty header/param/body collections must fall back to a single blank row `{ key: "", value: "", comment: "", enabled: true }` (matches existing import normalization).
- Run tests with `npx vitest run <path>`. Run typecheck/lint with `npm run lint`.
- Body type values in this app: `"none" | "json" | "form" | "raw" | "multipart"`.
- Auth type values: `"none" | "bearer" | "basic" | "api_key" | "custom"`.

---

## Task 1: Pure curl parser service + tests

**Files:**
- Create: `src/services/curlParser.ts`
- Create: `src/services/curlParser.test.ts`

**Interfaces:**
- Consumes: `RequestRow`, `AuthConfig` from `src/hooks/useRequestState.ts`.
- Produces:
  - `interface ParsedCurl { method: string; url: string; headersRows: RequestRow[]; paramsRows: RequestRow[]; bodyType: string; bodyText: string; bodyRows: RequestRow[]; authType: string; authConfig: AuthConfig }`
  - `function looksLikeCurl(text: string): boolean`
  - `function parseCurl(command: string): ParsedCurl` — throws `Error` if the command is not curl or has no URL.
  - `function inferRequestNameFromUrl(value: string): string`
  - `function collectTemplateVars(parsed: ParsedCurl): string[]` — unique `{{name}}` tokens used anywhere in the parsed request.
  - `function findParameterizableVars(parsed: ParsedCurl, envVars: Record<string, string>): { name: string; value: string }[]` — env vars whose non-empty value appears literally in the parsed request.
  - `function parameterizeParsedCurl(parsed: ParsedCurl, literal: string, varName: string): ParsedCurl` — copy with every `literal` replaced by `{{varName}}` in string fields.

- [ ] **Step 1: Write the failing tests**

Create `src/services/curlParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  looksLikeCurl,
  parseCurl,
  inferRequestNameFromUrl,
  collectTemplateVars,
  findParameterizableVars,
  parameterizeParsedCurl,
} from "./curlParser";

describe("looksLikeCurl", () => {
  it("detects a curl command", () => {
    expect(looksLikeCurl("curl https://x.com")).toBe(true);
    expect(looksLikeCurl("  curl -X POST https://x.com  ")).toBe(true);
  });
  it("rejects non-curl text", () => {
    expect(looksLikeCurl("https://x.com")).toBe(false);
    expect(looksLikeCurl('{"a":1}')).toBe(false);
    expect(looksLikeCurl("curly braces")).toBe(false);
    expect(looksLikeCurl("")).toBe(false);
  });
});

describe("parseCurl", () => {
  it("parses a bare URL as GET", () => {
    const r = parseCurl("curl https://api.example.com/users");
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("throws when there is no URL", () => {
    expect(() => parseCurl("curl -X POST")).toThrow();
  });

  it("throws when not a curl command", () => {
    expect(() => parseCurl("wget https://x.com")).toThrow();
  });

  it("parses method, header and JSON body", () => {
    const r = parseCurl(
      `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"a"}'`
    );
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("json");
    expect(r.bodyText).toBe('{"name":"a"}');
    expect(r.headersRows.find((h) => h.key === "Content-Type")?.value).toBe("application/json");
  });

  it("infers POST when data present without -X", () => {
    const r = parseCurl(`curl https://x.com -d 'a=1'`);
    expect(r.method).toBe("POST");
  });

  it("parses multiple headers", () => {
    const r = parseCurl(`curl https://x.com -H 'A: 1' -H 'B: 2'`);
    expect(r.headersRows.find((h) => h.key === "A")?.value).toBe("1");
    expect(r.headersRows.find((h) => h.key === "B")?.value).toBe("2");
  });

  it("parses x-www-form-urlencoded body into rows", () => {
    const r = parseCurl(
      `curl -X POST https://x.com -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2'`
    );
    expect(r.bodyType).toBe("form");
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("parses -F multipart form into rows", () => {
    const r = parseCurl(`curl -X POST https://x.com -F a=1 -F b=2`);
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("multipart");
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("extracts basic auth from -u into authConfig and drops the header", () => {
    const r = parseCurl(`curl https://x.com -u alice:secret`);
    expect(r.authType).toBe("basic");
    expect(r.authConfig.basic).toEqual({ username: "alice", password: "secret" });
    expect(r.headersRows.find((h) => h.key.toLowerCase() === "authorization")).toBeUndefined();
  });

  it("extracts Bearer auth from an Authorization header", () => {
    const r = parseCurl(`curl https://x.com -H 'Authorization: Bearer tok123'`);
    expect(r.authType).toBe("bearer");
    expect(r.authConfig.bearer.token).toBe("tok123");
    expect(r.headersRows.find((h) => h.key.toLowerCase() === "authorization")).toBeUndefined();
  });

  it("maps -b/--cookie to a Cookie header", () => {
    const r = parseCurl(`curl https://x.com -b 'sid=abc'`);
    expect(r.headersRows.find((h) => h.key === "Cookie")?.value).toBe("sid=abc");
  });

  it("moves -G data into query params and keeps GET", () => {
    const r = parseCurl(`curl -G https://x.com/search -d q=1 -d r=2`);
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://x.com/search");
    expect(r.paramsRows.map((row) => [row.key, row.value])).toEqual([["q", "1"], ["r", "2"]]);
  });

  it("splits an inline query string into paramsRows", () => {
    const r = parseCurl(`curl 'https://x.com/search?a=1&b=2'`);
    expect(r.url).toBe("https://x.com/search");
    expect(r.paramsRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("handles backslash line continuations", () => {
    const r = parseCurl("curl https://x.com \\\n  -H 'A: 1' \\\n  -d 'x=1'");
    expect(r.method).toBe("POST");
    expect(r.headersRows.find((h) => h.key === "A")?.value).toBe("1");
  });

  it("keeps -d @file as a raw body placeholder", () => {
    const r = parseCurl("curl -X POST https://x.com -d @payload.json");
    expect(r.bodyType).toBe("raw");
    expect(r.bodyText).toBe("@payload.json");
  });

  it("keeps -F field=@file as a multipart file-row placeholder", () => {
    const r = parseCurl("curl -X POST https://x.com -F file=@logo.png");
    expect(r.bodyType).toBe("multipart");
    const row = r.bodyRows.find((b) => b.key === "file");
    expect(row?.kind).toBe("file");
    expect(row?.fileName).toBe("logo.png");
  });
});

describe("inferRequestNameFromUrl", () => {
  it("uses the last path segment", () => {
    expect(inferRequestNameFromUrl("https://x.com/api/users")).toBe("users");
  });
  it("falls back to hostname when path is empty", () => {
    expect(inferRequestNameFromUrl("https://x.com")).toBe("x.com");
  });
});

describe("collectTemplateVars", () => {
  it("finds template vars across url, headers and body", () => {
    const r = parseCurl(
      `curl 'https://x.com/{{id}}' -H 'Authorization: Bearer {{token}}' -d '{{payload}}'`
    );
    const vars = collectTemplateVars(r).sort();
    expect(vars).toEqual(["id", "payload", "token"]);
  });
  it("returns an empty array when there are no template vars", () => {
    expect(collectTemplateVars(parseCurl("curl https://x.com"))).toEqual([]);
  });
});

describe("findParameterizableVars", () => {
  it("returns env vars whose value appears literally in the request", () => {
    const r = parseCurl("curl https://api.example.com/users");
    const found = findParameterizableVars(r, {
      baseUrl: "https://api.example.com",
      unused: "nope-not-here",
      blank: "",
    });
    expect(found).toEqual([{ name: "baseUrl", value: "https://api.example.com" }]);
  });
});

describe("parameterizeParsedCurl", () => {
  it("replaces a literal with a {{var}} reference in the url", () => {
    const r = parseCurl("curl https://api.example.com/users");
    const out = parameterizeParsedCurl(r, "https://api.example.com", "baseUrl");
    expect(out.url).toBe("{{baseUrl}}/users");
  });
  it("replaces a literal in header values", () => {
    const r = parseCurl("curl https://x.com -H 'Authorization: Bearer tok123'");
    // auth extracted → token lives in authConfig.bearer.token
    const out = parameterizeParsedCurl(r, "tok123", "token");
    expect(out.authConfig.bearer.token).toBe("{{token}}");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/curlParser.test.ts`
Expected: FAIL — `Cannot find module './curlParser'`.

- [ ] **Step 3: Create the parser module**

Create `src/services/curlParser.ts`:

```ts
import type { RequestRow, AuthConfig } from "../hooks/useRequestState";

export interface ParsedCurl {
  method: string;
  url: string;
  headersRows: RequestRow[];
  paramsRows: RequestRow[];
  bodyType: string;
  bodyText: string;
  bodyRows: RequestRow[];
  authType: string;
  authConfig: AuthConfig;
}

const EMPTY_ROW: RequestRow = { key: "", value: "", comment: "", enabled: true };
const emptyRows = (): RequestRow[] => [{ ...EMPTY_ROW }];

function defaultAuthConfig(): AuthConfig {
  return {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" },
  };
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\s|$)/.test(text || "");
}

export function inferRequestNameFromUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : parsed.hostname;
  } catch {
    return "Imported cURL Request";
  }
}

function tokenizeShellCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escaping) {
      // A backslash before a newline is a line continuation: drop both.
      if (char !== "\n") current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function objectToRows(obj: Record<string, string>): RequestRow[] {
  const entries = Object.entries(obj);
  if (entries.length === 0) return emptyRows();
  return entries.map(([key, value]) => ({ key, value, comment: "", enabled: true }));
}

export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0 || tokens[0] !== "curl") {
    throw new Error("Command must start with curl");
  }

  let method = "";
  let urlValue = "";
  let explicitMethod = false;
  let useQueryString = false;
  const headers: Record<string, string> = {};
  const dataParts: string[] = [];
  const formParts: string[] = [];

  const readValue = (index: number, label: string): string => {
    const value = tokens[index + 1];
    if (value == null) throw new Error(`Missing value for ${label}`);
    return value;
  };

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const nextValue = () => {
      const value = readValue(i, token);
      i += 1;
      return value;
    };

    if (token === "-X" || token === "--request") {
      method = nextValue().toUpperCase();
      explicitMethod = true;
      continue;
    }
    if (token.startsWith("--request=")) {
      method = token.split("=", 2)[1].toUpperCase();
      explicitMethod = true;
      continue;
    }
    if (token === "-H" || token === "--header") {
      const header = nextValue();
      const idx = header.indexOf(":");
      if (idx !== -1) headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
      continue;
    }
    if (token.startsWith("--header=")) {
      const header = token.split("=", 2)[1];
      const idx = header.indexOf(":");
      if (idx !== -1) headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
      continue;
    }
    if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"].includes(token)) {
      dataParts.push(nextValue());
      continue;
    }
    if (
      token.startsWith("--data=") ||
      token.startsWith("--data-raw=") ||
      token.startsWith("--data-binary=") ||
      token.startsWith("--data-ascii=") ||
      token.startsWith("--data-urlencode=")
    ) {
      dataParts.push(token.split("=", 2)[1]);
      continue;
    }
    if (token === "-F" || token === "--form" || token === "--form-string") {
      formParts.push(nextValue());
      continue;
    }
    if (token.startsWith("--form=") || token.startsWith("--form-string=")) {
      formParts.push(token.split("=", 2)[1]);
      continue;
    }
    if (token === "-G" || token === "--get") {
      useQueryString = true;
      continue;
    }
    if (token === "-b" || token === "--cookie") {
      headers["Cookie"] = nextValue();
      continue;
    }
    if (token.startsWith("--cookie=")) {
      headers["Cookie"] = token.split("=", 2)[1];
      continue;
    }
    if (token === "--url") {
      urlValue = nextValue();
      continue;
    }
    if (token.startsWith("--url=")) {
      urlValue = token.split("=", 2)[1];
      continue;
    }
    if (token === "-u" || token === "--user") {
      headers["Authorization"] = `Basic ${btoa(nextValue())}`;
      continue;
    }
    if (!token.startsWith("-") && !urlValue) {
      urlValue = token;
    }
  }

  if (!urlValue) throw new Error("cURL command does not contain a URL");

  const normalizedMethod = explicitMethod
    ? method
    : (formParts.length > 0 || dataParts.length > 0) && !useQueryString
    ? "POST"
    : "GET";

  let finalUrl = urlValue;
  let bodyType = "none";
  let bodyText = "";
  let bodyRows: RequestRow[] = emptyRows();

  if (useQueryString && dataParts.length > 0) {
    try {
      const urlObject = new URL(finalUrl);
      dataParts.forEach((part) => {
        const [key, value = ""] = part.split("=", 2);
        urlObject.searchParams.append(key, value);
      });
      finalUrl = urlObject.toString();
    } catch {
      // leave url unchanged if it is not absolute
    }
  } else if (formParts.length > 0) {
    bodyType = "multipart";
    bodyRows = formParts.map((part) => {
      const [key, rawValue = ""] = part.split("=", 2);
      if (rawValue.startsWith("@")) {
        const filePath = rawValue.slice(1);
        const fileName = filePath.split(/[/\\]/).pop() || "upload.bin";
        return { key, value: "", comment: "", enabled: true, kind: "file", fileName, mimeType: "application/octet-stream" };
      }
      return { key, value: rawValue, comment: "", enabled: true, kind: "text" };
    });
  } else if (dataParts.length > 0) {
    const joined = dataParts.join("&");
    const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
    const ct = ctKey ? headers[ctKey].toLowerCase() : "";
    if (ct.includes("application/json") || /^[[{]/.test(joined.trim())) {
      bodyType = "json";
      bodyText = joined;
    } else if (ct.includes("application/x-www-form-urlencoded") || dataParts.every((p) => p.includes("="))) {
      bodyType = "form";
      bodyRows = dataParts.map((part) => {
        const [key, value = ""] = part.split("=", 2);
        return { key, value, comment: "", enabled: true };
      });
    } else {
      bodyType = "raw";
      bodyText = joined;
    }
  }

  let paramsRows: RequestRow[] = emptyRows();
  try {
    const urlObject = new URL(finalUrl);
    const rows = Array.from(urlObject.searchParams.entries()).map(([key, value]) => ({
      key,
      value,
      comment: "",
      enabled: true,
    }));
    if (rows.length > 0) paramsRows = rows;
    urlObject.search = "";
    finalUrl = urlObject.toString();
  } catch {
    // relative/opaque URL: keep as-is
  }

  let authType = "none";
  const authConfig = defaultAuthConfig();
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  if (authKey) {
    const authValue = headers[authKey];
    if (authValue.toLowerCase().startsWith("bearer ")) {
      authType = "bearer";
      authConfig.bearer.token = authValue.slice(7);
      delete headers[authKey];
    } else if (authValue.toLowerCase().startsWith("basic ")) {
      try {
        const decoded = atob(authValue.slice(6));
        const [username, ...rest] = decoded.split(":");
        authType = "basic";
        authConfig.basic = { username, password: rest.join(":") };
        delete headers[authKey];
      } catch {
        // keep as a plain header if not decodable
      }
    }
  }

  return {
    method: normalizedMethod,
    url: finalUrl,
    headersRows: objectToRows(headers),
    paramsRows,
    bodyType,
    bodyText,
    bodyRows: bodyRows.length > 0 ? bodyRows : emptyRows(),
    authType,
    authConfig,
  };
}

// --- Environment-variable helpers -------------------------------------------

function collectStrings(parsed: ParsedCurl): string[] {
  const out: string[] = [parsed.url];
  const pushRows = (rows: RequestRow[]) =>
    rows.forEach((r) => {
      out.push(r.key, r.value);
    });
  pushRows(parsed.headersRows);
  pushRows(parsed.paramsRows);
  pushRows(parsed.bodyRows);
  out.push(parsed.bodyText);
  out.push(parsed.authConfig.bearer.token);
  out.push(parsed.authConfig.basic.username, parsed.authConfig.basic.password);
  out.push(parsed.authConfig.api_key.key, parsed.authConfig.api_key.value);
  return out.filter((s) => typeof s === "string" && s.length > 0);
}

export function collectTemplateVars(parsed: ParsedCurl): string[] {
  const names = new Set<string>();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  for (const s of collectStrings(parsed)) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) names.add(m[1]);
  }
  return Array.from(names);
}

export function findParameterizableVars(
  parsed: ParsedCurl,
  envVars: Record<string, string>
): { name: string; value: string }[] {
  const strings = collectStrings(parsed);
  return Object.entries(envVars)
    .filter(([, value]) => value && strings.some((s) => s.includes(value)))
    .map(([name, value]) => ({ name, value }));
}

export function parameterizeParsedCurl(
  parsed: ParsedCurl,
  literal: string,
  varName: string
): ParsedCurl {
  if (!literal) return parsed;
  const token = `{{${varName}}}`;
  const swap = (s: string) => (s ? s.split(literal).join(token) : s);
  const swapRows = (rows: RequestRow[]): RequestRow[] =>
    rows.map((r) => ({ ...r, key: swap(r.key), value: swap(r.value) }));
  return {
    ...parsed,
    url: swap(parsed.url),
    headersRows: swapRows(parsed.headersRows),
    paramsRows: swapRows(parsed.paramsRows),
    bodyRows: swapRows(parsed.bodyRows),
    bodyText: swap(parsed.bodyText),
    authConfig: {
      bearer: { token: swap(parsed.authConfig.bearer.token) },
      basic: {
        username: swap(parsed.authConfig.basic.username),
        password: swap(parsed.authConfig.basic.password),
      },
      api_key: {
        key: swap(parsed.authConfig.api_key.key),
        value: swap(parsed.authConfig.api_key.value),
        add_to: parsed.authConfig.api_key.add_to,
      },
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/curlParser.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/services/curlParser.ts src/services/curlParser.test.ts
git commit -m "feat(curl): pure, tested curl parser service"
```

---

## Task 2: Repoint the existing "Import from cURL" modal at the service

**Files:**
- Modify: `src/App.tsx` — remove in-component `tokenizeShellCommand` (~1226-1268), `inferRequestNameFromUrl` (~1270-1278), `parseCurlCommand` (~1280-1497); update `handleImportCurlSubmit` (~1553-1573); add the import.

**Interfaces:**
- Consumes: `parseCurl`, `inferRequestNameFromUrl` from `src/services/curlParser`.
- Produces: nothing new; fixes the broken new-request import (previously `parseCurlCommand` never returned, so imports were empty).

- [ ] **Step 1: Add the service import**

At the top of `src/App.tsx`, near the other `./services/...` imports, add:

```ts
import { parseCurl, inferRequestNameFromUrl } from "./services/curlParser";
```

- [ ] **Step 2: Delete the in-component parser functions**

Remove these three functions entirely from `src/App.tsx` (they now live in the service):
- `function tokenizeShellCommand(command: string): string[] { ... }`
- `function inferRequestNameFromUrl(value: string) { ... }`
- `function parseCurlCommand(command: string) { ... }` (the whole block ending at the `};`/`}` after `wsConfig: DEFAULT_WS_CONFIG`).

- [ ] **Step 3: Rewrite `handleImportCurlSubmit` to use the service**

Replace the existing `handleImportCurlSubmit` body with:

```ts
function handleImportCurlSubmit() {
  if (!importCurlDraft.trim()) return;
  try {
    const parsed = parseCurl(importCurlDraft);
    const createdReq = addRequestToCollection(null, (req) => {
      Object.assign(req, {
        method: parsed.method,
        url: parsed.url,
        headersRows: parsed.headersRows,
        paramsRows: parsed.paramsRows,
        bodyType: parsed.bodyType,
        bodyText: parsed.bodyText,
        bodyRows: parsed.bodyRows,
        authType: parsed.authType,
        authConfig: parsed.authConfig,
      });
      req.type = "request";
      req.id = req.id || "req_" + Date.now();
      req.name = req.name || inferRequestNameFromUrl(parsed.url);
      req.description = req.description || "";
      req.tags = req.tags || [];
      return req;
    });
    if (createdReq) {
      handleRequestClick(createdReq as RequestItem);
    }
    setShowImportCurlModal(false);
    setImportCurlDraft("");
  } catch (err: any) {
    alert("Failed to parse the provided cURL command. Error: " + err.message);
  }
}
```

- [ ] **Step 4: Verify build & lint pass**

Run: `npm run lint`
Expected: PASS with no errors referencing removed symbols (`parseCurlCommand`, `tokenizeShellCommand`) or unused variables (`objectToRows` may still be used elsewhere — leave it).

Run: `npm run build`
Expected: PASS (Vite build completes; TypeScript has no errors).

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(curl): share parser service; fix empty new-request import"
```

---

## Task 3: Add `onPaste` prop to `EnvInput`

**Files:**
- Modify: `src/components/TableEditor.tsx` — `EnvInputProps` interface (~line 6) and the inner `<input>` (~line 340).

**Interfaces:**
- Consumes: nothing new.
- Produces: `EnvInput` accepts optional `onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void`, forwarded to the inner `<input>`. Absent = unchanged behavior.

- [ ] **Step 1: Extend the props interface**

In `src/components/TableEditor.tsx`, add to `interface EnvInputProps`:

```ts
    onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
```

- [ ] **Step 2: Destructure and forward the prop**

Update the `EnvInput` function signature to include `onPaste`:

```ts
export function EnvInput({ value, onChange, placeholder, className, style, envVars, onUpdateEnvVar, maskLiterals, onPaste }: EnvInputProps) {
```

On the inner `<input>` (the one with `ref={inputRef}`), add:

```tsx
                    onPaste={onPaste}
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/TableEditor.tsx
git commit -m "feat(input): forward optional onPaste on EnvInput"
```

---

## Task 4: Confirmation modal component

**Files:**
- Create: `src/components/Modals/CurlImportModal.tsx`

**Interfaces:**
- Consumes: `ParsedCurl`, `collectTemplateVars`, `findParameterizableVars` from `src/services/curlParser`.
- Produces: `function CurlImportModal(props: { parsed: ParsedCurl; envVars: Record<string,string>; onConfirm: (result: { fills: Record<string,string>; parameterize: string[] }) => void; onCancel: () => void }): JSX.Element`.

- [ ] **Step 1: Create the component**

Create `src/components/Modals/CurlImportModal.tsx`:

```tsx
import React, { useMemo, useState } from "react";
import type { ParsedCurl } from "../../services/curlParser";
import { collectTemplateVars, findParameterizableVars } from "../../services/curlParser";

interface CurlImportModalProps {
  parsed: ParsedCurl;
  envVars: Record<string, string>;
  onConfirm: (result: { fills: Record<string, string>; parameterize: string[] }) => void;
  onCancel: () => void;
}

function summarize(parsed: ParsedCurl): string {
  const parts: string[] = [];
  const headerCount = parsed.headersRows.filter((r) => r.key.trim()).length;
  if (headerCount) parts.push(`${headerCount} header${headerCount === 1 ? "" : "s"}`);
  const paramCount = parsed.paramsRows.filter((r) => r.key.trim()).length;
  if (paramCount) parts.push(`${paramCount} query param${paramCount === 1 ? "" : "s"}`);
  if (parsed.bodyType !== "none") parts.push(`${parsed.bodyType} body`);
  if (parsed.authType !== "none") parts.push(`${parsed.authType} auth`);
  return parts.length ? parts.join(" · ") : "no headers, body, or auth";
}

export function CurlImportModal({ parsed, envVars, onConfirm, onCancel }: CurlImportModalProps) {
  const undefinedVars = useMemo(
    () => collectTemplateVars(parsed).filter((name) => !envVars[name]),
    [parsed, envVars]
  );
  const paramCandidates = useMemo(
    () => findParameterizableVars(parsed, envVars),
    [parsed, envVars]
  );

  const [fills, setFills] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const handleImport = () => {
    const cleanFills: Record<string, string> = {};
    for (const [name, value] of Object.entries(fills)) {
      if (value.trim()) cleanFills[name] = value;
    }
    const parameterize = paramCandidates.filter((c) => selected[c.name]).map((c) => c.name);
    onConfirm({ fills: cleanFills, parameterize });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel} style={{ zIndex: 9999 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "560px", maxWidth: "90vw" }}>
        <div className="modal-title">
          <div>Import from cURL</div>
          <button className="ghost icon-button" onClick={onCancel} style={{ margin: "-8px", padding: "8px" }}>✕</button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
          This will replace the current request with the pasted cURL command.
        </p>

        <div style={{ background: "var(--panel)", borderRadius: "6px", padding: "10px 12px", margin: "12px 0", fontFamily: "monospace", fontSize: "13px", wordBreak: "break-all" }}>
          <div><strong>{parsed.method}</strong> {parsed.url}</div>
          <div style={{ color: "var(--muted)", marginTop: "6px", fontFamily: "inherit" }}>{summarize(parsed)}</div>
        </div>

        {undefinedVars.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }}>
              Undefined variables — fill or leave blank to import as-is
            </div>
            {undefinedVars.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <code style={{ minWidth: "120px", fontSize: "12px" }}>{`{{${name}}}`}</code>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder={`value for ${name}`}
                  value={fills[name] || ""}
                  onChange={(e) => setFills((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        {paramCandidates.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }}>
              Use existing environment variables
            </div>
            {paramCandidates.map((c) => (
              <label key={c.name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", cursor: "pointer", fontSize: "0.82rem" }}>
                <input
                  type="checkbox"
                  checked={!!selected[c.name]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [c.name]: e.target.checked }))}
                />
                <span>Replace <code style={{ fontSize: "12px" }}>{c.value}</code> → <code style={{ fontSize: "12px" }}>{`{{${c.name}}}`}</code></span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={handleImport}>Import</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Modals/CurlImportModal.tsx
git commit -m "feat(curl): confirmation modal for paste import"
```

---

## Task 5: Wire paste → confirm → apply to current request

**Files:**
- Modify: `src/components/RequestPane/RequestEditor.tsx` — add `onCurlPaste` prop, pass to URL `EnvInput`.
- Modify: `src/App.tsx` — `pendingCurl` state, `handleCurlPaste`, `applyParsedCurlToCurrent`, render `CurlImportModal`, pass `onCurlPaste` to `RequestEditor`.

**Interfaces:**
- Consumes: `looksLikeCurl`, `parseCurl`, `ParsedCurl` from `src/services/curlParser`; `CurlImportModal` from `src/components/Modals/CurlImportModal`.
- Produces: `RequestEditor` gains prop `onCurlPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void`.

- [ ] **Step 1: Add the prop to `RequestEditor`**

In `src/components/RequestPane/RequestEditor.tsx`, add to `interface RequestEditorProps`:

```ts
    onCurlPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
```

Add `onCurlPaste` to the destructured params in the function signature (next to `theme`).

Pass it to the URL `EnvInput` (inside `RequestToolbar`'s `urlField`):

```tsx
                    <EnvInput
                        className={`input ${styles.url} h-[30px]`}
                        value={url}
                        onChange={(val) => {
                            setUrl(val);
                            if (currentRequestId) updateRequestState(currentRequestId, "url", val);
                        }}
                        onPaste={onCurlPaste}
                        envVars={getEnvVars()}
                        onUpdateEnvVar={handleUpdateEnvVar}
                        placeholder="https://api.example.com/v1/users/{{id}}"
                        style={{ flex: 1 }}
                    />
```

- [ ] **Step 2: Add imports and state in `App.tsx`**

Extend the curl service import from Task 2 to the full set, and import the modal:

```ts
import {
  parseCurl,
  inferRequestNameFromUrl,
  looksLikeCurl,
  parameterizeParsedCurl,
  type ParsedCurl,
} from "./services/curlParser";
import { CurlImportModal } from "./components/Modals/CurlImportModal";
```

Near the other `useState` declarations (e.g. after `showImportCurlModal`), add:

```ts
  const [pendingCurl, setPendingCurl] = useState<ParsedCurl | null>(null);
```

- [ ] **Step 3: Add the paste handler and the apply function**

Add these two functions in `App.tsx` (near `handleImportCurlSubmit`):

```ts
  function handleCurlPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!looksLikeCurl(text)) return; // normal paste
    try {
      const parsed = parseCurl(text);
      e.preventDefault(); // keep the raw curl out of the URL field
      setPendingCurl(parsed);
    } catch {
      // not parseable as curl — let it paste normally
    }
  }

  function applyParsedCurlToCurrent(parsed: ParsedCurl) {
    const headersText = JSON.stringify(rowsToObject(parsed.headersRows), null, 2);
    setMethod(parsed.method);
    setUrl(parsed.url);
    setParamsRows(parsed.paramsRows);
    setHeadersRows(parsed.headersRows);
    setHeadersText(headersText);
    setBodyType(parsed.bodyType);
    setBodyText(parsed.bodyText);
    setBodyRows(parsed.bodyRows);
    setAuthType(parsed.authType);
    setAuthConfig(parsed.authConfig);
    if (currentRequestId) {
      updateRequestById(currentRequestId as string, {
        method: parsed.method,
        url: parsed.url,
        paramsRows: parsed.paramsRows,
        headersRows: parsed.headersRows,
        headersText,
        bodyType: parsed.bodyType,
        bodyText: parsed.bodyText,
        bodyRows: parsed.bodyRows,
        authType: parsed.authType,
        authConfig: parsed.authConfig,
      });
    }
    setPendingCurl(null);
  }

  function handleCurlConfirm(result: { fills: Record<string, string>; parameterize: string[] }) {
    if (!pendingCurl) return;
    let parsed = pendingCurl;
    // 1. Swap chosen literals for {{var}} references first.
    for (const name of result.parameterize) {
      const value = envVars[name];
      if (value) parsed = parameterizeParsedCurl(parsed, value, name);
    }
    // 2. Persist any newly-filled variable values into the active environment.
    for (const [name, value] of Object.entries(result.fills)) {
      if (value) handleUpdateEnvVar(name, value);
    }
    applyParsedCurlToCurrent(parsed);
  }
```

- [ ] **Step 4: Pass `onCurlPaste` to `RequestEditor`**

In the `<RequestEditor ... />` JSX (~line 3373), add the prop next to `theme={theme}`:

```tsx
                  onCurlPaste={handleCurlPaste}
```

- [ ] **Step 5: Render the confirmation modal**

Near where `showImportCurlModal` renders its modal (~line 3910), add:

```tsx
      {pendingCurl && (
        <CurlImportModal
          parsed={pendingCurl}
          envVars={envVars}
          onConfirm={handleCurlConfirm}
          onCancel={() => setPendingCurl(null)}
        />
      )}
```

- [ ] **Step 6: Verify build & lint pass**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
- Copy this to the clipboard: `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -H 'Authorization: Bearer tok123' -d '{"name":"ada"}'`
- Paste into the URL input.
- Expect the confirmation modal ("POST https://api.example.com/users · 1 header · json body · bearer auth").
- Click **Import**. Verify: method = POST; URL = the endpoint; Headers tab shows `Content-Type` (no `Authorization`); Body tab = JSON with the payload; Auth tab = Bearer with `tok123`.
- Paste a plain URL (`https://x.com`) → no modal, normal paste into the field.
- **Env var — fill:** paste `curl 'https://x.com/{{userId}}'` with no `userId` in the active environment → modal shows a "fill" input for `userId`. Type `42`, Import → the request URL keeps `{{userId}}` and the active environment now has `userId=42` (check the environment editor).
- **Env var — parameterize:** define an env var `baseUrl=https://api.example.com`, then paste `curl https://api.example.com/users` → modal offers "Replace `https://api.example.com` → `{{baseUrl}}`". Check it, Import → URL becomes `{{baseUrl}}/users`.
- **File placeholder:** paste `curl -X POST https://x.com -d @payload.json` → Import → Body tab = Raw containing `@payload.json`.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/RequestPane/RequestEditor.tsx
git commit -m "feat(curl): paste curl in URL input to fill the current request"
```

---

## Self-Review Notes

- **Spec coverage:** parser service + env-var helpers (Task 1), confirm-first modal with fill/parameterize env-var UI (Task 4 + 5), EnvInput onPaste interception with preventDefault (Task 3 + 5), apply-to-current-request via existing setters (Task 5), extended flags incl. `-F`/`-G`/`-u`/`-b`/cookie and Bearer/Basic auth extraction (Task 1). Sharing the parser with the existing modal + fixing its bug (Task 2) reflects the user's "Extract, fix & share" decision.
- **Env vars ("Both", default Continue):** `collectTemplateVars` → undefined `{{vars}}` get fill inputs (saved via `handleUpdateEnvVar`); `findParameterizableVars` → literals matching existing env var values get opt-in checkboxes (applied via `parameterizeParsedCurl`). Import is always enabled; doing neither imports as pasted.
- **Auth `authConfig` note:** `updateRequestState`'s back-sync map has no `authConfig` entry, so Task 5 uses direct `setAuthConfig` + `updateRequestById` (which persists arbitrary fields) rather than `updateRequestState`.
- **File placeholders (in scope):** `-F field=@file` → multipart file row (`kind:"file"`, `fileName`); `-d @file` → raw body with the literal `@file` text. Files are never read from disk.
- **Out of scope (YAGNI):** reading `@file` contents from disk, cookie jars, multi-request pastes.
