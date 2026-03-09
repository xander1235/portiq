import React from "react";
import ReactDOM from "react-dom";

export function EnvInput({ value, onChange, placeholder, className, style, envVars, onUpdateEnvVar }) {
    const containerStyle = { position: "relative", display: "flex", alignItems: "center", flex: 1, ...style };
    const inputRef = React.useRef(null);
    const textRef = React.useRef(null);
    const popupRef = React.useRef(null);
    const [editingKey, setEditingKey] = React.useState(null);
    const [draftValue, setDraftValue] = React.useState("");
    const [hoveredData, setHoveredData] = React.useState(null);

    React.useEffect(() => {
        function handleClickOutside(event) {
            if (editingKey && popupRef.current && !popupRef.current.contains(event.target)) {
                setEditingKey(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [editingKey]);

    const handleScroll = () => {
        if (inputRef.current && textRef.current) {
            textRef.current.scrollLeft = inputRef.current.scrollLeft;
        }
    };

    React.useEffect(() => {
        handleScroll();
    }, [value]);

    const renderHighlighted = () => {
        if (!value) {
            return <span style={{ color: "var(--muted)" }}>{placeholder}</span>;
        }
        const parts = value.split(/(\{\{.*?\}\})/g);
        return parts.map((part, i) => {
            if (part.startsWith("{{") && part.endsWith("}}")) {
                const key = part.slice(2, -2).trim();
                const exists = envVars && Object.prototype.hasOwnProperty.call(envVars, key);
                return (
                    <span
                        key={i}
                        onPointerEnter={(e) => {
                            const rect = e.target.getBoundingClientRect();
                            setHoveredData({ key, rect });
                        }}
                        onPointerLeave={() => setHoveredData(null)}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (inputRef.current) {
                                inputRef.current.focus();
                                const rect = e.target.getBoundingClientRect();
                                const clickX = e.clientX - rect.left;
                                const charWidth = rect.width / part.length;
                                const charOffset = Math.round(clickX / charWidth);
                                const prefixLength = parts.slice(0, i).join('').length;
                                const totalOffset = prefixLength + charOffset;
                                inputRef.current.setSelectionRange(totalOffset, totalOffset);
                            }
                        }}
                        onDoubleClick={(e) => {
                            if (!onUpdateEnvVar) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingKey(key);
                            setDraftValue(exists ? envVars[key] : "");
                            setHoveredData(null);
                        }}
                        style={{
                            position: "relative",
                            color: exists ? "var(--accent-2)" : "#ff5555",
                            backgroundColor: exists ? "rgba(46, 211, 198, 0.15)" : "rgba(255, 85, 85, 0.15)",
                            borderRadius: "3px",
                            cursor: onUpdateEnvVar ? "text" : "default",
                            pointerEvents: "auto"
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
                    position: "fixed",
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
                                onUpdateEnvVar(editingKey, draftValue);
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
                                onUpdateEnvVar(editingKey, draftValue);
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
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
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
        </div>
    );
}

export function TableEditor({ rows, onChange, keyPlaceholder, valuePlaceholder, envVars, onUpdateEnvVar, isEnv, isMaskable }) {
    const [unmaskedRows, setUnmaskedRows] = React.useState({});

    function updateRow(index, field, value) {
        const next = rows.map((row, idx) => (idx === index ? { ...row, [field]: value } : row));
        onChange(next);
    }

    function addRow() {
        const newRow = { key: "", value: "", comment: "", enabled: true };
        if (isEnv) newRow.secret = false;
        if (isMaskable) newRow.masked = true;
        onChange([...rows, newRow]);
    }

    function removeRow(index) {
        onChange(rows.filter((_, idx) => idx !== index));
    }

    function toggleUnmask(index) {
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
                            <input
                                className="input table-input"
                                value={row.key}
                                placeholder={keyPlaceholder || "Key"}
                                onChange={(e) => updateRow(index, "key", e.target.value)}
                            />
                            {isMaskable ? (
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type={isMasked ? "password" : "text"}
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
