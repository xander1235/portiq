import { assist, generateTests, listModels, type AssistDeps } from "../assist";
import { AiConfigError } from "../config";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  handler(args: any): Promise<McpToolResult>;
}

export interface AiMcpDeps extends AssistDeps {
  /** Supplied by the Phase 1 MCP scaffold from its store (read access). */
  getCollections: () => any[] | Promise<any[]>;
}

function text(s: string): McpToolResult {
  return { content: [{ type: "text", text: s }] };
}

function toError(e: unknown): McpToolResult {
  const message = e instanceof AiConfigError || e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createAiMcpTools(deps: AiMcpDeps): McpToolDescriptor[] {
  const assistDeps: AssistDeps = { config: deps.config, configOptions: deps.configOptions, fetch: deps.fetch, semanticSearch: deps.semanticSearch, registry: deps.registry, log: deps.log };

  return [
    {
      name: "ai_assist",
      description: "Ask the AI assistant to analyze the library and suggest operations (read-only: returns a message plus suggested operations; does not mutate the library).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Natural-language instruction or question." },
          currentRequest: { type: "object", description: "Optional active request state (protocol/method/url/headersText/bodyText/graphqlConfig)." },
          responseData: { type: "object", description: "Optional last response (status/statusText/headers/body)." },
        },
        required: ["prompt"],
      },
      async handler(args: any): Promise<McpToolResult> {
        try {
          const collections = await deps.getCollections();
          const res = await assist(
            { prompt: args.prompt, collections, currentState: args.currentRequest, responseData: args.responseData ?? null },
            assistDeps,
          );
          return text(JSON.stringify({ message: res.message, operations: res.operations, model: res._model }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
    {
      name: "ai_generate_tests",
      description: "Generate pm.test() assertions for a request/response pair (read-only).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: "object",
        properties: {
          request: { type: "object", description: "Request object (method/url)." },
          response: { type: "object", description: "Response object (status/body)." },
        },
        required: ["request", "response"],
      },
      async handler(args: any): Promise<McpToolResult> {
        try {
          const tests = await generateTests(args.request, args.response, assistDeps);
          return text(JSON.stringify({ tests }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
    {
      name: "ai_list_models",
      description: "List available models for the configured AI provider (read-only).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: { type: "object", properties: {} },
      async handler(): Promise<McpToolResult> {
        try {
          const models = await listModels(assistDeps);
          return text(JSON.stringify({ models }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
  ];
}
