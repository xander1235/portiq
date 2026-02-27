import { Octokit } from "@octokit/rest";
import { getGitHubToken } from "./githubAuth.js";

const SYNC_REPO_NAME = "commu-sync";
const SYNC_FILE_PATH = "state.json";

// We'll extract only the keys that represent user-created content (collections, environments, etc.), not ephemeral UI states.
const SYNC_KEYS = [
    "ui_collections",
    "ui_environments",
    "ui_activeEnvironmentId",
    "ui_method",
    "ui_url",
    "ui_headersText",
    "ui_bodyText",
    "ui_testsPreText",
    "ui_testsPostText",
    "ui_testsInputText",
    "ui_paramsRows",
    "ui_headersRows",
    "ui_authRows",
    "ui_authType",
    "ui_authConfig",
    "ui_bodyType",
    "ui_bodyRows",
    "ui_requestName"
];

function getOctokit() {
    const token = getGitHubToken();
    if (!token) throw new Error("No GitHub token found.");
    return new Octokit({ auth: token });
}

async function ensureSyncRepo(octokit) {
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owner = user.login;

    try {
        await octokit.rest.repos.get({
            owner,
            repo: SYNC_REPO_NAME,
        });
        return { owner, repo: SYNC_REPO_NAME };
    } catch (e) {
        if (e.status === 404) {
            // Create private repo
            await octokit.rest.repos.createForAuthenticatedUser({
                name: SYNC_REPO_NAME,
                private: true,
                auto_init: true, // we need a main/master branch to push to
                description: "Commu App Sync Repository"
            });
            return { owner, repo: SYNC_REPO_NAME };
        }
        throw e;
    }
}

export function previewEnvironmentsForSync() {
    const item = localStorage.getItem("ui_environments");
    if (!item) return [];

    try {
        const parsed = JSON.parse(item);
        if (Array.isArray(parsed)) {
            return parsed.map(env => {
                return {
                    id: env.id,
                    name: env.name,
                    vars: (env.vars || []).map(v => {
                        const keyStr = (v.key || "").toLowerCase();
                        const isLikelySecret = v.secret || /secret|token|password|key|auth|cred/i.test(keyStr);
                        return {
                            ...v,
                            shouldMask: isLikelySecret
                        };
                    })
                };
            });
        }
    } catch {
        // ignore
    }
    return [];
}

export async function pushStateToGitHub(maskedVarIds = new Set()) {
    const octokit = getOctokit();
    const { owner, repo } = await ensureSyncRepo(octokit);

    const stateToExport = {};

    for (const key of SYNC_KEYS) {
        const item = localStorage.getItem(key);
        if (item !== null) {
            try {
                const parsed = JSON.parse(item);

                if (key === "ui_environments" && Array.isArray(parsed)) {
                    for (const env of parsed) {
                        if (Array.isArray(env.vars)) {
                            env.vars.forEach((v, i) => {
                                const varId = `${env.id}::${v.id || i}`;
                                if (maskedVarIds.has(varId)) {
                                    v.value = "<SECRET_STORED_LOCALLY>";
                                    v.secret = true;
                                }
                            });
                        }
                    }
                }

                stateToExport[key] = parsed;
            } catch {
                stateToExport[key] = item;
            }
        }
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(stateToExport, null, 2))));
    let sha;

    try {
        const { data: existingFile } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: SYNC_FILE_PATH,
        });
        sha = existingFile.sha;
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: SYNC_FILE_PATH,
        message: `Commu State Sync - ${new Date().toISOString()}`,
        content,
        ...(sha ? { sha } : {}),
    });

    return true;
}
export async function pullStateFromGitHub() {
    const octokit = getOctokit();
    const { owner, repo } = await ensureSyncRepo(octokit);

    let data;
    try {
        const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: SYNC_FILE_PATH,
        });
        const contentBase64 = response.data.content;
        const jsonStr = decodeURIComponent(escape(atob(contentBase64)));
        data = JSON.parse(jsonStr);
    } catch (e) {
        if (e.status === 404) {
            throw new Error("No synced state found in the repository.");
        }
        throw e;
    }

    for (const key of SYNC_KEYS) {
        if (data[key] !== undefined) {
            const val = data[key];
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            localStorage.setItem(key, strVal);
        }
    }

    return true;
}

export async function testGitHubConnection() {
    const octokit = getOctokit();
    const { data: user } = await octokit.rest.users.getAuthenticated();
    return user;
}

export async function pushHistoryToGitHub() {
    const octokit = getOctokit();
    const { owner, repo } = await ensureSyncRepo(octokit);

    const historyRaw = localStorage.getItem("ui_history");
    if (!historyRaw) return false;

    let historyArr = [];
    try {
        historyArr = JSON.parse(historyRaw);
    } catch {
        return false;
    }

    if (!Array.isArray(historyArr) || historyArr.length === 0) return false;

    const grouped = {};
    for (const item of historyArr) {
        if (!item.timestamp) continue;
        const d = new Date(item.timestamp);
        const dateStr = d.toISOString().split('T')[0];
        if (!grouped[dateStr]) grouped[dateStr] = [];
        grouped[dateStr].push(item);
    }

    let mainSha;
    try {
        const { data: refData } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: "heads/main"
        });
        mainSha = refData.object.sha;
    } catch (e) {
        try {
            const { data: refData } = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: "heads/master"
            });
            mainSha = refData.object.sha;
        } catch (e2) {
            throw new Error("Could not find main or master branch to branch from.");
        }
    }

    for (const [dateStr, items] of Object.entries(grouped)) {
        const branchName = `history/${dateStr}`;
        const refName = `heads/${branchName}`;

        try {
            await octokit.rest.git.getRef({
                owner,
                repo,
                ref: refName
            });
        } catch (e) {
            if (e.status === 404) {
                await octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/${refName}`,
                    sha: mainSha
                });
            } else {
                throw e;
            }
        }

        const content = btoa(unescape(encodeURIComponent(JSON.stringify(items, null, 2))));
        let fileSha;
        try {
            const { data: existingFile } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: "history.json",
                ref: branchName
            });
            fileSha = existingFile.sha;
        } catch (e) {
            if (e.status !== 404) throw e;
        }

        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: "history.json",
            message: `Sync history for ${dateStr}`,
            content,
            branch: branchName,
            ...(fileSha ? { sha: fileSha } : {})
        });
    }

    return true;
}
