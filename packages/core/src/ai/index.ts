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
export * from "./summarize";
export * from "./assist";
export * from "./context";
export * from "./prompts";
export * from "./surface/mcp";
export * from "./surface/cli";
export { openaiProvider, OPENAI_DEFAULT_MODEL } from "./providers/openai";
export { anthropicProvider, ANTHROPIC_DEFAULT_MODEL } from "./providers/anthropic";
export { geminiProvider, GEMINI_DEFAULT_MODEL } from "./providers/gemini";
