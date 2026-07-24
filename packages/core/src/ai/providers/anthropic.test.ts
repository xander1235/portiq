import { describe, it, expect, vi } from "vitest";
import { anthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./anthropic";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("anthropicProvider.chat", () => {
  it("defaults to the current model id and sends the version + key headers", async () => {
    const { fetch, calls } = okFetch({ content: [{ text: '{"message":"ok","operations":[]}' }], usage: { input_tokens: 10, output_tokens: 5 } });
    const res = await anthropicProvider.chat({ systemPrompt: "sys", userMessage: "hi", format: "json" }, { apiKey: "k", fetch });
    expect(res.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 10, output: 5 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(2000);
    expect(calls[0].init.headers["x-api-key"]).toBe("k");
    expect(calls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].url).toContain("api.anthropic.com/v1/messages");
  });

  it("throws with the response text on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 401, async text() { return "bad key"; }, async json() { return {}; } });
    await expect(anthropicProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "k", fetch })).rejects.toThrow(/Anthropic Error: bad key/);
  });
});

describe("anthropicProvider.listModels", () => {
  it("returns only entries of type 'model'", async () => {
    const { fetch } = okFetch({ data: [{ id: "claude-opus-4-8", type: "model" }, { id: "other", type: "not" }] });
    expect(await anthropicProvider.listModels({ apiKey: "k", fetch })).toEqual(["claude-opus-4-8"]);
  });
});
