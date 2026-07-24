import { describe, it, expect } from "vitest";
import { assembleRequest, type AssemblableRequest } from "./assembleRequest";
import { interpolate as coreInterpolate } from "./interpolate";

/**
 * Verbatim reproduction of src/App.tsx handleSend (:2211-2276) + its helpers
 * parseHeaders (:1269-1289), getCompiledAuthHeaders (:1291-1309),
 * getCompiledAuthParams (:1311-1316), rowsToObject (:1831-1836),
 * stripJsonComments (:1912-1916), buildUrlWithParams (:1918-1941).
 * interpolate is the same primitive core extracted from the renderer.
 * Used ONLY to prove byte-identical parity of the extracted assembler.
 */
function rendererAssemble(m: AssemblableRequest, vars: Record<string, string>) {
  const interpolate = (v: string) => coreInterpolate(v, vars);

  const rowsToObject = (rows: any[], interpolateValues = true) => {
    const val = (v: string) => (interpolateValues ? interpolate(v) : v);
    return (rows || [])
      .filter((row: any) => row.key && row.enabled !== false)
      .reduce((acc: any, row: any) => ({ ...acc, [val(row.key)]: val(row.value) }), {});
  };

  const getCompiledAuthHeaders = (type: string, config: any, customRows: any[], valFn: (v: string) => string): Record<string, string> => {
    if (type === "none") return {};
    if (type === "bearer" && config.bearer?.token) return { Authorization: `Bearer ${valFn(config.bearer.token)}` };
    if (type === "basic" && (config.basic?.username || config.basic?.password)) {
      const creds = `${valFn(config.basic.username)}:${valFn(config.basic.password)}`;
      return { Authorization: `Basic ${btoa(creds)}` };
    }
    if (type === "api_key" && config.api_key?.add_to === "header" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    if (type === "custom") {
      return (customRows || [])
        .filter((row: any) => row.key && row.enabled !== false)
        .reduce((acc: any, row: any) => ({ ...acc, [valFn(row.key)]: valFn(row.value) }), {});
    }
    return {};
  };

  const getCompiledAuthParams = (type: string, config: any, valFn: (v: string) => string): Record<string, string> => {
    if (type === "api_key" && config.api_key?.add_to === "query" && config.api_key?.key) {
      return { [valFn(config.api_key.key)]: valFn(config.api_key.value) };
    }
    return {};
  };

  const parseHeaders = () => {
    let parsed: any;
    try {
      if (m.headersText && m.headersText.trim().length > 0) parsed = JSON.parse(m.headersText);
      else parsed = (m.headersRows || []).filter((r: any) => r.key && r.enabled !== false).reduce((a: any, r: any) => ({ ...a, [r.key]: r.value }), {});
    } catch {
      parsed = (m.headersRows || []).filter((r: any) => r.key && r.enabled !== false).reduce((a: any, r: any) => ({ ...a, [r.key]: r.value }), {});
    }
    const authHeaders = getCompiledAuthHeaders(m.authType as string, m.authConfig, m.authRows as any[], (v: string) => v);
    return { ...authHeaders, ...parsed };
  };

  const stripJsonComments = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const buildUrlWithParams = () => {
    const val = (v: string) => interpolate(v);
    let base = val(m.url || "");
    base = base.replace(/^(https?:\/\/[a-zA-Z0-9.-]+:\d+)([a-zA-Z_\-~])/i, "$1/$2");
    const activeParams = [...((m.paramsRows as any[]) || [])];
    const authParams = getCompiledAuthParams(m.authType as string, m.authConfig, val);
    Object.entries(authParams).forEach(([k, v]) => activeParams.push({ key: k, value: v as string, enabled: true, comment: "" }));
    if (!activeParams.length) return base;
    const query = activeParams
      .filter((r: any) => r.key && r.enabled !== false)
      .map((r: any) => `${encodeURIComponent(val(r.key))}=${encodeURIComponent(val(r.value || ""))}`)
      .join("&");
    if (!query) return base;
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  };

  const headers = parseHeaders();
  let body: any = m.bodyType === "none" ? undefined : m.bodyText;
  let multipartParts: any;
  if (m.bodyType === "json") {
    const s = stripJsonComments(interpolate(m.bodyText || ""));
    body = s.trim() ? JSON.stringify(JSON.parse(s)) : "";
  }
  if (m.bodyType === "form") body = new URLSearchParams(rowsToObject(m.bodyRows as any[])).toString();
  if (m.bodyType === "multipart") {
    multipartParts = ((m.bodyRows as any[]) || [])
      .filter((r: any) => r.key && r.enabled !== false)
      .map((r: any) =>
        r.kind === "file"
          ? { kind: "file", name: interpolate(r.key), filename: r.fileName || "upload.bin", contentType: r.mimeType || "application/octet-stream", dataBase64: r.fileBase64 || "" }
          : { kind: "text", name: interpolate(r.key), value: interpolate(r.value || "") },
      );
    body = undefined;
  }
  if (m.bodyType === "xml") body = interpolate(m.bodyText || "");
  if (m.bodyType === "raw") body = interpolate(m.bodyText || "");

  return {
    method: m.method,
    url: buildUrlWithParams(),
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, interpolate(v as string)])),
    body,
    multipartParts,
    httpVersion: m.httpVersion,
    timeoutMs: m.requestTimeoutMs,
  };
}

