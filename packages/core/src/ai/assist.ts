import { AIProviderRegistry, type ProviderContext, type FetchLike } from "./providerRegistry";
import { resolveAiConfig, requireApiKey, AiConfigError, type AiConfig, type AiConfigOptions } from "./config";
import { searchRequestsContext, flattenCollections, buildResponseContext, buildCollectionContext } from "./context";
import { buildAssistSystemPrompt, buildTestsSystemPrompt, buildTestsUserMessage, type AssistPromptContext } from "./prompts";

const defaultFetch: FetchLike = (url, init) => (globalThis.fetch as any)(url, init);

export interface AssistInput {
  prompt: string;
  collections: any[];
  currentState?: AssistPromptContext["currentState"];
  responseData?: any;
  activeSessionId?: string | null;
  chatSessions?: { id: string; timestamp: number }[];
}

export interface AssistDeps {
  /** Pre-resolved config; else resolveAiConfig(configOptions) is used. */
  config?: AiConfig;
  configOptions?: AiConfigOptions;
  fetch?: FetchLike;
  semanticSearch?: (prompt: string) => Promise<{ id: string }[]>;
  registry?: typeof AIProviderRegistry;
  log?: (entry: any) => void;
}

export interface AssistResult {
  message: string;
  operations: any[];
  _usage: { input: number; output: number } | null;
  _model: string;
}

function providerCtx(config: AiConfig, deps: AssistDeps): { chat: (req: any) => Promise<any>; listModels: () => Promise<string[]> } {
  const { provider, apiKey } = requireApiKey(config);
  const registry = deps.registry ?? AIProviderRegistry;
  const p = registry.get(provider);
  if (!p) throw new AiConfigError(`Unknown AI provider "${provider}"`);
  const ctx: ProviderContext = { apiKey, fetch: deps.fetch ?? defaultFetch, log: deps.log };
  return {
    chat: (req) => p.chat(req, ctx),
    listModels: () => p.listModels(ctx),
  };
}

export async function assist(input: AssistInput, deps: AssistDeps = {}): Promise<AssistResult> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  const { chat } = providerCtx(config, deps);

  let relevant = searchRequestsContext(input.prompt, input.collections);
  if (config.semanticSearchEnabled && deps.semanticSearch) {
    try {
      const sem = await deps.semanticSearch(input.prompt);
      if (sem && sem.length > 0) {
        const flat = flattenCollections(input.collections);
        const semObjs = sem.map((s) => flat.find((r: any) => r.id === s.id)).filter(Boolean);
        relevant = [...semObjs, ...relevant].filter((v: any, i, a) => a.findIndex((v2: any) => v2.id === v.id) === i).slice(0, 10);
      }
    } catch {
      // Fall back to fuzzy-only results.
    }
  }

  const sessionContext: any = {};
  if (config.provider === "openai" && input.activeSessionId) {
    sessionContext.conversation_id = input.activeSessionId;
  } else if (config.provider === "gemini" && input.chatSessions && input.chatSessions.length > 0) {
    const sorted = [...input.chatSessions].sort((a, b) => b.timestamp - a.timestamp);
    sessionContext.past_conversation_ids = sorted.slice(0, 5).map((s) => s.id);
  }

  const systemPrompt = buildAssistSystemPrompt({
    currentState: input.currentState ?? {},
    responseContext: buildResponseContext(input.responseData ?? null),
    collectionContext: buildCollectionContext(input.collections),
    relevantRequests: relevant,
  });

  const { result, usage, model } = await chat({
    model: config.model ?? undefined,
    systemPrompt,
    userMessage: input.prompt,
    format: "json",
    sessionContext,
  });

  const operations = Array.isArray(result?.operations) ? result.operations : [];
  for (const op of operations) {
    if (op?.type === "SUGGEST_ENDPOINTS" && op.payload && op.payload.endpointIds) {
      op.payload.endpoints = [];
      for (const id of op.payload.endpointIds) {
        const found = relevant.find((r: any) => r.id === id);
        if (found) op.payload.endpoints.push(found);
      }
    }
  }

  return { message: result?.message ?? "", operations, _usage: usage, _model: model };
}

export async function generateTests(request: any, response: any, deps: AssistDeps = {}): Promise<string[]> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  if (config.provider && config.apiKey) {
    try {
      const { chat } = providerCtx(config, deps);
      const { result } = await chat({
        model: config.model ?? undefined,
        systemPrompt: buildTestsSystemPrompt(),
        userMessage: buildTestsUserMessage(request, response),
        format: "json",
      });
      if (result && Array.isArray(result.tests)) return result.tests;
    } catch {
      // Fall through to non-LLM defaults.
    }
  }
  const status = response?.status || 200;
  return [
    `pm.test("status is ${status}", () => pm.response.to.have.status(${status}));`,
    `pm.test("response has body", () => pm.response.text().length > 0);`,
  ];
}

export async function listModels(deps: AssistDeps = {}): Promise<string[]> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  const { listModels: list } = providerCtx(config, deps);
  return list();
}
