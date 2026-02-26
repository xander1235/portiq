import React, { useState, useEffect } from "react";
import { getGitHubToken, setGitHubToken, requestDeviceCode, pollForToken } from "../../services/githubAuth.js";
import { testGitHubConnection, pushStateToGitHub, pullStateFromGitHub, pushHistoryToGitHub } from "../../services/githubSync.js";

export function GitHubSyncModal({ isOpen, onClose }) {
    const [user, setUser] = useState(null);
    const [statusText, setStatusText] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);

    // Auth flow state
    const [authStep, setAuthStep] = useState("start"); // "start", "device_code", "connected"
    const [deviceCodeData, setDeviceCodeData] = useState(null);

    useEffect(() => {
        if (isOpen) {
            const savedToken = getGitHubToken();
            if (savedToken) {
                checkConnection(savedToken);
            } else {
                setAuthStep("start");
                setUser(null);
                setStatusText("");
            }
        } else {
            // Reset state when closed, to prevent lingering polling issues if not handled
            setAuthStep("start");
            setDeviceCodeData(null);
        }
    }, [isOpen]);

    const checkConnection = async (t) => {
        setIsProcessing(true);
        setStatusText("Connecting to GitHub...");
        try {
            // temporarily set it so testGitHubConnection uses it
            setGitHubToken(t);
            const verifiedUser = await testGitHubConnection();
            setUser(verifiedUser);
            setStatusText(`Connected as ${verifiedUser.login}`);
            setAuthStep("connected");
        } catch (e) {
            setUser(null);
            setStatusText("Failed to authenticate. Please login again.");
            setGitHubToken(""); // clear invalid token
            setAuthStep("start");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleLogin = async () => {
        setIsProcessing(true);
        setStatusText("Requesting device code...");
        try {
            const data = await requestDeviceCode();
            setDeviceCodeData(data);
            setAuthStep("device_code");
            setStatusText(`Waiting for authorization...`);

            // Start polling
            const token = await pollForToken(data.device_code, data.interval);
            await checkConnection(token);
        } catch (e) {
            console.error(e);
            setStatusText(`Login failed: ${e.message}`);
            setAuthStep("start");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleLogout = () => {
        setGitHubToken("");
        setUser(null);
        setAuthStep("start");
        setStatusText("Logged out");
    };

    const handlePush = async () => {
        setIsProcessing(true);
        setStatusText("Pushing State & History to GitHub...");
        try {
            await pushStateToGitHub();
            await pushHistoryToGitHub();
            setStatusText(`Successfully pushed to GitHub! (${new Date().toLocaleTimeString()})`);
        } catch (e) {
            console.error(e);
            setStatusText(`Failed to push: ${e.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePull = async () => {
        if (!window.confirm("Are you sure? Pulling from GitHub will overwrite your current local state and reload the app.")) return;

        setIsProcessing(true);
        setStatusText("Pulling from GitHub...");
        try {
            await pullStateFromGitHub();
            setStatusText(`Successfully pulled! Reloading app...`);
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (e) {
            console.error(e);
            setStatusText(`Failed to pull: ${e.message}`);
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '450px' }}>
                <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600 }}>Sync with GitHub</div>
                    <button className="ghost icon-button" onClick={onClose} style={{ margin: "-8px", padding: "8px" }}>✕</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>

                    {authStep === "start" && (
                        <div style={{ textAlign: 'center', padding: '16px' }}>
                            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '16px' }}>
                                Connect your GitHub account to sync your collections across devices. We will create a private repository called <code>commu-sync</code> to securely store your data.
                            </p>
                            <button className="primary" style={{ width: '100%', padding: '12px' }} onClick={handleLogin} disabled={isProcessing}>
                                {isProcessing ? "Loading..." : "Log in with GitHub"}
                            </button>
                        </div>
                    )}

                    {authStep === "device_code" && deviceCodeData && (
                        <div style={{ textAlign: 'center', padding: '16px', background: 'var(--panel-2)', borderRadius: '4px' }}>
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '8px' }}>Please go to:</div>
                                <a href={deviceCodeData.verification_uri} target="_blank" rel="noreferrer" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent)' }}>
                                    {deviceCodeData.verification_uri}
                                </a>
                            </div>
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '8px' }}>And enter the code:</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '2px', background: 'var(--bg-dark)', padding: '12px', borderRadius: '4px', userSelect: 'all' }}>
                                    {deviceCodeData.user_code}
                                </div>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                                Waiting for authorization...
                            </div>
                        </div>
                    )}

                    {statusText && authStep !== "device_code" && (
                        <div style={{ padding: '8px', borderRadius: '4px', background: 'var(--panel-2)', fontSize: '0.85rem' }}>
                            {statusText}
                        </div>
                    )}

                    {user && authStep === "connected" && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                <span>Logged in as <strong>{user.login}</strong></span>
                                <button className="ghost" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={handleLogout}>Log out</button>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                                <button className="primary" style={{ flex: 1, padding: '10px' }} onClick={handlePush} disabled={isProcessing}>
                                    ⬆️ Push State
                                </button>
                                <button className="ghost" style={{ flex: 1, padding: '10px' }} onClick={handlePull} disabled={isProcessing}>
                                    ⬇️ Pull State
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
