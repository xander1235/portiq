// @portiq/core/ai — headless AI assist. Exposed via the package.json "./ai"
// subpath (NOT the top barrel) so AI stays opt-in and the base build is unaffected.
// Providers self-register into AIProviderRegistry below (populated in Task 7).
export * from "./config";
export * from "./providerRegistry";
export * from "./parseLLMJson";
