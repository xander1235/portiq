import { describe, it, expect } from "vitest";
import { createAiCliCommands } from "./cli";
import type { AIProvider } from "../providerRegistry";
import type { AiConfig } from "../config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({ provider: "anthropic", model: null, apiKey: "k", keys: {}, semanticSearchEnabled: false, source: "flag", ...over });
const reg = (chat: AIProvider["chat"], list: AIProvider["listModels"] = async () => []): any => ({ get: () => ({ id: "anthropic", defaultModel: "m", chat, listModels: list }) });
const collections = () => [{ id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List", method: "GET", url: "https://x" }] }];

describe("createAiCliCommands", () => {
  it("exposes a single 'ai' command", () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config() });
    expect(cmds.map((c) => c.name)).toEqual(["ai"]);
  });

  it("assist prints the message and exits 0", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { message: "hello", operations: [] }, usage: null, model: "m" })) });
    const res = await cmds[0].run(["find list"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello");
  });

  it("assist with --json emits a JSON envelope", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { message: "hi", operations: [{ type: "SEND_REQUEST", payload: {} }] }, usage: null, model: "m" })) });
    const res = await cmds[0].run(["do it"], { json: true });
    const parsed = JSON.parse(res.stdout!);
    expect(parsed.message).toBe("hi");
    expect(parsed.operations[0].type).toBe("SEND_REQUEST");
  });

  it("models lists provider models", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]) });
    const res = await cmds[0].run(["models"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("claude-opus-4-8");
  });

  it("tests <ref> resolves+runs via injected runRequest, then generates tests", async () => {
    const runRequest = async () => ({ request: { method: "GET", url: "https://x" }, response: { status: 200, body: "{}" } });
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { tests: ["pm.test('a', () => {});"] }, usage: null, model: "m" })), runRequest });
    const res = await cmds[0].run(["tests", "API/List"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("pm.test('a'");
  });

  it("tests <ref> without a runner is a usage error (exit 3)", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config() });
    const res = await cmds[0].run(["tests", "API/List"], {});
    expect(res.exitCode).toBe(3);
  });

  it("returns a usage error (exit 3) when unconfigured", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config({ apiKey: null, provider: null }) });
    const res = await cmds[0].run(["anything"], {});
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toMatch(/No AI credentials/);
  });
});
