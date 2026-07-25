// Node-only AI-config resolvers: read from env, an ai.json file, and the
// desktop kv store. Pulls node:fs / node:path / better-sqlite3 (via kvStore),
// so this module MUST NOT be reachable from the renderer bundle. It is exposed
// only through the full "@portiq/core/ai" barrel (Node consumers) and is loaded
// lazily by assist.ts; the renderer-safe ./index.browser.ts excludes it.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "../store/dataDir";
import { openKvStore } from "../store/kvStore";
import { isEncrypted, type Encryptor } from "../store/keystoreTypes";
import { createLocalEncryptor } from "../store/keystore";
import {
  AI_SETTINGS_KEY,
  AI_CONFIG_FILE,
  type AiConfig,
  type AiKeys,
  type AiConfigOptions,
} from "./config";

const NATIVE_KEY_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

function resolveEncryptor(opts: AiConfigOptions): Encryptor {
  if (opts.encryptor?.available) return opts.encryptor;
  return createLocalEncryptor(opts);
}

function decryptKeys(keys: AiKeys | undefined, enc: Encryptor): AiKeys {
  const out: AiKeys = {};
  for (const [k, v] of Object.entries(keys ?? {})) {
    if (!v) continue;
    out[k as keyof AiKeys] = isEncrypted(v) ? enc.decrypt(v) : v;
  }
  return out;
}

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
  const enc = resolveEncryptor(opts);
  const keys: AiKeys = { ...decryptKeys(kv.keys, enc), ...decryptKeys(file.keys, enc) };
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
  } else if (provider && keys[provider as keyof AiKeys]) {
    apiKey = keys[provider as keyof AiKeys]!;
    source = file.keys?.[provider as keyof AiKeys] ? "file" : "kv";
  }

  return { provider, model, apiKey, keys, semanticSearchEnabled, source };
}

export function saveAiConfig(config: Partial<AiConfig>, opts: AiConfigOptions = {}): void {
  const kv = opts.kv ?? openKvStore(opts);
  try {
    const enc = resolveEncryptor(opts);
    const toStore: Partial<AiConfig> = { ...config };
    if (config.keys) {
      const encKeys: AiKeys = {};
      for (const [k, v] of Object.entries(config.keys)) {
        if (!v) continue;
        encKeys[k as keyof AiKeys] = isEncrypted(v) ? v : enc.encrypt(v);
      }
      toStore.keys = encKeys;
    }
    const existing = kv.get(AI_SETTINGS_KEY);
    const merged = { ...(existing ? JSON.parse(existing) : {}), ...toStore };
    kv.set(AI_SETTINGS_KEY, JSON.stringify(merged));
  } finally {
    if (!opts.kv) kv.close();
  }
}

/** Encrypt any plaintext values in the stored aiSettings.keys. Idempotent. Returns count changed. */
export function migrateAiKeystore(opts: AiConfigOptions = {}): number {
  const kv = opts.kv ?? openKvStore(opts);
  try {
    const raw = kv.get(AI_SETTINGS_KEY);
    if (!raw) return 0;
    const settings = JSON.parse(raw) as Partial<AiConfig>;
    const keys = settings.keys ?? {};
    const enc = resolveEncryptor(opts);
    let changed = 0;
    for (const [k, v] of Object.entries(keys)) {
      if (v && !isEncrypted(v)) {
        keys[k as keyof AiKeys] = enc.encrypt(v);
        changed += 1;
      }
    }
    if (changed > 0) {
      settings.keys = keys;
      kv.set(AI_SETTINGS_KEY, JSON.stringify(settings));
    }
    return changed;
  } finally {
    if (!opts.kv) kv.close();
  }
}
