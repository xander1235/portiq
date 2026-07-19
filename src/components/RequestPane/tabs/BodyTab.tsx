import React, { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { lintGutter } from '@codemirror/lint';

import { xmlLinter } from "../../../utils/codemirror/xmlExtensions";
import { customJsonLinter } from "../../../utils/codemirror/jsonExtensions";
import { envVarHighlightPlugin, createEnvAutoComplete, createEnvHoverTooltip } from "../../../utils/codemirror/environmentExtensions";
import { search } from '@codemirror/search';
import { createCustomSearchPanel, customSearchKeymap } from "../../../utils/codemirror/customSearchPanel";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap
];

import { TableEditor, EnvInput } from "../../TableEditor";
import { FullScreenModal } from "../../Modals/FullScreenModal";
import { prettifyXml } from "../../../services/format";
import styles from "../RequestEditor.module.css";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cmTheme, indentGuides } from "../../../theme/codemirrorTheme";
import type { Theme } from "../../../theme/theme";

interface MultipartRow {
    key: string;
    value: string;
    enabled: boolean;
    kind: "text" | "file";
    fileName?: string;
    mimeType?: string;
    fileBase64?: string;
}

interface BodyTabProps {
    theme: Theme;
    bodyType: string;
    setBodyType: (type: string) => void;
    setContentType: (type: string) => void;
    bodyText: string;
    setBodyText: (text: string) => void;
    bodyRows: any[];
    setBodyRows: (rows: any[]) => void;
    currentRequestId: string;
    updateRequestState: (id: string, key: string, val: any) => void;
    getEnvVars: () => any;
    handleUpdateEnvVar: (key: string, val: string) => void;
    setCmEnvEdit: (edit: any) => void;
}

