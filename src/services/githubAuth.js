import { safeFetch } from "../utils/safeFetch";

export const GITHUB_TOKEN_KEY = "ui_github_token";
export const GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq";

export function getGitHubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
}

export function setGitHubToken(token) {
    if (token) {
        localStorage.setItem(GITHUB_TOKEN_KEY, token.trim());
    } else {
        localStorage.removeItem(GITHUB_TOKEN_KEY);
    }
}

export async function requestDeviceCode() {
    const res = await safeFetch("/github-oauth/login/device/code", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            scope: "repo"
        })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data;
}

export async function pollForToken(deviceCode, rawInterval) {
    let currentIntervalMs = (rawInterval || 5) * 1000;

    return new Promise((resolve, reject) => {
        let isPolling = true;

        const poll = async () => {
            if (!isPolling) return;
            try {
                const res = await safeFetch("/github-oauth/login/oauth/access_token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        device_code: deviceCode,
                        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
                    })
                });

                const data = await res.json();

                if (data.access_token) {
                    isPolling = false;
                    setGitHubToken(data.access_token);
                    resolve(data.access_token);
                } else if (data.error === "authorization_pending") {
                    setTimeout(poll, currentIntervalMs);
                } else if (data.error === "slow_down") {
                    currentIntervalMs += 5000;
                    setTimeout(poll, currentIntervalMs);
                } else {
                    isPolling = false;
                    reject(new Error(data.error_description || data.error));
                }
            } catch (err) {
                isPolling = false;
                reject(err);
            }
        };

        setTimeout(poll, currentIntervalMs);
    });
}

