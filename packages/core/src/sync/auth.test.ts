import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitHubToken, GITHUB_CLIENT_ID } from "./auth";

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
