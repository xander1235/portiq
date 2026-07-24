import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAiConfig, resolveAiConfig } from "./index";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-ai-tier-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("desktop-stored credential tier", () => {
  it("a desktop write via saveAiConfig is discoverable headlessly and sits below env/flag", () => {
    const dir = tempDir();
    // Desktop app persists settings:
    saveAiConfig({ provider: "gemini", model: "gemini-1.5-flash", keys: { gemini: "desk-key" } }, { dataDir: dir });

    // Headless CLI/MCP with no env/flag resolves the desktop tier:
    const desktop = resolveAiConfig({ dataDir: dir, env: {} });
    expect(desktop.provider).toBe("gemini");
    expect(desktop.apiKey).toBe("desk-key");
    expect(desktop.source).toBe("kv");

    // An env key still wins over the desktop tier:
    const overridden = resolveAiConfig({ dataDir: dir, env: { ANTHROPIC_API_KEY: "env-key" } });
    expect(overridden.provider).toBe("anthropic");
    expect(overridden.apiKey).toBe("env-key");
  });
});
