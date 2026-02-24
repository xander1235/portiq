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
                            padding: "0 2px",
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

export function TableEditor({ rows, onChange, keyPlaceholder, valuePlaceholder, envVars, onUpdateEnvVar }) {
    function updateRow(index, field, value) {
        const next = rows.map((row, idx) => (idx === index ? { ...row, [field]: value } : row));
        onChange(next);
    }

    function addRow() {
        onChange([...rows, { key: "", value: "", comment: "", enabled: true }]);
    }

    function removeRow(index) {
        onChange(rows.filter((_, idx) => idx !== index));
    }

    return (
        <div className="table-editor">
            <div className="table-editor-header">
                <div />
                <div>{keyPlaceholder}</div>
                <div>{valuePlaceholder}</div>
                <div>Comment</div>
                <div className="table-editor-actions">
                    <button className="ghost" onClick={addRow}>Add</button>
                </div>
            </div>
            <div className="table-rows">
                {rows.map((row, index) => (
                    <div className="table-row" key={index}>
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
                        <EnvInput
                            className="input table-input"
                            value={row.value}
                            placeholder={valuePlaceholder || "Value"}
                            onChange={(val) => updateRow(index, "value", val)}
                            envVars={envVars}
                            onUpdateEnvVar={onUpdateEnvVar}
                            style={{ width: "100%" }}
                        />
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
                ))}
            </div>
        </div>
    );
}
