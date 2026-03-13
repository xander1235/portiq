import { Octokit } from "@octokit/rest";
import { getGitHubToken } from "./githubAuth.js";

const SYNC_REPO_NAME = "portiq-sync";
const WORKSPACE_ROOT = "workspace";
const LEGACY_STATE_FILE = "state.json";
const SECRET_PLACEHOLDER_PREFIX = "__COMMU_SECRET__:";

function getOctokit() {
    const token = getGitHubToken();
    if (!token) throw new Error("No GitHub token found.");
    return new Octokit({ auth: token });
}

async function ensureSyncRepo(octokit) {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owner = user.login;

    try {
        const { data: repo } = await octokit.rest.repos.get({
            owner,
            repo: SYNC_REPO_NAME,
        });
        return { owner, repo: SYNC_REPO_NAME, defaultBranch: repo.default_branch || "main" };
    } catch (e) {
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

function encodeContent(value) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2))));
}

function decodeContent(base64) {
    return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

function slugify(value) {
    return String(value || "item")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "item";
}

function makeSecretPlaceholder(scope) {
    return `${SECRET_PLACEHOLDER_PREFIX}${scope}`;
}

function isSecretPlaceholder(value) {
    return typeof value === "string" && value.startsWith(SECRET_PLACEHOLDER_PREFIX);
}

function isSensitiveKey(key) {
    return /authorization|api[-_ ]?key|token|secret|password|cookie|auth|credential/i.test(String(key || ""));
}

function sanitizeSensitiveMap(input, scope) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const next = { ...input };
    Object.keys(next).forEach((key) => {
        if (next[key] && isSensitiveKey(key)) {
            next[key] = makeSecretPlaceholder(`${scope}:${key}`);
        }
    });
    return next;
}

