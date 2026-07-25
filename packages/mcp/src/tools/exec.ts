import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveVars, type FolderItem, type RequestItem, type GrpcConfig } from "@portiq/core";
import type { ServerContext } from "../context";
import { jsonToolResult, errorToolResult } from "../util/mcpJson";
import { runRequestItem } from "../exec/run";
import { runSavedFlow } from "../exec/flow";
import { resolveEnvironment } from "../exec/env";
import { makeHostGuard } from "../hostPolicy";

const EXECUTES = { readOnlyHint: false } as const;
const varsSchema = z.record(z.string(), z.string()).optional();

function collectionRequests(ctx: ServerContext, collectionId: string): RequestItem[] {
  const collection = ctx.store.collections().find((c) => c.id === collectionId);
  if (!collection) return [];
  const out: RequestItem[] = [];
  const walk = (items: (FolderItem | RequestItem)[]) => {
    for (const it of items) {
      if (it.type === "request") out.push(it);
      else if (it.type === "folder") walk(it.items);
    }
  };
  walk(collection.items ?? []);
  return out;
}

export function registerExecTools(server: McpServer, ctx: ServerContext): void {
  const hostGuard = makeHostGuard(ctx.hostPolicy);

  server.registerTool(
    "run_request",
    {
      title: "Run saved request",
      description: "Execute a saved request by id (with optional environment + variable overrides) and run its tests.",
      inputSchema: { id: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ id, env, vars }) => {
      const item = ctx.store.flattenRequests().find((r) => r.id === id);
      if (!item) return errorToolResult(`Request '${id}' not found`);
      try {
        return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars, hostGuard }));
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "run_ad_hoc_request",
    {
      title: "Run ad-hoc request",
      description: "Execute an inline request (http, graphql, or grpc) that is not saved to the library.",
      inputSchema: {
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        bodyType: z.string().optional(),
        protocol: z.string().optional(),
        // gRPC-only fields (used when protocol === "grpc"): method=RPC name, url=target, headers=metadata, body=request JSON.
        service: z.string().optional(),
        protoContent: z.string().optional(),
        protoPath: z.string().optional(),
        callType: z.enum(["UNARY", "SERVER_STREAM", "CLIENT_STREAM", "BIDI_STREAM"]).optional(),
        deadline: z.number().optional(),
        tls: z.boolean().optional(),
        messages: z.array(z.string()).optional(),
        useReflection: z.boolean().optional(),
        rootCertsPem: z.string().optional(),
        clientCertPem: z.string().optional(),
        clientKeyPem: z.string().optional(),
        callToken: z.string().optional(),
        env: z.string().optional(),
        vars: varsSchema,
      },
      annotations: EXECUTES,
    },
    async (args) => {
      const { method, url, headers, body, bodyType, protocol, env, vars } = args;
      const proto = (protocol || "http").toLowerCase();
      const item: RequestItem = {
        type: "request", id: "ad-hoc", name: "ad-hoc", description: "", tags: [],
        protocol: proto, method, url,
        bodyType: bodyType || (body ? "raw" : "none"), bodyText: body ?? "",
        headersRows: Object.entries(headers ?? {}).map(([key, value]) => ({ key, value, comment: "", enabled: true })),
      };
      if (proto === "grpc") {
        const grpcConfig: GrpcConfig = {
          service: args.service ?? "", method,
          requestBody: body ?? "{}",
          metadata: headers ?? {},
          callType: args.callType ?? "UNARY",
          deadline: args.deadline, tls: args.tls,
          protoContent: args.protoContent, protoPath: args.protoPath,
          messages: args.messages,
          useReflection: args.useReflection,
          tlsConfig: (args.rootCertsPem || args.clientCertPem || args.clientKeyPem)
            ? { rootCertsPem: args.rootCertsPem, clientCertPem: args.clientCertPem, clientKeyPem: args.clientKeyPem }
            : undefined,
          callToken: args.callToken,
        };
        item.grpcConfig = grpcConfig;
      }
      try {
        return jsonToolResult(await runRequestItem(item, { transport: ctx.transport, env: resolveEnvironment(ctx, env), vars, hostGuard }));
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    "run_collection",
    {
      title: "Run collection",
      description: "Execute every request in a collection (sharing one variable context) and return a test summary.",
      inputSchema: { collectionId: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ collectionId, env, vars }) => {
      const requests = collectionRequests(ctx, collectionId);
      if (requests.length === 0) return errorToolResult(`Collection '${collectionId}' has no requests or does not exist`);
      const environment = resolveEnvironment(ctx, env);
      const shared = resolveVars(environment, vars); // shared across requests for chaining via pm.environment.set
      const results: Array<{ id: string; name: string; tests: unknown; error?: string }> = [];
      const totals = { passed: 0, failed: 0, errored: 0 };
      for (const item of requests) {
        try {
          const { tests } = await runRequestItem(item, { transport: ctx.transport, env: environment, vars: shared, hostGuard });
          totals.passed += tests.passed;
          totals.failed += tests.failed;
          totals.errored += tests.errored;
          results.push({ id: item.id, name: item.name, tests });
        } catch (err) {
          totals.errored += 1;
          results.push({ id: item.id, name: item.name, tests: null, error: (err as Error).message });
        }
      }
      return jsonToolResult({ requests: results, totals });
    }
  );

  server.registerTool(
    "run_flow",
    {
      title: "Run flow",
      description: "Execute a saved flow (a request carrying a dagGraph) and return the per-step results.",
      inputSchema: { id: z.string(), env: z.string().optional(), vars: varsSchema },
      annotations: EXECUTES,
    },
    async ({ id, env, vars }) => {
      const item = ctx.store.flattenRequests().find((r) => r.id === id);
      if (!item) return errorToolResult(`Request '${id}' not found`);
      if (!item.dagGraph) return errorToolResult(`Request '${id}' is not a flow (no dagGraph)`);
      const environment = resolveEnvironment(ctx, env);
      try {
        const steps = await runSavedFlow(item.dagGraph, {
          transport: ctx.transport,
          env: resolveVars(environment, vars),
          lookupRequest: (rid) => ctx.store.flattenRequests().find((r) => r.id === rid),
          hostGuard,
        });
        return jsonToolResult(steps);
      } catch (err) {
        return errorToolResult((err as Error).message);
      }
    }
  );
}
