import { Octokit } from "@octokit/rest";
import { getGitHubToken } from "./githubAuth";

const SYNC_REPO_NAME = "portiq-sync";
const WORKSPACE_ROOT = "workspace";
const LEGACY_STATE_FILE = "state.json";
export const SECRET_PLACEHOLDER_PREFIX = "__PORTIQ_SECRET__:";

interface SyncRepo {
    owner: string;
    repo: string;
    defaultBranch: string;
}

interface TreeEntry {
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    url: string;
}

function getOctokit(): Octokit {
    const token = getGitHubToken();
    if (!token) throw new Error("No GitHub token found.");
    return new Octokit({ auth: token });
}

async function ensureSyncRepo(octokit: Octokit): Promise<SyncRepo> {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owner = user.login;

    try {
        const { data: repo } = await octokit.rest.repos.get({
            owner,
            repo: SYNC_REPO_NAME,
        });
        return { owner, repo: SYNC_REPO_NAME, defaultBranch: repo.default_branch || "main" };
    } catch (e: any) {
        if (e.status === 404) {
            const { data: createdRepo } = await octokit.rest.repos.createForAuthenticatedUser({
                name: SYNC_REPO_NAME,
                private: true,
                auto_init: true,
                description: "Portiq App Sync Repository"
            });
            return { owner, repo: SYNC_REPO_NAME, defaultBranch: createdRepo.default_branch || "main" };
        }
        throw e;
    }
}

function encodeContent(value: any): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2))));
}

function decodeContent(base64: string): any {
    return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

function slugify(value: any) {
    return String(value || "item")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "item";
}

function makeSecretPlaceholder(scope: string) {
    return `${SECRET_PLACEHOLDER_PREFIX}${scope}`;
}

export function isSecretPlaceholder(value: any): boolean {
    return typeof value === "string" && (value.startsWith("__PORTIQ_SECRET__:") || value.startsWith("__COMMU_SECRET__:"));
}

export function parseSecretPlaceholder(value: string) {
    if (!isSecretPlaceholder(value)) return null;
    if (value.startsWith("__PORTIQ_SECRET__:")) return value.slice("__PORTIQ_SECRET__:".length);
    if (value.startsWith("__COMMU_SECRET__:")) return value.slice("__COMMU_SECRET__:".length);
    return null;
}

function isSensitiveKey(key: any) {
    return /authorization|api[-_ ]?key|token|secret|password|cookie|auth|credential/i.test(String(key || ""));
}

function sanitizeSensitiveMap(input: any, scope: string): any {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const next = { ...input };
    Object.keys(next).forEach((key) => {
        if (next[key] && isSensitiveKey(key)) {
            next[key] = makeSecretPlaceholder(`${scope}:${key}`);
        }
    });
    return next;
}

function sanitizeSensitiveRows(rows: any[], scope: string): any[] {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row, index) => {
        if (!row || typeof row !== "object") return row;
        if (!row.value || !isSensitiveKey(row.key)) return row;
        return {
            ...row,
            value: makeSecretPlaceholder(`${scope}:row:${index}:${row.key || "value"}`)
        };
    });
}

function sanitizeSensitiveJsonText(text: string, scope: string): string {
    if (typeof text !== "string" || !text.trim()) return text;
    try {
        const parsed = JSON.parse(text);
        return JSON.stringify(sanitizeSensitiveMap(parsed, scope), null, 2);
    } catch {
        return text;
    }
}

function sanitizeAuthConfig(authConfig: any, scope: string): any {
    const base = authConfig && typeof authConfig === "object" ? authConfig : {};
    const next = {
        bearer: { ...(base.bearer || {}) },
        basic: { ...(base.basic || {}) },
        api_key: { ...(base.api_key || {}) }
    };

    if (next.bearer.token) {
        next.bearer.token = makeSecretPlaceholder(`${scope}:auth:bearer:token`);
    }
    if (next.basic.password) {
        next.basic.password = makeSecretPlaceholder(`${scope}:auth:basic:password`);
    }
    if (next.api_key.value) {
        next.api_key.value = makeSecretPlaceholder(`${scope}:auth:api_key:value`);
    }

    return next;
}

function sanitizeWsConfig(wsConfig: any, scope: string): any {
    if (!wsConfig || typeof wsConfig !== "object") return wsConfig;
    return {
        ...wsConfig,
        headersRows: sanitizeSensitiveRows(wsConfig.headersRows, `${scope}:ws:headersRows`),
        headersText: sanitizeSensitiveJsonText(wsConfig.headersText, `${scope}:ws:headersText`)
    };
}

