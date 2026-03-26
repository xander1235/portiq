import React from "react";
import ReactDOM from "react-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isSecretPlaceholder, parseSecretPlaceholder } from "../services/githubSync";

interface EnvInputProps {
    value: any;
    onChange: (val: any) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    envVars?: Record<string, string>;
    onUpdateEnvVar?: (key: string, val: string) => void;
}

export function EnvInput({ value, onChange, placeholder, className, style, envVars, onUpdateEnvVar }: EnvInputProps) {
    const containerStyle: React.CSSProperties = { position: "relative", display: "flex", alignItems: "center", flex: 1, ...style };
    const inputRef = React.useRef<HTMLInputElement>(null);
    const textRef = React.useRef<HTMLDivElement>(null);
    const popupRef = React.useRef<HTMLDivElement>(null);
    const suggestRef = React.useRef<HTMLDivElement>(null);
    const [editingKey, setEditingKey] = React.useState<string | null>(null);
    const [draftValue, setDraftValue] = React.useState("");
    const [hoveredData, setHoveredData] = React.useState<any>(null);
    const [suggestions, setSuggestions] = React.useState<string[]>([]);
    const [suggestIndex, setSuggestIndex] = React.useState(0);
    const [suggestRange, setSuggestRange] = React.useState<{ from: number, to: number } | null>(null);

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (editingKey && popupRef.current && !popupRef.current.contains(event.target as Node)) {
                setEditingKey(null);
            }
            if (suggestions.length && suggestRef.current && !suggestRef.current.contains(event.target as Node)) {
                setSuggestions([]);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [editingKey, suggestions.length]);

    const handleScroll = () => {
        if (inputRef.current && textRef.current) {
            textRef.current.scrollLeft = inputRef.current.scrollLeft;
        }
    };

    React.useEffect(() => {
        handleScroll();
    }, [value]);

    function checkAutocomplete(inputEl: HTMLInputElement | null) {
        if (!envVars || !inputEl) {
            setSuggestions([]);
            return;
        }
        const pos = inputEl.selectionStart || 0;
        const text = inputEl.value;
        // Find the nearest {{ before cursor
        const before = text.slice(0, pos);
        const openIdx = before.lastIndexOf("{{");
        if (openIdx === -1) { setSuggestions([]); return; }
        // Make sure there's no }} between {{ and cursor
        const between = before.slice(openIdx + 2);
        if (between.includes("}}")) { setSuggestions([]); return; }
        const partial = between.trim().toLowerCase();
        const keys = Object.keys(envVars).filter(k => k.toLowerCase().includes(partial));
        if (keys.length === 0) { setSuggestions([]); return; }
        setSuggestions(keys);
        setSuggestIndex(0);
        setSuggestRange({ from: openIdx, to: pos });
    }

    function applySuggestion(key: string) {
        if (!suggestRange) return;
        const before = value.slice(0, suggestRange.from);
        // Find if there's a closing }} after cursor
        const afterCursor = value.slice(suggestRange.to);
        const closingIdx = afterCursor.indexOf("}}");
        const after = closingIdx !== -1 ? afterCursor.slice(closingIdx + 2) : afterCursor;
        const newValue = before + "{{" + key + "}}" + after;
        onChange(newValue);
        setSuggestions([]);
        setSuggestRange(null);
        // Set cursor after the inserted variable
        setTimeout(() => {
            if (inputRef.current) {
                const newPos = before.length + key.length + 4; // {{ + key + }}
                inputRef.current.setSelectionRange(newPos, newPos);
                inputRef.current.focus();
            }
        }, 0);
    }

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        onChange(e.target.value);
        setTimeout(() => checkAutocomplete(e.target), 0);
    }

    function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (suggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSuggestIndex(i => (i + 1) % suggestions.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestIndex(i => (i - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applySuggestion(suggestions[suggestIndex]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setSuggestions([]);
                return;
            }
        }
    }

    function handleInputClick() {
        setTimeout(() => {
            if (inputRef.current) checkAutocomplete(inputRef.current);
        }, 0);
    }

    const renderHighlighted = () => {
        const valStr = String(value || "");
        if (!valStr) {
            return <span style={{ color: "var(--muted)" }}>{placeholder}</span>;
        }

        if (isSecretPlaceholder(valStr)) {
            const scope = parseSecretPlaceholder(valStr);
            return (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span style={{ 
                                color: "#ff5555", 
                                backgroundColor: "rgba(255, 85, 85, 0.1)", 
                                padding: "2px 4px", 
                                borderRadius: "4px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                cursor: "help",
                                fontWeight: 600,
                                fontSize: "0.80rem"
                            }}>
                                <span style={{ fontSize: "12px" }}>⚠️</span>
                                [Missing Secret: {scope}]
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>This secret is stored locally. Please provide a value.</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        }

        const parts = valStr.split(/(\{\{.*?\}\})/g);
        return parts.map((part, i) => {
            if (part.startsWith("{{") && part.endsWith("}}")) {
                const key = part.slice(2, -2).trim();
                const exists = envVars && Object.prototype.hasOwnProperty.call(envVars, key);
                return (
                    <span
                        key={i}
                        onPointerEnter={(e: React.PointerEvent) => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setHoveredData({ key, rect });
                        }}
                        onPointerLeave={() => setHoveredData(null)}
                        onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (inputRef.current) {
                                (inputRef.current as HTMLInputElement).focus();
                                const rect = (e.target as HTMLElement).getBoundingClientRect();
                                const clickX = e.clientX - rect.left;
                                const charWidth = rect.width / part.length;
                                const charOffset = Math.round(clickX / charWidth);
                                const prefixLength = parts.slice(0, i).join('').length;
                                const totalOffset = prefixLength + charOffset;
                                (inputRef.current as HTMLInputElement).setSelectionRange(totalOffset, totalOffset);
                            }
                        }}
                        onDoubleClick={(e: React.MouseEvent) => {
                            if (!onUpdateEnvVar) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingKey(key);
                            setDraftValue(exists ? (envVars as Record<string, string>)[key] : "");
                            setHoveredData(null);
                        }}
                        style={{
                            position: "relative" as "relative",
                            color: exists ? "var(--accent-2)" : "#ff5555",
                            backgroundColor: exists ? "rgba(46, 211, 198, 0.15)" : "rgba(255, 85, 85, 0.15)",
                            borderRadius: "3px",
                            cursor: onUpdateEnvVar ? "text" : "default",
                            pointerEvents: "auto" as "auto"
                        }}
                    >
                        {part}
                    </span>
                );
            }
            return <span key={i} style={{ pointerEvents: "none" }}>{part}</span>;
        });
    };

    return (
        <div className={`env-input-wrap ${className}`} style={containerStyle}>
            {hoveredData && !editingKey && ReactDOM.createPortal(
                <div style={{
                    position: "fixed" as const,
                    bottom: window.innerHeight - hoveredData.rect.top + 6,
                    left: hoveredData.rect.left + (hoveredData.rect.width / 2),
                    transform: "translateX(-50%)",
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                    color: "var(--text)",
                    fontSize: "0.80rem",
                    whiteSpace: "nowrap",
                    zIndex: 99999,
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center"
                }}>
                    <div style={{ fontWeight: 600, color: (envVars && Object.prototype.hasOwnProperty.call(envVars, hoveredData.key)) ? 'var(--text)' : '#ff5555' }}>
                        {(envVars && Object.prototype.hasOwnProperty.call(envVars, hoveredData.key)) ? envVars[hoveredData.key] : "Unresolved Variable"}
                    </div>
                    {onUpdateEnvVar && (
                        <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "3px", fontWeight: 500 }}>
                            Double-click to edit
                        </div>
                    )}
                    <div style={{
                        position: "absolute",
                        top: "100%",
                        left: "50%",
                        transform: "translateX(-50%)",
                        borderWidth: "4px",
                        borderStyle: "solid",
                        borderColor: "var(--border) transparent transparent transparent"
                    }}></div>
                </div>,
                document.body
            )}
            {editingKey && (
                <div ref={popupRef} style={{
                    position: "absolute",
                    top: "100%", left: 0,
                    marginTop: "4px",
                    zIndex: 100,
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    padding: "8px",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minWidth: "220px",
                    color: "var(--text)"
                }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Edit variable: {editingKey}</div>
                    <input
                        autoFocus
                        className="input compact"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                onUpdateEnvVar?.(editingKey, draftValue);
                                setEditingKey(null);
                            }
                            if (e.key === "Escape") setEditingKey(null);
                        }}
                        placeholder="Value..."
                    />
                    <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button className="ghost compact" onPointerDown={() => setEditingKey(null)}>Cancel</button>
                        <button
                            className="primary compact"
                            onPointerDown={(e) => {
                                e.preventDefault();
                                onUpdateEnvVar?.(editingKey, draftValue);
                                setEditingKey(null);
                            }}
                        >
                            Save
                        </button>
                    </div>
                </div>
            )}
            <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", overflow: "hidden", padding: 0, margin: 0, height: "100%" }}>
                <div
                    ref={textRef}
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        pointerEvents: "none",
                        whiteSpace: "pre",
                        overflow: "hidden",
                        color: "var(--text)",
                        zIndex: 3,
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        fontWeight: "inherit",
                        letterSpacing: "inherit",
                        wordSpacing: "inherit",
                        display: "flex",
                        alignItems: "center",
                    }}
                >
                    {renderHighlighted()}
                </div>
                <input
                    ref={inputRef}
                    value={String(value || "")}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    onClick={handleInputClick}
                    onScroll={handleScroll}
                    spellCheck={false}
                    style={{
                        flex: 1,
                        width: "100%",
                        height: "100%",
                        padding: 0,
                        margin: 0,
                        border: "none",
                        background: "transparent",
                        outline: "none",
                        color: "transparent",
                        caretColor: "var(--text)",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        fontWeight: "inherit",
                        letterSpacing: "inherit",
                        wordSpacing: "inherit",
                        zIndex: 2,
                        minWidth: 0,
                        position: "relative"
                    }}
                />
            </div>
            {suggestions.length > 0 && ReactDOM.createPortal(
                <div
                    ref={suggestRef}
                    style={{
                        position: "fixed",
                        top: inputRef.current ? (inputRef.current as HTMLElement).getBoundingClientRect().bottom + 4 : 0,
                        left: inputRef.current ? (inputRef.current as HTMLElement).getBoundingClientRect().left : 0,
                        background: "var(--panel-2)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                        zIndex: 100000,
                        minWidth: "180px",
                        maxHeight: "200px",
                        overflowY: "auto",
                        padding: "4px 0"
                    }}
                >
                    {suggestions.map((key, i) => (
                        <div
                            key={key}
                            onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); applySuggestion(key); }}
                            style={{
                                padding: "5px 12px",
                                cursor: "pointer",
                                fontSize: "0.82rem",
                                color: i === suggestIndex ? "var(--bg)" : "var(--text)",
                                backgroundColor: i === suggestIndex ? "var(--accent-2)" : "transparent",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px"
                            }}
                        >
                            <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>{"{{"}</span>
                            <span style={{ fontWeight: 500 }}>{key}</span>
                            <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>{"}}"}</span>
                            {envVars && (envVars as Record<string, string>)[key] && (
                                <span style={{
                                    marginLeft: "auto",
                                    fontSize: "0.72rem",
                                    opacity: 0.6,
                                    maxWidth: "120px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}>
                                    {(envVars as Record<string, string>)[key]}
                                </span>
                            )}
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

interface TableRow {
    key: string;
    value: string;
    enabled?: boolean;
    secret?: boolean;
    masked?: boolean;
    comment?: string;
}

interface TableEditorProps {
    rows: TableRow[];
    onChange: (rows: TableRow[]) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    envVars?: Record<string, string>;
    onUpdateEnvVar?: (key: string, val: string) => void;
    isEnv?: boolean;
    isMaskable?: boolean;
}

export function TableEditor({ rows, onChange, keyPlaceholder, valuePlaceholder, envVars, onUpdateEnvVar, isEnv, isMaskable }: TableEditorProps) {
    const [unmaskedRows, setUnmaskedRows] = React.useState<Record<number, boolean>>({});

    function updateRow(index: number, field: string, value: any) {
        const next = rows.map((row, idx) => (idx === index ? { ...row, [field]: value } : row));
        onChange(next);
    }

    function addRow() {
        const newRow: TableRow = { key: "", value: "", comment: "", enabled: true };
        if (isEnv) newRow.secret = false;
        if (isMaskable) newRow.masked = true;
        onChange([...rows, newRow]);
    }

    function removeRow(index: number) {
        onChange(rows.filter((_, idx) => idx !== index));
    }

    function toggleUnmask(index: number) {
        setUnmaskedRows(prev => ({ ...prev, [index]: !prev[index] }));
    }

    const gridColumns = isEnv
        ? "30px 1fr 1fr 40px 1fr 80px"
        : isMaskable
            ? "30px 1fr 1fr 40px 1fr 80px"
            : "30px 1fr 1fr 1fr 80px";

    return (
        <div className="table-editor">
            <div className="table-editor-header" style={{ gridTemplateColumns: gridColumns }}>
                <div />
                <div>{keyPlaceholder}</div>
                <div>{valuePlaceholder}</div>
                {isEnv && <div style={{ textAlign: "center", display: 'flex', justifyContent: 'center' }} title="GitHub Secret"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></div>}
                {isMaskable && <div style={{ textAlign: "center", display: 'flex', justifyContent: 'center' }} title="Mask value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></div>}
                <div>Comment</div>
                <div className="table-editor-actions">
                    <button className="ghost" onClick={addRow}>Add</button>
                </div>
            </div>
            <div className="table-rows">
                {rows.map((row, index) => {
                    const isMasked = isMaskable && row.masked !== false && !unmaskedRows[index];
                    return (
                        <div className="table-row" key={index} style={{ gridTemplateColumns: gridColumns }}>
                            <input
                                type="checkbox"
                                className="checkbox"
                                checked={row.enabled !== false}
                                onChange={(e) => updateRow(index, "enabled", e.target.checked)}
                            />
                            <EnvInput
                                className="input table-input"
                                value={row.key}
                                placeholder={keyPlaceholder || "Key"}
                                onChange={(val) => updateRow(index, "key", val)}
                                envVars={envVars}
                                onUpdateEnvVar={onUpdateEnvVar}
                                style={{ width: "100%" }}
                            />
                            {isMaskable ? (
                                isMasked ? (
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type="password"
                                            className="input table-input"
                                            value={row.value}
                                            placeholder={valuePlaceholder || "Value"}
                                            onChange={(e) => updateRow(index, "value", e.target.value)}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                ) : (
                                    <EnvInput
                                        className="input table-input"
                                        value={row.value}
                                        placeholder={valuePlaceholder || "Value"}
                                        onChange={(val) => updateRow(index, "value", val)}
                                        envVars={envVars}
                                        onUpdateEnvVar={onUpdateEnvVar}
                                        style={{ width: "100%" }}
                                    />
                                )
                            ) : (
                                <EnvInput
                                    className="input table-input"
                                    value={row.value}
                                    placeholder={valuePlaceholder || "Value"}
                                    onChange={(val) => updateRow(index, "value", val)}
                                    envVars={envVars}
                                    onUpdateEnvVar={onUpdateEnvVar}
                                    style={{ width: "100%" }}
                                />
                            )}
                            {isEnv && (
                                <button
                                    className="ghost icon-button"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: row.secret ? 'var(--accent)' : 'var(--muted)',
                                        opacity: row.secret ? 1 : 0.5
                                    }}
                                    title="Toggle GitHub Secret"
                                    onClick={() => updateRow(index, "secret", !row.secret)}
                                >
                                    {row.secret ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5"></path></svg>
                                    )}
                                </button>
                            )}
                            {isMaskable && (
                                <button
                                    className="ghost icon-button"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '14px',
                                        opacity: isMasked ? 0.7 : 1
                                    }}
                                    title={isMasked ? "Show value" : "Hide value"}
                                    onClick={() => toggleUnmask(index)}
                                >
                                    {isMasked ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                    )}
                                </button>
                            )}
                            <input
                                className="input table-input"
                                value={row.comment || ""}
                                placeholder="Comment"
                                onChange={(e) => updateRow(index, "comment", e.target.value)}
                            />
                            <button className="ghost icon-button" onClick={() => removeRow(index)} aria-label="Remove row">
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
