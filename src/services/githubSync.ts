import { getGitHubToken } from "./githubAuth";
import {
  buildWorkspaceFiles,
  buildHistoryFiles,
  previewMaskableVars,
  mergePulledState,
  createGithubRemote,
  isSecretPlaceholder,
  parseSecretPlaceholder,
  SECRET_PLACEHOLDER_PREFIX,
  WORKSPACE_MANAGED_PREFIXES,
  HISTORY_PREFIX,
  type SyncRemote,
} from "@portiq/core/sync/browser";
import { toSteps } from "@portiq/core";

// Re-export for existing consumers (TableEditor.tsx imports these two).
export { isSecretPlaceholder, parseSecretPlaceholder, SECRET_PLACEHOLDER_PREFIX };

function buildRemote(): SyncRemote {
  const token = getGitHubToken();
  if (!token) throw new Error("No GitHub token found.");
  // Octokit runs in the renderer (GitHub REST is CORS-permitted), exactly as before.
  return createGithubRemote({ token });
}

// ---- renderer state I/O (unchanged behavior) ----

function getStorageJson(key: string, fallback: any = null): any {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function setStorageJson(key: string, value: any): void {
  localStorage.setItem(key, JSON.stringify(value));
}

async function getAppStateSnapshot(): Promise<any> {
  try {
    if ((window as any).api?.loadState) {
      const raw = await (window as any).api.loadState("appState");
      if (raw) return JSON.parse(raw);
    }
  } catch {
    // fall through
  }
  return getStorageJson("appState", {}) || {};
}

async function saveAppStateSnapshot(appState: any): Promise<void> {
  const encoded = JSON.stringify(appState);
  if ((window as any).api?.saveState) {
    await (window as any).api.saveState("appState", encoded);
  }
  localStorage.setItem("appState", encoded);
}

function writeLegacyStateToStorage(data: any): void {
  Object.entries(data || {}).forEach(([key, value]) => {
    const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    localStorage.setItem(key, strValue);
  });
}

function writeWorkspaceStateToStorage(appState: any, history: any[]): void {
  setStorageJson("ui_collections", appState.collections || []);
  setStorageJson("ui_activeCollectionId", appState.activeCollectionId || "");
  setStorageJson("ui_environments", appState.environments || []);
  setStorageJson("ui_activeEnvId", appState.activeEnvId || "");
  setStorageJson("ui_history", history || []);
  setStorageJson("ui_historyRetentionDays", appState.historyRetentionDays || 7);
  setStorageJson("ui_method", appState.method || "GET");
  setStorageJson("ui_url", appState.url || "");
  setStorageJson("ui_headersText", appState.headersText || "");
  setStorageJson("ui_bodyText", appState.bodyText || "");
  setStorageJson("ui_testsPreSteps", toSteps(appState.testsPreSteps, appState.testsPreText));
  setStorageJson("ui_testsPostSteps", toSteps(appState.testsPostSteps, appState.testsPostText));
  setStorageJson("ui_testsInputText", appState.testsInputText || "");
  setStorageJson("ui_httpVersion", appState.httpVersion || "auto");
  setStorageJson("ui_requestTimeoutMs", appState.requestTimeoutMs || 30000);
  setStorageJson("ui_paramsRows", appState.paramsRows || []);
  setStorageJson("ui_headersRows", appState.headersRows || []);
  setStorageJson("ui_authRows", appState.authRows || []);
  setStorageJson("ui_authType", appState.authType || "none");
  setStorageJson("ui_authConfig", appState.authConfig || {});
  setStorageJson("ui_bodyType", appState.bodyType || "json");
  setStorageJson("ui_bodyRows", appState.bodyRows || []);
  setStorageJson("ui_graphqlConfig", appState.graphqlConfig || {});
  setStorageJson("ui_wsConfig", appState.wsConfig || {});
  setStorageJson("ui_protocol", appState.protocol || "http");
  setStorageJson("ui_requestName", appState.requestName || "New Request");
  setStorageJson("ui_currentRequestId", appState.currentRequestId || "");
  setStorageJson("ui_activeRequestTab", appState.activeRequestTab || "Body");
  setStorageJson("ui_activeResponseTab", appState.activeResponseTab || "Pretty");
  setStorageJson("ui_headersMode", appState.headersMode || "table");
  setStorageJson("ui_testsMode", appState.testsMode || "post");
  setStorageJson("ui_selectedTablePath", appState.selectedTablePath || "$");
  setStorageJson("ui_search", appState.search || "");
  setStorageJson("ui_searchKey", appState.searchKey || "all");
  setStorageJson("ui_sortKey", appState.sortKey || "");
  setStorageJson("ui_sortDirection", appState.sortDirection || "asc");
}

// ---- public API (unchanged signatures) ----

export function previewEnvironmentsForSync() {
  const snapshot = getStorageJson("appState", null);
  const environments = snapshot?.environments || getStorageJson("ui_environments", []);
  return previewMaskableVars(environments);
}

export async function pushStateToGitHub(maskedVarIds: Set<string> = new Set<string>()) {
  const remote = buildRemote();
  const appState = await getAppStateSnapshot();
  await remote.ensureRepo();
  await remote.pushFiles(buildWorkspaceFiles(appState, maskedVarIds), WORKSPACE_MANAGED_PREFIXES);
  return true;
}

export async function pushHistoryToGitHub() {
  const remote = buildRemote();
  const appState = await getAppStateSnapshot();
  const history = getStorageJson("ui_history", []);
  await remote.ensureRepo();
  await remote.pushFiles(buildHistoryFiles(history, appState.collections || []), [HISTORY_PREFIX]);
  return true;
}

export async function pullStateFromGitHub() {
  const remote = buildRemote();
  const currentAppState = await getAppStateSnapshot();
  await remote.ensureRepo();
  const workspace = await remote.fetchWorkspace();

  if (workspace.legacy) {
    writeLegacyStateToStorage(workspace.legacy);
    return true;
  }

  const { appState, history } = mergePulledState(currentAppState, workspace.fileMap || {});
  await saveAppStateSnapshot(appState);
  writeWorkspaceStateToStorage(appState, history);
  return { appState, history };
}

export async function testGitHubConnection() {
  const remote = buildRemote();
  const identity = await remote.getIdentity();
  return identity; // shape: { login } — the modal reads user.login
}
