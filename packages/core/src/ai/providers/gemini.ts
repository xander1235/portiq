import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";

export const GEMINI_DEFAULT_MODEL = "gemini-1.5-flash";

export const geminiProvider: AIProvider = {
  id: "gemini",
  defaultModel: GEMINI_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || GEMINI_DEFAULT_MODEL;
    const body: any = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: req.userMessage }] }],
      generationConfig: { responseMimeType: req.format === "text" ? "text/plain" : "application/json" },
    };
    const past = (req.sessionContext as any)?.past_conversation_ids;
    if (past && past.length > 0) body.past_conversation_ids = past;

    const res = await ctx.fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${ctx.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const text = data.candidates[0].content.parts[0].text;
    const usage = data.usageMetadata
      ? { input: data.usageMetadata.promptTokenCount, output: data.usageMetadata.candidatesTokenCount }
      : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${GEMINI_BASE}/v1beta/models?key=${ctx.apiKey}`);
    if (!res.ok) throw new Error(`Failed to fetch Gemini models (${res.status})`);
    const data = await res.json();
    return (data.models || []).map((m: any) => String(m.name).replace("models/", ""));
  },
};
