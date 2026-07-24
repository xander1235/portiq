import {
  assist,
  generateTests as coreGenerateTests,
  listModels as coreListModels,
  summarizeResponse as coreSummarizeResponse,
  type AiConfig,
  type FetchLike,
} from "@portiq/core/ai";
import { SemanticSearch } from "../utils/semanticSearch";
import { safeFetch } from "../utils/safeFetch";

/** Map core's canonical provider URLs back to safeFetch's proxy roots so the
 *  renderer keeps its CORS-bypass / Electron-IPC transport behavior. */
const rendererFetch: FetchLike = (url, init) => {
  const proxied = String(url)
    .replace("https://api.openai.com", "/proxy-openai")
    .replace("https://api.anthropic.com", "/proxy-anthropic")
    .replace("https://generativelanguage.googleapis.com", "/proxy-gemini");
  return safeFetch(proxied, init as any);
};

function toConfig(aiSettings: any): AiConfig {
  const provider = aiSettings?.provider ?? null;
  return {
    provider,
    model: aiSettings?.model ?? null,
    apiKey: provider ? (aiSettings?.keys?.[provider] ?? null) : null,
    keys: aiSettings?.keys ?? {},
    semanticSearchEnabled: Boolean(aiSettings?.semanticSearchEnabled),
    source: "desktop",
  };
}

export async function fetchModels(provider: string, apiKey: string, addLog: (entry: any) => void): Promise<string[]> {
  if (!apiKey) {
    if (addLog) addLog({ source: "AI", type: "info", message: `Skipped fetching models: No API key for ${provider}` });
    return [];
  }
  try {
    return await coreListModels({
      config: { provider, model: null, apiKey, keys: { [provider]: apiKey } as any, semanticSearchEnabled: false, source: "desktop" },
      fetch: rendererFetch,
    });
  } catch (error: any) {
    console.warn(`Could not fetch models for ${provider}:`, error);
    return [];
  }
}

export async function generateRequestFromPrompt(
  prompt: string,
  currentState: any,
  collections: any[],
  aiSettings: any,
  activeAiSessionId: string,
  aiChatSessions: any[],
  responseData: any = null,
) {
  return assist(
    { prompt, currentState, collections, responseData, activeSessionId: activeAiSessionId, chatSessions: aiChatSessions },
    { config: toConfig(aiSettings), fetch: rendererFetch, semanticSearch: async (p) => (await SemanticSearch.search(p)) || [] },
  );
}

export async function generateTestsFromResponse(request: any, response: any, aiSettings: any) {
  return coreGenerateTests(request, response, { config: toConfig(aiSettings), fetch: rendererFetch });
}

export async function summarizeResponse(response: any) {
  return coreSummarizeResponse(response);
}
