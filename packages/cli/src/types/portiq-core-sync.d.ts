// Ambient module shim for `@portiq/core/sync`, scoped to the CommonJS
// production build (tsconfig.build.json).
//
// Editor/vitest use `moduleResolution: "Bundler"` (tsconfig.json), which
// understands @portiq/core's package.json `exports["./sync"]` map and
// resolves straight to the real TypeScript source
// (packages/core/src/sync/index.ts) — real types, no shim needed there.
//
// The production build uses classic `moduleResolution: "Node"` (needed so
// the emitted CommonJS `require("@portiq/core/sync")` matches the
// `require`-condition/dist target — dist/sync/index.cjs — at runtime).
// Classic resolution does not understand `exports` subpath maps at all, and
// @portiq/core emits no `.d.ts` files for its dist output, so the build
// cannot otherwise see any types for this subpath. This shim supplies the
// minimal shape the CLI actually consumes (packages/cli/src/commands/sync.ts)
// so the build type-checks; it mirrors (does not import) the real shapes in
// packages/core/src/sync/{types,engine,githubRemote,localRemote,auth}.ts.
declare module "@portiq/core/sync" {
  import type { AppState } from "@portiq/core";

  export interface SyncRepoInfo { owner: string; repo: string; defaultBranch: string; }
  export interface FetchWorkspaceResult { fileMap?: Record<string, unknown>; legacy?: unknown; }
  export interface SyncRemote {
    getIdentity(): Promise<{ login: string }>;
    ensureRepo(): Promise<SyncRepoInfo>;
    fetchWorkspace(): Promise<FetchWorkspaceResult>;
    pushFiles(desiredFiles: Record<string, unknown>, managedPrefixes: string[]): Promise<void>;
  }
  export interface SyncFileDiff { path: string; state: "added" | "removed" | "modified"; }
  export interface SyncStatus {
    repo: string; branch: string; remoteExists: boolean;
    legacy: boolean; inSync: boolean; diffs: SyncFileDiff[];
  }
  export class SyncConflictError extends Error {}
  export function syncPush(remote: SyncRemote, state: AppState, opts?: { maskedVarIds?: Set<string>; history?: unknown[] }): Promise<void>;
  export function syncPullToStore(remote: SyncRemote, opts?: { dataDir?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string }, store?: unknown): Promise<{ appState: AppState; history: unknown[]; version: number }>;
  export function syncStatus(remote: SyncRemote, state: AppState): Promise<SyncStatus>;
  export function createGithubRemote(opts: { token: string; client?: unknown }): SyncRemote;
  export function createLocalGitRemote(opts: { dir: string }): SyncRemote;
  export function resolveGitHubToken(opts?: { token?: string; dataDir?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string }): string | null;
}
