import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseCurl, type Environment, type FolderItem, type RequestItem } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { searchLibrary } from "../search";

const READ_ONLY = { readOnlyHint: true } as const;

const SECRET_KEY_PATTERN = /secret|token|password|passwd|api[_-]?key|auth|cred|private[_-]?key|access[_-]?key|client[_-]?secret/i;

function isSecretVar(v: { key?: string; secret?: boolean }): boolean {
  return !!v.secret || SECRET_KEY_PATTERN.test(v.key ?? "");
}

/** Return an environment with secret-flagged var values masked so credentials
 *  never land in the model's context/logs. */
function maskEnvironment(env: Environment): Environment {
  return {
    ...env,
    vars: (env.vars ?? []).map((v) => (isSecretVar(v) ? { ...v, value: "<SECRET>" } : v)),
  };
}

interface FlatRequest {
  item: RequestItem;
  collectionId: string;
}

function flatten(ctx: ServerContext): FlatRequest[] {
  const out: FlatRequest[] = [];
  const walk = (items: (FolderItem | RequestItem)[], collectionId: string) => {
    for (const it of items) {
      if (it.type === "request") out.push({ item: it, collectionId });
      else if (it.type === "folder") walk(it.items, collectionId);
    }
  };
  for (const c of ctx.store.collections()) walk(c.items ?? [], c.id);
  return out;
}

export function registerReadTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_collections",
    { title: "List collections", description: "List all collections in the library.", inputSchema: {}, annotations: READ_ONLY },
    async () => jsonToolResult(ctx.store.collections().map((c) => ({ id: c.id, name: c.name, itemCount: c.items?.length ?? 0 })))
  );

  server.registerTool(
    "list_requests",
    {
      title: "List requests",
      description: "List saved requests, optionally filtered by collection id.",
      inputSchema: { collectionId: z.string().optional() },
      annotations: READ_ONLY,
    },
    async ({ collectionId }) =>
      jsonToolResult(
        flatten(ctx)
          .filter((f) => !collectionId || f.collectionId === collectionId)
          .map((f) => ({
            id: f.item.id,
            name: f.item.name,
            method: f.item.method,
            url: f.item.url,
            protocol: f.item.protocol,
            collectionId: f.collectionId,
            isFlow: !!f.item.dagGraph,
          }))
      )
  );

  server.registerTool(
    "get_request",
    { title: "Get request", description: "Fetch a full saved request by id.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    async ({ id }) => {
      const found = ctx.store.flattenRequests().find((r) => r.id === id);
      return found ? jsonToolResult(found) : errorToolResult(`Request '${id}' not found`);
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search library",
      description: "Fuzzy/substring search across requests, collections, environments and flows.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().optional() },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => jsonToolResult(searchLibrary(ctx.store.load().state, query, limit))
  );

  server.registerTool(
    "list_environments",
    { title: "List environments", description: "List all environments.", inputSchema: {}, annotations: READ_ONLY },
    async () => jsonToolResult(ctx.store.environments().map((e) => ({ id: e.id, name: e.name, varCount: e.vars?.length ?? 0 })))
  );

  server.registerTool(
    "get_environment",
    { title: "Get environment", description: "Fetch a full environment by id.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    async ({ id }) => {
      const found = ctx.store.environments().find((e) => e.id === id);
      return found ? jsonToolResult(maskEnvironment(found)) : errorToolResult(`Environment '${id}' not found`);
    }
  );

  server.registerTool(
    "import_curl",
    {
      title: "Import cURL (parse only)",
      description: "Parse a curl command into a Portiq request object. Does NOT save.",
      inputSchema: { command: z.string() },
      annotations: READ_ONLY,
    },
    async ({ command }) => {
      try {
        return jsonToolResult(parseCurl(command));
      } catch (err) {
        return errorToolResult(`Failed to parse cURL: ${(err as Error).message}`);
      }
    }
  );
}