export function BodyTab({
    theme,
    bodyType,
    setBodyType,
    setContentType,
    bodyText,
    setBodyText,
    bodyRows,
    setBodyRows,
    currentRequestId,
    updateRequestState,
    getEnvVars,
    handleUpdateEnvVar,
    setCmEnvEdit
}: BodyTabProps) {
    const [isFullScreen, setIsFullScreen] = useState(false);

    const updateBodyRowsState = (nextRows: MultipartRow[]) => {
        setBodyRows(nextRows);
        if (currentRequestId) updateRequestState(currentRequestId, "bodyRows", nextRows);
    };

    const updateMultipartRow = (index: number, patch: Partial<MultipartRow>) => {
        updateBodyRowsState((bodyRows as MultipartRow[] || []).map((row, rowIndex) => (
            rowIndex === index ? { ...row, ...patch } : row
        )));
    };

    const addMultipartRow = () => {
        updateBodyRowsState([...(bodyRows as MultipartRow[] || []), { key: "", value: "", enabled: true, kind: "text" }]);
    };

    const removeMultipartRow = (index: number) => {
        const nextRows = (bodyRows as MultipartRow[] || []).filter((_, rowIndex) => rowIndex !== index);
        updateBodyRowsState(nextRows.length > 0 ? nextRows : [{ key: "", value: "", enabled: true, kind: "text" }]);
    };

    const handleMultipartFileSelect = async (index: number, file: File | undefined) => {
        if (!file) {
            updateMultipartRow(index, { fileName: "", mimeType: "", fileBase64: "" });
            return;
        }
        const arrayBuffer = await file.arrayBuffer();
        let binary = "";
        new Uint8Array(arrayBuffer).forEach((byte: number) => {
            binary += String.fromCharCode(byte);
        });
        updateMultipartRow(index, {
            kind: "file",
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileBase64: btoa(binary),
            value: ""
        });
    };

    const bodyToolbar = (
        <>
            <Select value={bodyType} onValueChange={(val) => {
                setBodyType(val);
                setContentType(val);
            }}>
                <SelectTrigger className="w-[180px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                    <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xml">XML</SelectItem>
                    <SelectItem value="form">x-www-form-urlencoded</SelectItem>
                    <SelectItem value="multipart">form-data</SelectItem>
                    <SelectItem value="raw">Raw</SelectItem>
                </SelectContent>
            </Select>
            {(bodyType === "json" || bodyType === "xml") && (
                <button
                    className="ghost compact"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                    onClick={() => {
                        try {
                            if (bodyType === "json") {
                                const stripComments = (str: string) => str.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                                const parsed = JSON.parse(stripComments(bodyText));
                                setBodyText(JSON.stringify(parsed, null, 2));
                            } else if (bodyType === "xml") {
                                setBodyText(prettifyXml(bodyText));
                            }
                        } catch (e) {
                            // Ignored if invalid
                        }
                    }}
                >
                    Prettify
                </button>
            )}
            {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
            {(bodyType === "json" || bodyType === "xml" || bodyType === "raw" || bodyType === "form" || bodyType === "multipart") && (
                <button className="ghost compact" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setIsFullScreen(true)}>Full Screen</button>
            )}
        </>
    );

    const bodyActions = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Select value={bodyType} onValueChange={(val) => {
                setBodyType(val);
                setContentType(val);
            }}>
                <SelectTrigger className="w-[180px] h-[28px] text-[12px] bg-panel border-border text-foreground">
                    <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="xml">XML</SelectItem>
                    <SelectItem value="form">x-www-form-urlencoded</SelectItem>
                    <SelectItem value="multipart">form-data</SelectItem>
                    <SelectItem value="raw">Raw</SelectItem>
                </SelectContent>
            </Select>
            {(bodyType === "json" || bodyType === "xml") && (
                <button
                    className="ghost compact"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                    onClick={() => {
                        try {
                            if (bodyType === "json") {
                                const stripComments = (str: string) => str.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                                const parsed = JSON.parse(stripComments(bodyText));
                                setBodyText(JSON.stringify(parsed, null, 2));
                            } else if (bodyType === "xml") {
                                setBodyText(prettifyXml(bodyText));
                            }
                        } catch (e) {
                            // Ignored if invalid
                        }
                    }}
                >
                    Prettify
                </button>
            )}
            {bodyType === "json" && <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Supports // comments</div>}
        </div>
    );

    const bodyEditorContent = (
        <div
            className={styles.bodyEditor}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}
        >
            {bodyType === "none" && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", border: isFullScreen ? "none" : "1px solid var(--border)", borderRadius: "4px", fontSize: "0.9rem" }}>
                    This request will be sent without a body.
                </div>
            )}
            {(bodyType === "json" || bodyType === "xml" || bodyType === "raw") && (() => {
                const envAutoComplete = createEnvAutoComplete(getEnvVars);
                const envHoverTooltip = createEnvHoverTooltip(getEnvVars, setCmEnvEdit);

                return (
                    <div style={{ flex: 1, border: isFullScreen ? 'none' : '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <CodeMirror
                            value={bodyText}
                            height="100%"
                            theme={cmTheme(theme)}
                            extensions={
                                bodyType === "json"
                                    ? [json(), customJsonLinter, lintGutter(), indentGuides, envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
                                    : bodyType === "xml"
                                        ? [xmlLang(), xmlLinter, lintGutter(), indentGuides, envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
                                        : [envAutoComplete, envVarHighlightPlugin, envHoverTooltip, ...searchWithReplace()]
                            }
                            onChange={(value) => setBodyText(value)}
                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                        />
                    </div>
                );
            })()}
            {bodyType === "form" && (
                <TableEditor
                    rows={bodyRows}
                    onChange={updateBodyRowsState as (rows: any[]) => void}
                    keyPlaceholder="Field"
                    valuePlaceholder="Value"
                    envVars={getEnvVars()}
                />
            )}
            {bodyType === "multipart" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", minHeight: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                            Add text fields or file parts to the multipart body.
                        </div>
                        <button className="ghost compact" onClick={addMultipartRow}>Add Part</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflow: "auto", minHeight: 0 }}>
                        {(bodyRows || []).map((row, index) => (
                            <div
                                key={index}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "24px 1.2fr 110px 2fr 32px",
                                    gap: "8px",
                                    alignItems: "center",
                                    padding: "8px",
                                    border: "1px solid var(--border)",
                                    borderRadius: "8px",
                                    background: "rgba(255,255,255,0.02)"
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={row.enabled !== false}
                                    onChange={(e) => updateMultipartRow(index, { enabled: e.target.checked })}
                                />
                                <EnvInput
                                    className="input"
                                    value={row.key || ""}
                                    onChange={(value) => updateMultipartRow(index, { key: value })}
                                    envVars={getEnvVars()}
                                    onUpdateEnvVar={handleUpdateEnvVar}
                                    placeholder="Part name"
                                />
                                <Select
                                    value={row.kind || "text"}
                                    onValueChange={(value: "text" | "file") => updateMultipartRow(index, { kind: value })}
                                >
                                    <SelectTrigger className="w-full h-[32px] text-[12px] bg-panel border-border text-foreground">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="text">Text</SelectItem>
                                        <SelectItem value="file">File</SelectItem>
                                    </SelectContent>
                                </Select>
                                {row.kind === "file" ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                        <input
                                            className="input"
                                            type="file"
                                            style={{ flex: 1, minWidth: 0, padding: "4px" }}
                                            onChange={(e) => handleMultipartFileSelect(index, e.target.files?.[0])}
                                        />
                                        <span style={{ fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {row.fileName || "No file"}
                                        </span>
                                    </div>
                                ) : (
                                    <EnvInput
                                        className="input"
                                        value={row.value || ""}
                                        onChange={(value) => updateMultipartRow(index, { value })}
                                        envVars={getEnvVars()}
                                        onUpdateEnvVar={handleUpdateEnvVar}
                                        placeholder="Part value"
                                    />
                                )}
                                <button className="ghost compact" onClick={() => removeMultipartRow(index)}>×</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {bodyToolbar}
            </div>
            {!isFullScreen && bodyEditorContent}
            <FullScreenModal isOpen={isFullScreen} onClose={() => setIsFullScreen(false)} title="Request Body" actions={bodyActions}>
                {bodyEditorContent}
            </FullScreenModal>
        </>
    );
}
