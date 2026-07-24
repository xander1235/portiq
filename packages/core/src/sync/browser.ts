// @portiq/core/sync/browser — renderer-safe subset of the GitHub sync surface,
// exposed via the package.json "./sync/browser" exports subpath (src-only, same
// as "./sync" — @octokit/rest is ESM and must not enter the CJS dist consumed by
// the electron main process).
//
// This is deliberately NARROWER than the full "./sync" barrel (./index.ts): it
// must never import localRemote.ts, which shells out via node:child_process
// (execFileSync git ls-files/rev-parse) and touches node:fs — Node-only code that
// has no business being bundled into the Vite renderer (nodeIntegration:false).
// It also skips engine.ts/auth.ts, which pull in the Node-only appStateStore
// (better-sqlite3) and dataDir/config-file resolution that the renderer doesn't
// use (the renderer reads/writes its own state via localStorage/window.api).
//
// Node consumers (electron main, future CLI/MCP) MUST keep importing the full
// "./sync" barrel — that is what keeps localRemote registered for them. Only
// the renderer (src/services/githubSync.ts) should import this subpath.
export * from "./constants";
export * from "./secrets";
export * from "./serialize";
export * from "./deserialize";
export * from "./types";
export * from "./registry";
// Importing githubRemote registers "github" in the shared registry as a
// module-scope side effect, mirroring how the full barrel registers "local".
export * from "./githubRemote";
