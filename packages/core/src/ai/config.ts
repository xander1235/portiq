import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir, type ResolveDataDirOptions } from "../store/dataDir";
import { openKvStore, type KvStore } from "../store/kvStore";

export const AI_SETTINGS_KEY = "aiSettings";
export const AI_CONFIG_FILE = "ai.json";

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

export interface AiKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
}

export interface AiConfig {
  provider: string | null;
  model: string | null;
  apiKey: string | null;
  keys: AiKeys;
  semanticSearchEnabled: boolean;
  /** Where provider/apiKey resolved from, for diagnostics. */
  source: string;
}

export interface AiConfigOptions extends ResolveDataDirOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  /** Overrides PORTIQ_AI_CONFIG / <dataDir>/ai.json. */
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Inject a kv store (tests / reuse); else one is opened + closed per call. */
  kv?: KvStore;
}

const NATIVE_KEY_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

function readConfigFile(opts: AiConfigOptions): Partial<AiConfig> | null {
  const env = opts.env ?? process.env;
  const path = opts.configPath ?? env.PORTIQ_AI_CONFIG ?? join(resolveDataDir(opts), AI_CONFIG_FILE);
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Partial<AiConfig>;
  } catch {
    return null;
  }
}

function readKvSettings(opts: AiConfigOptions): Partial<AiConfig> | null {
  let kv = opts.kv;
  let owned = false;
  try {
    if (!kv) {
      kv = openKvStore(opts);
      owned = true;
    }
    const raw = kv.get(AI_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<AiConfig>) : null;
  } catch {
    return null;
  } finally {
    if (owned && kv) kv.close();
  }
}

export function resolveAiConfig(opts: AiConfigOptions = {}): AiConfig {
  const env = opts.env ?? process.env;
  const file = readConfigFile(opts) ?? {};
  const kv = readKvSettings(opts) ?? {};

  // provider: flag -> PORTIQ_AI_PROVIDER -> inferred-from-native-env -> file -> kv
  // (native env is part of the "env" tier, so it must outrank the file/kv tiers below it —
  // matching the DECISION precedence: flag > env > config file > desktop-stored kv.)
  let provider: string | null = opts.provider ?? env.PORTIQ_AI_PROVIDER ?? null;
  if (!provider) {
    for (const [p, names] of Object.entries(NATIVE_KEY_ENV)) {
      if (names.some((n) => env[n])) {
        provider = p;
        break;
      }
    }
  }
  provider = provider ?? file.provider ?? kv.provider ?? null;

  // config-file keys outrank desktop-stored kv keys (file is a higher tier).
  const keys: AiKeys = { ...(kv.keys ?? {}), ...(file.keys ?? {}) };
  const model = opts.model ?? env.PORTIQ_AI_MODEL ?? file.model ?? kv.model ?? null;
  const semanticSearchEnabled = Boolean(file.semanticSearchEnabled ?? kv.semanticSearchEnabled ?? false);

  // apiKey: flag -> PORTIQ_AI_API_KEY -> provider-native env -> file keys -> kv keys
  let apiKey: string | null = null;
  let source = "none";
  if (opts.apiKey) {
    apiKey = opts.apiKey;
    source = "flag";
  } else if (env.PORTIQ_AI_API_KEY) {
    apiKey = env.PORTIQ_AI_API_KEY;
    source = "env:PORTIQ_AI_API_KEY";
  } else if (provider && NATIVE_KEY_ENV[provider]?.some((n) => env[n])) {
    const name = NATIVE_KEY_ENV[provider].find((n) => env[n])!;
    apiKey = env[name]!;
    source = `env:${name}`;
  } else if (provider && file.keys?.[provider as keyof AiKeys]) {
    apiKey = file.keys[provider as keyof AiKeys]!;
    source = "file";
  } else if (provider && kv.keys?.[provider as keyof AiKeys]) {
    apiKey = kv.keys[provider as keyof AiKeys]!;
    source = "kv";
  }

  return { provider, model, apiKey, keys, semanticSearchEnabled, source };
}

export function requireApiKey(config: AiConfig): { provider: string; apiKey: string } {
  if (!config.provider || !config.apiKey) {
    throw new AiConfigError(
      "No AI credentials configured. Provide one of: --ai-key flag, PORTIQ_AI_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) env, an ai.json config file, or a desktop-stored AI setting.",
    );
  }
  return { provider: config.provider, apiKey: config.apiKey };
}

export function saveAiConfig(config: Partial<AiConfig>, opts: AiConfigOptions = {}): void {
  const kv = opts.kv ?? openKvStore(opts);
  try {
    const existing = kv.get(AI_SETTINGS_KEY);
    const merged = { ...(existing ? JSON.parse(existing) : {}), ...config };
    kv.set(AI_SETTINGS_KEY, JSON.stringify(merged));
  } finally {
    if (!opts.kv) kv.close();
  }
}

export function redactKey(key: string | null | undefined): string {
  if (!key) return "(none)";
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-2)}`;
}
