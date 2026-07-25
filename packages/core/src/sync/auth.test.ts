import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitHubToken, saveGitHubToken, GITHUB_CLIENT_ID } from "./auth";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-auth-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveGitHubToken", () => {
  it("prefers the explicit flag token", () => {
    expect(resolveGitHubToken({ token: "flag", env: { PORTIQ_GITHUB_TOKEN: "env" }, dataDir: tempDir() })).toBe("flag");
  });
  it("falls back to PORTIQ_GITHUB_TOKEN then GITHUB_TOKEN", () => {
    expect(resolveGitHubToken({ env: { PORTIQ_GITHUB_TOKEN: "p" }, dataDir: tempDir() })).toBe("p");
    expect(resolveGitHubToken({ env: { GITHUB_TOKEN: "g" }, dataDir: tempDir() })).toBe("g");
  });
  it("reads config.json githubToken last", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ githubToken: "cfg" }));
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("cfg");
  });
  it("returns null when no token is available", () => {
    expect(resolveGitHubToken({ env: {}, dataDir: tempDir() })).toBeNull();
  });
  it("exposes the desktop OAuth client id for parity", () => {
    expect(GITHUB_CLIENT_ID).toBe("Ov23liWUpjkSkyaC3sBq");
  });
});

describe("saveGitHubToken", () => {
  it("writes githubToken to <dataDir>/config.json and returns the path", () => {
    const dir = tempDir();
    const path = saveGitHubToken("gho_new", { dataDir: dir });
    expect(path).toBe(join(dir, "config.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ githubToken: "gho_new" });
  });

  it("round-trips through resolveGitHubToken with no other precedence set", () => {
    const dir = tempDir();
    saveGitHubToken("gho_roundtrip", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_roundtrip");
  });

  it("preserves unrelated existing keys in config.json", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ someOtherSetting: true }));
    saveGitHubToken("gho_merged", { dataDir: dir });
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual({
      someOtherSetting: true,
      githubToken: "gho_merged",
    });
  });

  it("overwrites a previously saved token", () => {
    const dir = tempDir();
    saveGitHubToken("gho_old", { dataDir: dir });
    saveGitHubToken("gho_new", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_new");
  });

  it("trims whitespace before saving", () => {
    const dir = tempDir();
    saveGitHubToken("  gho_padded  ", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_padded");
  });
});