const vars = { baseUrl: "https://api.test", token: "sekret", q: "search me" };

function pick(p: ReturnType<typeof assembleRequest>) {
  return { method: p.method, url: p.url, headers: p.headers, body: p.body, multipartParts: p.multipartParts, httpVersion: p.httpVersion, timeoutMs: p.timeoutMs };
}

describe("golden parity: assembleRequest == renderer handleSend", () => {
  it("matches for a templated url + params + bearer + headers + json body", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "POST", url: "{{baseUrl}}:8443api/items",
      headersText: '{"X-Trace":"{{token}}","Accept":"application/json"}',
      paramsRows: [{ key: "q", value: "{{q}}", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "json", bodyText: '{\n  "id": "{{token}}" // trailing\n}',
      httpVersion: "1.1", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for api_key query auth + form body + host:port slash fix", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "POST", url: "https://api.test:8080submit",
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "apikey", value: "{{token}}", add_to: "query" } },
      bodyType: "form",
      bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
      httpVersion: "auto", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for multipart body + table-row headers fallback", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "PUT", url: "{{baseUrl}}/upload",
      headersRows: [{ key: "X-Env", value: "{{token}}", comment: "", enabled: true }],
      bodyType: "multipart",
      bodyRows: [{ key: "field", value: "{{token}}", comment: "", enabled: true, kind: "text" }],
      httpVersion: "auto", requestTimeoutMs: 30000,
    };
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });

  it("matches for literal basic-auth credentials (byte-identical base64)", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "GET", url: "https://api.test/",
      authType: "basic",
      authConfig: { bearer: { token: "" }, basic: { username: "alice", password: "pa55" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "none", httpVersion: "auto", requestTimeoutMs: 30000,
    };
    // Buffer.from("alice:pa55").toString("base64") === btoa("alice:pa55") for ASCII.
    expect(pick(assembleRequest(model, { vars }))).toEqual(rendererAssemble(model, vars));
  });
});

describe("documented deviation: basic-auth credential interpolation (core fixes a renderer bug)", () => {
  it("interpolates {{var}} credentials BEFORE base64 (the renderer base64s the raw template)", () => {
    const model: AssemblableRequest = {
      protocol: "http", method: "GET", url: "https://api.test/",
      authType: "basic",
      authConfig: { bearer: { token: "" }, basic: { username: "{{token}}", password: "pw" }, api_key: { key: "", value: "", add_to: "header" } },
      bodyType: "none", httpVersion: "auto", requestTimeoutMs: 30000,
    };
    const core = assembleRequest(model, { vars });
    expect(core.headers?.Authorization).toBe(`Basic ${Buffer.from("sekret:pw").toString("base64")}`);
    // The renderer would emit Basic <base64 of "{{token}}:pw"> — the latent bug core intentionally fixes.
    expect(core.headers?.Authorization).not.toBe(rendererAssemble(model, vars).headers.Authorization);
  });
});
