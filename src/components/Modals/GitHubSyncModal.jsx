import React, { useState, useEffect } from "react";
import { getGitHubToken, setGitHubToken, requestDeviceCode, pollForToken } from "../../services/githubAuth.js";
import { testGitHubConnection, pushStateToGitHub, pullStateFromGitHub, pushHistoryToGitHub, previewEnvironmentsForSync } from "../../services/githubSync.js";

export function GitHubSyncModal({ isOpen, onClose }) {
    const [user, setUser] = useState(null);
    const [statusText, setStatusText] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);

    // Auth flow state
    const [authStep, setAuthStep] = useState("start"); // "start", "device_code", "connected", "preview"
    const [deviceCodeData, setDeviceCodeData] = useState(null);
    const [previewData, setPreviewData] = useState([]);
    const [maskedVarIds, setMaskedVarIds] = useState(new Set());

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

    const handlePreparePush = () => {
        const envs = previewEnvironmentsForSync();
        if (!envs || envs.length === 0 || envs.every(e => !e.vars || e.vars.length === 0)) {
            // No envs to sync, or no vars, skip preview
            performActualPush(new Set());
            return;
        }

        const initialMasked = new Set();
        envs.forEach(env => {
            (env.vars || []).forEach((v, i) => {
                if (v.shouldMask) initialMasked.add(`${env.id}::${v.id || i}`);
            });
        });

        setPreviewData(envs);
        setMaskedVarIds(initialMasked);
        setAuthStep("preview");
        setStatusText("Please review environment variables before pushing.");
    };

    const performActualPush = async (maskedIds) => {
        setIsProcessing(true);
        setStatusText("Pushing State & History to GitHub...");
        try {
            await pushStateToGitHub(maskedIds);
            await pushHistoryToGitHub();
            setStatusText(`Successfully pushed to GitHub! (${new Date().toLocaleTimeString()})`);
            setAuthStep("connected");
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
                                <button className="primary" style={{ flex: 1, padding: '10px' }} onClick={handlePreparePush} disabled={isProcessing}>
                                    ⬆️ Push State
                                </button>
                                <button className="ghost" style={{ flex: 1, padding: '10px' }} onClick={handlePull} disabled={isProcessing}>
                                    ⬇️ Pull State
                                </button>
                            </div>
                        </>
                    )}

                    {authStep === "preview" && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text)', background: 'rgba(255, 187, 0, 0.1)', border: '1px solid rgba(255,187,0,0.3)', padding: '12px', borderRadius: '6px' }}>
                                <strong style={{ color: '#ffcc00' }}>Review Environment Variables</strong>
                                <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '0.85rem' }}>
                                    Below are the environment variables about to be synced. Check the box to <strong>MASK</strong> the variable before it leaves your device. Masked variables will be replaced with a placeholder on GitHub.
                                </p>
                            </div>

                            <div style={{ maxHeight: '250px', overflowY: 'auto', background: 'var(--panel-2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                {previewData.filter(env => env.vars && env.vars.length > 0).map(env => (
                                    <div key={env.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <div style={{ padding: '8px 12px', background: 'var(--panel-3)', fontWeight: 600, fontSize: '0.85rem', position: 'sticky', top: 0 }}>
                                            Environment: {env.name || "Default"}
                                        </div>
                                        {env.vars.map((v, i) => {
                                            const vId = `${env.id}::${v.id || i}`;
                                            const isMasked = maskedVarIds.has(vId);
                                            return (
                                                <div key={vId} style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '0.85rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                                        <span style={{ color: 'var(--accent)', fontWeight: 500, flexShrink: 0 }}>{v.key || "UNNAMED"}</span>
                                                        <span style={{ color: 'var(--muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                            {v.value || ""}
                                                        </span>
                                                    </div>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isMasked}
                                                            onChange={(e) => {
                                                                const newMasks = new Set(maskedVarIds);
                                                                if (e.target.checked) newMasks.add(vId);
                                                                else newMasks.delete(vId);
                                                                setMaskedVarIds(newMasks);
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isMasked ? '#ff5555' : 'var(--muted)' }}>
                                                            {isMasked ? "MASKED" : "PUSHING TEXT"}
                                                        </span>
                                                    </label>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                                {previewData.filter(env => env.vars && env.vars.length > 0).length === 0 && (
                                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)' }}>No variables to review.</div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                                <button className="ghost" style={{ flex: 1, padding: '10px' }} onClick={() => {
                                    setAuthStep("connected");
                                    setStatusText("");
                                }} disabled={isProcessing}>
                                    Cancel
                                </button>
                                <button className="primary" style={{ flex: 1, padding: '10px' }} onClick={() => performActualPush(maskedVarIds)} disabled={isProcessing}>
                                    Push {maskedVarIds.size} Masked
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