function sanitizeGraphqlConfig(graphqlConfig: any, scope: string): any {
    if (!graphqlConfig || typeof graphqlConfig !== "object") return graphqlConfig;
    return {
        ...graphqlConfig,
        headers: sanitizeSensitiveMap(graphqlConfig.headers, `${scope}:graphql:headers`)
    };
}

function sanitizeRequestSecrets(request: any, scope: string): any {
    if (!request || typeof request !== "object") return request;
    return {
        ...request,
        authConfig: sanitizeAuthConfig(request.authConfig, scope),
        authRows: sanitizeSensitiveRows(request.authRows, `${scope}:authRows`),
        headersRows: sanitizeSensitiveRows(request.headersRows, `${scope}:headersRows`),
        paramsRows: sanitizeSensitiveRows(request.paramsRows, `${scope}:paramsRows`),
        headersText: sanitizeSensitiveJsonText(request.headersText, `${scope}:headersText`),
        graphqlConfig: sanitizeGraphqlConfig(request.graphqlConfig, scope),
        wsConfig: sanitizeWsConfig(request.wsConfig, scope)
    };
}

function restoreRowsWithLocalSecrets(remoteRows: any[], localRows: any[]): any[] {
    if (!Array.isArray(remoteRows)) return remoteRows;
    const localList = Array.isArray(localRows) ? localRows : [];
    return remoteRows.map((row, index) => {
        if (!row || typeof row !== "object" || !isSecretPlaceholder(row.value)) return row;
        const localRow = localList[index];
        if (localRow?.value && !isSecretPlaceholder(localRow.value)) {
            return { ...row, value: localRow.value };
        }
        return row;
    });
}

function restoreMapWithLocalSecrets(remoteMap: any, localMap: any): any {
    if (!remoteMap || typeof remoteMap !== "object" || Array.isArray(remoteMap)) return remoteMap;
    const local = localMap && typeof localMap === "object" ? localMap : {};
    const next = { ...remoteMap };
    Object.keys(next).forEach((key) => {
        if (isSecretPlaceholder(next[key]) && local[key] && !isSecretPlaceholder(local[key])) {
            next[key] = local[key];
        }
    });
    return next;
}

function restoreJsonTextWithLocalSecrets(remoteText: string, localText: string): string {
    if (typeof remoteText !== "string" || !remoteText.trim()) return remoteText;
    try {
        const remote = JSON.parse(remoteText);
        const local = typeof localText === "string" && localText.trim() ? JSON.parse(localText) : {};
        return JSON.stringify(restoreMapWithLocalSecrets(remote, local), null, 2);
    } catch {
        return remoteText;
    }
}

function restoreAuthConfigWithLocalSecrets(remoteAuthConfig: any, localAuthConfig: any): any {
    const remote = remoteAuthConfig && typeof remoteAuthConfig === "object" ? remoteAuthConfig : {};
    const local = localAuthConfig && typeof localAuthConfig === "object" ? localAuthConfig : {};
    const next = {
        bearer: { ...(remote.bearer || {}) },
        basic: { ...(remote.basic || {}) },
        api_key: { ...(remote.api_key || {}) }
    };

    if (isSecretPlaceholder(next.bearer.token) && local?.bearer?.token) {
        next.bearer.token = local.bearer.token;
    }
    if (isSecretPlaceholder(next.basic.password) && local?.basic?.password) {
        next.basic.password = local.basic.password;
    }
    if (isSecretPlaceholder(next.api_key.value) && local?.api_key?.value) {
        next.api_key.value = local.api_key.value;
    }

    return next;
}

