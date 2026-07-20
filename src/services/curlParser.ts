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
      bodyRows = joined
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const [key, value = ""] = pair.split("=", 2);
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
    if (rows.length > 0) {
      paramsRows = rows;
      urlObject.search = "";
      finalUrl = urlObject.toString();
    }
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
