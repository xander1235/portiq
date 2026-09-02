import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Collection, Environment, FolderItem, RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { withEntityRetry, newId } from "../store/write";
import { parseDagGraph, rejectPrototypeKeys } from "./dagGraphSchema";

const MUTATES = { readOnlyHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

function findRequest(collections: Collection[], id: string): RequestItem | undefined {
  const walk = (items: (FolderItem | RequestItem)[]): RequestItem | undefined => {
    for (const it of items) {
      if (it.type === "request" && it.id === id) return it;
      if (it.type === "folder") {
        const hit = walk(it.items);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const c of collections) {
    const hit = walk(c.items ?? []);
    if (hit) return hit;
  }
  return undefined;
}

function makeRequestItem(args: { name: string; method: string; url: string; protocol?: string; headers?: Record<string, string>; body?: string; bodyType?: string; dagGraph?: unknown }): RequestItem {
  return {
    type: "request", id: newId("req"), name: args.name, description: "", tags: [],
    protocol: args.protocol || "http", method: args.method, url: args.url,
    bodyType: args.bodyType || (args.body ? "raw" : "none"), bodyText: args.body ?? "",
    headersRows: Object.entries(args.headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
    ...(args.dagGraph ? { dagGraph: args.dagGraph as RequestItem["dagGraph"] } : {}),
  };
}

const requestFields = {
  collectionId: z.string(),
  name: z.string(),
  method: z.string(),
  url: z.string(),
  protocol: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  bodyType: z.string().optional(),
  dagGraph: z.unknown().optional(),
};

/** Parse a raw dagGraph argument (already zod-stripped to unknown) and return
 *  a validated graph, or surface a descriptive error for the tool result. */
function takeDagGraph(raw: unknown): { ok: true; dagGraph?: RequestItem["dagGraph"] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const protoHit = rejectPrototypeKeys(raw);
  if (protoHit) return { ok: false, message: `Disallowed key at '${protoHit}'` };
  const res = parseDagGraph(raw);
  if ("error" in res) return { ok: false, message: res.error };
  return { ok: true, dagGraph: res.graph };
}

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Whitelisted patchable request fields — never a free-form record, so a
 *  hostile `__proto__`/`constructor` key cannot pollute the item. */
const requestPatchSchema = z
  .object({
    name: z.string().optional(),
    method: z.string().optional(),
    url: z.string().optional(),
    protocol: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    bodyType: z.string().optional(),
    dagGraph: z.union([z.unknown(), z.null()]).optional(),
  })
  .strict();

function applyPatch(item: RequestItem, patch: unknown): void {
  // zod's strict() strips unknown keys instead of failing, so reject dangerous
  // keys on the raw input first (JSON wire payloads carry __proto__ as an own key).
  if (patch && typeof patch === "object") {
    for (const key of Object.keys(patch as object)) {
      if (PROTOTYPE_KEYS.has(key)) throw new Error(`Disallowed patch key '${key}'`);
    }
  }
  const clean = requestPatchSchema.parse(patch);
  const dag = takeDagGraph(clean.dagGraph);
  if (!dag.ok) throw new Error(dag.message);
  if (dag.dagGraph === undefined && clean.dagGraph === null) {
    // explicit null clears the graph (turns the flow back into a plain request)
    delete item.dagGraph;
  } else if (dag.dagGraph) {
    item.dagGraph = dag.dagGraph;
    if (!clean.protocol) item.protocol = "dag";
  }
  delete (clean as { dagGraph?: unknown }).dagGraph;
  Object.assign(item, clean, { type: "request", id: item.id });
}

export function registerWriteTools(server: McpServer, ctx: ServerContext): void {
  const registered = [
    server.registerTool(
      "create_request",
      { title: "Create request", description: "Add a new request to a collection. Pass dagGraph (version 2, nodes/edges/positions) to author a DAG flow; protocol is set to \"dag\" automatically.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const dag = takeDagGraph(args.dagGraph);
          if (!dag.ok) return errorToolResult(dag.message);
          const item = makeRequestItem({ ...args, dagGraph: dag.dagGraph });
          if (dag.dagGraph) item.protocol = "dag";
          withEntityRetry(() => {
            const { collection, version } = ctx.store.entities.getCollection(args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            (collection.items ??= []).push(item);
            ctx.store.entities.upsertCollection(collection, version);
          });
          return jsonToolResult(item);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "update_request",
      {
        title: "Update request",
        description: "Patch fields of an existing request by id.",
        inputSchema: { id: z.string(), patch: z.record(z.string(), z.unknown()) },
        annotations: DESTRUCTIVE,
      },
      async ({ id, patch }) => {
        try {
          let updated: RequestItem | null = null;
          withEntityRetry(() => {
            for (const meta of ctx.store.collections()) {
              const fresh = ctx.store.entities.getCollection(meta.id);
              if (!fresh.collection) continue;
              const item = findRequest([fresh.collection], id);
              if (!item) continue;
              applyPatch(item, patch);
              ctx.store.entities.upsertCollection(fresh.collection, fresh.version);
              updated = item;
              return;
            }
            throw new Error(`Request '${id}' not found`);
          });
          return jsonToolResult(updated);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "delete_request",
      { title: "Delete request", description: "Remove a request from its collection by id.", inputSchema: { id: z.string() }, annotations: DESTRUCTIVE },
      async ({ id }) => {
        try {
          withEntityRetry(() => {
            for (const meta of ctx.store.collections()) {
              const fresh = ctx.store.entities.getCollection(meta.id);
              if (!fresh.collection) continue;
              let found = false;
              const prune = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
                items.filter((it) => {
                  if (it.type === "request" && it.id === id) { found = true; return false; }
                  if (it.type === "folder") it.items = prune(it.items);
                  return true;
                });
              fresh.collection.items = prune(fresh.collection.items ?? []);
              if (found) { ctx.store.entities.upsertCollection(fresh.collection, fresh.version); return; }
            }
            throw new Error(`Request '${id}' not found`);
          });
          return jsonToolResult({ deleted: true, id });
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "create_collection",
      { title: "Create collection", description: "Create a new empty collection.", inputSchema: { name: z.string() }, annotations: MUTATES },
      async ({ name }) => {
        try {
          const collection: Collection = { id: newId("col"), name, items: [] };
          withEntityRetry(() => ctx.store.entities.upsertCollection(collection));
          return jsonToolResult(collection);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "set_environment_variable",
      {
        title: "Set environment variable",
        description: "Create or update a variable in an environment.",
        inputSchema: { envId: z.string(), key: z.string(), value: z.string() },
        annotations: DESTRUCTIVE,
      },
      async ({ envId, key, value }) => {
        try {
          let target: Environment | null = null;
          withEntityRetry(() => {
            const { environment, version } = ctx.store.entities.getEnvironment(envId);
            if (!environment) throw new Error(`Environment '${envId}' not found`);
            const existing = (environment.vars ??= []).find((v) => v.key === key);
            if (existing) existing.value = value;
            else environment.vars.push({ key, value, comment: "", enabled: true });
            ctx.store.entities.upsertEnvironment(environment, version);
            target = environment;
          });
          return jsonToolResult(target);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),

    server.registerTool(
      "save_ad_hoc_as_request",
      { title: "Save ad-hoc request", description: "Persist an ad-hoc request into a collection. Accepts the same fields as create_request, including dagGraph for flows.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const dag = takeDagGraph(args.dagGraph);
          if (!dag.ok) return errorToolResult(dag.message);
          const item = makeRequestItem({ ...args, dagGraph: dag.dagGraph });
          if (dag.dagGraph) item.protocol = "dag";
          withEntityRetry(() => {
            const { collection, version } = ctx.store.entities.getCollection(args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            (collection.items ??= []).push(item);
            ctx.store.entities.upsertCollection(collection, version);
          });
          return jsonToolResult(item);
        } catch (err) {
          return errorToolResult((err as Error).message);
        }
      }
    ),
  ];

  if (!ctx.config.allowWrites) {
    for (const tool of registered) tool.disable();
  }
}
