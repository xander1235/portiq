import type { Collection, FolderItem, RequestItem, RequestRow, AuthConfig } from "../model";
import type { ImportedLibrary } from "./types";
import { createIdFactory, type IdFactory } from "./ids";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];
const blankRow = (): RequestRow[] => [{ key: "", value: "", comment: "", enabled: true }];

function defaultAuthConfig(): AuthConfig {
  return {
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", add_to: "header" },
  };
}

export function looksLikeOpenApi(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const v = (data as { openapi?: unknown }).openapi;
  return typeof v === "string" && v.startsWith("3.");
}

/** Resolve a local `#/...` JSON pointer within `doc`; returns `node` unchanged
 *  when it is not a `$ref`. Cycle-guarded; unresolvable pointers yield `{}`. */
function resolveRef(doc: any, node: any, seen: Set<string> = new Set()): any {
  if (node && typeof node === "object" && typeof node.$ref === "string") {
    if (seen.has(node.$ref) || !node.$ref.startsWith("#/")) return {};
    seen.add(node.$ref);
    let cur: any = doc;
    for (const seg of node.$ref.slice(2).split("/")) {
      const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
      cur = cur?.[key];
      if (cur == null) return {};
    }
    return resolveRef(doc, cur, seen);
  }
  return node;
}

function pathToTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function sampleForType(t: unknown): unknown {
  switch (t) {
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}

function schemaExample(schema: any): string {
  if (!schema || typeof schema !== "object") return "";
  if (schema.example !== undefined) return JSON.stringify(schema.example, null, 2);
  if (schema.default !== undefined) return JSON.stringify(schema.default, null, 2);
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries<any>(schema.properties)) {
      const v = raw ?? {};
      obj[k] = v.example !== undefined ? v.example : v.default !== undefined ? v.default : sampleForType(v.type);
    }
    return JSON.stringify(obj, null, 2);
  }
  return "";
}

function paramRows(doc: any, params: any[], where: string): RequestRow[] {
  const rows = (Array.isArray(params) ? params : [])
    .map((p) => resolveRef(doc, p))
    .filter((p) => p && p.in === where && p.name != null)
    .map((p) => ({
      key: String(p.name),
      value:
        p.example != null ? String(p.example) : p.schema && p.schema.default != null ? String(p.schema.default) : "",
      comment: typeof p.description === "string" ? p.description : "",
      enabled: p.required !== false,
    }));
  return rows.length ? rows : blankRow();
}

function propRows(schema: any): RequestRow[] {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return blankRow();
  const rows = Object.keys(props).map((k) => ({ key: k, value: "", comment: "", enabled: true }));
  return rows.length ? rows : blankRow();
}

function readRequestBody(doc: any, requestBody: any): { bodyType: string; bodyText: string; bodyRows: RequestRow[] } {
  const rb = resolveRef(doc, requestBody);
  const content = rb?.content;
  if (!content || typeof content !== "object") return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
  if (content["application/json"]) {
    const media = content["application/json"];
    const text =
      media.example !== undefined ? JSON.stringify(media.example, null, 2) : schemaExample(resolveRef(doc, media.schema));
    return { bodyType: "json", bodyText: text, bodyRows: blankRow() };
  }
  if (content["application/x-www-form-urlencoded"]) {
    return { bodyType: "form", bodyText: "", bodyRows: propRows(resolveRef(doc, content["application/x-www-form-urlencoded"].schema)) };
  }
  if (content["multipart/form-data"]) {
    return { bodyType: "multipart", bodyText: "", bodyRows: propRows(resolveRef(doc, content["multipart/form-data"].schema)) };
  }
  return { bodyType: "none", bodyText: "", bodyRows: blankRow() };
}

function securityToAuth(doc: any, security: any): { authType: string; authConfig: AuthConfig } {
  const authConfig = defaultAuthConfig();
  const schemes = doc?.components?.securitySchemes ?? {};
  const reqs: any[] = Array.isArray(security) ? security : [];
  for (const entry of reqs) {
    const name = entry && typeof entry === "object" ? Object.keys(entry)[0] : undefined;
    if (!name) continue;
    const scheme = resolveRef(doc, schemes[name]);
    if (!scheme || typeof scheme !== "object") continue;
    const kind = String(scheme.scheme ?? "").toLowerCase();
    if (scheme.type === "http" && kind === "bearer") return { authType: "bearer", authConfig };
    if (scheme.type === "http" && kind === "basic") return { authType: "basic", authConfig };
    if (scheme.type === "apiKey") {
      authConfig.api_key = { key: typeof scheme.name === "string" ? scheme.name : "", value: "", add_to: scheme.in === "query" ? "query" : "header" };
      return { authType: "api_key", authConfig };
    }
  }
  return { authType: "none", authConfig };
}

export function parseOpenApi(data: unknown, opts: { newId?: IdFactory } = {}): ImportedLibrary {
  if (!looksLikeOpenApi(data)) throw new Error("Not an OpenAPI 3.x document");
  const newId = opts.newId ?? createIdFactory();
  const doc = data as any;

  const server = Array.isArray(doc.servers) && doc.servers[0] ? doc.servers[0] : undefined;
  const variables: Record<string, string> = {};
  if (server && typeof server.url === "string") variables.baseUrl = pathToTemplate(server.url);
  if (server && server.variables && typeof server.variables === "object") {
    for (const [k, raw] of Object.entries<any>(server.variables)) {
      if (raw && raw.default != null) variables[k] = String(raw.default);
    }
  }

  const foldersByTag = new Map<string, FolderItem>();
  const rootItems: (FolderItem | RequestItem)[] = [];
  const bucketFor = (tag: string): (FolderItem | RequestItem)[] => {
    if (!tag) return rootItems;
    let folder = foldersByTag.get(tag);
    if (!folder) {
      folder = { type: "folder", id: newId("fld"), name: tag, items: [] };
      foldersByTag.set(tag, folder);
      rootItems.push(folder);
    }
    return folder.items;
  };

  const paths = doc.paths && typeof doc.paths === "object" ? doc.paths : {};
  for (const [rawPath, rawPathItem] of Object.entries<any>(paths)) {
    const pathItem = resolveRef(doc, rawPathItem);
    const sharedParams = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const op = pathItem?.[method];
      if (!op || typeof op !== "object") continue;
      const params = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const security = op.security !== undefined ? op.security : doc.security;
      const { authType, authConfig } = securityToAuth(doc, security);
      const { bodyType, bodyText, bodyRows } = readRequestBody(doc, op.requestBody);
      const req: RequestItem = {
        type: "request",
        id: newId("req"),
        name:
          typeof op.summary === "string" && op.summary
            ? op.summary
            : typeof op.operationId === "string" && op.operationId
            ? op.operationId
            : `${method.toUpperCase()} ${rawPath}`,
        description: typeof op.description === "string" ? op.description : "",
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        protocol: "http",
        method: method.toUpperCase(),
        url: (variables.baseUrl ? "{{baseUrl}}" : "") + pathToTemplate(rawPath),
        headersRows: paramRows(doc, params, "header"),
        paramsRows: paramRows(doc, params, "query"),
        authType,
        authConfig,
        bodyType,
        bodyText,
        bodyRows,
      };
      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : "";
      bucketFor(tag).push(req);
    }
  }

  const collection: Collection = {
    id: newId("col"),
    name: doc.info?.title != null ? String(doc.info.title) : "OpenAPI Import",
    items: rootItems,
    ...(Object.keys(variables).length ? { variables } : {}),
  };
  return { collections: [collection], environments: [] };
}