function restoreRequestSecrets(remoteRequest: any, localRequest: any): any {
    if (!remoteRequest || typeof remoteRequest !== "object") return remoteRequest;
    const local = localRequest && typeof localRequest === "object" ? localRequest : {};
    return {
        ...remoteRequest,
        authConfig: restoreAuthConfigWithLocalSecrets(remoteRequest.authConfig, local.authConfig),
        authRows: restoreRowsWithLocalSecrets(remoteRequest.authRows, local.authRows),
        headersRows: restoreRowsWithLocalSecrets(remoteRequest.headersRows, local.headersRows),
        paramsRows: restoreRowsWithLocalSecrets(remoteRequest.paramsRows, local.paramsRows),
        headersText: restoreJsonTextWithLocalSecrets(remoteRequest.headersText, local.headersText),
        graphqlConfig: remoteRequest.graphqlConfig
            ? {
                ...remoteRequest.graphqlConfig,
                headers: restoreMapWithLocalSecrets(remoteRequest.graphqlConfig.headers, local?.graphqlConfig?.headers)
            }
            : remoteRequest.graphqlConfig,
        wsConfig: remoteRequest.wsConfig
            ? {
                ...remoteRequest.wsConfig,
                headersRows: restoreRowsWithLocalSecrets(remoteRequest.wsConfig.headersRows, local?.wsConfig?.headersRows),
                headersText: restoreJsonTextWithLocalSecrets(remoteRequest.wsConfig.headersText, local?.wsConfig?.headersText)
            }
            : remoteRequest.wsConfig
    };
}

function getStorageJson(key: string, fallback: any = null): any {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
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

function previewMaskableVars(environments: any[]): any[] {
    return (environments || []).map((env: any) => ({
        id: env.id,
        name: env.name,
        vars: (env.vars || []).map((v: any, index: number) => {
            const keyStr = (v.key || "").toLowerCase();
            const isLikelySecret = v.secret || /secret|token|password|key|auth|cred/i.test(keyStr);
            return {
                ...v,
                id: v.id || index,
                shouldMask: isLikelySecret
            };
        })
    }));
}

function maskEnvironments(environments: any[], maskedVarIds: Set<string>): any[] {
    return (environments || []).map((env: any) => ({
        ...env,
        vars: (env.vars || []).map((v: any, index: number) => {
            const varId = `${env.id}::${v.id || index}`;
            if (!maskedVarIds.has(varId)) return v;
            return {
                ...v,
                value: "<SECRET_STORED_LOCALLY>",
                secret: true
            };
        })
    }));
}

function serializeCollectionItems(items: any[], basePath: string, files: Record<string, any>): void {
    (items || []).forEach((item: any, index: number) => {
        if (item.type === "folder") {
            const folderDir = `${basePath}/${slugify(item.name)}__${item.id}`;
            files[`${folderDir}/folder.json`] = {
                id: item.id,
                type: "folder",
                name: item.name,
                sortOrder: index
            };
            serializeCollectionItems(item.items || [], `${folderDir}/items`, files);
            return;
        }

        if (item.type === "request") {
            const requestPath = `${basePath}/${slugify(item.name)}__${item.id}.request.json`;
            files[requestPath] = {
                ...sanitizeRequestSecrets(item, `request:${item.id}`),
                sortOrder: index
            };
        }
    });
}

function buildRequestLocationIndex(collections: any[]): Map<string, any> {
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
                    folderPath
                });
            }
        });
    };

    (collections || []).forEach((collection: any) => {
        walk(collection.items || [], { id: collection.id, name: collection.name }, []);
    });

    return index;
}

function buildWorkspaceFiles(appState: any, maskedVarIds: Set<string> = new Set()): Record<string, any> {
    const files: Record<string, any> = {};
    const collections = Array.isArray(appState.collections) ? appState.collections : [];
    const environments = maskEnvironments(appState.environments || [], maskedVarIds);

    files[`${WORKSPACE_ROOT}/manifest.json`] = {
        version: 2,
        updatedAt: new Date().toISOString(),
        format: "portiq-workspace-tree"
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
        historyRetentionDays: appState.historyRetentionDays || 7
    };

    files[`${WORKSPACE_ROOT}/draft/current-request.json`] = {
        ...sanitizeRequestSecrets({
            method: appState.method || "GET",
            url: appState.url || "",
            headersText: appState.headersText || "",
            bodyText: appState.bodyText || "",
            testsPreText: appState.testsPreText || "",
            testsPostText: appState.testsPostText || "",
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
            currentRequestId: appState.currentRequestId || ""
        }, `draft:${appState.currentRequestId || "current"}`)
    };

    files[`${WORKSPACE_ROOT}/environments/environments.json`] = environments;

    collections.forEach((collection: any, index: number) => {
        const collectionDir = `${WORKSPACE_ROOT}/collections/${slugify(collection.name)}__${collection.id}`;
        files[`${collectionDir}/collection.json`] = {
            id: collection.id,
            type: "collection",
            name: collection.name,
            variables: collection.variables || {},
            sortOrder: index
        };
        serializeCollectionItems(collection.items || [], collectionDir, files);
    });

    return files;
}

