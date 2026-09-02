import { describe, it, expect } from "vitest";
import { AIProviderRegistry } from "./index";

describe("@portiq/core/ai registration", () => {
  it("registers openai, anthropic, and gemini providers on import", () => {
    expect(AIProviderRegistry.get("openai")?.id).toBe("openai");
    expect(AIProviderRegistry.get("anthropic")?.id).toBe("anthropic");
    expect(AIProviderRegistry.get("gemini")?.id).toBe("gemini");
  });

  it("lists all three built-in provider ids", () => {
    const ids = AIProviderRegistry.getIds();
    expect(ids).toEqual(expect.arrayContaining(["openai", "anthropic", "gemini"]));
  });
});
