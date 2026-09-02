# Phase 3 — Parity: AI Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Portiq's AI-assist logic out of the Electron renderer (`src/services/ai.ts`) into a framework-free, headless-capable, self-registering `@portiq/core/ai` module, resolve the deferred credential/config-sourcing decision, and surface the AI features additively as MCP tools and CLI commands.

**Architecture:** Add a new `packages/core/src/ai/**` module exposed via a dedicated `@portiq/core/ai` subpath export (mirroring `@portiq/core/flows`), kept out of the top barrel so AI stays opt-in. Providers (`openai`, `anthropic`, `gemini`) self-register into an `AIProviderRegistry` that mirrors the existing `ProtocolRegistry`. All network I/O goes through an injected `FetchLike` (default `globalThis.fetch`) so the module is Electron-free; the renderer injects its CORS-bypassing `safeFetch`, and semantic search is an injected optional dependency. A `resolveAiConfig()` resolver implements the credential precedence flag → env → config file → desktop-stored kv setting, mirroring the data-location contract's precedence style. Surface work returns framework-free MCP tool descriptors and CLI command descriptors that the (assumed) Phase 1 MCP and Phase 2 CLI registries register in one line.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler`), Vitest 4 (`node` env, `vi` mocks — no real network / no real key in CI), `fuse.js` (fuzzy library search), Node ≥18 global `fetch`, `better-sqlite3` (via `openKvStore` for the desktop-stored credential tier). No `@anthropic-ai/sdk` (the current feature is a raw-HTTP multi-provider client — see Open Questions).

## Global Constraints

- Module lives under `packages/core/src/ai/**`; exposed via a new `"./ai"` subpath in `packages/core/package.json` (`import` → `./src/ai/index.ts`, `require` → `./dist/ai/index.js`). It is **NOT** added to the top barrel (`packages/core/src/index.ts`) — AI stays opt-in so the base build/tests/electron require are unaffected.
- NO Electron imports anywhere under `packages/core/**` (no `electron`, `app`, `BrowserWindow`, `ipcMain`, `window.*`), and NO renderer-only globals in core (`import.meta.url`, `Worker`, `localStorage`, `document`). All network I/O flows through an injected `FetchLike`; semantic search is an injected optional dependency.
- **better-sqlite3 ABI gotcha:** the hoisted native binary serves EITHER plain-Node (vitest/CLI/MCP) OR Electron, not both. Core unit tests run on plain-Node — run `npm rebuild better-sqlite3` before `npm test` if a native-module ABI error appears; run `npm run rebuild` to restore the Electron ABI before `npm run dev`.
- **Data-location contract:** resolve storage via core's `resolveDataDir(opts)` / `openKvStore(opts)` — never re-derive a path. The desktop-stored credential tier reads/writes the kv key `"aiSettings"` (distinct from `"appState"`; reads are always safe).
- **Registry pattern:** ADDITIVE self-registration only. Providers self-register into `AIProviderRegistry` in `ai/index.ts` (import + register, mirroring `ProtocolRegistry`). Surface adapters return descriptors; the Phase 1 MCP / Phase 2 CLI registries register them additively — no editing a shared switchboard.
- **Confirmed aligned with Phase 0.5 (Part C + Part D delta #9):** `AIProviderRegistry` (backing class `AIProviderRegistryClass`) is a legitimate per-domain registry — it has 2+ interchangeable implementations (`openai`/`anthropic`/`gemini`) selected by string `id`, self-registered in `ai/index.ts`, mirroring `ProtocolRegistry`. No change required. The `@portiq/core/ai` subpath follows the same `exports`-map convention Phase 0.5 Part B applied to `./flows`; AI adds its own subpath entry (out of scope for Phase 0.5).
- **Package boundaries:** all new core files live under `packages/core/src/ai/**` (disjoint from other tracks). The only files touched outside that dir are the renderer parity shim `src/services/ai.ts` and the desktop-mirror glue (`electron/main.cjs`, `electron/preload.cjs`, `src/App.tsx`), all additive.
- **AI is optional:** everything else must build and pass with AI absent/unconfigured. `summarizeResponse` is pure and always works; `assist` / `generateTests` / `listModels` throw `AiConfigError` when no credentials resolve; `generateTests` degrades to non-LLM defaults.
- **Claude/Anthropic model IDs:** the Anthropic provider defaults to the current model id `claude-opus-4-8` (was the stale `claude-3-5-sonnet-latest`). Keep `anthropic-version: 2023-06-01` (current for the raw `/v1/messages` endpoint). Thinking is intentionally left off (JSON-extraction reliability + behavior parity) — see Open Questions.
- Test convention (match existing): `import { describe, it, expect } from "vitest";` (add `vi` when mocking); import module under test by relative path; local factory helpers at top; `describe` per function, `it` per behavior; inject clocks/deps for determinism; no global setup file. The AI provider is ALWAYS mocked in tests — no real network, no real API key.
- Commit after every task with a Conventional Commit message; end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Source-of-truth references (current code being extracted)

- AI service (renderer): `src/services/ai.ts` —
  - `fetchModels(provider, apiKey, addLog)`: `:15-74` (openai/anthropic/gemini model lists via `safeFetch` proxy roots).
  - `parseLLMJson(text)`: `:76-127` (robust JSON extraction from LLM output; merges pre/post prose into `message`).
  - `callLLM(provider, model, apiKey, systemPrompt, userMessage, format, sessionContext)`: `:129-231` (openai `:135-164`, anthropic `:166-196`, gemini `:198-228`).
  - `generateRequestFromPrompt(prompt, currentState, collections, aiSettings, activeAiSessionId, aiChatSessions, responseData)`: `:233-425` — semantic-search merge `:247-263`; session context `:265-272`; response-context compression `:274-336`; collection context `:339-344`; system prompt `:346-408`; call + `SUGGEST_ENDPOINTS` rehydration `:410-424`.
  - `generateTestsFromResponse(request, response, aiSettings)`: `:427-468` (LLM tests + non-LLM fallback `:462-467`).
  - `summarizeResponse(response)`: `:470-486` (pure, no LLM).
- AI deps (renderer, stay in renderer / injected): `src/utils/fuzzySearch.ts` (`searchRequestsContext`, `flattenCollections` — `fuse.js`, pure); `src/utils/semanticSearch.ts` (`SemanticSearch.search` — Web Worker + `@huggingface/transformers`, renderer-only); `src/utils/safeFetch.ts` (proxy roots `/proxy-openai`→`api.openai.com`, `/proxy-anthropic`→`api.anthropic.com`, `/proxy-gemini`→`generativelanguage.googleapis.com`; routes through `window.api.sendRequest` in Electron for CORS bypass).
- Credentials today (renderer localStorage, NOT the shared store): `src/App.tsx:380-386` — `ui_aiProvider` (default `"openai"`), `ui_activeModel` (`"gpt-4o-mini"`), `ui_aiApiKeyOpenAI`, `ui_aiApiKeyAnthropic`, `ui_aiApiKeyGemini`, `ui_aiSemanticSearchEnabled`. `aiSettings` object built at `src/App.tsx:2547-2555` (`{ provider, model, keys: {openai, anthropic, gemini}, semanticSearchEnabled }`).
- Renderer callers to preserve: `src/App.tsx:5` (import), `:2578` (`generateRequestFromPrompt`), `:2198/:2317/:2437` (`summarizeResponse`), `:401` (`fetchModels` effect); `src/components/Modals/SettingsModal.tsx:93` (`fetchModels`).
- Registry pattern to mirror: `packages/core/src/protocols/registry.ts` (`ProtocolRegistry` singleton: `register`/`get`/`getAll`/`getIds`/`unregister`), registered in `packages/core/src/protocols/index.ts`.
- Store APIs to reuse (never re-derive): `packages/core/src/store/dataDir.ts` (`resolveDataDir(opts)`, `ResolveDataDirOptions`), `packages/core/src/store/kvStore.ts` (`openKvStore(opts): KvStore`, `KvStore.get/set/close`).
- Subpath-export precedent: `packages/core/package.json` `exports["./flows"]`; build via `tsconfig.build.json` (emits `dist/**`, excludes `**/*.test.ts`).

---

## Task 1: `ai/config.ts` — credential/config resolver (the deferred decision) + `@portiq/core/ai` scaffold

**Files:**
- Modify: `packages/core/package.json` (add `"./ai"` export + `fuse.js` dependency)
- Create: `packages/core/src/ai/index.ts` (barrel stub; providers registered in Task 7)
- Create: `packages/core/src/ai/config.ts`
- Create: `packages/core/src/ai/config.test.ts`

**Interfaces:**
- Consumes: `resolveDataDir`, `type ResolveDataDirOptions` from `../store/dataDir`; `openKvStore`, `type KvStore` from `../store/kvStore`.
- Produces: `AiConfigError` (Error subclass); `interface AiKeys { openai?: string; anthropic?: string; gemini?: string }`; `interface AiConfig { provider: string | null; model: string | null; apiKey: string | null; keys: AiKeys; semanticSearchEnabled: boolean; source: string }`; `interface AiConfigOptions extends ResolveDataDirOptions { provider?: string; model?: string; apiKey?: string; configPath?: string; env?: NodeJS.ProcessEnv; kv?: KvStore }`; `resolveAiConfig(opts?): AiConfig`; `requireApiKey(config): { provider: string; apiKey: string }` (throws `AiConfigError`); `saveAiConfig(config: Partial<AiConfig>, opts?): void`; `redactKey(key): string`; constants `AI_SETTINGS_KEY = "aiSettings"`, `AI_CONFIG_FILE = "ai.json"`. Precedence: provider = opts → `PORTIQ_AI_PROVIDER` → config file → kv → inferred-from-native-env; apiKey = opts → `PORTIQ_AI_API_KEY` → provider-native env → config-file keys → kv keys.

- [ ] **Step 1: Add the `./ai` export and `fuse.js` dep to `packages/core/package.json`**

In `exports`, add a sibling to `"./flows"`:

```json
    "./ai": {
      "import": "./src/ai/index.ts",
      "require": "./dist/ai/index.js"
    }
```

In `dependencies`, add (keep alphabetical-ish, matching the root version):

```json
    "fuse.js": "^7.1.0",
```

- [ ] **Step 2: Create the barrel stub `packages/core/src/ai/index.ts`**

```ts
// @portiq/core/ai — headless AI assist. Exposed via the package.json "./ai"
// subpath (NOT the top barrel) so AI stays opt-in and the base build is unaffected.
// Providers self-register into AIProviderRegistry below (populated in Task 7).
export * from "./config";
```

- [ ] **Step 3: Write the failing test `packages/core/src/ai/config.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAiConfig, requireApiKey, saveAiConfig, redactKey, AiConfigError, AI_CONFIG_FILE } from "./config";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-ai-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("resolveAiConfig precedence", () => {
  it("honors explicit flags over everything", () => {
    const dir = tempDir();
    writeFileSync(join(dir, AI_CONFIG_FILE), JSON.stringify({ provider: "gemini", keys: { gemini: "file-key" } }));
    const cfg = resolveAiConfig({
      dataDir: dir,
      provider: "anthropic",
      apiKey: "flag-key",
      env: { PORTIQ_AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "env-key" },
    });
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBe("flag-key");
    expect(cfg.source).toBe("flag");
  });

  it("falls back to PORTIQ_AI_* env, then provider-native env", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { PORTIQ_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "native" } });
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBe("native");
    expect(cfg.source).toBe("env:ANTHROPIC_API_KEY");
  });

  it("infers the provider from a lone native env key", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { OPENAI_API_KEY: "sk-x" } });
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("sk-x");
  });

  it("reads a config file when env is empty", () => {
    const dir = tempDir();
    writeFileSync(join(dir, AI_CONFIG_FILE), JSON.stringify({ provider: "gemini", model: "gemini-1.5-pro", keys: { gemini: "gk" }, semanticSearchEnabled: true }));
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.provider).toBe("gemini");
    expect(cfg.model).toBe("gemini-1.5-pro");
    expect(cfg.apiKey).toBe("gk");
    expect(cfg.semanticSearchEnabled).toBe(true);
    expect(cfg.source).toBe("file");
  });

  it("reads the desktop-stored kv setting as the lowest tier and round-trips saveAiConfig", () => {
    const dir = tempDir();
    saveAiConfig({ provider: "openai", model: "gpt-4o-mini", keys: { openai: "kv-key" } }, { dataDir: dir });
    const cfg = resolveAiConfig({ dataDir: dir, env: {} });
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("kv-key");
    expect(cfg.source).toBe("kv");
  });

  it("resolves with no apiKey when nothing is configured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: {} });
    expect(cfg.apiKey).toBeNull();
    expect(cfg.source).toBe("none");
  });
});

describe("requireApiKey", () => {
  it("throws AiConfigError when unconfigured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: {} });
    expect(() => requireApiKey(cfg)).toThrow(AiConfigError);
  });
  it("returns provider + apiKey when configured", () => {
    const cfg = resolveAiConfig({ dataDir: tempDir(), env: { ANTHROPIC_API_KEY: "k" } });
    expect(requireApiKey(cfg)).toEqual({ provider: "anthropic", apiKey: "k" });
  });
});

describe("redactKey", () => {
  it("masks long keys and reports absence", () => {
    expect(redactKey(null)).toBe("(none)");
    expect(redactKey("sk-1234567890")).toBe("sk-1…90");
    expect(redactKey("short")).toBe("****");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/config.test.ts`
Expected: FAIL — cannot find module `./config`. (If a `better-sqlite3` ABI error appears instead, run `npm rebuild better-sqlite3` first, then re-run.)

- [ ] **Step 5: Implement `packages/core/src/ai/config.ts`**

```ts
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

  // provider: flag -> PORTIQ_AI_PROVIDER -> file -> kv -> inferred-from-native-env
  let provider = opts.provider ?? env.PORTIQ_AI_PROVIDER ?? file.provider ?? kv.provider ?? null;
  if (!provider) {
    for (const [p, names] of Object.entries(NATIVE_KEY_ENV)) {
      if (names.some((n) => env[n])) {
        provider = p;
        break;
      }
    }
  }

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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/config.test.ts`
Expected: PASS (11 tests). If a `better-sqlite3` native ABI error appears, run `npm rebuild better-sqlite3` first.

- [ ] **Step 7: Install (picks up the new dep) and commit**

Run: `npm install`

```bash
git add packages/core/package.json package-lock.json packages/core/src/ai/index.ts packages/core/src/ai/config.ts packages/core/src/ai/config.test.ts
git commit -m "feat(core): resolve AI credential/config sourcing precedence + @portiq/core/ai scaffold"
```

---

## Task 2: `ai/providerRegistry.ts` — `AIProvider` interface + registry (mirrors `ProtocolRegistry`)

**Files:**
- Create: `packages/core/src/ai/providerRegistry.ts`
- Create: `packages/core/src/ai/providerRegistry.test.ts`

**Interfaces:**
- Produces: `type FetchLike = (url: string, init?: any) => Promise<FetchLikeResponse>`; `interface FetchLikeResponse { ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }`; `interface AiLogEntry { source: string; type: string; message: string; data?: unknown }`; `interface ProviderContext { apiKey: string; fetch: FetchLike; log?: (e: AiLogEntry) => void }`; `interface ChatRequest { model?: string; systemPrompt: string; userMessage: string; format?: "json" | "text"; sessionContext?: Record<string, unknown> | null; maxTokens?: number }`; `interface ChatResult { result: any; usage: { input: number; output: number } | null; model: string }`; `interface AIProvider { id: string; defaultModel: string; chat(req: ChatRequest, ctx: ProviderContext): Promise<ChatResult>; listModels(ctx: ProviderContext): Promise<string[]> }`; singleton `AIProviderRegistry` with `register(p)`, `get(id): AIProvider | null`, `getAll(): AIProvider[]`, `getIds(): string[]`, `unregister(id)`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/providerRegistry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { AIProviderRegistry, type AIProvider } from "./providerRegistry";

const fake = (id: string): AIProvider => ({
  id,
  defaultModel: "m",
  async chat() {
    return { result: {}, usage: null, model: "m" };
  },
  async listModels() {
    return [];
  },
});

describe("AIProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    AIProviderRegistry.register(fake("test-a"));
    expect(AIProviderRegistry.get("test-a")?.id).toBe("test-a");
    AIProviderRegistry.unregister("test-a");
  });

  it("returns null for an unknown provider", () => {
    expect(AIProviderRegistry.get("nope-xyz")).toBeNull();
  });

  it("throws when a provider lacks an id", () => {
    expect(() => AIProviderRegistry.register({ ...fake(""), id: "" })).toThrow(/id/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/providerRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/providerRegistry.ts`**

```ts
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}

/** Minimal fetch shape satisfied by Node's global fetch AND the renderer's
 *  safeFetch polyfill — the seam that keeps this module Electron-free. */
export type FetchLike = (url: string, init?: any) => Promise<FetchLikeResponse>;

export interface AiLogEntry {
  source: string;
  type: string;
  message: string;
  data?: unknown;
}

export interface ProviderContext {
  apiKey: string;
  fetch: FetchLike;
  log?: (entry: AiLogEntry) => void;
}

export interface ChatRequest {
  model?: string;
  systemPrompt: string;
  userMessage: string;
  /** "json" (default) parses the reply via parseLLMJson; "text" returns raw text. */
  format?: "json" | "text";
  sessionContext?: Record<string, unknown> | null;
  maxTokens?: number;
}

export interface ChatResult {
  /** Parsed object when format === "json", else the raw string. */
  result: any;
  usage: { input: number; output: number } | null;
  model: string;
}

export interface AIProvider {
  id: string;
  defaultModel: string;
  chat(req: ChatRequest, ctx: ProviderContext): Promise<ChatResult>;
  listModels(ctx: ProviderContext): Promise<string[]>;
}

class AIProviderRegistryClass {
  private _providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (!provider.id) throw new Error("AIProvider must have an 'id'");
    if (this._providers.has(provider.id)) {
      console.warn(`AI provider "${provider.id}" is already registered. Overwriting.`);
    }
    this._providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this._providers.delete(id);
  }

  get(id: string): AIProvider | null {
    return this._providers.get(id) ?? null;
  }

  getAll(): AIProvider[] {
    return Array.from(this._providers.values());
  }

  getIds(): string[] {
    return Array.from(this._providers.keys());
  }
}

export const AIProviderRegistry = new AIProviderRegistryClass();

export default AIProviderRegistry;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/providerRegistry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export from the ai barrel and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./providerRegistry";`

```bash
git add packages/core/src/ai/providerRegistry.ts packages/core/src/ai/providerRegistry.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): AIProvider interface + self-registration registry"
```

---

## Task 3: `ai/parseLLMJson.ts` — robust LLM-JSON extraction (verbatim move)

**Files:**
- Create: `packages/core/src/ai/parseLLMJson.ts`
- Create: `packages/core/src/ai/parseLLMJson.test.ts`

**Interfaces:**
- Produces: `parseLLMJson(text: string): any` — extracts the first `{`/`[` … last `}`/`]` slice, strips markdown code fences from surrounding prose, `JSON.parse`s the slice, and (for objects) merges leading/trailing prose into `.message`. Ported verbatim from `src/services/ai.ts:76-127`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/parseLLMJson.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseLLMJson } from "./parseLLMJson";

