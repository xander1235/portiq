import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { search as searchExtension } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { createCustomSearchPanel, customSearchKeymap } from "../../utils/codemirror/customSearchPanel.js";
import { FullScreenModal } from "../Modals/FullScreenModal.jsx";
import styles from "./ResponseViewer.module.css";

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
    responseSummary,
    isSending
}) {
    const [isFullScreen, setIsFullScreen] = useState(false);

    const responseTabButtons = (
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
            {responseTabs.map((tab) => (
                <button
                    key={tab}
                    className={tab === activeResponseTab ? `${styles.tab} ${styles.active}` : styles.tab}
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
            <div style={{ flex: 1, border: isFullScreen ? 'none' : '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <CodeMirror
                    value={value || ""}
                    readOnly={true}
                    theme={vscodeDark}
                    extensions={[searchExtension({ top: true, createPanel: createCustomSearchPanel }), customSearchKeymap, ...extensions]}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                />
            </div>
        );
    };

    const loadingSpinner = (
        <div className={styles.loadingContainer}>
            <div className={styles.spinner}></div>
            <span className={styles.loadingText}>Sending request...</span>
        </div>
    );

    const emptyState = (
        <div className={styles.emptyState}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        </div>
    );

    const responseBodyContent = (
        <div className={styles.responseBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
            {activeResponseTab === "Headers" && (() => {
                const headersJson = response?.headers && Object.keys(response.headers).length > 0
                    ? JSON.stringify(response.headers, null, 2)
                    : "No headers available.";
                return renderCodeMirror(headersJson, [json()]);
            })()}
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
                <div className={styles.visualize}>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Summary</div>
                        <div className={styles.vizValue}>{responseSummary.summary}</div>
                    </div>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Rows</div>
                        <div className={styles.vizValue}>{tableRows.length}</div>
                    </div>
                    <div className={styles.vizCard}>
                        <div className={styles.vizTitle}>Status</div>
                        <div className={styles.vizValue}>{response?.status || "-"}</div>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <section className={styles.response}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className={styles.responseMeta} style={{ marginBottom: 0 }}>
                    <div>Status: {response?.status ? `${response.status} ${response.statusText}` : "-"}</div>
                    <div>Latency: {response?.duration ? `${response.duration} ms` : "-"}</div>
                    <div>Size: {response?.body ? `${response.body.length} bytes` : "-"}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {responseTabButtons}
                    <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setIsFullScreen(true)}>Full Screen</button>
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {isSending && !response ? (
                !isFullScreen && loadingSpinner
            ) : !response && !error ? (
                !isFullScreen && emptyState
            ) : (
                !isFullScreen && responseBodyContent
            )}

            <FullScreenModal isOpen={isFullScreen} onClose={() => setIsFullScreen(false)} title="Response" actions={fullScreenActions}>
                {isSending && !response ? loadingSpinner : responseBodyContent}
            </FullScreenModal>
        </section>
    );
}
