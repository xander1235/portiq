// Pure AI-config types + helpers. NO node: builtins or native addons — safe to
// evaluate in a Chromium renderer. The Node-only resolvers (file/kv reading)
// live in ./configStore so that renderer-reachable modules (assist.ts) can
// import these types + AiConfigError + requireApiKey without dragging node:fs
// and better-sqlite3 into the browser bundle.
import type { ResolveDataDirOptions } from "../store/dataDir";
import type { KvStore } from "../store/kvStore";

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

export function requireApiKey(config: AiConfig): { provider: string; apiKey: string } {
  if (!config.provider || !config.apiKey) {
    throw new AiConfigError(
      "No AI credentials configured. Provide one of: --ai-key flag, PORTIQ_AI_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) env, an ai.json config file, or a desktop-stored AI setting.",
    );
  }
  return { provider: config.provider, apiKey: config.apiKey };
}

export function redactKey(key: string | null | undefined): string {
  if (!key) return "(none)";
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-2)}`;
}
