import { describe, it, expect, vi } from "vitest";
import { assist, generateTests, listModels } from "./assist";
import type { AIProvider } from "./providerRegistry";
import type { AiConfig } from "./config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({
  provider: "anthropic",
  model: null,
  apiKey: "test-key",
  keys: {},
  semanticSearchEnabled: false,
  source: "flag",
  ...over,
});

function stubProvider(id: string, chat: AIProvider["chat"], listModels: AIProvider["listModels"] = async () => []): AIProvider {
  return { id, defaultModel: "m", chat, listModels };
}

const collections = () => [
  { id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List Users", method: "GET", url: "https://x/users" }] },
];

describe("assist", () => {
  it("builds the system prompt from context and returns message + operations", async () => {
    let seenSystem = "";
    const reg = { get: () => stubProvider("anthropic", async (req) => { seenSystem = req.systemPrompt; return { result: { message: "done", operations: [] }, usage: { input: 1, output: 2 }, model: "claude-opus-4-8" }; }) } as any;
    const res = await assist({ prompt: "update the url", collections: collections(), currentState: { method: "GET", url: "https://x" } }, { config: config(), fetch: (async () => ({}) as any), registry: reg });
    expect(res.message).toBe("done");
    expect(res._model).toBe("claude-opus-4-8");
    expect(res._usage).toEqual({ input: 1, output: 2 });
    expect(seenSystem).toContain("# Workspace Collections");
    expect(seenSystem).toContain('"API"');
  });

  it("rehydrates SUGGEST_ENDPOINTS payloads with matched request objects", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { message: "found", operations: [{ type: "SUGGEST_ENDPOINTS", payload: { endpointIds: ["r1"] } }] }, usage: null, model: "m" })) } as any;
    const res = await assist({ prompt: "find list users", collections: collections() }, { config: config(), registry: reg });
    expect(res.operations[0].payload.endpoints[0].id).toBe("r1");
  });

  it("merges injected semantic results when enabled", async () => {
    const semantic = vi.fn(async () => [{ id: "r1" }]);
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { message: "ok", operations: [] }, usage: null, model: "m" })) } as any;
    await assist({ prompt: "zzz no fuzzy match", collections: collections() }, { config: config({ semanticSearchEnabled: true }), semanticSearch: semantic, registry: reg });
    expect(semantic).toHaveBeenCalledWith("zzz no fuzzy match");
  });

  it("throws AiConfigError when no credentials resolve", async () => {
    await expect(assist({ prompt: "x", collections: [] }, { config: config({ apiKey: null, provider: null }) })).rejects.toThrow(/No AI credentials/);
  });
});

describe("generateTests", () => {
  it("returns LLM tests when configured", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { tests: ["pm.test('a', () => {});"] }, usage: null, model: "m" })) } as any;
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 200, body: "{}" }, { config: config(), registry: reg });
    expect(tests).toEqual(["pm.test('a', () => {});"]);
  });

  it("falls back to default tests when unconfigured (AI absent)", async () => {
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 204 }, { config: config({ apiKey: null, provider: null }) });
    expect(tests[0]).toContain("status is 204");
    expect(tests.some((t) => t.includes("response has body"))).toBe(true);
  });

  it("falls back to defaults when the provider throws", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => { throw new Error("network"); }) } as any;
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 200 }, { config: config(), registry: reg });
    expect(tests[0]).toContain("status is 200");
  });
});

describe("listModels", () => {
  it("delegates to the resolved provider", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]) } as any;
    expect(await listModels({ config: config(), registry: reg })).toEqual(["claude-opus-4-8"]);
  });
});
