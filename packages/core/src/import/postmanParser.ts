import type { Collection, FolderItem, RequestItem, RequestRow, AuthConfig } from "../model";
import type { ImportedLibrary } from "./types";
import { createIdFactory, type IdFactory } from "./ids";

const blankRow = (): RequestRow[] => [{ key: "", value: "", comment: "", enabled: true }];

function defaultAuthConfig(): AuthConfig {
  return {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" },
  };
}

export function looksLikePostman(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const info = (data as { info?: { schema?: unknown } }).info;
  const schema = info && typeof info.schema === "string" ? info.schema : "";
  return /(schema\.getpostman\.com|postman\.com)\/json\/collection\/v2\./.test(schema);
}

function kvValue(entries: unknown, key: string): string {
  if (!Array.isArray(entries)) return "";
  const found = entries.find((e) => e && typeof e === "object" && (e as { key?: unknown }).key === key) as
    | { value?: unknown }
    | undefined;
  return found && found.value != null ? String(found.value) : "";
}

function authToConfig(pmAuth: unknown): { authType: string; authConfig: AuthConfig } {
  const authConfig = defaultAuthConfig();
  const a = pmAuth as { type?: unknown; bearer?: unknown; basic?: unknown; apikey?: unknown } | null;
  if (!a || typeof a.type !== "string") return { authType: "none", authConfig };
  switch (a.type) {
    case "bearer":
      authConfig.bearer.token = kvValue(a.bearer, "token");
      return { authType: "bearer", authConfig };
    case "basic":
      authConfig.basic = { username: kvValue(a.basic, "username"), password: kvValue(a.basic, "password") };
      return { authType: "basic", authConfig };
    case "apikey":
      authConfig.api_key = {
        key: kvValue(a.apikey, "key"),
        value: kvValue(a.apikey, "value"),
        add_to: kvValue(a.apikey, "in") === "query" ? "query" : "header",
      };
      return { authType: "api_key", authConfig };
    default:
      return { authType: "none", authConfig };
  }
}

function readUrl(url: unknown): { raw: string; query: RequestRow[] } {
  if (typeof url === "string") return { raw: url, query: blankRow() };
  if (url && typeof url === "object") {
    const u = url as { raw?: unknown; query?: unknown };
    const raw = typeof u.raw === "string" ? u.raw : "";
    const rows = Array.isArray(u.query)
      ? u.query
          .filter((q) => q && typeof q === "object" && (q as { key?: unknown }).key != null)
          .map((q) => {
            const r = q as { key: unknown; value?: unknown; disabled?: unknown };
            return { key: String(r.key), value: r.value != null ? String(r.value) : "", comment: "", enabled: r.disabled !== true };
          })
      : [];
    return { raw, query: rows.length ? rows : blankRow() };
  }
  return { raw: "", query: blankRow() };
}

function kvRows(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((p) => {
    const r = p as { key?: unknown; value?: unknown; disabled?: unknown };
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true };
  });
}

function formDataRows(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((p) => {
    const r = p as { key?: unknown; value?: unknown; type?: unknown; src?: unknown; disabled?: unknown };
    if (r?.type === "file") {
      const src = typeof r.src === "string" ? r.src : "";
      const fileName = src.split(/[/\\]/).pop() || "upload.bin";
      return { key: String(r?.key ?? ""), value: "", comment: "", enabled: r?.disabled !== true, kind: "file" as const, fileName, mimeType: "application/octet-stream" };
    }
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true, kind: "text" as const };
  });
}

function readBody(body: unknown): { bodyType: string; bodyText: string; bodyRows: RequestRow[] } {
  const b = body as { mode?: unknown; raw?: unknown; urlencoded?: unknown; formdata?: unknown; options?: { raw?: { language?: unknown } } } | null;
  if (!b || typeof b !== "object") return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  switch (b.mode) {
    case "raw": {
      const lang = b.options?.raw?.language;
      const isText = typeof lang === "string" && lang !== "json";
      return { bodyType: isText ? "raw" : "json", bodyText: typeof b.raw === "string" ? b.raw : "", bodyRows: blankRow() };
    }
    case "urlencoded":
      return { bodyType: "form", bodyText: "", bodyRows: kvRows(b.urlencoded) };
    case "formdata":
      return { bodyType: "multipart", bodyText: "", bodyRows: formDataRows(b.formdata) };
    default:
      return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  }
}

function readHeaders(list: unknown): RequestRow[] {
  if (!Array.isArray(list) || list.length === 0) return blankRow();
  return list.map((h) => {
    const r = h as { key?: unknown; value?: unknown; disabled?: unknown };
    return { key: String(r?.key ?? ""), value: r?.value != null ? String(r.value) : "", comment: "", enabled: r?.disabled !== true };
  });
}

export function parsePostmanCollection(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  if (!looksLikePostman(data)) throw new Error("Not a Postman v2.1 collection");
  const newId = opts.newId ?? createIdFactory();
  const root = data as { info?: { name?: unknown }; variable?: unknown; item?: unknown };

  const parseItem = (pmItem: unknown): FolderItem | RequestItem | null => {
    if (!pmItem || typeof pmItem !== "object") return null;
    const item = pmItem as { name?: unknown; item?: unknown; request?: any };
    if (Array.isArray(item.item)) {
      return {
        type: "folder",
        id: newId("fld"),
        name: typeof item.name === "string" ? item.name : "Imported Folder",
        items: item.item.map(parseItem).filter(Boolean) as (FolderItem | RequestItem)[],
      };
    }
    if (item.request) {
      const req = item.request;
      const { raw, query } = readUrl(req.url);
      const { authType, authConfig } = authToConfig(req.auth);
      const { bodyType, bodyText, bodyRows } = readBody(req.body);
      return {
        type: "request",
        id: newId("req"),
        name: typeof item.name === "string" ? item.name : "Imported Request",
        description: typeof req.description === "string" ? req.description : "",
        tags: [],
        protocol: "http",
        method: typeof req.method === "string" ? req.method.toUpperCase() : "GET",
        url: raw,
        headersRows: readHeaders(req.header),
        paramsRows: query,
        authType,
        authConfig,
        bodyType,
        bodyText,
        bodyRows,
      };
    }
    return null;
  };

  const variables: Record<string, string> = {};
  if (Array.isArray(root.variable)) {
    for (const v of root.variable) {
      const r = v as { key?: unknown; value?: unknown };
      if (r && r.key != null) variables[String(r.key)] = r.value != null ? String(r.value) : "";
    }
  }

  const collection: Collection = {
    id: newId("col"),
    name: root.info?.name != null ? String(root.info.name) : "Postman Import",
    items: (Array.isArray(root.item) ? root.item : []).map(parseItem).filter(Boolean) as (FolderItem | RequestItem)[],
    ...(Object.keys(variables).length ? { variables } : {}),
  };

  return { collections: [collection], environments: [] };
}
