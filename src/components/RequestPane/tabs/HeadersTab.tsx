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

interface HeadersTabProps {
    headersMode: string;
    setHeadersMode: (mode: string) => void;
    headersRows: any[];
    handleHeadersRowsChange: (rows: any[]) => void;
    headersText: string;
    handleHeadersTextChange: (text: string) => void;
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
    getEnvVars,
    theme
}: HeadersTabProps) {
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
        </div>
    );
}
