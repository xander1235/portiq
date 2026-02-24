import React from "react";

export function ExportModal({
    showExportModal,
    setShowExportModal,
    exportTargetNode,
    exportSelections,
    setExportSelections,
    exportInterpolate,
    setExportInterpolate,
    renderExportTree,
    getExportPayload
}) {
    if (!showExportModal) return null;

    return (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '600px', maxWidth: '95vw', padding: '20px', gap: '20px' }}>
                <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>Export collection</div>
                    <button className="ghost icon-button" onClick={() => setShowExportModal(false)} style={{ margin: "-8px", padding: "8px" }}>✕</button>
                </div>

                <div className="export-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        <span style={{ fontWeight: '600', fontSize: '1.05rem' }}>{exportTargetNode?.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="ghost input compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => {
                                const allIds = new Set();
                                const collectIds = (n) => { allIds.add(n.id); if (n.items) n.items.forEach(collectIds); };
                                collectIds(exportTargetNode);
                                setExportSelections(allIds);
                            }}>Select All</button>
                            <button className="ghost input compact" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => setExportSelections(new Set())}>None</button>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Requests <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{Array.from(exportSelections).filter(id => id.startsWith('req-')).length}</span>
                        </div>
                    </div>
                </div>

                <div className="export-list" style={{ overflowY: 'auto', maxHeight: '50vh', padding: '8px 16px' }}>
                    {renderExportTree(exportTargetNode)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <button className="ghost" style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }} onClick={() => setShowExportModal(false)}>Cancel</button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            <input
                                type="checkbox"
                                checked={exportInterpolate}
                                onChange={(e) => setExportInterpolate(e.target.checked)}
                            />
                            Preserve {"{{variables}}"} (don't evaluate)
                        </label>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <button
                            className="ghost icon-button"
                            title="Copy to Clipboard"
                            onClick={() => {
                                const { jsonStr } = getExportPayload();
                                navigator.clipboard.writeText(jsonStr);
                                setShowExportModal(false);
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button
                            className="ghost"
                            style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }}
                            onClick={() => alert("Exporting via API is coming soon!")}
                        >
                            Export as API
                        </button>
                        <button
                            className="primary"
                            style={{ background: 'var(--accent-green)', color: '#000', fontWeight: '600', padding: '8px 24px', borderRadius: '8px' }}
                            onClick={() => {
                                const { jsonStr, fileName } = getExportPayload();
                                const blob = new Blob([jsonStr], { type: "application/json" });
                                const u = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = u;
                                a.download = fileName;
                                a.click();
                                URL.revokeObjectURL(u);
                                setShowExportModal(false);
                            }}
                        >
                            Download
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
