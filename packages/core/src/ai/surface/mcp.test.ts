import { describe, it, expect } from "vitest";
import { createAiMcpTools } from "./mcp";
import type { AIProvider } from "../providerRegistry";
import type { AiConfig } from "../config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({ provider: "anthropic", model: null, apiKey: "k", keys: {}, semanticSearchEnabled: false, source: "flag", ...over });
const provider = (chat: AIProvider["chat"], list: AIProvider["listModels"] = async () => []): any => ({ get: () => ({ id: "anthropic", defaultModel: "m", chat, listModels: list }) });
const collections = () => [{ id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List", method: "GET", url: "https://x" }] }];

describe("createAiMcpTools", () => {
  it("exposes ai_assist / ai_generate_tests / ai_list_models as read-only, open-world tools", () => {
    const tools = createAiMcpTools({ getCollections: collections, config: config() });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["ai_assist", "ai_generate_tests", "ai_list_models"]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.openWorldHint).toBe(true);
      expect(t.annotations.destructiveHint).toBeUndefined();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("ai_assist runs the assistant with the loaded library and returns text", async () => {
    const reg = provider(async () => ({ result: { message: "done", operations: [] }, usage: null, model: "m" }));
    const tools = createAiMcpTools({ getCollections: collections, config: config(), registry: reg });
    const res = await tools[0].handler({ prompt: "find list" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("done");
  });

  it("returns an error result (not a throw) when unconfigured", async () => {
    const tools = createAiMcpTools({ getCollections: collections, config: config({ apiKey: null, provider: null }) });
    const res = await tools[0].handler({ prompt: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/No AI credentials/);
  });

  it("ai_list_models delegates to the provider", async () => {
    const reg = provider(async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]);
    const tools = createAiMcpTools({ getCollections: collections, config: config(), registry: reg });
    const res = await tools[2].handler({});
    expect(res.content[0].text).toContain("claude-opus-4-8");
  });
});