function buildHistoryFiles(history: any[], collections: any[]): Record<string, any> {
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
            ...normalizedFolderPath
        ];

        const filename = `${new Date(entry.timestamp).toISOString().replace(/[:.]/g, "-")}__${slugify(requestName)}__${index}.json`;
        files[`${pathParts.join("/")}/${filename}`] = entry;
    });

    return files;
}

async function getRepoTree(octokit: Octokit, owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const { data: ref } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`
    });

    const { data: commit } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: ref.object.sha
    });

    const { data: tree } = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: commit.tree.sha,
        recursive: "true"
    });

    return (tree.tree || []) as TreeEntry[];
}

async function syncFiles(octokit: Octokit, owner: string, repo: string, branch: string, desiredFiles: Record<string, any>, managedPrefixes: string[]) {
    const tree = await getRepoTree(octokit, owner, repo, branch);
    const existingBlobs = new Map<string, string>(
        tree
            .filter((entry) => entry.type === "blob")
            .map((entry) => [entry.path, entry.sha])
    );

    for (const [path, content] of Object.entries(desiredFiles)) {
        const encodedContent = encodeContent(content);
        const updateFile = async (sha?: string) => octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            branch,
            message: `Sync ${path}`,
            content: encodedContent,
            ...(sha ? { sha } : {})
        });

        try {
            await updateFile(existingBlobs.get(path));
        } catch (error: any) {
            const needsShaRetry = error?.status === 422 && /sha/i.test(error?.message || "");
            if (!needsShaRetry) throw error;

            const currentFile: any = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref: branch
            });
            const currentSha = currentFile?.data?.sha;
            if (!currentSha) throw error;
            await updateFile(currentSha);
            existingBlobs.set(path, currentSha);
        }

        existingBlobs.delete(path);
    }

    const stalePaths = Array.from(existingBlobs.keys()).filter((path) =>
        managedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix))
    );

    for (const path of stalePaths) {
        await octokit.rest.repos.deleteFile({
            owner,
            repo,
            path,
            branch,
            message: `Remove stale synced file ${path}`,
            sha: existingBlobs.get(path)!
        });
    }
}

function buildItemsFromFiles(prefix: string, fileMap: Record<string, any>): any[] {
    const itemsPrefix = `${prefix}/items/`;
    const directChildren = new Map<string, any>();

    Object.keys(fileMap).forEach((path: string) => {
        if (!path.startsWith(itemsPrefix)) return;
        const remainder = path.slice(itemsPrefix.length);
        const firstSegment = remainder.split("/")[0];
        if (!firstSegment) return;
        if (!directChildren.has(firstSegment)) {
            directChildren.set(firstSegment, { segment: firstSegment, path: `${itemsPrefix}${firstSegment}` });
        }
    });

    return Array.from(directChildren.values())
        .map(({ segment, path }: any) => {
            if (path.endsWith(".request.json") && fileMap[path]) {
                return fileMap[path];
            }

            const folderMeta = fileMap[`${path}/folder.json`];
            if (!folderMeta) return null;
            return {
                ...folderMeta,
                items: buildItemsFromFiles(path, fileMap)
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
            const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
            if (left !== right) return left - right;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
}

function buildRequestIndex(items: any[], index: Map<string, any> = new Map<string, any>()): Map<string, any> {
    (items || []).forEach((item: any) => {
        if (item.type === "folder") {
            buildRequestIndex(item.items || [], index);
            return;
        }
        if (item.type === "request" && item.id) {
            index.set(item.id, item);
        }
    });
    return index;
}

function restoreCollectionItemsWithLocalSecrets(items: any[], localIndex: Map<string, any>): any[] {
    return (items || []).map((item: any) => {
        if (item.type === "folder") {
            return {
                ...item,
                items: restoreCollectionItemsWithLocalSecrets(item.items || [], localIndex)
            };
        }
        if (item.type === "request") {
            return restoreRequestSecrets(item, localIndex.get(item.id));
        }
        return item;
    });
}

async function fetchWorkspaceData(octokit: Octokit, owner: string, repo: string, branch: string): Promise<any> {
    const tree = await getRepoTree(octokit, owner, repo, branch);
    const workspaceEntries = tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(`${WORKSPACE_ROOT}/`));

    if (workspaceEntries.length === 0) {
        try {
            const response: any = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: LEGACY_STATE_FILE,
                ref: branch
            });
            return { legacy: decodeContent(response.data.content) };
        } catch (e: any) {
            if (e.status === 404) throw new Error("No synced workspace found in the repository.");
            throw e;
        }
    }

    const fileMap: Record<string, any> = {};
    for (const entry of workspaceEntries) {
        const blob = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: entry.sha
        });
        fileMap[entry.path] = decodeContent(blob.data.content);
    }
    return { fileMap };
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
    setStorageJson("ui_testsPreText", appState.testsPreText || "");
    setStorageJson("ui_testsPostText", appState.testsPostText || "");
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

export function previewEnvironmentsForSync() {
    const snapshot = getStorageJson("appState", null);
    const environments = snapshot?.environments || getStorageJson("ui_environments", []);
    return previewMaskableVars(environments);
}

export async function pushStateToGitHub(maskedVarIds: Set<string> = new Set<string>()) {
    const octokit = getOctokit();
    const { owner, repo, defaultBranch } = await ensureSyncRepo(octokit);
    const appState = await getAppStateSnapshot();
    const files = buildWorkspaceFiles(appState, maskedVarIds);

    await syncFiles(
        octokit,
        owner,
        repo,
        defaultBranch,
        files,
        [
            `${WORKSPACE_ROOT}/manifest.json`,
            `${WORKSPACE_ROOT}/settings.json`,
            `${WORKSPACE_ROOT}/draft/`,
            `${WORKSPACE_ROOT}/environments/`,
            `${WORKSPACE_ROOT}/collections/`
        ]
    );

    return true;
}

export async function pullStateFromGitHub() {
    const octokit = getOctokit();
    const { owner, repo, defaultBranch } = await ensureSyncRepo(octokit);
    const currentAppState = await getAppStateSnapshot();
    const workspace = await fetchWorkspaceData(octokit, owner, repo, defaultBranch);

    if (workspace.legacy) {
        writeLegacyStateToStorage(workspace.legacy);
        return true;
    }

    const fileMap = workspace.fileMap || {};
    const settings = fileMap[`${WORKSPACE_ROOT}/settings.json`] || {};
    const draft = fileMap[`${WORKSPACE_ROOT}/draft/current-request.json`] || {};
    const environments = fileMap[`${WORKSPACE_ROOT}/environments/environments.json`] || [];

    const collections = Object.keys(fileMap)
        .filter((path) => path.startsWith(`${WORKSPACE_ROOT}/collections/`) && path.endsWith("/collection.json"))
        .map((path) => {
            const collectionDir = path.replace(/\/collection\.json$/, "");
            const meta = fileMap[path];
            return {
                ...meta,
                items: buildItemsFromFiles(collectionDir, fileMap)
            };
        })
        .sort((a, b) => {
            const left = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
            const right = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
            if (left !== right) return left - right;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });

    const localRequestIndex = buildRequestIndex(currentAppState.collections || []);
    const mergedCollections = collections.map((collection) => ({
        ...collection,
        items: restoreCollectionItemsWithLocalSecrets(collection.items || [], localRequestIndex)
    }));

    const restoredDraft = restoreRequestSecrets(draft, {
        headersText: currentAppState.headersText,
        authRows: currentAppState.authRows,
        headersRows: currentAppState.headersRows,
        paramsRows: currentAppState.paramsRows,
        authConfig: currentAppState.authConfig,
        graphqlConfig: currentAppState.graphqlConfig,
        wsConfig: currentAppState.wsConfig
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
        activeCollectionId: settings.activeCollectionId || currentAppState.activeCollectionId || null,
        activeEnvId: settings.activeEnvId || currentAppState.activeEnvId || null,
        historyRetentionDays: settings.historyRetentionDays || currentAppState.historyRetentionDays || 7
    };

    await saveAppStateSnapshot(nextAppState);
    writeWorkspaceStateToStorage(nextAppState, history);
    return {
        appState: nextAppState,
        history
    };
}

export async function testGitHubConnection() {
    const octokit = getOctokit();
    const { data: user } = await octokit.rest.users.getAuthenticated();
    return user;
}

export async function pushHistoryToGitHub() {
    const octokit = getOctokit();
    const { owner, repo, defaultBranch } = await ensureSyncRepo(octokit);
    const appState = await getAppStateSnapshot();
    const history = getStorageJson("ui_history", []);
    const files = buildHistoryFiles(history, appState.collections || []);

    await syncFiles(
        octokit,
        owner,
        repo,
        defaultBranch,
        files,
        [`${WORKSPACE_ROOT}/history/`]
    );

    return true;
}
