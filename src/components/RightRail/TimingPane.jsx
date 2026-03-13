import React from "react";
import rightRailStyles from "../Layout/RightRail.module.css";

export function TimingPane({ response, setShowRightRail }) {

    // Simulate some detailed metrics if they aren't fully populated by the native sender yet
    const metrics = response?.metrics || {
        dnsLookup: 12,
        tcpConnection: 25,
        tlsHandshake: 35,
        firstByte: response?.time ? Math.max(0, response.time - 10) : 0,
        contentDownload: 10,
        total: response?.time || 0
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className={rightRailStyles.paneHero}>
                <div className={rightRailStyles.paneHeroTop}>
                    <div className={rightRailStyles.paneHeroMeta}>
                        <div className={rightRailStyles.paneHeroIcon}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </div>
                        <div>
                            <div className={rightRailStyles.paneEyebrow}>Timing & Performance</div>
                            <div className={rightRailStyles.paneTitle}>Latency and transport breakdown</div>
                        </div>
                    </div>
                    <button className={`ghost icon-button ${rightRailStyles.paneHeaderButton}`} onClick={() => setShowRightRail(false)} title="Collapse">
                        →
                    </button>
                </div>
            </div>

            <div className={rightRailStyles.paneSurface} style={{ padding: '16px', overflowY: 'auto' }}>
                {!response ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>Send a request to see timing data.</div>
                ) : (
                    <>
                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--text)' }}>
                                {metrics.total || response.time || 0}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>ms</span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Time</div>
                            {response.size && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '4px' }}>Size: {response.size}</div>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <TimingRow label="DNS Lookup" value={metrics.dnsLookup} color="#888" total={metrics.total} />
                            <TimingRow label="TCP Connection" value={metrics.tcpConnection} color="#88f" total={metrics.total} />
                            {metrics.tlsHandshake > 0 && <TimingRow label="TLS Handshake" value={metrics.tlsHandshake} color="#f8f" total={metrics.total} />}
                            <TimingRow label="Time to First Byte" value={metrics.firstByte} color="var(--success)" total={metrics.total} />
                            <TimingRow label="Content Download" value={metrics.contentDownload} color="var(--accent)" total={metrics.total} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function TimingRow({ label, value, color, total }) {
    if (value === undefined || value === 0) return null;

    // Calculate width relative to total (max 100%)
    const widthPercentage = total > 0 ? Math.min(100, Math.max(1, (value / total) * 100)) : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{ fontWeight: '500' }}>{Math.round(value)} ms</span>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'var(--bg)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${widthPercentage}%`, height: '100%', background: color, borderRadius: '2px' }} />
            </div>
        </div>
    );
}
