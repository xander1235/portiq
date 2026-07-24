import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Collection, Environment, FolderItem, RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { withOptimisticWrite, newId } from "../store/write";

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
          const created = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const collection = state.collections.find((c) => c.id === args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            const item = makeRequestItem(args);
            (collection.items ??= []).push(item);
            return { next: state, result: item };
          });
          return jsonToolResult(created);
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
          const updated = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const item = findRequest(state.collections, id);
            if (!item) throw new Error(`Request '${id}' not found`);
            Object.assign(item, patch, { type: "request", id });
            return { next: state, result: item };
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
          const removed = withOptimisticWrite<boolean>(ctx.store, (state) => {
            let found = false;
            const prune = (items: (FolderItem | RequestItem)[]): (FolderItem | RequestItem)[] =>
              items.filter((it) => {
                if (it.type === "request" && it.id === id) { found = true; return false; }
                if (it.type === "folder") it.items = prune(it.items);
                return true;
              });
            for (const c of state.collections) c.items = prune(c.items ?? []);
            if (!found) throw new Error(`Request '${id}' not found`);
            return { next: state, result: true };
          });
          return jsonToolResult({ deleted: removed, id });
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
          const created = withOptimisticWrite<Collection>(ctx.store, (state) => {
            const collection: Collection = { id: newId("col"), name, items: [] };
            state.collections.push(collection);
            if (!state.activeCollectionId) state.activeCollectionId = collection.id;
            return { next: state, result: collection };
          });
          return jsonToolResult(created);
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
          const env = withOptimisticWrite<Environment>(ctx.store, (state) => {
            const target = state.environments.find((e) => e.id === envId);
            if (!target) throw new Error(`Environment '${envId}' not found`);
            const existing = (target.vars ??= []).find((v) => v.key === key);
            if (existing) existing.value = value;
            else target.vars.push({ key, value, comment: "", enabled: true });
            return { next: state, result: target };
          });
          return jsonToolResult(env);
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
          const created = withOptimisticWrite<RequestItem>(ctx.store, (state) => {
            const collection = state.collections.find((c) => c.id === args.collectionId);
            if (!collection) throw new Error(`Collection '${args.collectionId}' not found`);
            const item = makeRequestItem(args);
            (collection.items ??= []).push(item);
            return { next: state, result: item };
          });
          return jsonToolResult(created);
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
