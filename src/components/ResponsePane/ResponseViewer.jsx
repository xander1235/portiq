import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { search as searchExtension } from '@codemirror/search';
import { FullScreenModal } from "../Modals/FullScreenModal.jsx";

export function ResponseViewer({
    response,
    responseTabs,
    activeResponseTab,
    setActiveResponseTab,
    error,
    pretty,
    raw,
    xml,
    handleXmlToJson,
    search,
    setSearch,
    searchKey,
    setSearchKey,
    computedRows,
    selectedTablePath,
    setSelectedTablePath,
    tableCandidates,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    downloadText,
    csv,
    tableRows,
    derivedName,
    setDerivedName,
    derivedExpr,
    setDerivedExpr,
    handleAddDerivedField,
    handleSort,
    responseSummary
}) {
    const [isFullScreen, setIsFullScreen] = useState(false);

    const responseTabButtons = (
        <div className="tabs" style={{ marginBottom: 0 }}>
            {responseTabs.map((tab) => (
                <button
                    key={tab}
                    className={tab === activeResponseTab ? "tab active" : "tab"}
                    onClick={() => setActiveResponseTab(tab)}
                >
                    {tab}
                </button>
            ))}
        </div>
    );

    const xmlActions = activeResponseTab === "XML" ? (
        <div style={{ display: 'flex', gap: '8px' }}>
            <button className="ghost compact" onClick={handleXmlToJson}>XML → JSON</button>
            <button className="ghost compact" onClick={() => navigator.clipboard.writeText(xml || raw || "")}>Copy XML</button>
        </div>
    ) : null;

    const fullScreenActions = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {responseTabButtons}
            {xmlActions}
        </div>
    );

    const renderCodeMirror = (value, extensions = []) => {
        return (
            <div style={{ flex: 1, overflow: 'auto', border: isFullScreen ? 'none' : '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <CodeMirror
                    value={value || "No response yet."}
                    readOnly={true}
                    theme={vscodeDark}
                    extensions={[searchExtension(), ...extensions]}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                />
            </div>
        );
    };

    const responseBodyContent = (
        <div className="response-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {activeResponseTab === "Pretty" && renderCodeMirror(pretty, [json()])}
            {activeResponseTab === "Raw" && renderCodeMirror(raw, [])}
            {activeResponseTab === "XML" && (
                <div className="split" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {renderCodeMirror(xml || raw || "No XML available.", [xmlLang()])}
                    {!isFullScreen && (
                        <div className="inline-actions">
                            <button className="ghost" onClick={handleXmlToJson}>XML → JSON</button>
                            <button className="ghost" onClick={() => navigator.clipboard.writeText(xml || raw || "")}>Copy XML</button>
                        </div>
                    )}
                </div>
            )}
            {activeResponseTab === "Headers" && (
                <div className="headers-view" style={{ overflow: 'auto', padding: '16px' }}>
                    {response?.headers && Object.keys(response.headers).length > 0 ? (
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ padding: '8px', color: 'var(--muted)' }}>Header</th>
                                    <th style={{ padding: '8px', color: 'var(--muted)' }}>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(response.headers).map(([key, value]) => (
                                    <tr key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '8px', fontWeight: 500 }}>{key}</td>
                                        <td style={{ padding: '8px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{value}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ color: 'var(--muted)' }}>No headers available.</div>
                    )}
                </div>
            )}
            {activeResponseTab === "Table" && (
                <div className="table-view">
                    <div className="table-toolbar">
                        <input
                            className="input search"
                            placeholder="Search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <select
                            className="input"
                            value={searchKey}
                            onChange={(e) => setSearchKey(e.target.value)}
                        >
                            <option value="">All keys</option>
                            {computedRows[0] && Object.keys(computedRows[0]).map((key) => (
                                <option key={key} value={key}>{key}</option>
                            ))}
                        </select>
                        <select
                            className="input"
                            value={selectedTablePath}
                            onChange={(e) => setSelectedTablePath(e.target.value)}
                        >
                            {tableCandidates.map((path) => (
                                <option key={path} value={path}>{path}</option>
                            ))}
                        </select>
                        <select
                            className="input"
                            value={sortKey}
                            onChange={(e) => setSortKey(e.target.value)}
                        >
                            <option value="">Sort key</option>
                            {computedRows[0] && Object.keys(computedRows[0]).map((key) => (
                                <option key={key} value={key}>{key}</option>
                            ))}
                        </select>
                        <button className="ghost" onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}>
                            Sort: {sortDirection}
                        </button>
                        <button className="ghost" onClick={() => downloadText("table.csv", csv)}>Export CSV</button>
                        <button className="ghost" onClick={() => downloadText("table.json", JSON.stringify(tableRows, null, 2))}>Export JSON</button>
                    </div>
                    <div className="derived">
                        <input
                            className="input"
                            placeholder="Derived field name"
                            value={derivedName}
                            onChange={(e) => setDerivedName(e.target.value)}
                        />
                        <input
                            className="input"
                            placeholder="Expression e.g. name + ' (' + role + ')'"
                            value={derivedExpr}
                            onChange={(e) => setDerivedExpr(e.target.value)}
                        />
                        <button className="ghost" onClick={handleAddDerivedField}>Add</button>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                {computedRows[0] ? Object.keys(computedRows[0]).map((key) => (
                                    <th key={key} onClick={() => handleSort(key)}>{key}</th>
                                )) : (
                                    <th>No data</th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {computedRows.map((row, idx) => (
                                <tr key={idx}>
                                    {Object.keys(row).map((key) => (
                                        <td key={key}>{String(row[key])}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {activeResponseTab === "Visualize" && (
                <div className="visualize">
                    <div className="viz-card">
                        <div className="viz-title">Summary</div>
                        <div className="viz-value">{responseSummary.summary}</div>
                    </div>
                    <div className="viz-card">
                        <div className="viz-title">Rows</div>
                        <div className="viz-value">{tableRows.length}</div>
                    </div>
                    <div className="viz-card">
                        <div className="viz-title">Status</div>
                        <div className="viz-value">{response?.status || "-"}</div>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <section className="response">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className="response-meta" style={{ marginBottom: 0 }}>
                    <div>Status: {response?.status ? `${response.status} ${response.statusText}` : "-"}</div>
                    <div>Latency: {response?.duration ? `${response.duration} ms` : "-"}</div>
                    <div>Size: {response?.body ? `${response.body.length} bytes` : "-"}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {responseTabButtons}
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setIsFullScreen(true)}>Full Screen</button>
                </div>
            </div>

            {error && <div className="error">{error}</div>}

            {!isFullScreen && responseBodyContent}

            <FullScreenModal isOpen={isFullScreen} onClose={() => setIsFullScreen(false)} title="Response" actions={fullScreenActions}>
                {responseBodyContent}
            </FullScreenModal>
        </section>
    );
}
