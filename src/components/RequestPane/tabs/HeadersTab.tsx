import { useState } from "react";
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { lintGutter } from '@codemirror/lint';

import { customJsonLinter } from "../../../utils/codemirror/jsonExtensions";
import { search } from '@codemirror/search';
import { createCustomSearchPanel, customSearchKeymap } from "../../../utils/codemirror/customSearchPanel";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap
];

import { TableEditor } from "../../TableEditor";
import { SegmentedControl } from "../../ui/SegmentedControl";
import styles from "../RequestEditor.module.css";
import { cmTheme } from "../../../theme/codemirrorTheme";
import type { Theme } from "../../../theme/theme";
import type { AutoHeader } from "../../../utils/autoHeaders";

interface HeadersTabProps {
    headersMode: string;
    setHeadersMode: (mode: string) => void;
    headersRows: any[];
    handleHeadersRowsChange: (rows: any[]) => void;
    headersText: string;
    handleHeadersTextChange: (text: string) => void;
    autoHeaders: AutoHeader[];
    getEnvVars: () => any;
    theme: Theme;
}

export function HeadersTab({
    headersMode,
    setHeadersMode,
    headersRows,
    handleHeadersRowsChange,
    headersText,
    handleHeadersTextChange,
    autoHeaders,
    getEnvVars,
    theme
}: HeadersTabProps) {
    const [showHidden, setShowHidden] = useState(false);
    return (
        <div className={styles.headersEditor}>
            <SegmentedControl
                value={headersMode}
                onChange={setHeadersMode}
                options={[
                    { value: "table", label: "Table" },
                    { value: "json", label: "JSON" }
                ]}
            />
            {headersMode === "table" && (
                <TableEditor
                    rows={headersRows}
                    onChange={handleHeadersRowsChange}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                    envVars={getEnvVars()}
                />
            )}
            {headersMode === "json" && (
                <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <CodeMirror
                        value={headersText}
                        theme={cmTheme(theme)}
                        extensions={[json(), customJsonLinter, lintGutter(), ...searchWithReplace()]}
                        onChange={(value) => handleHeadersTextChange(value)}
                        basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                        placeholder="Paste JSON headers here"
                    />
                </div>
            )}

            {autoHeaders.length > 0 && (
                <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                    <button
                        className="ghost compact"
                        style={{ padding: '2px 6px', fontSize: '0.72rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => setShowHidden((s) => !s)}
                        aria-expanded={showHidden}
                    >
                        <span style={{ display: 'inline-block', width: '8px' }}>{showHidden ? '▾' : '▸'}</span>
                        {showHidden ? 'Hide' : 'Show'} auto-generated headers ({autoHeaders.length})
                    </button>
                    {showHidden && (
                        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: '4px' }}>
                                Added automatically when the request is sent. Set a header above to override any of these.
                            </div>
                            {autoHeaders.map((header) => (
                                <div
                                    key={header.key}
                                    style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: '0.76rem', fontFamily: 'var(--font-mono)', padding: '3px 6px', borderRadius: '4px', background: 'var(--panel-2)', color: 'var(--muted)' }}
                                    title="Auto-generated — read only"
                                >
                                    <span style={{ minWidth: '130px', color: 'var(--text-muted)' }}>{header.key}</span>
                                    <span style={{ flex: 1, wordBreak: 'break-all' }}>{header.value}</span>
                                    {header.note && <span style={{ fontStyle: 'italic', fontSize: '0.68rem', opacity: 0.8 }}>{header.note}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
