import { WORKSPACE_ROOT } from "./constants";
import { sanitizeRequestSecrets } from "./secrets";
import type { AppState } from "../model";

export function encodeContent(value: any): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2))));
}

export function decodeContent(base64: string): any {
  return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

export function slugify(value: any): string {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function previewMaskableVars(environments: any[]): any[] {
  return (environments || []).map((env: any) => ({
    id: env.id,
    name: env.name,
    vars: (env.vars || []).map((v: any, index: number) => {
      const keyStr = (v.key || "").toLowerCase();
      const isLikelySecret = v.secret || /secret|token|password|key|auth|cred/i.test(keyStr);
      return { ...v, id: v.id || index, shouldMask: isLikelySecret };
    }),
  }));
}

export function maskEnvironments(environments: any[], maskedVarIds: Set<string>): any[] {
  return (environments || []).map((env: any) => ({
    ...env,
    vars: (env.vars || []).map((v: any, index: number) => {
      const varId = `${env.id}::${v.id || index}`;
      if (!maskedVarIds.has(varId)) return v;
      return { ...v, value: "<SECRET_STORED_LOCALLY>", secret: true };
    }),
  }));
}

export function serializeCollectionItems(items: any[], basePath: string, files: Record<string, any>): void {
  (items || []).forEach((item: any, index: number) => {
    if (item.type === "folder") {
      const folderDir = `${basePath}/${slugify(item.name)}__${item.id}`;
      files[`${folderDir}/folder.json`] = { id: item.id, type: "folder", name: item.name, sortOrder: index };
      serializeCollectionItems(item.items || [], `${folderDir}/items`, files);
      return;
    }
    if (item.type === "request") {
      const requestPath = `${basePath}/${slugify(item.name)}__${item.id}.request.json`;
      files[requestPath] = { ...sanitizeRequestSecrets(item, `request:${item.id}`), sortOrder: index };
    }
  });
}

export function buildWorkspaceFiles(appState: AppState, maskedVarIds: Set<string> = new Set()): Record<string, any> {
  const files: Record<string, any> = {};
  const collections = Array.isArray(appState.collections) ? appState.collections : [];
  const environments = maskEnvironments(appState.environments || [], maskedVarIds);

  files[`${WORKSPACE_ROOT}/manifest.json`] = {
    version: 2,
    updatedAt: new Date().toISOString(),
    format: "portiq-workspace-tree",
  };

  files[`${WORKSPACE_ROOT}/settings.json`] = {
    activeCollectionId: appState.activeCollectionId || null,
    activeEnvId: appState.activeEnvId || null,
    activeRequestTab: appState.activeRequestTab || "Body",
    activeResponseTab: appState.activeResponseTab || "Pretty",
    headersMode: appState.headersMode || "table",
    testsMode: appState.testsMode || "post",
    selectedTablePath: appState.selectedTablePath || "$",
    search: appState.search || "",
    searchKey: appState.searchKey || "all",
    sortKey: appState.sortKey || "",
    sortDirection: appState.sortDirection || "asc",
    historyRetentionDays: appState.historyRetentionDays || 7,
  };

  files[`${WORKSPACE_ROOT}/draft/current-request.json`] = {
    ...sanitizeRequestSecrets({
      method: appState.method || "GET",
      url: appState.url || "",
      headersText: appState.headersText || "",
      bodyText: appState.bodyText || "",
      testsPreSteps: appState.testsPreSteps || [],
      testsPostSteps: appState.testsPostSteps || [],
      testsInputText: appState.testsInputText || "",
      httpVersion: appState.httpVersion || "auto",
      requestTimeoutMs: appState.requestTimeoutMs || 30000,
      bodyType: appState.bodyType || "json",
      paramsRows: appState.paramsRows || [],
      headersRows: appState.headersRows || [],
      authRows: appState.authRows || [],
      authType: appState.authType || "none",
      authConfig: appState.authConfig || {},
      bodyRows: appState.bodyRows || [],
      graphqlConfig: appState.graphqlConfig || {},
      wsConfig: appState.wsConfig || {},
      protocol: appState.protocol || "http",
      requestName: appState.requestName || "New Request",
      currentRequestId: appState.currentRequestId || "",
    }, `draft:${appState.currentRequestId || "current"}`),
  };

  files[`${WORKSPACE_ROOT}/environments/environments.json`] = environments;

  collections.forEach((collection: any, index: number) => {
    const collectionDir = `${WORKSPACE_ROOT}/collections/${slugify(collection.name)}__${collection.id}`;
    files[`${collectionDir}/collection.json`] = {
      id: collection.id,
      type: "collection",
      name: collection.name,
      variables: collection.variables || {},
      sortOrder: index,
    };
    serializeCollectionItems(collection.items || [], collectionDir, files);
  });

  return files;
}

export function buildRequestLocationIndex(collections: any[]): Map<string, any> {
  const index = new Map<string, any>();
  const walk = (items: any[], collectionMeta: any, folderPath: string[] = []) => {
    (items || []).forEach((item: any) => {
      if (item.type === "folder") {
        walk(item.items || [], collectionMeta, [...folderPath, item.name]);
        return;
      }
      if (item.type === "request") {
        index.set(item.id, {
          collectionId: collectionMeta.id,
          collectionName: collectionMeta.name,
          folderPath,
        });
      }
    });
  };
  (collections || []).forEach((collection: any) => {
    walk(collection.items || [], { id: collection.id, name: collection.name }, []);
  });
  return index;
}

export function buildHistoryFiles(history: any[], collections: any[]): Record<string, any> {
  const files: Record<string, any> = {};
  const locationIndex = buildRequestLocationIndex(collections);

  (history || []).forEach((entry: any, index: number) => {
    if (!entry?.timestamp) return;
    const date = new Date(entry.timestamp);
    const day = date.toISOString().split("T")[0];
    const requestId = entry.request?.requestId;
    const indexedMeta = requestId ? locationIndex.get(requestId) : null;
    const collectionName = entry.request?.collectionName || indexedMeta?.collectionName || "unassigned";
    const folderPath = entry.request?.folderPath || indexedMeta?.folderPath || [];
    const requestName = entry.request?.requestName || "request";

    const normalizedFolderPath = Array.isArray(folderPath) && folderPath.length > 0
      ? folderPath.map((segment: string) => slugify(segment))
      : ["root"];

    const pathParts = [
      WORKSPACE_ROOT,
      "history",
      day,
      `${slugify(collectionName)}__${entry.request?.collectionId || indexedMeta?.collectionId || "unassigned"}`,
      ...normalizedFolderPath,
    ];

    const filename = `${new Date(entry.timestamp).toISOString().replace(/[:.]/g, "-")}__${slugify(requestName)}__${index}.json`;
    files[`${pathParts.join("/")}/${filename}`] = entry;
  });

  return files;
}
