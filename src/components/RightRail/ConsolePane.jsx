import React, { useState } from "react";
import rightRailStyles from "../Layout/RightRail.module.css";
import styles from "../../App.module.css";

export function ConsolePane({ history, setHistory, testsOutput, appLogs, setAppLogs, setShowRightRail }) {
    const [activeTab, setActiveTab] = useState("logs");

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.rightRailHeader}>
                <div className={styles.sectionTitle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', color: 'var(--accent)', verticalAlign: 'text-bottom' }}>
                        <polyline points="4 17 10 11 4 5"></polyline>
                        <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                    Console
                </div>
                <button className="ghost icon-button" onClick={() => setShowRightRail(false)} title="Collapse">
                    →
                </button>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 12px' }}>
                <button
                    style={{ flex: 1, padding: '8px 0', border: 'none', background: 'transparent', cursor: 'pointer', color: activeTab === 'logs' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'logs' ? '2px solid var(--accent)' : '2px solid transparent' }}
                    onClick={() => setActiveTab('logs')}
                >
                    App Logs
                </button>
                <button
                    style={{ flex: 1, padding: '8px 0', border: 'none', background: 'transparent', cursor: 'pointer', color: activeTab === 'executions' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'executions' ? '2px solid var(--accent)' : '2px solid transparent' }}
                    onClick={() => setActiveTab('executions')}
                >
                    Executions
                </button>
                <button
                    style={{ flex: 1, padding: '8px 0', border: 'none', background: 'transparent', cursor: 'pointer', color: activeTab === 'scripts' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'scripts' ? '2px solid var(--accent)' : '2px solid transparent' }}
                    onClick={() => setActiveTab('scripts')}
                >
                    Script Output
                </button>
            </div>

            <div className={rightRailStyles.chatContainer} style={{ background: 'var(--panel-1)', border: '1px solid var(--border)', padding: '12px', overflowY: 'auto', flex: 1 }}>

                {activeTab === 'logs' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(!appLogs || appLogs.length === 0) ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No application logs.</div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                                    <button className="ghost secondary" style={{ fontSize: '0.7rem', padding: '2px 6px', height: 'auto', minHeight: 'auto' }} onClick={() => setAppLogs([])}>Clear Logs</button>
                                </div>
                                {appLogs.slice(-100).reverse().map((log, i) => (
                                    <div key={i} style={{
                                        fontSize: '0.72rem', fontFamily: 'monospace', padding: '6px 8px', background: 'var(--bg)', borderRadius: '4px',
                                        borderLeft: `3px solid ${log.type === 'error' ? 'var(--error)' : log.type === 'success' ? 'var(--success)' : log.type === 'warning' ? 'var(--accent)' : 'var(--text-muted)'}`
                                    }}>
                                        <span style={{ color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                                        <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>[{log.source}]</span>{' '}
                                        <span style={{ color: 'var(--text)' }}>{log.message}</span>
                                        {log.data && (
                                            <pre style={{ margin: '4px 0 0 0', padding: '6px', background: 'black', color: 'var(--text-muted)', fontSize: '0.65rem', maxHeight: '100px', overflowY: 'auto', borderRadius: '4px' }}>
                                                {typeof log.data === 'object' ? JSON.stringify(log.data, null, 2) : String(log.data)}
                                            </pre>
                                        )}
                                    </div>
                                ))
                                }
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'executions' && (
                    <div>
                        {history && history.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                                    <button className="ghost secondary" style={{ fontSize: '0.7rem', padding: '2px 6px', height: 'auto', minHeight: 'auto' }} onClick={() => setHistory([])}>Clear Executions</button>
                                </div>
                                {history.slice(-10).reverse().map((h, i) => (
                                    <div key={i} style={{ fontSize: '0.72rem', fontFamily: 'monospace', padding: '6px 8px', background: 'var(--bg)', borderRadius: '4px', borderLeft: `3px solid ${h.response?.status >= 400 ? 'var(--error)' : 'var(--accent)'}` }}>
                                        <span style={{ color: 'var(--text-muted)' }}>{new Date(h.timestamp).toLocaleTimeString()}</span>{' '}
                                        <span style={{ fontWeight: 'bold' }}>{h.request.method}</span>{' '}
                                        <span style={{ color: 'var(--text-secondary)' }}>{h.request.url}</span>{' '}
                                        <span style={{ float: 'right', color: h.response?.status >= 400 ? 'var(--error)' : 'var(--success)' }}>{h.response?.status || 'Error'}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No recent executions.</div>
                        )}
                    </div>
                )}

                {activeTab === 'scripts' && (
                    <pre style={{ margin: 0, padding: '8px 10px', background: 'black', color: '#0f0', borderRadius: '4px', fontSize: '0.72rem', minHeight: '60px', overflowX: 'auto', fontFamily: 'monospace' }}>
                        {testsOutput || "Ready for execution..."}
                    </pre>
                )}
            </div>
        </div>
    );
}
