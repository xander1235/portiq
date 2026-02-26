import { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
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

export async function pushStateToGitHub() {
    const octokit = getOctokit();
    const { owner, repo } = await ensureSyncRepo(octokit);

    const stateToExport = {};
    const secretsToPush = {}; // { secretName: rawValue }

    for (const key of SYNC_KEYS) {
        const item = localStorage.getItem(key);
        if (item !== null) {
            try {
                const parsed = JSON.parse(item);

                // Intercept environments to mask secrets and queue them for GitHub Actions Secrets
                if (key === "ui_environments" && Array.isArray(parsed)) {
                    for (const env of parsed) {
                        if (Array.isArray(env.vars)) {
                            for (const v of env.vars) {
                                if (v.secret) {
                                    // Format a valid GitHub Action Secret name (e.g. COMMU_ENV_LOCAL_API_KEY)
                                    const safeEnvName = (env.name || env.id).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                                    const safeVarName = (v.key || "UNNAMED").toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                                    const secretName = `COMMU_${safeEnvName}_${safeVarName}`;

                                    secretsToPush[secretName] = v.value;
                                    v.value = "<SECRET_STORED_IN_GITHUB>"; // Mask it in state.json
                                }
                            }
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

    // Handle Secrets Upload if any exist
    const secretKeys = Object.keys(secretsToPush);
    if (secretKeys.length > 0) {
        // 1. Get Repo Public Key
        const { data: publicKeyData } = await octokit.rest.actions.getRepoPublicKey({
            owner,
            repo,
        });

        const keyId = publicKeyData.key_id;
        const key = publicKeyData.key;

        // 2. Wait for sodium to initialize once
        await sodium.ready;

        // 3. Encrypt and upload each secret
        for (const secretName of secretKeys) {
            const rawValue = secretsToPush[secretName];

            // Convert Public Key and Secret to Uint8Array
            const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
            const binsec = sodium.from_string(rawValue);

            // Encrypt using libsodium
            const encBytes = sodium.crypto_box_seal(binsec, binkey);
            const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

            // PUT to GitHub Secrets API
            await octokit.rest.actions.createOrUpdateRepoSecret({
                owner,
                repo,
                secret_name: secretName,
                encrypted_value,
                key_id: keyId
            });
        }
    }

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
