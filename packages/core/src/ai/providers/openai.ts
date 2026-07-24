import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const OPENAI_BASE = "https://api.openai.com";

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export const openaiProvider: AIProvider = {
  id: "openai",
  defaultModel: OPENAI_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || OPENAI_DEFAULT_MODEL;
    const body: any = {
      model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userMessage },
      ],
    };
    if (req.format !== "text") body.response_format = { type: "json_object" };
    const sc = req.sessionContext as any;
    if (sc?.conversation_id) body.conversation_id = sc.conversation_id;

    const res = await ctx.fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI Error: ${await res.text()}`);
    const data = await res.json();
    const text = data.choices[0].message.content;
    const usage = data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${OPENAI_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch OpenAI models (${res.status})`);
    const data = await res.json();
    return (data.data || []).map((m: any) => m.id);
  },
};
