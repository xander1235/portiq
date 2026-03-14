import React, { useState, useMemo, useRef, useEffect } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { search as searchExtension } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { createCustomSearchPanel, customSearchKeymap } from "../../utils/codemirror/customSearchPanel";
import { FullScreenModal } from "../Modals/FullScreenModal";
import styles from "./ResponseViewer.module.css";
import { isDerivedError } from "../../services/table";

interface RenderCellProps {
    val: any;
}

function RenderCell({ val }: RenderCellProps) {
    const [expanded, setExpanded] = useState(false);
    if (isDerivedError(val)) {
        return <span className="cell-error" title={val.message}>#ERR</span>;
    }
    if (val === null || val === undefined) {
        return <span className="cell-null">{val === null ? "null" : "—"}</span>;
    }
    if (typeof val === "boolean") {
        return <span className="cell-bool">{String(val)}</span>;
    }
    if (typeof val === "number") {
        return <span className="cell-number">{val}</span>;
    }
    if (Array.isArray(val)) {
        return (
            <span>
                <span className="cell-pill" onClick={() => setExpanded(e => !e)}>
                    [{val.length} items]
                </span>
                {expanded && (
                    <div className="cell-expanded-content">
                        {val.map((item: any, i: number) => (
                            <div className="mini-row" key={i}>
                                <span className="mini-key">{i}</span>
                                <span className="mini-val">{item && typeof item === 'object' ? JSON.stringify(item) : String(item)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </span>
        );
    }
    if (typeof val === "object") {
        const entries = Object.entries(val);
        return (
            <span>
                <span className="cell-pill" onClick={() => setExpanded(e => !e)}>
                    {"{" + entries.length + " keys}"}
                </span>
                {expanded && (
                    <div className="cell-expanded-content">
                        {entries.map(([k, v]) => (
                            <div className="mini-row" key={k}>
                                <span className="mini-key">{k}</span>
                                <span className="mini-val">{v && typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </span>
        );
    }
    const str = String(val);
    return str.length > 80 ? <span title={str}>{str.slice(0, 80)}…</span> : str;
}

interface ResponseViewerProps {
    response: any;
    responseTabs: string[];
    activeResponseTab: string;
    setActiveResponseTab: (tab: string) => void;
    error: string | null;
    pretty: string;
    raw: string;
    xml: string;
    handleXmlToJson: () => void;
    search: string;
    setSearch: (s: string) => void;
    searchKey: string;
    setSearchKey: (s: string) => void;
    computedRows: any[];
    selectedTablePath: string;
    setSelectedTablePath: (p: string) => void;
    tableCandidates: string[];
    sortKey: string;
    setSortKey: (s: string) => void;
    sortDirection: "asc" | "desc";
    setSortDirection: (d: "asc" | "desc") => void;
    downloadText: (n: string, t: string) => void;
    csv: string;
    tableRows: any[];
    derivedName: string;
    setDerivedName: (n: string) => void;
    derivedExpr: string;
    setDerivedExpr: (e: string) => void;
    handleAddDerivedField: () => void;
    handleSort: (k: string) => void;
    responseSummary: any;
    isSending: boolean;
    onClearWebSocketMessages?: () => void;
}

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
    isSending,
    onClearWebSocketMessages
}: ResponseViewerProps) {
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
    const [activeColFilters, setActiveColFilters] = useState<Set<string>>(new Set());
    const [columnOrder, setColumnOrder] = useState<string[] | null>(null);
    const [dragCol, setDragCol] = useState<string | null>(null);
    const [dragOverCol, setDragOverCol] = useState<string | null>(null);
    const [wsFilter, setWsFilter] = useState("all");
    const [wsAutoScroll, setWsAutoScroll] = useState(true);
    const [tablePathDraft, setTablePathDraft] = useState(selectedTablePath || "$");
    const wsMessagesEndRef = useRef<HTMLDivElement | null>(null);

    const columnFilteredRows = useMemo(() => {
        const hasColFilters = Object.values(columnFilters).some(v => v);
        if (!hasColFilters) return computedRows;
        return computedRows.filter(row =>
            Object.entries(columnFilters).every(([col, filter]) => {
                if (!filter) return true;
                const val = row[col];
                return String(val ?? "").toLowerCase().includes(filter.toLowerCase());
            })
        );
    }, [computedRows, columnFilters]);

    // Derive ordered keys from the full row set without transforming names.
    const rawKeys = useMemo(() => {
        const seen = new Set<string>();
        const keys: string[] = [];
        (computedRows || []).forEach((row) => {
            Object.keys(row || {}).forEach((key) => {
                if (!seen.has(key)) {
                    seen.add(key);
                    keys.push(key);
                }
            });
        });
        return keys;
    }, [computedRows]);

    const orderedKeys = useMemo(() => {
        if (!columnOrder) return rawKeys;
        // Only keep keys that still exist, and append any new ones
        const existing = columnOrder.filter(k => rawKeys.includes(k));
        const newKeys = rawKeys.filter(k => !columnOrder.includes(k));
        return [...existing, ...newKeys];
    }, [columnOrder, rawKeys]);

    // Reset column order when keys change fundamentally
    const rawKeysStr = rawKeys.join(',');
    React.useEffect(() => {
        setColumnOrder(null);
        setColumnFilters({});
        setActiveColFilters(new Set());
    }, [rawKeysStr]);

    // Column statistics
    const columnStats = useMemo(() => {
        const stats: Record<string, { count: number; sum: number; avg: number; min: number; max: number }> = {};
        const rows = columnFilteredRows;
        if (rows.length === 0) return stats;
        for (const key of orderedKeys) {
            const nums: number[] = [];
            for (const row of rows) {
                const v = row[key];
                if (typeof v === 'number' && !isNaN(v)) nums.push(v);
            }
            if (nums.length > 0) {
                const sum = nums.reduce((a, b) => a + b, 0);
                stats[key] = {
                    count: nums.length,
                    sum: Math.round(sum * 100) / 100,
                    avg: Math.round((sum / nums.length) * 100) / 100,
                    min: Math.min(...nums),
                    max: Math.max(...nums),
                };
            }
        }
        return stats;
    }, [columnFilteredRows, orderedKeys]);

    const clickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const responseTabButtons = (
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
            {responseTabs.map((tab: string) => (
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

    const renderCodeMirror = (value: string, extensions: any[] = []) => {
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

    const websocketMessages = response?.protocol === "websocket"
        ? (response?.ws?.messages || [])
        : [];

    const filteredWebSocketMessages = useMemo(() => {
        if (wsFilter === "all") return websocketMessages;
        return websocketMessages.filter((msg: any) => msg.direction === wsFilter);
    }, [websocketMessages, wsFilter]);


    useEffect(() => {
        setTablePathDraft(selectedTablePath || "$");
    }, [selectedTablePath]);

    const sentWebSocketCount = useMemo(
        () => websocketMessages.filter((msg: any) => msg.direction === "outgoing").length,
        [websocketMessages]
    );
    const receivedWebSocketCount = useMemo(
        () => websocketMessages.filter((msg: any) => msg.direction === "incoming").length,
        [websocketMessages]
    );

    useEffect(() => {
        if (response?.protocol === "websocket" && wsAutoScroll && wsMessagesEndRef.current) {
            wsMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [response?.protocol, filteredWebSocketMessages, wsAutoScroll]);

    const chartConfig = useMemo(() => {
        if (!Array.isArray(tableRows) || tableRows.length === 0) return null;
        const numericKeys = Object.keys(tableRows[0] || {}).filter((key) =>
            tableRows.some((row: any) => typeof row[key] === "number" && !Number.isNaN(row[key]))
        );
        if (numericKeys.length === 0) return null;
        const valueKey = numericKeys[0];
        const labelKey = Object.keys(tableRows[0] || {}).find((key) => key !== valueKey && typeof tableRows[0][key] !== "object")
            || null;
        const points = tableRows.slice(0, 10).map((row: any, index: number) => ({
            label: labelKey ? String(row[labelKey] ?? `Row ${index + 1}`) : `Row ${index + 1}`,
            value: Number(row[valueKey] || 0)
        }));
        const maxValue = Math.max(...points.map((point: any) => point.value), 1);
        return { valueKey, labelKey, points, maxValue };
    }, [tableRows]);

    if (response?.protocol === "websocket") {
        const wsStatus = response?.ws?.status || "disconnected";
        const wsError = response?.error || error;
        const statusColor = wsStatus === "connected"
            ? "#22c55e"
            : wsStatus === "connecting" || wsStatus === "reconnecting"
                ? "#f59e0b"
                : wsStatus === "error"
                    ? "#ef4444"
                    : "var(--muted)";

        return (
            <section className={styles.response}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "12px" }}>
                    <div className={styles.responseMeta} style={{ marginBottom: 0, flexWrap: "wrap" }}>
                        <div>Status: <span style={{ color: statusColor, fontWeight: 600 }}>{wsStatus}</span></div>
                        <div>Sent: {sentWebSocketCount}</div>
                        <div>Received: {receivedWebSocketCount}</div>
                        <div>Connected: {response?.ws?.elapsedSeconds != null ? `${response.ws.elapsedSeconds}s` : "-"}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <div className={styles.tabs} style={{ marginBottom: 0 }}>
                            {["all", "incoming", "outgoing"].map((item) => (
                                <button
                                    key={item}
                                    className={wsFilter === item ? `${styles.tab} ${styles.active}` : styles.tab}
                                    onClick={() => setWsFilter(item)}
                                >
                                    {item === "incoming" ? "Received" : item === "outgoing" ? "Sent" : "All"}
                                </button>
                            ))}
                        </div>
                        <button className="ghost compact" onClick={() => onClearWebSocketMessages?.()}>Clear</button>
                        <label style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                            <input type="checkbox" checked={wsAutoScroll} onChange={(e) => setWsAutoScroll(e.target.checked)} />
                            Auto-scroll
                        </label>
                    </div>
                </div>

                {wsError && <div className={styles.error}>{wsError}</div>}

                <div className={styles.responseBody} style={{ gap: "8px", padding: "12px" }}>
                    {filteredWebSocketMessages.length === 0 ? (
                        emptyState
                    ) : (
                        filteredWebSocketMessages.map((msg: any, index: number) => (
                            <div
                                key={index}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "6px",
                                    padding: "10px 12px",
                                    borderRadius: "10px",
                                    background: msg.direction === "outgoing" ? "rgba(99, 102, 241, 0.08)" : "rgba(34, 197, 94, 0.08)",
                                    border: `1px solid ${msg.direction === "outgoing" ? "rgba(99, 102, 241, 0.16)" : "rgba(34, 197, 94, 0.16)"}`,
                                    alignSelf: msg.direction === "outgoing" ? "flex-end" : "flex-start",
                                    width: "min(78%, 720px)"
                                }}
                            >
                                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "0.72rem", color: "var(--muted)" }}>
                                    <span style={{ fontWeight: 700, color: msg.direction === "outgoing" ? "#818cf8" : "#22c55e" }}>
                                        {msg.direction === "outgoing" ? "SENT" : "RECEIVED"}
                                    </span>
                                    <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ""}</span>
                                    {msg.size !== undefined && <span>{msg.size}B</span>}
                                    {msg.encoding === "base64" && <span>binary/base64</span>}
                                </div>
                                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "IBM Plex Mono, monospace", fontSize: "0.8rem", color: "var(--text)" }}>
                                    {msg.parsed?.type === "json"
                                        ? JSON.stringify(msg.parsed.data, null, 2)
                                        : (msg.data || msg.raw || "")}
                                </pre>
                            </div>
                        ))
                    )}
                    <div ref={wsMessagesEndRef} />
                </div>
            </section>
        );
    }

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
            {activeResponseTab === "Table" && (() => {
                const keys = orderedKeys;
                const filteredRows = columnFilteredRows;
                const hasStats = Object.keys(columnStats).length > 0;

                const handleDragStart = (key: string) => { setDragCol(key); };
                const handleDragOver = (e: React.DragEvent, key: string) => { e.preventDefault(); setDragOverCol(key); };
                const handleDragEnd = () => { setDragCol(null); setDragOverCol(null); };
                const handleDrop = (targetKey: string) => {
                    if (!dragCol || dragCol === targetKey) return;
                    const order = [...keys];
                    const fromIdx = order.indexOf(dragCol);
                    const toIdx = order.indexOf(targetKey);
                    order.splice(fromIdx, 1);
                    order.splice(toIdx, 0, dragCol);
                    setColumnOrder(order);
                    setDragCol(null);
                    setDragOverCol(null);
                };

                return (
                    <div className="table-view">
                        <div className="table-toolbar">
                            <input
                                className="input search"
                                placeholder="Search all columns…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "min(420px, 42vw)", flex: "1 1 360px" }}>
                                <input
                                    className="input"
                                    list="table-path-options"
                                    placeholder="Load table from path, e.g. $.data.items"
                                    value={tablePathDraft}
                                    onChange={(e) => setTablePathDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            setSelectedTablePath(tablePathDraft || "$");
                                        }
                                    }}
                                    style={{ minWidth: 0, flex: 1 }}
                                />
                                <datalist id="table-path-options">
                                    {tableCandidates.map((path: string) => (
                                        <option key={path} value={path} />
                                    ))}
                                </datalist>
                                <button className="ghost compact" onClick={() => setSelectedTablePath(tablePathDraft || "$")}>Load</button>
                            </div>
                            <button className="ghost compact" onClick={() => downloadText("table.csv", csv)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                CSV
                            </button>
                            <button className="ghost compact" onClick={() => downloadText("table.json", JSON.stringify(tableRows, null, 2))}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                JSON
                            </button>
                            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                                {filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''}
                            </span>
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
                            <button className="ghost compact" onClick={handleAddDerivedField}>Add</button>
                        </div>
                        <div className="table-scroll-container">
                            <table>
                                <thead>
                                    <tr>
                                        {keys.length > 0 ? keys.map((key: string) => {
                                            const hasFilter = !!(columnFilters[key]);
                                            const classes = [
                                                sortKey === key ? "sort-active" : "",
                                                hasFilter ? "filter-active" : "",
                                                dragCol === key ? "dragging" : "",
                                                dragOverCol === key ? "drag-over" : "",
                                            ].filter(Boolean).join(" ");
                                            return (
                                                <th
                                                    key={key}
                                                    className={classes}
                                                    draggable="true"
                                                    onDragStart={() => handleDragStart(key)}
                                                    onDragOver={(e) => handleDragOver(e, key)}
                                                    onDragEnd={handleDragEnd}
                                                    onDrop={() => handleDrop(key)}
                                                    onClick={() => {
                                                        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                                                        clickTimerRef.current = setTimeout(() => handleSort(key), 200);
                                                    }}
                                                    onDoubleClick={(e) => {
                                                        e.preventDefault();
                                                        if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                                                        setActiveColFilters(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(key)) {
                                                                next.delete(key);
                                                                setColumnFilters(f => { const n = { ...f }; delete n[key]; return n; });
                                                            }
                                                            else next.add(key);
                                                            return next;
                                                        });
                                                    }}
                                                    title="Click: sort · Double-click: filter · Drag: reorder"
                                                >
                                                    {key}
                                                    {sortKey === key && (
                                                        <span className="sort-indicator">
                                                            {sortDirection === "asc" ? "▲" : "▼"}
                                                        </span>
                                                    )}
                                                    {hasFilter && <span className="filter-dot" />}
                                                </th>
                                            );
                                        }) : (
                                            <th>No data</th>
                                        )}
                                    </tr>
                                    {activeColFilters.size > 0 && (
                                        <tr className="col-filter-row">
                                            {keys.map((key: string) => (
                                                <th key={key}>
                                                    {activeColFilters.has(key) ? (
                                                        <div className="col-filter-wrap">
                                                            <input
                                                                className={`col-filter-input${columnFilters[key] ? ' has-value' : ''}`}
                                                                placeholder={`Filter ${key}…`}
                                                                value={columnFilters[key] || ""}
                                                                onChange={(e) => setColumnFilters(prev => ({ ...prev, [key]: e.target.value }))}
                                                                autoFocus
                                                            />
                                                            {columnFilters[key] && (
                                                                <button className="col-filter-clear" onClick={() => setColumnFilters(prev => ({ ...prev, [key]: "" }))} title="Clear filter">×</button>
                                                            )}
                                                        </div>
                                                    ) : null}
                                                </th>
                                            ))}
                                        </tr>
                                    )}
                                </thead>
                                <tbody>
                                    {filteredRows.map((row: any, idx: number) => (
                                        <tr key={idx}>
                                            {keys.map((key: string) => {
                                                const val = row[key];
                                                const isNum = typeof val === 'number';
                                                const isExpandable = (Array.isArray(val) || (val !== null && typeof val === 'object' && !Array.isArray(val)));
                                                return (
                                                    <td key={key} className={`${isNum ? 'cell-number-align' : ''}${isExpandable ? ' cell-expanded' : ''}`}>
                                                        <RenderCell val={val} />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                    {filteredRows.length === 0 && (
                                        <tr>
                                            <td colSpan={keys.length || 1} style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px', fontStyle: 'italic' }}>
                                                No matching rows
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                {hasStats && (
                                    <tfoot>
                                        <tr>
                                            {keys.map((key: string) => {
                                                const s = columnStats[key];
                                                if (!s) return <td key={key} />;
                                                return (
                                                    <td key={key}>
                                                        <div className="stat-group">
                                                            <div className="stat-row">
                                                                <span className="stat-label">Σ</span>
                                                                <span className="stat-value">{s.sum.toLocaleString()}</span>
                                                            </div>
                                                            <div className="stat-row">
                                                                <span className="stat-label">μ</span>
                                                                <span className="stat-value">{s.avg.toLocaleString()}</span>
                                                            </div>
                                                            <div className="stat-row">
                                                                <span className="stat-label">↕</span>
                                                                <span className="stat-value">{s.min}–{s.max}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                );
            })()}
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
                    {chartConfig && (
                        <div className={styles.vizCard} style={{ gridColumn: "1 / -1" }}>
                            <div className={styles.vizTitle}>Chart</div>
                            <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: "10px" }}>
                                {chartConfig.valueKey} across the first {chartConfig.points.length} rows
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {chartConfig.points.map((point) => (
                                    <div key={point.label} style={{ display: "grid", gridTemplateColumns: "140px 1fr 80px", gap: "10px", alignItems: "center" }}>
                                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)" }}>
                                            {point.label}
                                        </div>
                                        <div style={{ height: "10px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                            <div
                                                style={{
                                                    width: `${(point.value / chartConfig.maxValue) * 100}%`,
                                                    height: "100%",
                                                    borderRadius: "999px",
                                                    background: "linear-gradient(90deg, var(--accent-2), var(--accent))"
                                                }}
                                            />
                                        </div>
                                        <div style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>{point.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
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
                    <div>HTTP: {response?.httpVersion || "-"}</div>
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
