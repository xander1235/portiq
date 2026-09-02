export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}

/** Minimal fetch shape satisfied by Node's global fetch AND the renderer's
 *  safeFetch polyfill — the seam that keeps this module Electron-free. */
export type FetchLike = (url: string, init?: any) => Promise<FetchLikeResponse>;

export interface AiLogEntry {
  source: string;
  type: string;
  message: string;
  data?: unknown;
}

export interface ProviderContext {
  apiKey: string;
  fetch: FetchLike;
  log?: (entry: AiLogEntry) => void;
}

export interface ChatRequest {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  /** "json" (default) parses the reply via parseLLMJson; "text" returns raw text. */
  format?: "json" | "text";
  sessionContext?: Record<string, unknown> | null;
  maxTokens?: number;
}

export interface ChatResult {
  /** Parsed object when format === "json", else the raw string. */
  result: any;
  usage: { input: number; output: number } | null;
  model: string;
}

export interface AIProvider {
  id: string;
  defaultModel: string;
  chat(req: ChatRequest, ctx: ProviderContext): Promise<ChatResult>;
  listModels(ctx: ProviderContext): Promise<string[]>;
}

class AIProviderRegistryClass {
  private _providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (!provider.id) throw new Error("AIProvider must have an 'id'");
    if (this._providers.has(provider.id)) {
      console.warn(`AI provider "${provider.id}" is already registered. Overwriting.`);
    }
    this._providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this._providers.delete(id);
  }

  get(id: string): AIProvider | null {
    return this._providers.get(id) ?? null;
  }

  getAll(): AIProvider[] {
    return Array.from(this._providers.values());
  }

  getIds(): string[] {
    return Array.from(this._providers.keys());
  }
}

export const AIProviderRegistry = new AIProviderRegistryClass();

export default AIProviderRegistry;
