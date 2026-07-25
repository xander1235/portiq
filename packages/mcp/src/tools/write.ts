import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Collection, Environment, FolderItem, RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { withEntityRetry, newId } from "../store/write";

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

function makeRequestItem(args: { name: string; method: string; url: string; protocol?: string; headers?: Record<string, string>; body?: string; bodyType?: string }): RequestItem {
  return {
    type: "request", id: newId("req"), name: args.name, description: "", tags: [],
    protocol: args.protocol || "http", method: args.method, url: args.url,
    bodyType: args.bodyType || (args.body ? "raw" : "none"), bodyText: args.body ?? "",
    headersRows: Object.entries(args.headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
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
};

export function registerWriteTools(server: McpServer, ctx: ServerContext): void {
  const registered = [
    server.registerTool(
      "create_request",
      { title: "Create request", description: "Add a new request to a collection.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const item = makeRequestItem(args);
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
              Object.assign(item, patch, { type: "request", id });
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
      { title: "Save ad-hoc request", description: "Persist an ad-hoc request into a collection.", inputSchema: requestFields, annotations: MUTATES },
      async (args) => {
        try {
          const item = makeRequestItem(args);
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
