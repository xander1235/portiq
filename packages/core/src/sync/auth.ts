import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir, type ResolveDataDirOptions } from "../store/dataDir";

/** Kept identical to the renderer's localStorage key and OAuth app for parity. */
export const GITHUB_TOKEN_KEY = "ui_github_token";
export const GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq";

export interface ResolveTokenOptions extends ResolveDataDirOptions {
  token?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Headless credential sourcing. Precedence:
 *   --token flag → PORTIQ_GITHUB_TOKEN → GITHUB_TOKEN → <dataDir>/config.json .githubToken
 * The interactive OAuth device-code flow is desktop-only and NOT sourced here.
 */
export function resolveGitHubToken(opts: ResolveTokenOptions = {}): string | null {
  const env = opts.env ?? process.env;
  if (opts.token && opts.token.trim()) return opts.token.trim();
  if (env.PORTIQ_GITHUB_TOKEN && env.PORTIQ_GITHUB_TOKEN.trim()) return env.PORTIQ_GITHUB_TOKEN.trim();
  if (env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()) return env.GITHUB_TOKEN.trim();

  const configPath = join(resolveDataDir(opts), "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      if (cfg && typeof cfg.githubToken === "string" && cfg.githubToken.trim()) return cfg.githubToken.trim();
    } catch {
      // ignore malformed config
    }
  }
  return null;
}
