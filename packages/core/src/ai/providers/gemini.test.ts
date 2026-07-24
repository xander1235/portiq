import { describe, it, expect } from "vitest";
import { geminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("geminiProvider.chat", () => {
  it("posts to the default model with the api key in the query and JSON mime type", async () => {
    const { fetch, calls } = okFetch({ candidates: [{ content: { parts: [{ text: '{"message":"ok"}' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 6 } });
    const res = await geminiProvider.chat({ systemPrompt: "s", userMessage: "u", format: "json" }, { apiKey: "gk", fetch });
    expect(res.model).toBe(GEMINI_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 2, output: 6 });
    expect(calls[0].url).toContain(`/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent?key=gk`);
    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("s");
  });

  it("throws with the response text on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 400, async text() { return "bad"; }, async json() { return {}; } });
    await expect(geminiProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "gk", fetch })).rejects.toThrow(/bad/);
  });
});

describe("geminiProvider.listModels", () => {
  it("strips the models/ prefix", async () => {
    const { fetch } = okFetch({ models: [{ name: "models/gemini-1.5-flash" }, { name: "models/gemini-1.5-pro" }] });
    expect(await geminiProvider.listModels({ apiKey: "gk", fetch })).toEqual(["gemini-1.5-flash", "gemini-1.5-pro"]);
  });
});
