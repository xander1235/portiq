import { WORKSPACE_ROOT, WORKSPACE_MANAGED_PREFIXES, HISTORY_PREFIX } from "./constants";
import { buildWorkspaceFiles, buildHistoryFiles } from "./serialize";
import { mergePulledState } from "./deserialize";
import type { SyncRemote, SyncStatus, SyncFileDiff, FetchWorkspaceResult } from "./types";
import type { AppState, HistoryEntry } from "../model";
import { openAppStateStore, type AppStateStore } from "../store/appStateStore";
import { ConflictError } from "../store/kvStore";
import type { ResolveDataDirOptions } from "../store/dataDir";

const MANIFEST_PATH = `${WORKSPACE_ROOT}/manifest.json`;

export class SyncConflictError extends Error {
  constructor(message = "Local store changed during pull; reload and retry.") {
    super(message);
    this.name = "SyncConflictError";
  }
}

export async function syncPush(
  remote: SyncRemote,
  state: AppState,
  opts: { maskedVarIds?: Set<string>; history?: HistoryEntry[] } = {},
): Promise<void> {
  await remote.ensureRepo();
  const workspaceFiles = buildWorkspaceFiles(state, opts.maskedVarIds ?? new Set());
  await remote.pushFiles(workspaceFiles, WORKSPACE_MANAGED_PREFIXES);
  if (opts.history) {
    const historyFiles = buildHistoryFiles(opts.history, (state as any).collections || []);
    await remote.pushFiles(historyFiles, [HISTORY_PREFIX]);
  }
}

export async function pullMerged(
  remote: SyncRemote,
  localState: AppState,
): Promise<{ appState: AppState; history: HistoryEntry[]; legacy?: any }> {
  await remote.ensureRepo();
  const workspace = await remote.fetchWorkspace();
  if (workspace.legacy) return { appState: localState, history: [], legacy: workspace.legacy };
  const merged = mergePulledState(localState, workspace.fileMap || {});
  return { appState: merged.appState, history: merged.history };
}

export async function syncPullToStore(
  remote: SyncRemote,
  opts: ResolveDataDirOptions = {},
  store?: AppStateStore,
): Promise<{ appState: AppState; history: HistoryEntry[]; version: number }> {
  const s = store ?? openAppStateStore(opts);
  try {
    const { state, version } = s.load();
    const localState = state ?? ({ collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
    const { appState, history } = await pullMerged(remote, localState);
    try {
      const newVersion = s.save(appState, version);
      return { appState, history, version: newVersion };
    } catch (e) {
      if (e instanceof ConflictError) throw new SyncConflictError();
      throw e;
    }
  } finally {
    if (!store) s.close();
  }
}

export async function syncStatus(remote: SyncRemote, localState: AppState): Promise<SyncStatus> {
  const info = await remote.ensureRepo();
  const identity = await remote.getIdentity().catch(() => ({ login: info.owner }));
  const workspace = await remote.fetchWorkspace().catch((e): FetchWorkspaceResult => {
    if (/No synced workspace/i.test(String(e?.message))) return { fileMap: {} };
    throw e;
  });

  if (workspace.legacy) {
    return { repo: `${identity.login}/${info.repo}`, branch: info.defaultBranch, remoteExists: true, legacy: true, inSync: false, diffs: [] };
  }

  const remoteFiles = workspace.fileMap || {};
  const localFiles = buildWorkspaceFiles(localState);
  const remoteExists = Object.keys(remoteFiles).length > 0;

  const diffs: SyncFileDiff[] = [];
  const allPaths = new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)]);
  for (const path of allPaths) {
    if (path === MANIFEST_PATH) continue; // updatedAt always differs; ignore
    const inLocal = path in localFiles;
    const inRemote = path in remoteFiles;
    if (inLocal && !inRemote) diffs.push({ path, state: "added" });
    else if (!inLocal && inRemote) diffs.push({ path, state: "removed" });
    else if (JSON.stringify(localFiles[path]) !== JSON.stringify(remoteFiles[path])) diffs.push({ path, state: "modified" });
  }

  return {
    repo: `${identity.login}/${info.repo}`,
    branch: info.defaultBranch,
    remoteExists,
    legacy: false,
    inSync: diffs.length === 0,
    diffs: diffs.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
