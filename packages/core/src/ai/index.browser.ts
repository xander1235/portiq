// @portiq/core/ai — renderer-safe AI entry (Vite resolves this via the
// resolve.alias in vite.config.js). Mirrors ./index.ts but EXCLUDES the
// Node-only pieces the renderer must never evaluate:
//   ./configStore            — node:fs + better-sqlite3 (file/kv config resolvers)
//   ./surface/{cli,mcp}      — CLI/MCP command/tool adapters (not used in the UI)
// The renderer injects a pre-resolved `config` into assist/generateTests/
// listModels, so the lazy `import("./configStore")` inside assist.ts never runs.
import { AIProviderRegistry } from "./providerRegistry";
import { openaiProvider } from "./providers/openai";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";

// Additive self-registration (mirrors ./index.ts). Import + register only.
AIProviderRegistry.register(openaiProvider);
AIProviderRegistry.register(anthropicProvider);
AIProviderRegistry.register(geminiProvider);

export * from "./config";
export * from "./providerRegistry";
export * from "./parseLLMJson";
export * from "./summarize";
export * from "./assist";
export * from "./context";
export * from "./prompts";
export { openaiProvider, OPENAI_DEFAULT_MODEL } from "./providers/openai";
export { anthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./providers/anthropic";
export { geminiProvider, GEMINI_DEFAULT_MODEL } from "./providers/gemini";
