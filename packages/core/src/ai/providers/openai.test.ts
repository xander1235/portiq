import { describe, it, expect } from "vitest";
import { openaiProvider, OPENAI_DEFAULT_MODEL } from "./openai";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("openaiProvider.chat", () => {
  it("requests json_object format and defaults the model", async () => {
    const { fetch, calls } = okFetch({ choices: [{ message: { content: '{"message":"ok"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
    const res = await openaiProvider.chat({ systemPrompt: "s", userMessage: "u", format: "json", sessionContext: { conversation_id: "c1" } }, { apiKey: "k", fetch });
    expect(res.model).toBe(OPENAI_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 3, output: 4 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.conversation_id).toBe("c1");
    expect(calls[0].init.headers.Authorization).toBe("Bearer k");
  });

  it("throws on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 500, async text() { return "boom"; }, async json() { return {}; } });
    await expect(openaiProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "k", fetch })).rejects.toThrow(/OpenAI Error: boom/);
  });
});

describe("openaiProvider.listModels", () => {
  it("maps data[].id", async () => {
    const { fetch } = okFetch({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    expect(await openaiProvider.listModels({ apiKey: "k", fetch })).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });
});
