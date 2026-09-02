import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir, type ResolveDataDirOptions } from "../store/dataDir";
import { isEncrypted, type Encryptor } from "../store/keystoreTypes";
import { createLocalEncryptor } from "../store/keystore";

/** Kept identical to the renderer's localStorage key and OAuth app for parity. */
export const GITHUB_TOKEN_KEY = "ui_github_token";
export const GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq";

export interface ResolveTokenOptions extends ResolveDataDirOptions {
  token?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected encryptor (desktop safeStorage); falls back to the local keyfile encryptor. */
  encryptor?: Encryptor;
}

/**
 * Headless credential sourcing. Precedence:
 *   --token flag → PORTIQ_GITHUB_TOKEN → GITHUB_TOKEN → <dataDir>/config.json .githubToken
 * The interactive OAuth device-code flow is desktop-only and NOT sourced here.
 *
 * config.json's githubToken may be `enc:v1:`-tagged (written by saveGitHubToken())
 * or plaintext (legacy, or hand-edited) — both are supported. If decryption fails
 * (lost/rotated keyfile, tampered ciphertext), the token is treated as absent and
 * this falls through to the "no token" result rather than throwing, since a
 * headless credential lookup must never crash the caller.
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
      if (cfg && typeof cfg.githubToken === "string" && cfg.githubToken.trim()) {
        const raw = cfg.githubToken.trim();
        if (isEncrypted(raw)) {
          try {
            const enc = opts.encryptor?.available ? opts.encryptor : createLocalEncryptor(opts);
            return enc.decrypt(raw);
          } catch {
            // Lost/rotated keyfile or tampered ciphertext: degrade to "no token
            // in config.json" — config.json is the lowest-precedence source, so
            // there is nothing further to fall through to except `null` below.
            return null;
          }
        }
        return raw;
      }
    } catch {
      // ignore malformed config
    }
  }
  return null;
}

/**
 * Write-side counterpart of resolveGitHubToken()'s config.json read. Read-
 * merge-write so any other keys already in config.json survive (mirrors
 * ../ai/configStore.ts's saveAiConfig() merge behavior, just for a plain
 * JSON file instead of the kv store — resolveGitHubToken() only ever reads
 * config.json, never the kv store, so this stays a plain file write).
 * The token is encrypted at rest (`enc:v1:`-tagged) via the injected
 * encryptor (desktop safeStorage) or the local keyfile fallback (headless
 * CLI/MCP) — matching the AI-credential keystore in ../ai/configStore.ts.
 * Returns the absolute config.json path that was written, for CLI messaging.
 */
export function saveGitHubToken(token: string, opts: ResolveTokenOptions = {}): string {
  const enc = opts.encryptor?.available ? opts.encryptor : createLocalEncryptor(opts);
  const configPath = join(resolveDataDir(opts), "config.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch {
      // malformed config.json — overwrite rather than fail the login.
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ ...existing, githubToken: enc.encrypt(token.trim()) }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
  // mode only applies on creation; tighten any pre-existing looser file too.
  try { chmodSync(configPath, 0o600); } catch { /* ignore */ }
  return configPath;
}
