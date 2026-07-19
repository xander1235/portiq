import React from "react";
import { TableEditor } from "../TableEditor";
import { Environment } from "../../hooks/useEnvironmentState";

interface EnvironmentModalProps {
    showEnvModal: boolean;
    setShowEnvModal: (show: boolean) => void;
    environments: Environment[];
    setEnvironments: React.Dispatch<React.SetStateAction<Environment[]>>;
    activeEnvId: string | null;
    setActiveEnvId: (id: string | null) => void;
    getActiveEnv: () => Environment | null;
    getEnvVars: () => Record<string, string>;
    handleUpdateEnvVar: (key: string, newValue: string) => void;
}

function countVars(env: Environment): number {
    return (env.vars || []).filter((v) => (v.key || "").trim()).length;
}

export function EnvironmentModal({
    showEnvModal,
    setShowEnvModal,
    environments,
    setEnvironments,
    activeEnvId,
    setActiveEnvId,
    getActiveEnv,
    getEnvVars,
    handleUpdateEnvVar
}: EnvironmentModalProps) {
    if (!showEnvModal) return null;

    const createEnvironment = () => {
        const id = `env-${Date.now()}`;
        setEnvironments((prev) => [
            ...prev,
            { id, name: `Env ${prev.length + 1}`, vars: [{ key: "", value: "", comment: "", enabled: true }] }
        ]);
        setActiveEnvId(id);
    };

    const deleteActiveEnvironment = () => {
        if (!activeEnvId) return;
        const remaining = environments.filter((env) => env.id !== activeEnvId);
        setEnvironments(remaining);
        setActiveEnvId(remaining.length > 0 ? remaining[0].id : null);
    };

    return (
        <div className="modal-backdrop" onClick={() => setShowEnvModal(false)}>
            <div className="modal modal-wide manage-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">
                    <div>Manage Environments</div>
                    <button className="ghost icon-button" onClick={() => setShowEnvModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
                </div>
                <div className="mc-layout">
                    <aside className="mc-aside">
                        <div className="mc-aside-head">
                            <span className="mc-aside-title">Environments</span>
                            <button className="mc-new-btn" onClick={createEnvironment} title="Create Environment">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                New
                            </button>
                        </div>
                        <div className="mc-collection-list scroll">
                            {environments.map((env) => {
                                const isActive = env.id === activeEnvId;
                                const varCount = countVars(env);
                                return (
                                    <div key={env.id} className={`mc-collection-item ${isActive ? "active" : ""}`}>
                                        <button className="mc-collection-select" onClick={() => setActiveEnvId(env.id)}>
                                            <span className="mc-collection-icon">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                                            </span>
                                            <span className="mc-collection-meta">
                                                <span className="mc-collection-name">{env.name}</span>
                                                <span className="mc-collection-count">{varCount} variable{varCount !== 1 ? "s" : ""}</span>
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                            {environments.length === 0 && (
                                <div className="mc-aside-empty">No environments yet</div>
                            )}
                        </div>
                        <button
                            className="mc-del-btn"
                            disabled={!activeEnvId}
                            onClick={deleteActiveEnvironment}
                        >
                            Delete Environment
                        </button>
                    </aside>

                    <div className="mc-main">
                        {getActiveEnv() ? (
                            <>
                                <label className="mc-name-field">
                                    <span className="mc-field-label">Environment name</span>
                                    <input
                                        className="input"
                                        placeholder="Environment name"
                                        value={getActiveEnv()?.name || ""}
                                        onChange={(e) =>
                                            setEnvironments((prev) =>
                                                prev.map((env) =>
                                                    env.id === activeEnvId ? { ...env, name: e.target.value } : env
                                                )
                                            )
                                        }
                                    />
                                </label>
                                <div className="mc-contents">
                                    <div className="mc-contents-head">
                                        <span className="mc-contents-title">Variables</span>
                                        <span className="mc-hint">
                                            Use via <code>{"{{variableName}}"}</code>
                                        </span>
                                    </div>
                                    <div className="mc-tree" style={{ display: "flex", flexDirection: "column" }}>
                                        <TableEditor
                                            rows={getActiveEnv()?.vars || []}
                                            onChange={(rows) => {
                                                setEnvironments((prev) =>
                                                    prev.map((env) =>
                                                        env.id === activeEnvId ? { ...env, vars: rows as any } : env
                                                    )
                                                );
                                            }}
                                            keyPlaceholder="Key"
                                            valuePlaceholder="Value"
                                            envVars={getEnvVars()}
                                            onUpdateEnvVar={handleUpdateEnvVar}
                                            isEnv={true}
                                        />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state-icon">
                                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                                </div>
                                <div>No environment selected</div>
                                <div style={{ fontSize: "0.85rem", marginTop: "8px" }}>Create one from the sidebar to manage variables.</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
