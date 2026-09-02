export interface SyncRepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface FetchWorkspaceResult {
  /** The workspace file tree (path -> decoded JSON). Present when a workspace exists. */
  fileMap?: Record<string, any>;
  /** Legacy single-file state.json payload, if that is all the remote has. */
  legacy?: any;
}

/**
 * The transport boundary for sync. Each backend (GitHub REST, local git repo)
 * implements these four operations; the engine is remote-agnostic.
 */
export interface SyncRemote {
  getIdentity(): Promise<{ login: string }>;
  ensureRepo(): Promise<SyncRepoInfo>;
  fetchWorkspace(): Promise<FetchWorkspaceResult>;
  /** Write every file in desiredFiles, then delete tracked files under
   *  managedPrefixes that are absent from desiredFiles (stale cleanup). */
  pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]): Promise<void>;
}

export type SyncRemoteFactory = (opts: any) => SyncRemote;

export interface SyncFileDiff {
  path: string;
  state: "added" | "removed" | "modified";
}

export interface SyncStatus {
  repo: string;
  branch: string;
  remoteExists: boolean;
  legacy: boolean;
  inSync: boolean;
  diffs: SyncFileDiff[];
}
