import { describe, it, expect } from "vitest";
import { AIProviderRegistry, type AIProvider } from "./providerRegistry";

const fake = (id: string): AIProvider => ({
  id,
  defaultModel: "m",
  async chat() {
    return { result: {}, usage: null, model: "m" };
  },
  async listModels() {
    return [];
  },
});

describe("AIProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    AIProviderRegistry.register(fake("test-a"));
    expect(AIProviderRegistry.get("test-a")?.id).toBe("test-a");
    AIProviderRegistry.unregister("test-a");
  });

  it("returns null for an unknown provider", () => {
    expect(AIProviderRegistry.get("nope-xyz")).toBeNull();
  });

  it("throws when a provider lacks an id", () => {
    expect(() => AIProviderRegistry.register({ ...fake(""), id: "" })).toThrow(/id/i);
  });
});
