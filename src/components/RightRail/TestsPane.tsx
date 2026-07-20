import React from "react";
import rightRailStyles from "../Layout/RightRail.module.css";
import { summarizeTests, type TestEntry } from "../../services/testRunner";

interface TestsPaneProps {
    testsOutput: TestEntry[];
    setShowRightRail: (show: boolean) => void;
}

export function TestsPane({ testsOutput, setShowRightRail }: TestsPaneProps) {
    const summary = summarizeTests(Array.isArray(testsOutput) ? testsOutput : []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.paneHero}>
                <div className={rightRailStyles.paneHeroTop}>
                    <div className={rightRailStyles.paneHeroMeta}>
                        <div className={rightRailStyles.paneHeroIcon}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 3H15M10 9H14M3 14H21M14 3V8.8C14 9.11828 14.1264 9.42352 14.3515 9.64853L19.5 14.7971C20.1332 15.4303 20.3705 16.3537 20.1171 17.2289C19.8637 18.1041 19.162 18.8 18.2868 19.0534C17.4116 19.3068 16.4882 19.0695 15.855 18.4363L11.5173 14.0986C11.3121 13.8934 10.9796 13.8934 10.7744 14.0986L6.4367 18.4363C5.80348 19.0695 4.88006 19.3068 4.00486 19.0534C3.12966 18.8 2.4279 18.1041 2.17449 17.2289C1.92107 16.3537 2.15842 15.4303 2.79164 14.7971L7.94017 9.64853C8.16527 9.42352 8.29167 9.11828 8.29167 8.8V3"></path>
                            </svg>
                        </div>
                        <div>
                            <div className={rightRailStyles.paneEyebrow}>Test Results</div>
                            <div className={rightRailStyles.paneTitle}>Script and assertion output</div>
                        </div>
                    </div>
                    <button className={`ghost icon-button ${rightRailStyles.paneHeaderButton}`} onClick={() => setShowRightRail(false)} title="Collapse">
                        →
                    </button>
                </div>
            </div>

            <div className={rightRailStyles.paneSurface} style={{ padding: '12px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)' }}>{summary.passed}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Passed</div>
                    </div>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: summary.failed > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{summary.failed}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Failed</div>
                    </div>
                    <div style={{ flex: 1, background: 'var(--bg)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: summary.errored > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{summary.errored}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Errored</div>
                    </div>
                </div>

                {summary.groups.map((group) => (
                    <div key={group.name} style={{ marginBottom: '12px' }}>
                        <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', display: 'flex', gap: '8px' }}>
                            <span>{group.name}</span>
                            <span style={{ color: 'var(--success)' }}>{group.passed}✓</span>
                            {group.failed > 0 && <span style={{ color: 'var(--error)' }}>{group.failed}✗</span>}
                        </h4>
                        {group.entries.map((entry, index) => (
                            <div key={index} style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ color: entry.type === 'pass' ? 'var(--success)' : 'var(--error)', fontWeight: 600, minWidth: '44px' }}>
                                    {entry.type.toUpperCase()}
                                </span>
                                <span style={{ flex: 1 }}>{entry.text}</span>
                                {entry.errorMessage && <span style={{ color: 'var(--error)', fontSize: '0.72rem' }}>{entry.errorMessage}</span>}
                            </div>
                        ))}
                    </div>
                ))}

                {summary.groups.length === 0 && (
                    <pre style={{ margin: 0, padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minHeight: '100px' }}>
                        No test output available for this request.
                    </pre>
                )}
            </div>
        </div>
    );
}
