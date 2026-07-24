import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireApiKey, redactKey, AiConfigError, AI_CONFIG_FILE } from "./config";
import { resolveAiConfig, saveAiConfig } from "./configStore";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-ai-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveAiConfig precedence", () => {
  it("honors explicit flags over everything", () => {
    const dir = tempDir();
    writeFileSync(join(dir, AI_CONFIG_FILE), JSON.stringify({ provider: "gemini", keys: { gemini: "file-key" } }));
    const cfg = resolveAiConfig({
      dataDir: dir,
      provider: "anthropic",
      apiKey: "flag-key",
      env: { PORTIQ_AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "env-key" },
    });
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBe("flag-key");
    expect(cfg.source).toBe("flag");
  });

  it("falls back to PORTIQ_AI_* env, then provider-native env", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { PORTIQ_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "native" } });
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBe("native");
    expect(cfg.source).toBe("env:ANTHROPIC_API_KEY");
  });

  it("infers the provider from a lone native env key", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { OPENAI_API_KEY: "sk-x" } });
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("sk-x");
  });

  it("reads a config file when env is empty", () => {
    const dir = tempDir();
    writeFileSync(join(dir, AI_CONFIG_FILE), JSON.stringify({ provider: "gemini", model: "gemini-1.5-pro", keys: { gemini: "gk" }, semanticSearchEnabled: true }));
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.provider).toBe("gemini");
    expect(cfg.model).toBe("gemini-1.5-pro");
    expect(cfg.apiKey).toBe("gk");
    expect(cfg.semanticSearchEnabled).toBe(true);
    expect(cfg.source).toBe("file");
  });

  it("reads the desktop-stored kv setting as the lowest tier and round-trips saveAiConfig", () => {
    const dir = tempDir();
    saveAiConfig({ provider: "openai", model: "gpt-4o-mini", keys: { openai: "kv-key" } }, { dataDir: dir });
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("kv-key");
    expect(cfg.source).toBe("kv");
  });

  it("resolves with no apiKey when nothing is configured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: {} });
    expect(cfg.apiKey).toBeNull();
    expect(cfg.source).toBe("none");
  });
});

describe("requireApiKey", () => {
  it("throws AiConfigError when unconfigured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: {} });
    expect(() => requireApiKey(cfg)).toThrow(AiConfigError);
  });
  it("returns provider + apiKey when configured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { ANTHROPIC_API_KEY: "k" } });
    expect(requireApiKey(cfg)).toEqual({ provider: "anthropic", apiKey: "k" });
  });
});

describe("redactKey", () => {
  it("masks long keys and reports absence", () => {
    expect(redactKey(null)).toBe("(none)");
    expect(redactKey("sk-1234567890")).toBe("sk-1…90");
    expect(redactKey("short")).toBe("****");
  });
});
