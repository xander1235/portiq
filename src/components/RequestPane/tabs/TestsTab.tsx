import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { lintGutter } from '@codemirror/lint';

import { customJsonLinter } from "../../../utils/codemirror/jsonExtensions";
import { search } from '@codemirror/search';
import { createCustomSearchPanel, customSearchKeymap } from "../../../utils/codemirror/customSearchPanel";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap
];

import { Button } from "../../ui/AppButton";
import { SegmentedControl } from "../../ui/SegmentedControl";
import styles from "../RequestEditor.module.css";
import { cmTheme } from "../../../theme/codemirrorTheme";
import type { Theme } from "../../../theme/theme";

interface TestsTabProps {
    showTestOutput: boolean;
    setShowTestOutput: (val: boolean | ((prev: boolean) => boolean)) => void;
    showTestInput: boolean;
    setShowTestInput: (val: boolean | ((prev: boolean) => boolean)) => void;
    testsMode: string;
    setTestsMode: (mode: string) => void;
    runTests: () => void;
    testsInputText: string;
    setTestsInputText: (text: string) => void;
    testsPreText: string;
    setTestsPreText: (text: string) => void;
    testsPostText: string;
    setTestsPostText: (text: string) => void;
    testsOutput: any;
    theme: Theme;
}

export function TestsTab({
    showTestOutput,
    setShowTestOutput,
    showTestInput,
    setShowTestInput,
    testsMode,
    setTestsMode,
    runTests,
    testsInputText,
    setTestsInputText,
    testsPreText,
    setTestsPreText,
    testsPostText,
    setTestsPostText,
    testsOutput,
    theme
}: TestsTabProps) {
    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Button
                    variant="ghost"
                    className="compact"
                    style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: showTestOutput ? 'var(--accent)' : 'var(--muted)',
                        borderColor: showTestOutput ? 'var(--accent)' : 'var(--border)',
                        background: showTestOutput ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent'
                    }}
                    onClick={() => setShowTestOutput((prev) => !prev)}
                >
                    Output
                </Button>
                <Button
                    variant="ghost"
                    className="compact"
                    style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: showTestInput ? 'var(--accent)' : 'var(--muted)',
                        borderColor: showTestInput ? 'var(--accent)' : 'var(--border)',
                        background: showTestInput ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent'
                    }}
                    onClick={() => setShowTestInput((prev) => !prev)}
                >
                    Test Input
                </Button>
                <SegmentedControl
                    value={testsMode}
                    onChange={setTestsMode}
                    options={[
                        { value: "pre", label: "Pre-request" },
                        { value: "post", label: "Post-response" }
                    ]}
                />
                <Button variant="primary" className="compact" style={{ padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600 }} onClick={runTests}>Run Tests</Button>
            </div>
            <div className={styles.testsEditor}>
                {showTestInput && (
                    <div className={styles.testsInputInline}>
                        <div className="panel-title">Test Input (JSON)</div>
                        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: '100px' }}>
                            <CodeMirror
                                value={testsInputText}
                                theme={cmTheme(theme)}
                                extensions={[json(), customJsonLinter, lintGutter(), ...searchWithReplace()]}
                                onChange={(value) => setTestsInputText(value)}
                                basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                            />
                        </div>
                    </div>
                )}
                {testsMode === "pre" && (
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <CodeMirror
                            value={testsPreText}
                            theme={cmTheme(theme)}
                            extensions={[javascript(), ...searchWithReplace()]}
                            onChange={(value) => setTestsPreText(value)}
                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                            placeholder="// Pre-request script (JavaScript)"
                        />
                    </div>
                )}
                {testsMode === "post" && (
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <CodeMirror
                            value={testsPostText}
                            theme={cmTheme(theme)}
                            extensions={[javascript(), ...searchWithReplace()]}
                            onChange={(value) => setTestsPostText(value)}
                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                            placeholder="// Post-response script (JavaScript)"
                        />
                    </div>
                )}
                {showTestOutput && (
                    <div className={styles.testsOutput}>
                        {testsOutput.map((entry: any, index: number) => (
                            <div className={`log ${entry.type}`} key={index}>
                                <span className="log-label">{entry.label || "script"}&gt;</span>
                                {entry.type === "pass" && <span className="log-type">PASS</span>}
                                {entry.type === "fail" && <span className="log-type">FAIL</span>}
                                {entry.type === "error" && <span className="log-type">ERROR</span>}
                                {entry.type === "info" && <span className="log-type">INFO</span>}
                                {entry.type === "log" && <span className="log-type">LOG</span>}
                                <span className="log-text">{entry.text}</span>
                                {entry.errorType && <span className="log-error">({entry.errorType}{entry.errorMessage ? `: ${entry.errorMessage}` : ""})</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}
