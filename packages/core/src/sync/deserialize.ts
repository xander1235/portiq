import { WORKSPACE_ROOT } from "./constants";
import { restoreRequestSecrets } from "./secrets";
import type { AppState, HistoryEntry } from "../model";

/**
 * Reconstructs the direct children written under `basePath` by
 * `serializeCollectionItems` (see serialize.ts). NOTE: this fixes a latent bug
 * present in the source `githubSync.ts:556` port: that version hardcoded the
 * child prefix to `${prefix}/items/` at every level, but `serializeCollectionItems`
 * only nests children under a literal "items/" segment when descending INTO a
 * folder (`${folderDir}/items`) — a collection's own top-level children (requests
 * and folders sitting directly in the collection, the common case) are written
 * directly under the collection dir with NO "items/" segment. The original code
 * therefore silently dropped every top-level collection item/folder on pull.
 * This version scans direct children under `basePath` itself, and only adds the
 * "/items" segment when recursing into a matched folder — mirroring the writer.
 */
export function buildItemsFromFiles(basePath: string, fileMap: Record<string, any>): any[] {
  const childPrefix = `${basePath}/`;
  const directChildren = new Map<string, any>();

  Object.keys(fileMap).forEach((path: string) => {
    if (!path.startsWith(childPrefix)) return;
    const remainder = path.slice(childPrefix.length);
    const firstSegment = remainder.split("/")[0];
    if (!firstSegment) return;
    if (!directChildren.has(firstSegment)) {
      directChildren.set(firstSegment, { segment: firstSegment, path: `${childPrefix}${firstSegment}` });
    }
  });

  return Array.from(directChildren.values())
    .map(({ path }: any) => {
      if (path.endsWith(".request.json") && fileMap[path]) return fileMap[path];
      const folderMeta = fileMap[`${path}/folder.json`];
      if (!folderMeta) return null;
      return { ...folderMeta, items: buildItemsFromFiles(`${path}/items`, fileMap) };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
}

export function buildRequestIndex(items: any[], index: Map<string, any> = new Map<string, any>()): Map<string, any> {
  (items || []).forEach((item: any) => {
    if (item.type === "folder") {
      buildRequestIndex(item.items || [], index);
      return;
    }
    if (item.type === "request" && item.id) index.set(item.id, item);
  });
  return index;
}

export function restoreCollectionItemsWithLocalSecrets(items: any[], localIndex: Map<string, any>): any[] {
  return (items || []).map((item: any) => {
    if (item.type === "folder") {
      return { ...item, items: restoreCollectionItemsWithLocalSecrets(item.items || [], localIndex) };
    }
    if (item.type === "request") return restoreRequestSecrets(item, localIndex.get(item.id));
    return item;
  });
}

/** Pure reproduction of pullStateFromGitHub's merge (githubSync.ts:738-790).
 *  Takes the current local AppState + the fetched remote fileMap; returns the
 *  next AppState + extracted history. No localStorage / window.api side effects. */
export function mergePulledState(
  localState: AppState,
  fileMap: Record<string, any>,
): { appState: AppState; history: HistoryEntry[] } {
  const currentAppState = localState || ({} as AppState);
  const settings = fileMap[`${WORKSPACE_ROOT}/settings.json`] || {};
  const draft = fileMap[`${WORKSPACE_ROOT}/draft/current-request.json`] || {};
  const environments = fileMap[`${WORKSPACE_ROOT}/environments/environments.json`] || [];

  const collections = Object.keys(fileMap)
    .filter((path) => path.startsWith(`${WORKSPACE_ROOT}/collections/`) && path.endsWith("/collection.json"))
    .map((path) => {
      const collectionDir = path.replace(/\/collection\.json$/, "");
      const meta = fileMap[path];
      return { ...meta, items: buildItemsFromFiles(collectionDir, fileMap) };
    })
    .sort((a, b) => {
      const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });

  // NOTE: another latent bug fix vs. githubSync.ts:760 — the source passed
  // `currentAppState.collections` (Collection[], which has no `type` field)
  // straight into buildRequestIndex (which expects an items array of
  // RequestItem|FolderItem). That call could never match anything, so local
  // secret restoration on pull was silently a no-op in production. Build the
  // index from each collection's `items` instead.
  const localRequestIndex = new Map<string, any>();
  ((currentAppState as any).collections || []).forEach((collection: any) => {
    buildRequestIndex(collection.items || [], localRequestIndex);
  });
  const mergedCollections = collections.map((collection) => ({
    ...collection,
    items: restoreCollectionItemsWithLocalSecrets(collection.items || [], localRequestIndex),
  }));

  const restoredDraft = restoreRequestSecrets(draft, {
    headersText: (currentAppState as any).headersText,
    authRows: (currentAppState as any).authRows,
    headersRows: (currentAppState as any).headersRows,
    paramsRows: (currentAppState as any).paramsRows,
    authConfig: (currentAppState as any).authConfig,
    graphqlConfig: (currentAppState as any).graphqlConfig,
    wsConfig: (currentAppState as any).wsConfig,
  });

  const history = Object.keys(fileMap)
    .filter((path) => path.startsWith(`${WORKSPACE_ROOT}/history/`) && path.endsWith(".json"))
    .sort()
    .map((path) => fileMap[path]);

  const nextAppState = {
    ...currentAppState,
    ...settings,
    ...restoredDraft,
    collections: mergedCollections,
    environments,
    activeCollectionId: settings.activeCollectionId || (currentAppState as any).activeCollectionId || null,
    activeEnvId: settings.activeEnvId || (currentAppState as any).activeEnvId || null,
    historyRetentionDays: settings.historyRetentionDays || (currentAppState as any).historyRetentionDays || 7,
  } as AppState;

  return { appState: nextAppState, history: history as HistoryEntry[] };
}