describe("parseLLMJson", () => {
  it("parses a bare JSON object", () => {
    expect(parseLLMJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts JSON embedded in a fenced code block", () => {
    const raw = "Here you go:\n```json\n{\"message\":\"hi\",\"operations\":[]}\n```";
    const parsed = parseLLMJson(raw);
    expect(parsed.operations).toEqual([]);
    expect(parsed.message).toContain("hi");
  });

  it("merges leading and trailing prose into the message field", () => {
    const parsed = parseLLMJson('Intro.\n{"message":"core"}\nOutro.');
    expect(parsed.message).toContain("Intro.");
    expect(parsed.message).toContain("core");
    expect(parsed.message).toContain("Outro.");
  });

  it("parses a JSON array", () => {
    expect(parseLLMJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/parseLLMJson.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/parseLLMJson.ts`**

Port `src/services/ai.ts:76-127` verbatim, exported and typed:

```ts
export function parseLLMJson(text: string): any {
  const cleanText = text.trim();
  let beforeStr = "";
  let afterStr = "";

  const firstBrace = cleanText.indexOf("{");
  const firstBracket = cleanText.indexOf("[");

  let startIdx;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else {
    startIdx = Math.max(firstBrace, firstBracket);
  }

  const lastBrace = cleanText.lastIndexOf("}");
  const lastBracket = cleanText.lastIndexOf("]");
  const endIdx = Math.max(lastBrace, lastBracket);

  let jsonStr = cleanText;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    beforeStr = cleanText.substring(0, startIdx).trim();
    afterStr = cleanText.substring(endIdx + 1).trim();
    jsonStr = cleanText.substring(startIdx, endIdx + 1);
  }

  if (beforeStr.endsWith("```json")) beforeStr = beforeStr.substring(0, beforeStr.length - 7).trim();
  else if (beforeStr.endsWith("```")) beforeStr = beforeStr.substring(0, beforeStr.length - 3).trim();

  if (afterStr.startsWith("```")) afterStr = afterStr.substring(3).trim();

  const parsed = JSON.parse(jsonStr);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const combinedMessage: string[] = [];
    if (beforeStr) combinedMessage.push(beforeStr);
    if (parsed.message) combinedMessage.push(parsed.message);
    if (afterStr) combinedMessage.push(afterStr);

    if (combinedMessage.length > 0) {
      parsed.message = combinedMessage.join("\n\n");
    }
  }

  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/parseLLMJson.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./parseLLMJson";`

```bash
git add packages/core/src/ai/parseLLMJson.ts packages/core/src/ai/parseLLMJson.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): headless LLM-JSON extraction helper"
```

---

## Task 4: `ai/providers/anthropic.ts` — Anthropic provider (current model id)

**Files:**
- Create: `packages/core/src/ai/providers/anthropic.ts`
- Create: `packages/core/src/ai/providers/anthropic.test.ts`

**Interfaces:**
- Consumes: `type AIProvider`, `type ChatRequest`, `type ProviderContext` from `../providerRegistry`; `parseLLMJson` from `../parseLLMJson`.
- Produces: `anthropicProvider: AIProvider`; `const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-8"`. `chat` POSTs `https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, body `{ model, system, messages:[{role:"user",content}], max_tokens }` (default `max_tokens` 2000); parses `data.content[0].text`. `listModels` GETs `/v1/models`, filters `type === "model"`. Ported from `src/services/ai.ts:37-52, 166-196`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/providers/anthropic.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { anthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./anthropic";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("anthropicProvider.chat", () => {
  it("defaults to the current model id and sends the version + key headers", async () => {
    const { fetch, calls } = okFetch({ content: [{ text: '{"message":"ok","operations":[]}' }], usage: { input_tokens: 10, output_tokens: 5 } });
    const res = await anthropicProvider.chat({ systemPrompt: "sys", userMessage: "hi", format: "json" }, { apiKey: "k", fetch });
    expect(res.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 10, output: 5 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(2000);
    expect(calls[0].init.headers["x-api-key"]).toBe("k");
    expect(calls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].url).toContain("api.anthropic.com/v1/messages");
  });

  it("throws with the response text on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 401, async text() { return "bad key"; }, async json() { return {}; } });
    await expect(anthropicProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "k", fetch })).rejects.toThrow(/Anthropic Error: bad key/);
  });
});

describe("anthropicProvider.listModels", () => {
  it("returns only entries of type 'model'", async () => {
    const { fetch } = okFetch({ data: [{ id: "claude-opus-4-8", type: "model" }, { id: "other", type: "not" }] });
    expect(await anthropicProvider.listModels({ apiKey: "k", fetch })).toEqual(["claude-opus-4-8"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/providers/anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/providers/anthropic.ts`**

```ts
import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const ANTHROPIC_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 2000;

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-8";

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export const anthropicProvider: AIProvider = {
  id: "anthropic",
  defaultModel: ANTHROPIC_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || ANTHROPIC_DEFAULT_MODEL;
    const res = await ctx.fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: "POST",
      headers: headers(ctx.apiKey),
      body: JSON.stringify({
        model,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.userMessage }],
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic Error: ${await res.text()}`);
    const data = await res.json();
    const text = data.content[0].text;
    const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${ANTHROPIC_BASE}/v1/models`, { headers: headers(ctx.apiKey) });
    if (!res.ok) throw new Error(`Failed to fetch Anthropic models (${res.status})`);
    const data = await res.json();
    return (data.data || []).filter((m: any) => m.type === "model").map((m: any) => m.id);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/providers/anthropic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/providers/anthropic.ts packages/core/src/ai/providers/anthropic.test.ts
git commit -m "feat(core): headless Anthropic provider (claude-opus-4-8 default)"
```

---

## Task 5: `ai/providers/openai.ts` — OpenAI provider

**Files:**
- Create: `packages/core/src/ai/providers/openai.ts`
- Create: `packages/core/src/ai/providers/openai.test.ts`

**Interfaces:**
- Consumes: `type AIProvider` from `../providerRegistry`; `parseLLMJson` from `../parseLLMJson`.
- Produces: `openaiProvider: AIProvider`; `const OPENAI_DEFAULT_MODEL = "gpt-4o-mini"`. `chat` POSTs `https://api.openai.com/v1/chat/completions` with `Authorization: Bearer`, body `{ model, messages:[{role:"system"},{role:"user"}] }` + `response_format:{type:"json_object"}` when `format !== "text"` + `conversation_id` from `sessionContext`; parses `data.choices[0].message.content`. `listModels` GETs `/v1/models`. Ported from `src/services/ai.ts:24-35, 135-164`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/providers/openai.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { openaiProvider, OPENAI_DEFAULT_MODEL } from "./openai";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("openaiProvider.chat", () => {
  it("requests json_object format and defaults the model", async () => {
    const { fetch, calls } = okFetch({ choices: [{ message: { content: '{"message":"ok"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
    const res = await openaiProvider.chat({ systemPrompt: "s", userMessage: "u", format: "json", sessionContext: { conversation_id: "c1" } }, { apiKey: "k", fetch });
    expect(res.model).toBe(OPENAI_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 3, output: 4 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.conversation_id).toBe("c1");
    expect(calls[0].init.headers.Authorization).toBe("Bearer k");
  });

  it("throws on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 500, async text() { return "boom"; }, async json() { return {}; } });
    await expect(openaiProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "k", fetch })).rejects.toThrow(/OpenAI Error: boom/);
  });
});

describe("openaiProvider.listModels", () => {
  it("maps data[].id", async () => {
    const { fetch } = okFetch({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    expect(await openaiProvider.listModels({ apiKey: "k", fetch })).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/providers/openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/providers/openai.ts`**

```ts
import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const OPENAI_BASE = "https://api.openai.com";

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export const openaiProvider: AIProvider = {
  id: "openai",
  defaultModel: OPENAI_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || OPENAI_DEFAULT_MODEL;
    const body: any = {
      model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userMessage },
      ],
    };
    if (req.format !== "text") body.response_format = { type: "json_object" };
    const sc = req.sessionContext as any;
    if (sc?.conversation_id) body.conversation_id = sc.conversation_id;

    const res = await ctx.fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI Error: ${await res.text()}`);
    const data = await res.json();
    const text = data.choices[0].message.content;
    const usage = data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${OPENAI_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch OpenAI models (${res.status})`);
    const data = await res.json();
    return (data.data || []).map((m: any) => m.id);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/providers/openai.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/providers/openai.ts packages/core/src/ai/providers/openai.test.ts
git commit -m "feat(core): headless OpenAI provider"
```

---

## Task 6: `ai/providers/gemini.ts` — Gemini provider

**Files:**
- Create: `packages/core/src/ai/providers/gemini.ts`
- Create: `packages/core/src/ai/providers/gemini.test.ts`

**Interfaces:**
- Consumes: `type AIProvider` from `../providerRegistry`; `parseLLMJson` from `../parseLLMJson`.
- Produces: `geminiProvider: AIProvider`; `const GEMINI_DEFAULT_MODEL = "gemini-1.5-flash"`. `chat` POSTs `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=`, body `{ systemInstruction, contents, generationConfig.responseMimeType }` + `past_conversation_ids` from `sessionContext`; parses `data.candidates[0].content.parts[0].text`. `listModels` GETs `/v1beta/models?key=`, strips `models/` prefix. Ported from `src/services/ai.ts:54-65, 198-228`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/providers/gemini.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { geminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini";
import type { FetchLike } from "../providerRegistry";

function okFetch(body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
  };
  return { fetch, calls };
}

describe("geminiProvider.chat", () => {
  it("posts to the default model with the api key in the query and JSON mime type", async () => {
    const { fetch, calls } = okFetch({ candidates: [{ content: { parts: [{ text: '{"message":"ok"}' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 6 } });
    const res = await geminiProvider.chat({ systemPrompt: "s", userMessage: "u", format: "json" }, { apiKey: "gk", fetch });
    expect(res.model).toBe(GEMINI_DEFAULT_MODEL);
    expect(res.result.message).toBe("ok");
    expect(res.usage).toEqual({ input: 2, output: 6 });
    expect(calls[0].url).toContain(`/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent?key=gk`);
    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("s");
  });

  it("throws with the response text on a non-ok status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 400, async text() { return "bad"; }, async json() { return {}; } });
    await expect(geminiProvider.chat({ systemPrompt: "s", userMessage: "u" }, { apiKey: "gk", fetch })).rejects.toThrow(/bad/);
  });
});

describe("geminiProvider.listModels", () => {
  it("strips the models/ prefix", async () => {
    const { fetch } = okFetch({ models: [{ name: "models/gemini-1.5-flash" }, { name: "models/gemini-1.5-pro" }] });
    expect(await geminiProvider.listModels({ apiKey: "gk", fetch })).toEqual(["gemini-1.5-flash", "gemini-1.5-pro"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/providers/gemini.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/providers/gemini.ts`**

```ts
import type { AIProvider } from "../providerRegistry";
import { parseLLMJson } from "../parseLLMJson";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";

export const GEMINI_DEFAULT_MODEL = "gemini-1.5-flash";

export const geminiProvider: AIProvider = {
  id: "gemini",
  defaultModel: GEMINI_DEFAULT_MODEL,

  async chat(req, ctx) {
    const model = (req.model || "").trim() || GEMINI_DEFAULT_MODEL;
    const body: any = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: req.userMessage }] }],
      generationConfig: { responseMimeType: req.format === "text" ? "text/plain" : "application/json" },
    };
    const past = (req.sessionContext as any)?.past_conversation_ids;
    if (past && past.length > 0) body.past_conversation_ids = past;

    const res = await ctx.fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${ctx.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const text = data.candidates[0].content.parts[0].text;
    const usage = data.usageMetadata
      ? { input: data.usageMetadata.promptTokenCount, output: data.usageMetadata.candidatesTokenCount }
      : null;
    return { result: req.format === "text" ? text : parseLLMJson(text), usage, model };
  },

  async listModels(ctx) {
    const res = await ctx.fetch(`${GEMINI_BASE}/v1beta/models?key=${ctx.apiKey}`);
    if (!res.ok) throw new Error(`Failed to fetch Gemini models (${res.status})`);
    const data = await res.json();
    return (data.models || []).map((m: any) => String(m.name).replace("models/", ""));
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/providers/gemini.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/providers/gemini.ts packages/core/src/ai/providers/gemini.test.ts
git commit -m "feat(core): headless Gemini provider"
```

---

## Task 7: `ai/index.ts` self-registration — wire providers into `AIProviderRegistry`

**Files:**
- Modify: `packages/core/src/ai/index.ts`
- Create: `packages/core/src/ai/index.test.ts`

**Interfaces:**
- Consumes: `AIProviderRegistry` from `./providerRegistry`; `openaiProvider`, `anthropicProvider`, `geminiProvider` from `./providers/*`.
- Produces: importing `@portiq/core/ai` (i.e. `./index`) has the side effect of registering all three providers. Re-exports the provider objects and their default-model constants.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { AIProviderRegistry } from "./index";

describe("@portiq/core/ai registration", () => {
  it("registers openai, anthropic, and gemini providers on import", () => {
    expect(AIProviderRegistry.get("openai")?.id).toBe("openai");
    expect(AIProviderRegistry.get("anthropic")?.id).toBe("anthropic");
    expect(AIProviderRegistry.get("gemini")?.id).toBe("gemini");
  });

  it("lists all three built-in provider ids", () => {
    const ids = AIProviderRegistry.getIds();
    expect(ids).toEqual(expect.arrayContaining(["openai", "anthropic", "gemini"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/index.test.ts`
Expected: FAIL — providers not registered yet (`AIProviderRegistry.get("openai")` is null).

- [ ] **Step 3: Update `packages/core/src/ai/index.ts` to register providers + re-export**

Replace the file contents with:

```ts
// @portiq/core/ai — headless AI assist. Exposed via the package.json "./ai"
// subpath (NOT the top barrel) so AI stays opt-in and the base build is unaffected.
import { AIProviderRegistry } from "./providerRegistry";
import { openaiProvider } from "./providers/openai";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";

// Additive self-registration (mirrors protocols/index.ts). Import + register only.
AIProviderRegistry.register(openaiProvider);
AIProviderRegistry.register(anthropicProvider);
AIProviderRegistry.register(geminiProvider);

export * from "./config";
export * from "./providerRegistry";
export * from "./parseLLMJson";
export { openaiProvider, OPENAI_DEFAULT_MODEL } from "./providers/openai";
export { anthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./providers/anthropic";
export { geminiProvider, GEMINI_DEFAULT_MODEL } from "./providers/gemini";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/index.ts packages/core/src/ai/index.test.ts
git commit -m "feat(core): self-register built-in AI providers"
```

---

## Task 8: `ai/context.ts` — library fuzzy search + response/collection context builders

**Files:**
- Create: `packages/core/src/ai/context.ts`
- Create: `packages/core/src/ai/context.test.ts`

**Interfaces:**
- Consumes: `fuse.js` (default import `Fuse`).
- Produces: `flattenCollections(collections: any[]): any[]` and `searchRequestsContext(prompt: string, collections: any[]): any[]` (ported verbatim from `src/utils/fuzzySearch.ts`); `buildResponseContext(responseData: any): string` (ported from `src/services/ai.ts:274-336` — array-of-objects compression choosing the shortest of minified JSON / schema-tuple / schema-tuple+dictionary, plus a 25000-char truncation marker); `buildCollectionContext(collections: any[]): any[]` (ported from `src/services/ai.ts:339-344`).

- [ ] **Step 1: Write the failing test `packages/core/src/ai/context.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { searchRequestsContext, flattenCollections, buildResponseContext, buildCollectionContext } from "./context";

const collections = () => [
  {
    id: "c1",
    name: "API",
    items: [
      { type: "request", id: "r1", name: "List Users", method: "GET", url: "https://x/users" },
      { type: "folder", id: "f1", name: "Auth", items: [
        { type: "request", id: "r2", name: "Login", method: "POST", url: "https://x/login" },
      ] },
    ],
  },
];

describe("flattenCollections", () => {
  it("flattens nested folders into a single request list", () => {
    expect(flattenCollections(collections()).map((r: any) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("searchRequestsContext", () => {
  it("returns fuzzy matches for a prompt", () => {
    const results = searchRequestsContext("find the login request", collections());
    expect(results.some((r: any) => r.id === "r2")).toBe(true);
  });

  it("returns an empty array for an empty library", () => {
    expect(searchRequestsContext("anything", [])).toEqual([]);
  });
});

describe("buildResponseContext", () => {
  it("reports no data when responseData is null", () => {
    expect(buildResponseContext(null)).toBe("No response data available yet.");
  });

  it("compresses an array-of-objects body and includes a Status line", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, name: "Alice", role: "admin" }));
    const ctx = buildResponseContext({ status: 200, statusText: "OK", headers: {}, body: JSON.stringify(rows) });
    expect(ctx).toContain("Status: 200 OK");
    expect(ctx).toContain("__schema");
  });

  it("truncates very long bodies with a marker", () => {
    const big = "x".repeat(30000);
    const ctx = buildResponseContext({ status: 200, statusText: "OK", headers: {}, body: big });
    expect(ctx).toContain("[TRUNCATED: showing 25000 of");
  });
});

describe("buildCollectionContext", () => {
  it("summarizes folders and request counts", () => {
    const summary = buildCollectionContext(collections());
    expect(summary[0]).toMatchObject({ id: "c1", name: "API", requestCount: 1 });
    expect(summary[0].folders).toEqual([{ id: "f1", name: "Auth" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/context.ts`**

Port `flattenCollections` + `searchRequestsContext` verbatim from `src/utils/fuzzySearch.ts`, then add the two context builders:

```ts
import Fuse from "fuse.js";

export function flattenCollections(collections: any[]): any[] {
  const allRequests: any[] = [];

  const extractRequests = (items: any[], collectionId: string, collectionName: string) => {
    if (!items || !Array.isArray(items)) return;
    items.forEach((item: any) => {
      if (item.type === "request") {
        allRequests.push({ collectionId, collectionName, ...item });
      } else if (item.type === "folder" && item.items) {
        extractRequests(item.items, collectionId, collectionName);
      }
    });
  };

  collections.forEach((col: any) => {
    extractRequests(col.items, col.id, col.name);
    if (col.requests && Array.isArray(col.requests)) {
      col.requests.forEach((req: any) => {
        allRequests.push({ collectionId: col.id, collectionName: col.name, ...req });
      });
    }
  });

  return allRequests;
}

export function searchRequestsContext(prompt: string, collections: any[]): any[] {
  const allRequests = flattenCollections(collections);
  if (allRequests.length === 0) return [];

  const fuse = new Fuse(allRequests, {
    keys: ["name", "url", "method"],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
  });

  const stopWords = ["find", "load", "open", "get", "fetch", "show", "the", "a", "an", "request", "endpoint", "api"];
  const cleanedPrompt = prompt.replace(/[^\w\s-]/gi, "").toLowerCase().trim();
  const tokens = cleanedPrompt.split(/\s+/).filter((t) => t.length > 1 && !stopWords.includes(t));
  const searchQuery = tokens.join(" ") || prompt;

  let results = fuse.search(searchQuery);
  results = results.filter((res) => res.score !== undefined && res.score < 0.4);

  return results.slice(0, 5).map((res) => {
    const r = res.item as any;
    return {
      id: r.id,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      name: r.name,
      method: r.method,
      url: r.url,
      authType: r.authType,
      headersText: r.headersText,
      bodyText: r.bodyText,
    };
  });
}

export function buildResponseContext(responseData: any): string {
  if (!responseData) return "No response data available yet.";
  let bodyStr = String(responseData.body || "");
  try {
    const parsed = JSON.parse(bodyStr);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      const rawJsonStr = JSON.stringify(parsed);

      const schema = Array.from(new Set(parsed.flatMap((obj: any) => Object.keys(obj))));
      const tupleData = parsed.map((obj: any) => schema.map((k) => (obj[k] !== undefined ? obj[k] : null)));
      const tupleJsonStr = JSON.stringify({ __schema: schema, __data: tupleData });

      const dictItems = new Map<any, number>();
      const dictArray: any[] = [];
      const tupleDictData = parsed.map((obj: any) =>
        schema.map((k) => {
          const val = obj[k] !== undefined ? obj[k] : null;
          if (typeof val === "string" && val.length > 2) {
            if (!dictItems.has(val)) {
              dictItems.set(val, dictArray.length);
              dictArray.push(val);
            }
            return dictItems.get(val);
          }
          return val;
        }),
      );

      const dictJsonStr = dictArray.length > 0
        ? JSON.stringify({ __dict: dictArray, __schema: schema, __data: tupleDictData })
        : tupleJsonStr;

      const candidates = [
        { method: "Minified JSON", str: rawJsonStr, len: rawJsonStr.length },
        { method: "Schema-Tuple", str: `[Compressed using Schema-Tuple format]\n${tupleJsonStr}`, len: tupleJsonStr.length },
        { method: "Schema-Tuple+Dictionary", str: `[Compressed using Schema-Tuple + Dictionary Encoder]\n${dictJsonStr}`, len: dictJsonStr.length },
      ];

      candidates.sort((a, b) => a.len - b.len);
      bodyStr = candidates[0].str;
    } else {
      bodyStr = JSON.stringify(parsed);
    }
  } catch {
    // Not JSON or parsing failed; leave as-is.
  }

  const bodyLimit = 25000;
  const bodyPreview = bodyStr.substring(0, bodyLimit) + (bodyStr.length > bodyLimit ? `\n...[TRUNCATED: showing ${bodyLimit} of ${bodyStr.length} chars]` : "");
  return `Status: ${responseData.status || "N/A"} ${responseData.statusText || ""}\nHeaders: ${responseData.headers ? JSON.stringify(responseData.headers).substring(0, 600) : ""}\nBody (${bodyStr.length} chars total):\n${bodyPreview}`;
}

export function buildCollectionContext(collections: any[]): any[] {
  return (collections || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    folders: (c.items || []).filter((i: any) => i.type === "folder").map((f: any) => ({ id: f.id, name: f.name })),
    requestCount: (c.items || []).filter((i: any) => i.type === "request").length,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/context.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/context.ts packages/core/src/ai/context.test.ts
git commit -m "feat(core): AI library search + response/collection context builders"
```

---

## Task 9: `ai/prompts.ts` — assist + test-generation prompt builders

**Files:**
- Create: `packages/core/src/ai/prompts.ts`
- Create: `packages/core/src/ai/prompts.test.ts`

**Interfaces:**
- Produces: `interface AssistPromptContext { currentState: { protocol?: string; method?: string; url?: string; headersText?: string; bodyText?: string; graphqlConfig?: any }; responseContext: string; collectionContext: any[]; relevantRequests: any[] }`; `buildAssistSystemPrompt(ctx: AssistPromptContext): string` (ported verbatim from `src/services/ai.ts:346-408`, including the operation schema and rules); `buildTestsSystemPrompt(): string` (from `:434-448`); `buildTestsUserMessage(request: any, response: any): string` (from `:450`, 1000-char body preview).

- [ ] **Step 1: Write the failing test `packages/core/src/ai/prompts.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildAssistSystemPrompt, buildTestsSystemPrompt, buildTestsUserMessage } from "./prompts";

describe("buildAssistSystemPrompt", () => {
  it("embeds current state, response context, collections, relevant requests, and the operation schema", () => {
    const prompt = buildAssistSystemPrompt({
      currentState: { protocol: "http", method: "GET", url: "https://x", headersText: "H", bodyText: "B" },
      responseContext: "Status: 200 OK",
      collectionContext: [{ id: "c1", name: "API", folders: [], requestCount: 2 }],
      relevantRequests: [{ id: "r1", name: "List", method: "GET", url: "https://x", protocol: "http", description: "d" }],
    });
    expect(prompt).toContain("Method: GET");
    expect(prompt).toContain("Status: 200 OK");
    expect(prompt).toContain('"API"');
    expect(prompt).toContain('"r1"');
    expect(prompt).toContain("UPDATE_CURRENT_REQUEST");
    expect(prompt).toContain("SUGGEST_ENDPOINTS");
    expect(prompt).toContain("Return ONLY valid JSON");
  });

  it("includes the GraphQL block only when the protocol is graphql", () => {
    const g = buildAssistSystemPrompt({
      currentState: { protocol: "graphql", method: "POST", url: "https://x", graphqlConfig: { query: "{ me }", variables: "{}" } },
      responseContext: "",
      collectionContext: [],
      relevantRequests: [],
    });
    expect(g).toContain("GraphQL Query: { me }");
    const h = buildAssistSystemPrompt({ currentState: { protocol: "http", method: "GET", url: "https://x" }, responseContext: "", collectionContext: [], relevantRequests: [] });
    expect(h).not.toContain("GraphQL Query:");
  });
});

describe("buildTestsSystemPrompt / buildTestsUserMessage", () => {
  it("describes the pm.* API and STRICT JSON tests shape", () => {
    const sys = buildTestsSystemPrompt();
    expect(sys).toContain("pm.response.to.have.status");
    expect(sys).toContain('"tests"');
  });

  it("builds a user message from request + response, previewing the body", () => {
    const msg = buildTestsUserMessage({ method: "GET", url: "https://x" }, { status: 200, body: "y".repeat(2000) });
    expect(msg).toContain("Request: GET https://x");
    expect(msg).toContain("Response Status: 200");
    expect(msg.length).toBeLessThan(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/prompts.ts`**

Port the two system prompts verbatim from `src/services/ai.ts`. The assist prompt is the `:346-408` template; the tests prompt is `:434-448`; the tests user message is `:450`:

```ts
export interface AssistPromptContext {
  currentState: {
    protocol?: string;
    method?: string;
    url?: string;
    headersText?: string;
    bodyText?: string;
    graphqlConfig?: any;
  };
  responseContext: string;
  collectionContext: any[];
  relevantRequests: any[];
}

export function buildAssistSystemPrompt(ctx: AssistPromptContext): string {
  const { currentState, responseContext, collectionContext, relevantRequests } = ctx;
  return `
You are an advanced API Client AI Assistant. Your goal is to help the user configure, manage, and test API requests.
The workspace has collections containing folders and requests. The app supports multiple protocols: HTTP, GraphQL, gRPC, WebSocket, SSE, MCP, and DAG flows.

# Current Active Request State
Protocol: ${currentState.protocol || "http"}
Method: ${currentState.method}
URL: ${currentState.url}
Headers: ${currentState.headersText ? currentState.headersText.substring(0, 1000) : ""}
Body: ${currentState.bodyText ? currentState.bodyText.substring(0, 2000) : ""}
${currentState.protocol === "graphql" ? `GraphQL Query: ${currentState.graphqlConfig?.query || ""}\nGraphQL Variables: ${currentState.graphqlConfig?.variables || "{}"}` : ""}

# Last Response
${responseContext}

# Workspace Collections
${JSON.stringify(collectionContext, null, 2)}

# Relevant Workspace Requests (Searched via keywords)
${JSON.stringify(relevantRequests.map((r: any) => ({ id: r.id, name: r.name, method: r.method, url: r.url, protocol: r.protocol, description: r.description })), null, 2)}

# Objective
Analyze the user's prompt and decide what actions need to be taken.

## Rules
1. If the user asks to "find", "load", "open", "get" or "search for" an existing request, return a \`SUGGEST_ENDPOINTS\` operation with matching IDs. Do NOT use \`UPDATE_CURRENT_REQUEST\` for this.
2. If the user asks to MODIFY the CURRENT request, use \`UPDATE_CURRENT_REQUEST\`.
3. If the user asks to "send", "run", "execute" the request, include a \`SEND_REQUEST\` operation.
4. If the user asks to "generate tests", "write tests", or "create assertions" for the current request/response, include a \`GENERATE_TESTS\` operation with the test scripts in the payload.
5. If the user asks to "delete" or "remove" a request, use \`DELETE_REQUEST\` with the request ID.
6. If the user asks to "move" a request to a folder or collection, use \`MOVE_REQUEST\` with the request ID and target.
7. If the user asks about the response, analyzes errors, or wants to extract data, answer based on the "Last Response" context above.
8. Do NOT hallucinate endpoints. If nothing matches, apologize.
9. If the user asks to find/load a request, IGNORE any "Template: " prefix.
10. **GRAPHQL NOTE:** If protocol is "graphql", use \`UPDATE_CURRENT_REQUEST\` with \`query\` and \`variables\` in the payload.
11. **COMPRESSED DATA INSTRUCTION:** The "Last Response" may be compressed to save space. 
    - If you see \`__schema\` and \`__data\`, each row in \`__data\` is an object where the values correspond positionally to the keys in \`__schema\`.
    - If you see \`__dict\`, any integer values in \`__data\` that correspond to string-like fields are index pointers to the \`__dict\` array. You MUST map these integers back to their actual string values from \`__dict\` before answering or extracting data.
    - Reconstruct the data mentally before providing your answer. Recreate the complete final objects if the user asks for extraction.

You must output STRICT JSON matching this schema:
{
  "message": "A friendly textual reply explaining what you did or observed",
  "operations": [
    {
      "type": "UPDATE_CURRENT_REQUEST" | "UPDATE_REQUEST_BY_ID" | "CREATE_REQUEST" | "SUGGEST_ENDPOINTS" | "SEND_REQUEST" | "GENERATE_TESTS" | "DELETE_REQUEST" | "MOVE_REQUEST",
      "payload": {
        // UPDATE_CURRENT_REQUEST: { "method", "url", "headersText", "bodyText" }
        // UPDATE_CURRENT_REQUEST: { "method"?: string, "url"?: string, "headersText"?: string, "bodyText"?: string, "query"?: string, "variables"?: string, "protocol"?: string }
        // UPDATE_REQUEST_BY_ID: { "id", "updates": { ... } }
        // CREATE_REQUEST: { "collectionId"?, "newCollectionName"?, "name", "method", "url", "headersText", "bodyText" }
        // SUGGEST_ENDPOINTS: { "endpointIds": ["id1", "id2"] }
        // SEND_REQUEST: {} (empty)
        // GENERATE_TESTS: { "tests": ["pm.test('description', () => { ... });", ...] }
        // DELETE_REQUEST: { "requestId": "id" }
        // MOVE_REQUEST: { "requestId": "id", "targetCollectionId": "colId", "targetFolderId"?: "folderId" }
      }
    }
  ]
}

Return ONLY valid JSON. Your response must be parseable.
  `.trim();
}

export function buildTestsSystemPrompt(): string {
  return `You are a test-writing assistant for an API client tool. Given the request and response details, generate a set of post-response test scripts using the pm.test() API.

Available API:
- pm.response.to.have.status(code) - assert status code
- pm.response.text() - get response body as text
- pm.response.json() - get response body as parsed JSON
- pm.response.headers - get response headers object

Generate 3-6 meaningful test assertions that cover:
1. Status code validation
2. Response body structure (check for expected keys/fields)
3. Data type validation (e.g., arrays, strings, numbers)
4. Any edge cases visible in the response

Return STRICT JSON: { "tests": ["pm.test('...', () => { ... });", ...] }`;
}

export function buildTestsUserMessage(request: any, response: any): string {
  const bodyPreview = response?.body ? String(response.body).substring(0, 1000) : "";
  return `Request: ${request.method} ${request.url}\nResponse Status: ${response?.status || "N/A"}\nResponse Body: ${bodyPreview}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/prompts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/prompts.ts packages/core/src/ai/prompts.test.ts
git commit -m "feat(core): AI assist + test-generation prompt builders"
```

---

## Task 10: `ai/summarize.ts` — pure response summarizer (works with AI absent)

**Files:**
- Create: `packages/core/src/ai/summarize.ts`
- Create: `packages/core/src/ai/summarize.test.ts`

**Interfaces:**
- Produces: `interface ResponseSummary { summary: string; hints: string[] }`; `summarizeResponse(response: any): ResponseSummary` (pure, no LLM, no credentials; ported verbatim from `src/services/ai.ts:470-486`).

- [ ] **Step 1: Write the failing test `packages/core/src/ai/summarize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { summarizeResponse } from "./summarize";

describe("summarizeResponse", () => {
  it("reports when there is no response", () => {
    expect(summarizeResponse(null)).toEqual({ summary: "No response yet.", hints: [] });
  });

  it("surfaces the error as a hint", () => {
    expect(summarizeResponse({ error: "boom" })).toEqual({ summary: "Request failed.", hints: ["boom"] });
  });

  it("hints on 4xx and reports row counts for data arrays", () => {
    const s = summarizeResponse({ status: 401, statusText: "Unauthorized", json: {} });
    expect(s.summary).toBe("Status 401 Unauthorized.");
    expect(s.hints).toContain("Check auth headers and required fields.");

    const rows = summarizeResponse({ status: 200, statusText: "OK", json: { data: [1, 2, 3] } });
    expect(rows.hints).toContain("Returned 3 rows.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/summarize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/summarize.ts`**

```ts
export interface ResponseSummary {
  summary: string;
  hints: string[];
}

export function summarizeResponse(response: any): ResponseSummary {
  if (!response) {
    return { summary: "No response yet.", hints: [] };
  }
  if (response.error) {
    return { summary: "Request failed.", hints: [response.error] };
  }
  const summary = `Status ${response.status} ${response.statusText}.`;
  const hints: string[] = [];
  if (response.status >= 400) {
    hints.push("Check auth headers and required fields.");
  }
  if (response.json && Array.isArray(response.json.data)) {
    hints.push(`Returned ${response.json.data.length} rows.`);
  }
  return { summary, hints };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/summarize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./summarize";`

```bash
git add packages/core/src/ai/summarize.ts packages/core/src/ai/summarize.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): pure response summarizer (AI-optional)"
```

---

## Task 11: `ai/assist.ts` — headless orchestration (assist / generateTests / listModels)

**Files:**
- Create: `packages/core/src/ai/assist.ts`
- Create: `packages/core/src/ai/assist.test.ts`

**Interfaces:**
- Consumes: `AIProviderRegistry`, `type AIProvider`, `type ProviderContext`, `type FetchLike` from `./providerRegistry`; `resolveAiConfig`, `requireApiKey`, `AiConfigError`, `type AiConfig`, `type AiConfigOptions` from `./config`; `searchRequestsContext`, `flattenCollections`, `buildResponseContext`, `buildCollectionContext` from `./context`; `buildAssistSystemPrompt`, `buildTestsSystemPrompt`, `buildTestsUserMessage` from `./prompts`.
- Produces: `interface AssistInput { prompt: string; collections: any[]; currentState?: AssistPromptContext["currentState"]; responseData?: any; activeSessionId?: string | null; chatSessions?: { id: string; timestamp: number }[] }`; `interface AssistDeps { config?: AiConfig; configOptions?: AiConfigOptions; fetch?: FetchLike; semanticSearch?: (prompt: string) => Promise<{ id: string }[]>; registry?: typeof AIProviderRegistry; log?: (e: any) => void }`; `interface AssistResult { message: string; operations: any[]; _usage: { input: number; output: number } | null; _model: string }`; `assist(input, deps?): Promise<AssistResult>`; `generateTests(request, response, deps?): Promise<string[]>`; `listModels(deps?): Promise<string[]>`. Ported from `src/services/ai.ts:233-425` (assist), `:427-468` (tests), `:15-74` (models) with all renderer coupling removed.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/assist.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { assist, generateTests, listModels } from "./assist";
import { AIProviderRegistry, type AIProvider } from "./providerRegistry";
import type { AiConfig } from "./config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({
  provider: "anthropic",
  model: null,
  apiKey: "test-key",
  keys: {},
  semanticSearchEnabled: false,
  source: "flag",
  ...over,
});

function stubProvider(id: string, chat: AIProvider["chat"], listModels: AIProvider["listModels"] = async () => []): AIProvider {
  return { id, defaultModel: "m", chat, listModels };
}

const collections = () => [
  { id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List Users", method: "GET", url: "https://x/users" }] },
];

describe("assist", () => {
  it("builds the system prompt from context and returns message + operations", async () => {
    let seenSystem = "";
    const reg = { get: () => stubProvider("anthropic", async (req) => { seenSystem = req.systemPrompt; return { result: { message: "done", operations: [] }, usage: { input: 1, output: 2 }, model: "claude-opus-4-8" }; }) } as any;
    const res = await assist({ prompt: "update the url", collections: collections(), currentState: { method: "GET", url: "https://x" } }, { config: config(), fetch: (async () => ({}) as any), registry: reg });
    expect(res.message).toBe("done");
    expect(res._model).toBe("claude-opus-4-8");
    expect(res._usage).toEqual({ input: 1, output: 2 });
    expect(seenSystem).toContain("# Workspace Collections");
    expect(seenSystem).toContain('"API"');
  });

  it("rehydrates SUGGEST_ENDPOINTS payloads with matched request objects", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { message: "found", operations: [{ type: "SUGGEST_ENDPOINTS", payload: { endpointIds: ["r1"] } }] }, usage: null, model: "m" })) } as any;
    const res = await assist({ prompt: "find list users", collections: collections() }, { config: config(), registry: reg });
    expect(res.operations[0].payload.endpoints[0].id).toBe("r1");
  });

  it("merges injected semantic results when enabled", async () => {
    const semantic = vi.fn(async () => [{ id: "r1" }]);
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { message: "ok", operations: [] }, usage: null, model: "m" })) } as any;
    await assist({ prompt: "zzz no fuzzy match", collections: collections() }, { config: config({ semanticSearchEnabled: true }), semanticSearch: semantic, registry: reg });
    expect(semantic).toHaveBeenCalledWith("zzz no fuzzy match");
  });

  it("throws AiConfigError when no credentials resolve", async () => {
    await expect(assist({ prompt: "x", collections: [] }, { config: config({ apiKey: null, provider: null }) })).rejects.toThrow(/No AI credentials/);
  });
});

describe("generateTests", () => {
  it("returns LLM tests when configured", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: { tests: ["pm.test('a', () => {});"] }, usage: null, model: "m" })) } as any;
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 200, body: "{}" }, { config: config(), registry: reg });
    expect(tests).toEqual(["pm.test('a', () => {});"]);
  });

  it("falls back to default tests when unconfigured (AI absent)", async () => {
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 204 }, { config: config({ apiKey: null, provider: null }) });
    expect(tests[0]).toContain("status is 204");
    expect(tests.some((t) => t.includes("response has body"))).toBe(true);
  });

  it("falls back to defaults when the provider throws", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => { throw new Error("network"); }) } as any;
    const tests = await generateTests({ method: "GET", url: "https://x" }, { status: 200 }, { config: config(), registry: reg });
    expect(tests[0]).toContain("status is 200");
  });
});

describe("listModels", () => {
  it("delegates to the resolved provider", async () => {
    const reg = { get: () => stubProvider("anthropic", async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]) } as any;
    expect(await listModels({ config: config(), registry: reg })).toEqual(["claude-opus-4-8"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/assist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/assist.ts`**

```ts
import { AIProviderRegistry, type ProviderContext, type FetchLike } from "./providerRegistry";
import { resolveAiConfig, requireApiKey, AiConfigError, type AiConfig, type AiConfigOptions } from "./config";
import { searchRequestsContext, flattenCollections, buildResponseContext, buildCollectionContext } from "./context";
import { buildAssistSystemPrompt, buildTestsSystemPrompt, buildTestsUserMessage, type AssistPromptContext } from "./prompts";

const defaultFetch: FetchLike = (url, init) => (globalThis.fetch as any)(url, init);

export interface AssistInput {
  prompt: string;
  collections: any[];
  currentState?: AssistPromptContext["currentState"];
  responseData?: any;
  activeSessionId?: string | null;
  chatSessions?: { id: string; timestamp: number }[];
}

export interface AssistDeps {
  /** Pre-resolved config; else resolveAiConfig(configOptions) is used. */
  config?: AiConfig;
  configOptions?: AiConfigOptions;
  fetch?: FetchLike;
  semanticSearch?: (prompt: string) => Promise<{ id: string }[]>;
  registry?: typeof AIProviderRegistry;
  log?: (entry: any) => void;
}

export interface AssistResult {
  message: string;
  operations: any[];
  _usage: { input: number; output: number } | null;
  _model: string;
}

function providerCtx(config: AiConfig, deps: AssistDeps): { chat: (req: any) => Promise<any>; listModels: () => Promise<string[]> } {
  const { provider, apiKey } = requireApiKey(config);
  const registry = deps.registry ?? AIProviderRegistry;
  const p = registry.get(provider);
  if (!p) throw new AiConfigError(`Unknown AI provider "${provider}"`);
  const ctx: ProviderContext = { apiKey, fetch: deps.fetch ?? defaultFetch, log: deps.log };
  return {
    chat: (req) => p.chat(req, ctx),
    listModels: () => p.listModels(ctx),
  };
}

export async function assist(input: AssistInput, deps: AssistDeps = {}): Promise<AssistResult> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  const { chat } = providerCtx(config, deps);

  let relevant = searchRequestsContext(input.prompt, input.collections);
  if (config.semanticSearchEnabled && deps.semanticSearch) {
    try {
      const sem = await deps.semanticSearch(input.prompt);
      if (sem && sem.length > 0) {
        const flat = flattenCollections(input.collections);
        const semObjs = sem.map((s) => flat.find((r: any) => r.id === s.id)).filter(Boolean);
        relevant = [...semObjs, ...relevant].filter((v: any, i, a) => a.findIndex((v2: any) => v2.id === v.id) === i).slice(0, 10);
      }
    } catch {
      // Fall back to fuzzy-only results.
    }
  }

  const sessionContext: any = {};
  if (config.provider === "openai" && input.activeSessionId) {
    sessionContext.conversation_id = input.activeSessionId;
  } else if (config.provider === "gemini" && input.chatSessions && input.chatSessions.length > 0) {
    const sorted = [...input.chatSessions].sort((a, b) => b.timestamp - a.timestamp);
    sessionContext.past_conversation_ids = sorted.slice(0, 5).map((s) => s.id);
  }

  const systemPrompt = buildAssistSystemPrompt({
    currentState: input.currentState ?? {},
    responseContext: buildResponseContext(input.responseData ?? null),
    collectionContext: buildCollectionContext(input.collections),
    relevantRequests: relevant,
  });

  const { result, usage, model } = await chat({
    model: config.model ?? undefined,
    systemPrompt,
    userMessage: input.prompt,
    format: "json",
    sessionContext,
  });

  const operations = Array.isArray(result?.operations) ? result.operations : [];
  for (const op of operations) {
    if (op?.type === "SUGGEST_ENDPOINTS" && op.payload && op.payload.endpointIds) {
      op.payload.endpoints = [];
      for (const id of op.payload.endpointIds) {
        const found = relevant.find((r: any) => r.id === id);
        if (found) op.payload.endpoints.push(found);
      }
    }
  }

  return { message: result?.message ?? "", operations, _usage: usage, _model: model };
}

export async function generateTests(request: any, response: any, deps: AssistDeps = {}): Promise<string[]> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  if (config.provider && config.apiKey) {
    try {
      const { chat } = providerCtx(config, deps);
      const { result } = await chat({
        model: config.model ?? undefined,
        systemPrompt: buildTestsSystemPrompt(),
        userMessage: buildTestsUserMessage(request, response),
        format: "json",
      });
      if (result && Array.isArray(result.tests)) return result.tests;
    } catch {
      // Fall through to non-LLM defaults.
    }
  }
  const status = response?.status || 200;
  return [
    `pm.test("status is ${status}", () => pm.response.to.have.status(${status}));`,
    `pm.test("response has body", () => pm.response.text().length > 0);`,
  ];
}

export async function listModels(deps: AssistDeps = {}): Promise<string[]> {
  const config = deps.config ?? resolveAiConfig(deps.configOptions);
  const { listModels: list } = providerCtx(config, deps);
  return list();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/assist.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./assist";` and `export * from "./context";` and `export * from "./prompts";`

```bash
git add packages/core/src/ai/assist.ts packages/core/src/ai/assist.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): headless AI orchestration (assist/generateTests/listModels)"
```

---

## Task 12: `ai/surface/mcp.ts` — additive MCP tool descriptors

**Files:**
- Create: `packages/core/src/ai/surface/mcp.ts`
- Create: `packages/core/src/ai/surface/mcp.test.ts`

**Interfaces:**
- Consumes: `assist`, `generateTests`, `listModels`, `type AssistDeps` from `../assist`; `AiConfigError` from `../config`.
- Produces: `interface McpToolAnnotations { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }`; `interface McpToolResult { content: { type: "text"; text: string }[]; isError?: boolean }`; `interface McpToolDescriptor { name: string; description: string; inputSchema: Record<string, unknown>; annotations: McpToolAnnotations; handler(args: any): Promise<McpToolResult> }`; `interface AiMcpDeps extends AssistDeps { getCollections: () => any[] | Promise<any[]> }`; `createAiMcpTools(deps: AiMcpDeps): McpToolDescriptor[]` returning `ai_assist`, `ai_generate_tests`, `ai_list_models`.
- Annotations: all three are `readOnlyHint: true, openWorldHint: true` — they call an external LLM but do NOT mutate the library (they return suggested operations / generated text). Applying suggested operations (`CREATE_REQUEST`/`DELETE_REQUEST`/`MOVE_REQUEST`) is done via Phase 1's existing guarded write tools, which already carry `destructiveHint` and are hidden unless `--allow-writes`. This adapter deliberately adds no auto-applying/mutating tool.
- Integration seam (assumed): the Phase 1 MCP scaffold's tool registry accepts descriptors of this shape; it registers them in one line, e.g. `for (const t of createAiMcpTools({ getCollections })) registry.register(t)`.

- [ ] **Step 1: Write the failing test `packages/core/src/ai/surface/mcp.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createAiMcpTools } from "./mcp";
import { AIProviderRegistry, type AIProvider } from "../providerRegistry";
import type { AiConfig } from "../config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({ provider: "anthropic", model: null, apiKey: "k", keys: {}, semanticSearchEnabled: false, source: "flag", ...over });
const provider = (chat: AIProvider["chat"], list: AIProvider["listModels"] = async () => []): any => ({ get: () => ({ id: "anthropic", defaultModel: "m", chat, listModels: list }) });
const collections = () => [{ id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List", method: "GET", url: "https://x" }] }];

describe("createAiMcpTools", () => {
  it("exposes ai_assist / ai_generate_tests / ai_list_models as read-only, open-world tools", () => {
    const tools = createAiMcpTools({ getCollections: collections, config: config() });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["ai_assist", "ai_generate_tests", "ai_list_models"]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.openWorldHint).toBe(true);
      expect(t.annotations.destructiveHint).toBeUndefined();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("ai_assist runs the assistant with the loaded library and returns text", async () => {
    const reg = provider(async () => ({ result: { message: "done", operations: [] }, usage: null, model: "m" }));
    const tools = createAiMcpTools({ getCollections: collections, config: config(), registry: reg });
    const res = await tools[0].handler({ prompt: "find list" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("done");
  });

  it("returns an error result (not a throw) when unconfigured", async () => {
    const tools = createAiMcpTools({ getCollections: collections, config: config({ apiKey: null, provider: null }) });
    const res = await tools[0].handler({ prompt: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/No AI credentials/);
  });

  it("ai_list_models delegates to the provider", async () => {
    const reg = provider(async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]);
    const tools = createAiMcpTools({ getCollections: collections, config: config(), registry: reg });
    const res = await tools[2].handler({});
    expect(res.content[0].text).toContain("claude-opus-4-8");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/surface/mcp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/surface/mcp.ts`**

```ts
import { assist, generateTests, listModels, type AssistDeps } from "../assist";
import { AiConfigError } from "../config";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  handler(args: any): Promise<McpToolResult>;
}

export interface AiMcpDeps extends AssistDeps {
  /** Supplied by the Phase 1 MCP scaffold from its store (read access). */
  getCollections: () => any[] | Promise<any[]>;
}

function text(s: string): McpToolResult {
  return { content: [{ type: "text", text: s }] };
}

function toError(e: unknown): McpToolResult {
  const message = e instanceof AiConfigError || e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createAiMcpTools(deps: AiMcpDeps): McpToolDescriptor[] {
  const assistDeps: AssistDeps = { config: deps.config, configOptions: deps.configOptions, fetch: deps.fetch, semanticSearch: deps.semanticSearch, registry: deps.registry, log: deps.log };

  return [
    {
      name: "ai_assist",
      description: "Ask the AI assistant to analyze the library and suggest operations (read-only: returns a message plus suggested operations; does not mutate the library).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Natural-language instruction or question." },
          currentRequest: { type: "object", description: "Optional active request state (protocol/method/url/headersText/bodyText/graphqlConfig)." },
          responseData: { type: "object", description: "Optional last response (status/statusText/headers/body)." },
        },
        required: ["prompt"],
      },
      async handler(args: any): Promise<McpToolResult> {
        try {
          const collections = await deps.getCollections();
          const res = await assist(
            { prompt: args.prompt, collections, currentState: args.currentRequest, responseData: args.responseData ?? null },
            assistDeps,
          );
          return text(JSON.stringify({ message: res.message, operations: res.operations, model: res._model }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
    {
      name: "ai_generate_tests",
      description: "Generate pm.test() assertions for a request/response pair (read-only).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: "object",
        properties: {
          request: { type: "object", description: "Request object (method/url)." },
          response: { type: "object", description: "Response object (status/body)." },
        },
        required: ["request", "response"],
      },
      async handler(args: any): Promise<McpToolResult> {
        try {
          const tests = await generateTests(args.request, args.response, assistDeps);
          return text(JSON.stringify({ tests }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
    {
      name: "ai_list_models",
      description: "List available models for the configured AI provider (read-only).",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: { type: "object", properties: {} },
      async handler(): Promise<McpToolResult> {
        try {
          const models = await listModels(assistDeps);
          return text(JSON.stringify({ models }, null, 2));
        } catch (e) {
          return toError(e);
        }
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/surface/mcp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./surface/mcp";`

```bash
git add packages/core/src/ai/surface/mcp.ts packages/core/src/ai/surface/mcp.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): additive MCP tool descriptors for AI assist"
```

---

## Task 13: `ai/surface/cli.ts` — additive CLI command descriptors

**Files:**
- Create: `packages/core/src/ai/surface/cli.ts`
- Create: `packages/core/src/ai/surface/cli.test.ts`

**Interfaces:**
- Consumes: `assist`, `generateTests`, `listModels`, `type AssistDeps` from `../assist`; `AiConfigError` from `../config`.
- Produces: `interface CliCommandResult { exitCode: number; stdout?: string; stderr?: string }`; `interface CliCommandDescriptor { name: string; summary: string; run(argv: string[], flags: Record<string, any>): Promise<CliCommandResult> }`; `interface AiCliDeps extends AssistDeps { getCollections: () => any[] | Promise<any[]>; runRequest?: (ref: string) => Promise<{ request: any; response: any }> }`; `createAiCliCommands(deps: AiCliDeps): CliCommandDescriptor[]` returning one `ai` command that dispatches subcommands `assist` (default), `tests <ref>`, `models`. Exit codes follow the spec (`0` success, `1` runtime error, `3` usage error). `--json` flag switches to JSON output.
- Integration seam (assumed): the Phase 2 CLI scaffold's command registry accepts descriptors of this shape and maps `run(...)`'s returned `exitCode`/`stdout`/`stderr` to `process.exit` + stdio; it owns global flags (`--env`, `--data-dir`, reporter) and ref resolution (via the injected `runRequest`).

- [ ] **Step 1: Write the failing test `packages/core/src/ai/surface/cli.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createAiCliCommands } from "./cli";
import type { AIProvider } from "../providerRegistry";
import type { AiConfig } from "../config";

const config = (over: Partial<AiConfig> = {}): AiConfig => ({ provider: "anthropic", model: null, apiKey: "k", keys: {}, semanticSearchEnabled: false, source: "flag", ...over });
const reg = (chat: AIProvider["chat"], list: AIProvider["listModels"] = async () => []): any => ({ get: () => ({ id: "anthropic", defaultModel: "m", chat, listModels: list }) });
const collections = () => [{ id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "List", method: "GET", url: "https://x" }] }];

describe("createAiCliCommands", () => {
  it("exposes a single 'ai' command", () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config() });
    expect(cmds.map((c) => c.name)).toEqual(["ai"]);
  });

  it("assist prints the message and exits 0", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { message: "hello", operations: [] }, usage: null, model: "m" })) });
    const res = await cmds[0].run(["find list"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello");
  });

  it("assist with --json emits a JSON envelope", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { message: "hi", operations: [{ type: "SEND_REQUEST", payload: {} }] }, usage: null, model: "m" })) });
    const res = await cmds[0].run(["do it"], { json: true });
    const parsed = JSON.parse(res.stdout!);
    expect(parsed.message).toBe("hi");
    expect(parsed.operations[0].type).toBe("SEND_REQUEST");
  });

  it("models lists provider models", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: {}, usage: null, model: "m" }), async () => ["claude-opus-4-8"]) });
    const res = await cmds[0].run(["models"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("claude-opus-4-8");
  });

  it("tests <ref> resolves+runs via injected runRequest, then generates tests", async () => {
    const runRequest = async () => ({ request: { method: "GET", url: "https://x" }, response: { status: 200, body: "{}" } });
    const cmds = createAiCliCommands({ getCollections: collections, config: config(), registry: reg(async () => ({ result: { tests: ["pm.test('a', () => {});"] }, usage: null, model: "m" })), runRequest });
    const res = await cmds[0].run(["tests", "API/List"], {});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("pm.test('a'");
  });

  it("tests <ref> without a runner is a usage error (exit 3)", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config() });
    const res = await cmds[0].run(["tests", "API/List"], {});
    expect(res.exitCode).toBe(3);
  });

  it("returns a usage error (exit 3) when unconfigured", async () => {
    const cmds = createAiCliCommands({ getCollections: collections, config: config({ apiKey: null, provider: null }) });
    const res = await cmds[0].run(["anything"], {});
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toMatch(/No AI credentials/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/ai/surface/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/ai/surface/cli.ts`**

```ts
import { assist, generateTests, listModels, type AssistDeps } from "../assist";
import { AiConfigError } from "../config";

export interface CliCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface CliCommandDescriptor {
  name: string;
  summary: string;
  run(argv: string[], flags: Record<string, any>): Promise<CliCommandResult>;
}

export interface AiCliDeps extends AssistDeps {
  getCollections: () => any[] | Promise<any[]>;
  /** Phase 2 CLI scaffold injects its ref-resolver + executor for `ai tests <ref>`. */
  runRequest?: (ref: string) => Promise<{ request: any; response: any }>;
}

function assistDepsOf(deps: AiCliDeps): AssistDeps {
  return { config: deps.config, configOptions: deps.configOptions, fetch: deps.fetch, semanticSearch: deps.semanticSearch, registry: deps.registry, log: deps.log };
}

export function createAiCliCommands(deps: AiCliDeps): CliCommandDescriptor[] {
  const shared = assistDepsOf(deps);

  return [
    {
      name: "ai",
      summary: "AI assist: `ai <prompt>` (analyze/suggest), `ai models` (list models), `ai tests <ref>` (generate tests).",
      async run(argv, flags): Promise<CliCommandResult> {
        try {
          const sub = argv[0];

          if (sub === "models") {
            const models = await listModels(shared);
            return flags.json
              ? { exitCode: 0, stdout: JSON.stringify({ models }, null, 2) }
              : { exitCode: 0, stdout: models.join("\n") };
          }

          if (sub === "tests") {
            const ref = argv[1];
            if (!ref) return { exitCode: 3, stderr: "usage: ai tests <ref>" };
            if (!deps.runRequest) return { exitCode: 3, stderr: "ai tests requires a request runner (not available in this context)" };
            const { request, response } = await deps.runRequest(ref);
            const tests = await generateTests(request, response, shared);
            return flags.json
              ? { exitCode: 0, stdout: JSON.stringify({ tests }, null, 2) }
              : { exitCode: 0, stdout: tests.join("\n") };
          }

          const prompt = argv.join(" ").trim();
          if (!prompt) return { exitCode: 3, stderr: "usage: ai <prompt>" };
          const collections = await deps.getCollections();
          const res = await assist({ prompt, collections }, shared);
          if (flags.json) {
            return { exitCode: 0, stdout: JSON.stringify({ message: res.message, operations: res.operations, model: res._model }, null, 2) };
          }
          const opsLine = res.operations.length ? `\n\nSuggested operations: ${res.operations.map((o: any) => o.type).join(", ")}` : "";
          return { exitCode: 0, stdout: `${res.message}${opsLine}` };
        } catch (e) {
          if (e instanceof AiConfigError) return { exitCode: 3, stderr: e.message };
          return { exitCode: 1, stderr: e instanceof Error ? e.message : String(e) };
        }
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/ai/surface/cli.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Re-export, run the full core suite, and commit**

Add to `packages/core/src/ai/index.ts`: `export * from "./surface/cli";`

Run: `npm test -- packages/core/src/ai` (all AI unit tests) — expected: all pass.
Run: `npm run lint` — expected: no new errors under `packages/core/src/ai`.

```bash
git add packages/core/src/ai/surface/cli.ts packages/core/src/ai/surface/cli.test.ts packages/core/src/ai/index.ts
git commit -m "feat(core): additive CLI command descriptors for AI assist"
```

---

## Task 14: Renderer parity — repoint `src/services/ai.ts` at `@portiq/core/ai`

**Files:**
- Rewrite: `src/services/ai.ts` (thin adapter; preserves the four exported signatures)

**Interfaces:**
- Consumes: `assist`, `generateTests`, `listModels`, `summarizeResponse`, `type AiConfig`, `type FetchLike` from `@portiq/core/ai`; `SemanticSearch` from `../utils/semanticSearch`; `safeFetch` from `../utils/safeFetch`.
- Produces (UNCHANGED public signatures so `App.tsx` / `SettingsModal.tsx` do not change): `fetchModels(provider: string, apiKey: string, addLog: (e: any) => void): Promise<string[]>`; `generateRequestFromPrompt(prompt, currentState, collections, aiSettings, activeAiSessionId, aiChatSessions, responseData?): Promise<any>`; `generateTestsFromResponse(request, response, aiSettings): Promise<string[]>`; `summarizeResponse(response): { summary: string; hints: string[] }`.
- The renderer injects (a) a `FetchLike` that maps core's real provider URLs back to `safeFetch`'s CORS-bypassing proxy roots, and (b) `SemanticSearch.search` as the optional semantic dependency. Credentials still come from the renderer's `aiSettings` object (localStorage-backed), converted to an `AiConfig`.

- [ ] **Step 1: Rewrite `src/services/ai.ts` as a thin adapter**

Replace the entire file with (this deletes the moved `parseLLMJson`/`callLLM`/prompt/context logic, which now lives in core):

```ts
import {
  assist,
  generateTests as coreGenerateTests,
  listModels as coreListModels,
  summarizeResponse as coreSummarizeResponse,
  type AiConfig,
  type FetchLike,
} from "@portiq/core/ai";
import { SemanticSearch } from "../utils/semanticSearch";
import { safeFetch } from "../utils/safeFetch";

/** Map core's canonical provider URLs back to safeFetch's proxy roots so the
 *  renderer keeps its CORS-bypass / Electron-IPC transport behavior. */
const rendererFetch: FetchLike = (url, init) => {
  const proxied = String(url)
    .replace("https://api.openai.com", "/proxy-openai")
    .replace("https://api.anthropic.com", "/proxy-anthropic")
    .replace("https://generativelanguage.googleapis.com", "/proxy-gemini");
  return safeFetch(proxied, init as any);
};

function toConfig(aiSettings: any): AiConfig {
  const provider = aiSettings?.provider ?? null;
  return {
    provider,
    model: aiSettings?.model ?? null,
    apiKey: provider ? (aiSettings?.keys?.[provider] ?? null) : null,
    keys: aiSettings?.keys ?? {},
    semanticSearchEnabled: Boolean(aiSettings?.semanticSearchEnabled),
    source: "desktop",
  };
}

export async function fetchModels(provider: string, apiKey: string, addLog: (entry: any) => void): Promise<string[]> {
  if (!apiKey) {
    if (addLog) addLog({ source: "AI", type: "info", message: `Skipped fetching models: No API key for ${provider}` });
    return [];
  }
  try {
    return await coreListModels({
      config: { provider, model: null, apiKey, keys: { [provider]: apiKey } as any, semanticSearchEnabled: false, source: "desktop" },
      fetch: rendererFetch,
    });
  } catch (error: any) {
    console.warn(`Could not fetch models for ${provider}:`, error);
    return [];
  }
}

export async function generateRequestFromPrompt(
  prompt: string,
  currentState: any,
  collections: any[],
  aiSettings: any,
  activeAiSessionId: string,
  aiChatSessions: any[],
  responseData: any = null,
) {
  return assist(
    { prompt, currentState, collections, responseData, activeSessionId: activeAiSessionId, chatSessions: aiChatSessions },
    { config: toConfig(aiSettings), fetch: rendererFetch, semanticSearch: async (p) => (await SemanticSearch.search(p)) || [] },
  );
}

export async function generateTestsFromResponse(request: any, response: any, aiSettings: any) {
  return coreGenerateTests(request, response, { config: toConfig(aiSettings), fetch: rendererFetch });
}

export async function summarizeResponse(response: any) {
  return coreSummarizeResponse(response);
}
```

- [ ] **Step 2: Type-check + build the renderer to confirm the adapter compiles and App/SettingsModal are unchanged**

Run: `npm run build:core` (emits `dist/ai/**` used by the `require` mapping) then `npm run build` (Vite renderer build).
Expected: build succeeds. `App.tsx` and `SettingsModal.tsx` still import the same four functions with the same signatures — no edits required there.

- [ ] **Step 3: Run the full test suite + lint**

Run: `npm test`
Expected: all tests pass (existing suite + new AI tests). Run `npm run lint` — expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/ai.ts
git commit -m "refactor(renderer): delegate AI service to @portiq/core/ai (parity)"
```

---

## Task 15: Activate the desktop-stored credential tier — mirror AI settings into the shared kv store

This is the bridge that makes the lowest-precedence tier real: the desktop app persists AI settings into the shared SQLite kv store (`aiSettings` key) so headless CLI/MCP invocations can discover desktop-configured provider/model/keys. Without it, the kv tier is dormant (only file/env/flag work headlessly).

**Files:**
- Create: `packages/core/src/ai/desktopTier.test.ts` (automated end-to-end proof of the tier)
- Modify: `electron/main.cjs` (add an additive `ai:saveConfig` IPC handler)
- Modify: `electron/preload.cjs` (expose `window.api.saveAiConfig`)
- Modify: `src/App.tsx` (persist AI settings to the store when they change)

**Interfaces:**
- Consumes: `saveAiConfig`, `resolveAiConfig` from `@portiq/core/ai` (electron requires `@portiq/core/ai`); `core.resolveDataDir()` (already used by the main process).
- Produces: IPC channel `ai:saveConfig` (main) → `window.api.saveAiConfig(config)` (renderer). The main handler calls `saveAiConfig(config)` with no `dataDir` override so it resolves the same canonical path the app already uses (data-location contract).

- [ ] **Step 1: Write the failing end-to-end tier test `packages/core/src/ai/desktopTier.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails, then passes (no core change needed — it exercises Task 1 code end-to-end)**

Run: `npm test -- packages/core/src/ai/desktopTier.test.ts`
Expected: PASS immediately (Task 1 already implements `saveAiConfig`/`resolveAiConfig`; this test locks the desktop→headless contract). If it fails on module resolution, ensure `saveAiConfig`/`resolveAiConfig` are exported from `packages/core/src/ai/index.ts` (they are, via `export * from "./config"`).

- [ ] **Step 3: Add the additive `ai:saveConfig` IPC handler in `electron/main.cjs`**

Near the other `ipcMain.handle(...)` registrations (the file already does `const core = require("@portiq/core");`), add:

```js
const aiCore = require("@portiq/core/ai");

ipcMain.handle("ai:saveConfig", (_event, config) => {
  try {
    aiCore.saveAiConfig(config || {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
```

(No `dataDir` is passed, so `saveAiConfig` resolves the canonical path — the same store the app is already pinned to via `app.setName("Portiq")` / `resolveDataDir()`.)

- [ ] **Step 4: Expose it in `electron/preload.cjs`**

In the `contextBridge.exposeInMainWorld("api", { ... })` object, add:

```js
  saveAiConfig: (config) => ipcRenderer.invoke("ai:saveConfig", config),
```

- [ ] **Step 5: Persist AI settings to the store when they change (`src/App.tsx`)**

Add an effect alongside the existing AI-settings state (near `src/App.tsx:380-386`). It mirrors the renderer's localStorage-backed AI settings into the shared store so headless surfaces can read them:

```tsx
  useEffect(() => {
    window.api?.saveAiConfig?.({
      provider: aiProvider,
      model: activeModel,
      keys: { openai: aiApiKeyOpenAI, anthropic: aiApiKeyAnthropic, gemini: aiApiKeyGemini },
      semanticSearchEnabled: aiSemanticSearchEnabled,
    });
  }, [aiProvider, activeModel, aiApiKeyOpenAI, aiApiKeyAnthropic, aiApiKeyGemini, aiSemanticSearchEnabled]);
```

- [ ] **Step 6: Build + smoke-verify the CJS subpath require works, then commit**

Run: `npm run build:core`
Run: `node -e "const ai = require('@portiq/core/ai'); ai.saveAiConfig({ provider: 'openai' }, { dataDir: require('os').tmpdir() + '/portiq-smoke' }); console.log('ai subpath require OK:', typeof ai.saveAiConfig);"`
Expected: prints `ai subpath require OK: function` (proves the `"./ai"` → `dist/ai/index.js` mapping resolves for CJS/Electron).
Run: `npm test -- packages/core/src/ai/desktopTier.test.ts` — expected PASS.

> Manual (interactive, for the user; needs `npm run rebuild` to restore the Electron better-sqlite3 ABI): `npm run dev`, set an API key in Settings, confirm no console error from `ai:saveConfig`, then in a plain-Node shell (after `npm rebuild better-sqlite3`) confirm `resolveAiConfig()` returns that provider/key. This mirrors the interactive-smoke deferral used in Phase 0 Task 16.

```bash
git add packages/core/src/ai/desktopTier.test.ts electron/main.cjs electron/preload.cjs src/App.tsx
git commit -m "feat(desktop): mirror AI settings into shared store for headless credential tier"
```

---

## Open Questions & Assumptions

### DECISION — Credential / config sourcing (resolves the spec's deferred Phase 3 open question)

AI assist in a headless context resolves provider/model/keys through a single resolver, `resolveAiConfig(opts)` (Task 1), whose precedence mirrors the data-location contract's style (`--data-dir` flag → `PORTIQ_DATA_DIR` env → config file → canonical default):

1. **Flag / explicit option** — `opts.provider` / `opts.model` / `opts.apiKey` (CLI `--ai-provider` / `--ai-model` / `--ai-key`; MCP server flags map here).
2. **Env** — Portiq env (`PORTIQ_AI_PROVIDER`, `PORTIQ_AI_MODEL`, `PORTIQ_AI_API_KEY`) then provider-native env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`). A lone native key also infers the provider.
3. **Config file** — `PORTIQ_AI_CONFIG` path, else `<resolveDataDir()>/ai.json`: `{ provider, model, keys: { openai, anthropic, gemini }, semanticSearchEnabled }`.
4. **Desktop-stored setting** — the shared SQLite kv key `aiSettings` (written by the desktop app, Task 15). This is the bridge for "install the app, configure keys there, then use the CLI/MCP" without re-entering keys.

`requireApiKey()` throws `AiConfigError` when nothing resolves; every credentialed entry point (`assist`, `generateTests` — before falling back —, `listModels`, and the surface adapters) reports this cleanly rather than crashing. Storage/path is always via `core.resolveDataDir()` / `openKvStore()` (never re-derived).

### Assumptions
- **MCP/CLI scaffolds exist (Phase 1/2).** Surface adapters (Tasks 12–13) return framework-free descriptor arrays; the scaffolds register them in one line and own transport, global flags, ref resolution, and exit-code plumbing. If the real registry shapes differ, only `ai/surface/mcp.ts` / `ai/surface/cli.ts` change — core is untouched. This plan builds **no** scaffolding.
- **No `@anthropic-ai/sdk` dependency.** The current feature is a raw-HTTP multi-provider client (openai/anthropic/gemini). Preserving parity + keeping AI optional + YAGNI means keeping raw HTTP through an injected `FetchLike`; adding the SDK would break openai/gemini parity and force a heavy dep. Per the model-ID constraint, the Anthropic provider's default is updated to the current `claude-opus-4-8` (was `claude-3-5-sonnet-latest`); `anthropic-version: 2023-06-01` remains current for `/v1/messages`.
- **Thinking left off / `max_tokens` kept at 2000.** The assistant must emit strict JSON; enabling adaptive thinking on `claude-opus-4-8` (which runs thinking-off when unset) would risk interleaving non-JSON reasoning and needs larger `max_tokens`. Behavior parity + JSON reliability → keep thinking off and `max_tokens` 2000 (exposed as `req.maxTokens` for a future bump). Consulted the `claude-api` skill; this is a deliberate, reversible choice.

### Open questions / risks
- **Plaintext keys.** `ai.json` and the kv `aiSettings` store API keys in plaintext (matching today's renderer localStorage). For CI/shared machines, prefer provider-native env vars or `--ai-key` (never persisted). Logs use `redactKey()`. A future encrypted-at-rest keystore is out of scope.
- **Semantic search is renderer-only.** `SemanticSearch` (Web Worker + `@huggingface/transformers`) cannot run headlessly; `assist` treats it as an injected optional dependency and silently falls back to fuzzy search when absent (headless CLI/MCP). No behavior change in the desktop app.
- **kv version reconciliation (carried from Phase 0 follow-up #1).** Reads of `aiSettings` are always safe; `saveAiConfig` uses `KvStore.set` (unversioned), consistent with the current main-process `db:*` writes. If/when both paths adopt `setIfVersion`, revisit.
- **`@portiq/core/ai` dist subpath.** The `"./ai"` export maps `require` → `dist/ai/index.js`; `tsconfig.build.json` already emits it. Phase 4 packaging must confirm `electron-builder` bundles `packages/core/dist/ai/**` (same follow-up already tracked for the top barrel and flows).

---

## Self-Review

**1. Spec coverage** (spec §"Phase 3 — Parity fill": the `ai/` core-module row + "AI-assisted tools" for CLI and MCP; §"Open questions/risks" credential decision):
- `ai/` core module extracted, framework-free, headless: Tasks 1–11 (config, registry, providers, parse, context, prompts, summarize, orchestration). ✔
- Self-registering: `AIProviderRegistry` + `ai/index.ts` registration (Tasks 2, 7). ✔
- Credential/config-sourcing decision resolved + designed-around + prominently documented: Task 1 + Open Questions "DECISION". ✔
- AI-assisted tools for MCP (additive, annotated): Task 12. ✔
- AI-assisted commands for CLI (additive): Task 13. ✔
- MCP annotations for mutation: covered — AI tools are read-only (`readOnlyHint`/`openWorldHint`); mutation defers to Phase 1 guarded write tools; documented in Task 12. ✔
- Tests with provider mocked, no real network/key: every provider/orchestration/surface test uses stub fetch or a stub registry (Tasks 4–6, 11–13). ✔
- Prompt construction, credential precedence, and no-credentials error asserted: Tasks 9, 1, 11. ✔
- AI optional (base builds/passes with AI absent): subpath-only export + `summarizeResponse` pure + `generateTests` fallback + `AiConfigError` (Global Constraints; Tasks 10, 11). ✔
- Feature parity preserved (fetchModels, generateRequestFromPrompt incl. semantic merge + compression + SUGGEST_ENDPOINTS rehydration, generateTests + fallback, summarizeResponse): Tasks 5–11 + renderer shim Task 14. ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step contains complete, real code; every port cites exact source lines. ✔

**3. Type consistency:** `AiConfig`, `AiConfigOptions`, `AiConfigError` (Task 1) are consumed unchanged by Tasks 11–14. `FetchLike`/`ChatRequest`/`ChatResult`/`AIProvider`/`ProviderContext` (Task 2) are consumed unchanged by Tasks 4–6, 11. `AssistDeps`/`AssistInput`/`AssistResult` (Task 11) are consumed unchanged by Tasks 12–14. `McpToolDescriptor` (Task 12) and `CliCommandDescriptor`/`CliCommandResult` (Task 13) are self-contained. Renderer shim (Task 14) preserves the exact four exported signatures used at `src/App.tsx:5/2578/2198/2317/2437/401` and `SettingsModal.tsx:93`. ✔

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-24-phase3-parity-ai-assist.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

- **If Subagent-Driven:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (fresh subagent per task + two-stage review).
- **If Inline Execution:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (batch execution with checkpoints).
