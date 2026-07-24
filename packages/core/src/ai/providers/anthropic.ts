import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const ANTHROPIC_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 2000;

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-8";

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export const anthropicProvider: AIProvider = {
  id: "anthropic",
  defaultModel: ANTHROPIC_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || ANTHROPIC_DEFAULT_MODEL;
    const res = await ctx.fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: headers(ctx.apiKey),
      body: JSON.stringify({
        model,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.userMessage }],
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic Error: ${await res.text()}`);
    const data = await res.json();
    const text = data.content[0].text;
    const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${ANTHROPIC_BASE}/v1/models`, { headers: headers(ctx.apiKey) });
    if (!res.ok) throw new Error(`Failed to fetch Anthropic models (${res.status})`);
    const data = await res.json();
    return (data.data || []).filter((m: any) => m.type === "model").map((m: any) => m.id);
  },
};
