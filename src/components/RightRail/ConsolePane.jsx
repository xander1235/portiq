import React from "react";
import rightRailStyles from "../Layout/RightRail.module.css";
import styles from "../../App.module.css";

export function ConsolePane({ history, testsOutput, setShowRightRail }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.rightRailHeader}>
                <div className={styles.sectionTitle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', color: 'var(--accent)', verticalAlign: 'text-bottom' }}>
                        <polyline points="4 17 10 11 4 5"></polyline>
                        <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                    Console Output
                </div>
                <button className="ghost icon-button" onClick={() => setShowRightRail(false)} title="Collapse">
                    →
                </button>
            </div>

            <div className={rightRailStyles.chatContainer} style={{ background: 'var(--panel-1)', border: '1px solid var(--border)', padding: '12px', overflowY: 'auto' }}>
                <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Recent Executions</h4>
                {history && history.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {history.slice(-10).reverse().map((h, i) => (
                            <div key={i} style={{ fontSize: '0.8rem', fontFamily: 'monospace', padding: '6px', background: 'var(--bg)', borderRadius: '4px', borderLeft: `3px solid ${h.response?.status >= 400 ? 'var(--error)' : 'var(--accent)'}` }}>
                                <span style={{ color: 'var(--text-muted)' }}>{new Date(h.timestamp).toLocaleTimeString()}</span>{' '}
                                <span style={{ fontWeight: 'bold' }}>{h.request.method}</span>{' '}
                                <span style={{ color: 'var(--text-secondary)' }}>{h.request.url}</span>{' '}
                                <span style={{ float: 'right', color: h.response?.status >= 400 ? 'var(--error)' : 'var(--success)' }}>{h.response?.status || 'Error'}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No recent executions.</div>
                )}

                <div style={{ marginTop: '20px' }}>
                    <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Script Output</h4>
                    <pre style={{ margin: 0, padding: '8px', background: 'black', color: '#0f0', borderRadius: '4px', fontSize: '0.8rem', minHeight: '60px', overflowX: 'auto' }}>
                        {testsOutput || "Ready for execution..."}
                    </pre>
                </div>
            </div>
        </div>
    );
}
