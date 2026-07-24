import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEffectiveDataDir, loadConfig, saveConfig, resolveConfigPath } from "./config";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-cli-cfg-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveEffectiveDataDir", () => {
  it("prefers the --data-dir flag", () => {
    expect(resolveEffectiveDataDir({ dataDir: "/flag" }, { PORTIQ_DATA_DIR: "/env" }, { dataDir: "/cfg" }))
      .toBe("/flag");
  });
  it("falls back to PORTIQ_DATA_DIR next", () => {
    expect(resolveEffectiveDataDir({}, { PORTIQ_DATA_DIR: "/env" }, { dataDir: "/cfg" })).toBe("/env");
  });
  it("falls back to config dataDir next", () => {
    expect(resolveEffectiveDataDir({}, {}, { dataDir: "/cfg" })).toBe("/cfg");
  });
  it("falls back to the OS default last (via core resolver)", () => {
    const d = resolveEffectiveDataDir({}, {}, {});
    expect(d.endsWith("Portiq")).toBe(true);
  });
});

describe("config file round-trip", () => {
  it("returns {} for a missing file", () => {
    expect(loadConfig(join(tempDir(), "nope.json"))).toEqual({});
  });
  it("saves and reloads config", () => {
    const p = join(tempDir(), "cli-config.json");
    saveConfig(p, { dataDir: "/x", reporter: "json" });
    expect(loadConfig(p)).toEqual({ dataDir: "/x", reporter: "json" });
  });
});

describe("resolveConfigPath", () => {
  it("ignores PORTIQ_DATA_DIR so config is stable", () => {
    const p = resolveConfigPath({ PORTIQ_DATA_DIR: "/redirected" }, "linux", "/home/u");
    expect(p).toBe("/home/u/.config/Portiq/cli-config.json");
  });
});
