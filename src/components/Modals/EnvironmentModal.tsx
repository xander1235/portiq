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

    return (
        <div className="modal-backdrop" onClick={() => setShowEnvModal(false)}>
            <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">
                    <div>Manage Environments</div>
                    <button className="ghost icon-button" onClick={() => setShowEnvModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
                </div>
                <div className="env-layout">
                    <div className="env-sidebar">
                        <div className="env-sidebar-header">
                            <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Environments</span>
                            <button
                                className="ghost icon-button"
                                title="Create Environment"
                                style={{ padding: '4px', height: 'auto', minHeight: 0 }}
                                onClick={() => {
                                    const id = `env-${Date.now()}`;
                                    setEnvironments((prev) => [
                                        ...prev,
                                        { id, name: `Env ${prev.length + 1}`, vars: [{ key: "", value: "", comment: "", enabled: true }] }
                                    ]);
                                    setActiveEnvId(id);
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                        </div>
                        <div className="env-list scroll">
                            {environments.map((env) => (
                                <div
                                    key={env.id}
                                    className={activeEnvId === env.id ? "env-item active" : "env-item"}
                                    onClick={() => setActiveEnvId(env.id)}
                                >
                                    <div className="env-select">
                                        {env.name}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="env-sidebar-footer">
                            <button
                                className="ghost container-fluid"
                                style={{ width: "100%", justifyContent: "center" }}
                                onClick={() => {
                                    if (!activeEnvId) return;
                                    const remaining = environments.filter((env) => env.id !== activeEnvId);
                                    setEnvironments(remaining);
                                    if (remaining.length > 0) {
                                        setActiveEnvId(remaining[0].id);
                                    } else {
                                        setActiveEnvId(null);
                                    }
                                }}
                            >
                                Delete Environment
                            </button>
                        </div>
                    </div>
                    <div className="env-editor">
                        {getActiveEnv() ? (
                            <>
                                <div style={{ display: "flex", alignItems: "center", marginBottom: "8px", gap: "12px" }}>
                                    <input
                                        className="input"
                                        placeholder="Environment name"
                                        value={getActiveEnv()?.name || ""}
                                        style={{ fontSize: "1.2rem", fontWeight: "600", border: "none", background: "transparent", padding: "0" }}
                                        onChange={(e) =>
                                            setEnvironments((prev) =>
                                                prev.map((env) =>
                                                    env.id === activeEnvId ? { ...env, name: e.target.value } : env
                                                )
                                            )
                                        }
                                    />
                                </div>
                                <div className="panel-body" style={{ marginBottom: "16px" }}>
                                    Use in requests via interpolation: <code>{"{{variableName}}"}</code>
                                </div>
                                <div className="env-vars" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                            </>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state-icon">
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
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
