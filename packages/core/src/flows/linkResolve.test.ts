import { describe, it, expect } from "vitest";
import { resolveStepConfig, savedRequestToConfig } from "./linkResolve";
import type { RequestConfig } from "./types";

const saved: Record<string, RequestConfig> = {
  r1: { method: "POST", url: "https://api/login", headers: '{"Accept":"application/json"}', body: "{}", params: "", pathVars: "" },
};
const lookup = (id: string) => saved[id];

describe("resolveStepConfig", () => {
  it("uses inline config when unlinked", () => {
    const { config, brokenLink } = resolveStepConfig(
      { overrides: {}, inlineConfig: { ...saved.r1, url: "https://inline" } }, lookup);
    expect(brokenLink).toBe(false);
    expect(config.url).toBe("https://inline");
  });
  it("resolves a live link and applies overrides", () => {
    const { config, brokenLink } = resolveStepConfig(
      { linkedRequestId: "r1", overrides: { headers: '{"Authorization":"Bearer x"}' } }, lookup);
    expect(brokenLink).toBe(false);
    expect(config.url).toBe("https://api/login");         // from link
    expect(config.headers).toBe('{"Authorization":"Bearer x"}'); // overridden
    expect(config.method).toBe("POST");                    // link untouched field
  });
  it("flags a broken link", () => {
    const { config, brokenLink } = resolveStepConfig({ linkedRequestId: "gone", overrides: {} }, lookup);
    expect(brokenLink).toBe(true);
    expect(config.method).toBe("GET"); // falls back to empty config
  });
});

describe("savedRequestToConfig", () => {
  it("maps app request fields to RequestConfig", () => {
    const cfg = savedRequestToConfig({ method: "PUT", url: "u", bodyText: "b" });
    expect(cfg.method).toBe("PUT");
    expect(cfg.url).toBe("u");
    expect(cfg.body).toBe("b");
  });
});
