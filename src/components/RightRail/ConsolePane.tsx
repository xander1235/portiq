import React, { useState } from "react";
import rightRailStyles from "../Layout/RightRail.module.css";

interface LogItem {
    timestamp: number | string;
    type: 'error' | 'success' | 'warning' | 'info';
    source: string;
    message: string;
    data?: any;
}

interface TestOutput {
    type: string;
    text: string;
    label?: string;
    errorType?: string;
}

interface HistoryItem {
    timestamp: number | string;
    request: {
        method: string;
        url: string;
    };
    response?: {
        status: number;
        statusText?: string;
    };
}

interface ConsolePaneProps {
    history: HistoryItem[];
    setHistory: (history: HistoryItem[]) => void;
    testsOutput: TestOutput[];
    appLogs: LogItem[];
    setAppLogs: (logs: LogItem[]) => void;
    setShowRightRail: (show: boolean) => void;
}

export function ConsolePane({ history, setHistory, testsOutput, appLogs, setAppLogs, setShowRightRail }: ConsolePaneProps) {
    const [activeTab, setActiveTab] = useState("logs");

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.paneHero}>
                <div className={rightRailStyles.paneHeroTop}>
                    <div className={rightRailStyles.paneHeroMeta}>
                        <div className={rightRailStyles.paneHeroIcon}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="4 17 10 11 4 5"></polyline>
                                <line x1="12" y1="19" x2="20" y2="19"></line>
                            </svg>
                        </div>
                        <div>
                            <div className={rightRailStyles.paneEyebrow}>Console</div>
                            <div className={rightRailStyles.paneTitle}>Logs and execution history</div>
                        </div>
                    </div>
                    <button className={`ghost icon-button ${rightRailStyles.paneHeaderButton}`} onClick={() => setShowRightRail(false)} title="Collapse">
                        →
                    </button>
                </div>

                <div className={rightRailStyles.paneTabRow}>
                    <button
                        className={`${rightRailStyles.paneTabButton} ${activeTab === 'logs' ? rightRailStyles.paneTabButtonActive : ''}`}
                        onClick={() => setActiveTab('logs')}
                    >
                        App Logs
                    </button>
                    <button
                        className={`${rightRailStyles.paneTabButton} ${activeTab === 'executions' ? rightRailStyles.paneTabButtonActive : ''}`}
                        onClick={() => setActiveTab('executions')}
                    >
                        Executions
                    </button>
                    <button
                        className={`${rightRailStyles.paneTabButton} ${activeTab === 'scripts' ? rightRailStyles.paneTabButtonActive : ''}`}
                        onClick={() => setActiveTab('scripts')}
                    >
                        Script Output
                    </button>
                </div>
            </div>

            <div className={rightRailStyles.paneSurface} style={{ padding: '12px', overflowY: 'auto', flex: 1 }}>

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
                                    <div key={i} style={{ fontSize: '0.72rem', fontFamily: 'monospace', padding: '6px 8px', background: 'var(--bg)', borderRadius: '4px', borderLeft: `3px solid ${h.response && h.response.status >= 400 ? 'var(--error)' : 'var(--accent)'}` }}>
                                        <span style={{ color: 'var(--text-muted)' }}>{new Date(h.timestamp).toLocaleTimeString()}</span>{' '}
                                        <span style={{ fontWeight: 'bold' }}>{h.request.method}</span>{' '}
                                        <span style={{ color: 'var(--text-secondary)' }}>{h.request.url}</span>{' '}
                                        <span style={{ float: 'right', color: h.response && h.response.status >= 400 ? 'var(--error)' : 'var(--success)' }}>{h.response?.status || 'Error'}</span>
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
                        {testsOutput && testsOutput.length > 0
                            ? testsOutput.map(o => `[${o.type.toUpperCase()}] ${o.text}`).join('\n')
                            : "Ready for execution..."}
                    </pre>
                )}
            </div>
        </div>
    );
}