function sanitizeSensitiveRows(rows, scope) {
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

function sanitizeSensitiveJsonText(text, scope) {
    if (typeof text !== "string" || !text.trim()) return text;
    try {
        const parsed = JSON.parse(text);
        return JSON.stringify(sanitizeSensitiveMap(parsed, scope), null, 2);
    } catch {
        return text;
    }
}

function sanitizeAuthConfig(authConfig, scope) {
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

function sanitizeWsConfig(wsConfig, scope) {
    if (!wsConfig || typeof wsConfig !== "object") return wsConfig;
    return {
        ...wsConfig,
        headersRows: sanitizeSensitiveRows(wsConfig.headersRows, `${scope}:ws:headersRows`),
        headersText: sanitizeSensitiveJsonText(wsConfig.headersText, `${scope}:ws:headersText`)
    };
}

function sanitizeGraphqlConfig(graphqlConfig, scope) {
    if (!graphqlConfig || typeof graphqlConfig !== "object") return graphqlConfig;
    return {
        ...graphqlConfig,
        headers: sanitizeSensitiveMap(graphqlConfig.headers, `${scope}:graphql:headers`)
    };
}

function sanitizeRequestSecrets(request, scope) {
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

function restoreRowsWithLocalSecrets(remoteRows, localRows) {
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

function restoreMapWithLocalSecrets(remoteMap, localMap) {
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

function restoreJsonTextWithLocalSecrets(remoteText, localText) {
    if (typeof remoteText !== "string" || !remoteText.trim()) return remoteText;
    try {
        const remote = JSON.parse(remoteText);
        const local = typeof localText === "string" && localText.trim() ? JSON.parse(localText) : {};
        return JSON.stringify(restoreMapWithLocalSecrets(remote, local), null, 2);
    } catch {
        return remoteText;
    }
}

function restoreAuthConfigWithLocalSecrets(remoteAuthConfig, localAuthConfig) {
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

function restoreRequestSecrets(remoteRequest, localRequest) {
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

function getStorageJson(key, fallback = null) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function setStorageJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

async function getAppStateSnapshot() {
    try {
        if (window.api?.loadState) {
            const raw = await window.api.loadState("appState");
            if (raw) return JSON.parse(raw);
        }
    } catch {
        // fall through
    }
    return getStorageJson("appState", {}) || {};
}

async function saveAppStateSnapshot(appState) {
    const encoded = JSON.stringify(appState);
    if (window.api?.saveState) {
        await window.api.saveState("appState", encoded);
    }
    localStorage.setItem("appState", encoded);
}

function previewMaskableVars(environments) {
    return (environments || []).map((env) => ({
        id: env.id,
        name: env.name,
        vars: (env.vars || []).map((v, index) => {
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

function maskEnvironments(environments, maskedVarIds) {
    return (environments || []).map((env) => ({
        ...env,
        vars: (env.vars || []).map((v, index) => {
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

function serializeCollectionItems(items, basePath, files) {
    (items || []).forEach((item, index) => {
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

function buildRequestLocationIndex(collections) {
    const index = new Map();

    const walk = (items, collectionMeta, folderPath = []) => {
        (items || []).forEach((item) => {
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

    (collections || []).forEach((collection) => {
        walk(collection.items || [], { id: collection.id, name: collection.name }, []);
    });

    return index;
}

function buildWorkspaceFiles(appState, maskedVarIds = new Set()) {
    const files = {};
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

    collections.forEach((collection, index) => {
        const collectionDir = `${WORKSPACE_ROOT}/collections/${slugify(collection.name)}__${collection.id}`;
        files[`${collectionDir}/collection.json`] = {
            id: collection.id,
            type: "collection",
            name: collection.name,
            variables: collection.variables || {},
            sortOrder: index
        };
        serializeCollectionItems(collection.items || [], `${collectionDir}/items`, files);
    });

    return files;
}

function buildHistoryFiles(history, collections) {
    const files = {};
    const locationIndex = buildRequestLocationIndex(collections);

    (history || []).forEach((entry, index) => {
        if (!entry?.timestamp) return;
        const date = new Date(entry.timestamp);
        const day = date.toISOString().split("T")[0];
        const requestId = entry.request?.requestId;
        const indexedMeta = requestId ? locationIndex.get(requestId) : null;
        const collectionName = entry.request?.collectionName || indexedMeta?.collectionName || "unassigned";
        const folderPath = entry.request?.folderPath || indexedMeta?.folderPath || [];
        const requestName = entry.request?.requestName || "request";

        const normalizedFolderPath = Array.isArray(folderPath) && folderPath.length > 0
            ? folderPath.map((segment) => slugify(segment))
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

async function getRepoTree(octokit, owner, repo, branch) {
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

    return tree.tree || [];
}

async function syncFiles(octokit, owner, repo, branch, desiredFiles, managedPrefixes) {
    const tree = await getRepoTree(octokit, owner, repo, branch);
    const existingBlobs = new Map(
        tree
            .filter((entry) => entry.type === "blob")
            .map((entry) => [entry.path, entry.sha])
    );

    for (const [path, content] of Object.entries(desiredFiles)) {
        const encodedContent = encodeContent(content);
        const updateFile = async (sha) => octokit.rest.repos.createOrUpdateFileContents({
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
        } catch (error) {
            const needsShaRetry = error?.status === 422 && /sha/i.test(error?.message || "");
            if (!needsShaRetry) throw error;

            const currentFile = await octokit.rest.repos.getContent({
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
            sha: existingBlobs.get(path)
        });
    }
}

function buildItemsFromFiles(prefix, fileMap) {
    const itemsPrefix = `${prefix}/items/`;
    const directChildren = new Map();

    Object.keys(fileMap).forEach((path) => {
        if (!path.startsWith(itemsPrefix)) return;
        const remainder = path.slice(itemsPrefix.length);
        const firstSegment = remainder.split("/")[0];
        if (!firstSegment) return;
        if (!directChildren.has(firstSegment)) {
            directChildren.set(firstSegment, { segment: firstSegment, path: `${itemsPrefix}${firstSegment}` });
        }
    });

    return Array.from(directChildren.values())
        .map(({ segment, path }) => {
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

function buildRequestIndex(items, index = new Map()) {
    (items || []).forEach((item) => {
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

function restoreCollectionItemsWithLocalSecrets(items, localIndex) {
    return (items || []).map((item) => {
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

async function fetchWorkspaceData(octokit, owner, repo, branch) {
    const tree = await getRepoTree(octokit, owner, repo, branch);
    const workspaceEntries = tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(`${WORKSPACE_ROOT}/`));

    if (workspaceEntries.length === 0) {
        try {
            const response = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: LEGACY_STATE_FILE,
                ref: branch
            });
            return { legacy: decodeContent(response.data.content) };
        } catch (e) {
            if (e.status === 404) throw new Error("No synced workspace found in the repository.");
            throw e;
        }
    }

    const fileMap = {};
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

function writeLegacyStateToStorage(data) {
    Object.entries(data || {}).forEach(([key, value]) => {
        const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
        localStorage.setItem(key, strValue);
    });
}

function writeWorkspaceStateToStorage(appState, history) {
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

export async function pushStateToGitHub(maskedVarIds = new Set()) {
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
