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
import { summarizeTests } from "../../../services/testRunner";
import { ScriptStep } from "../../../services/scriptSteps";
import { ScriptStepsEditor } from "./ScriptStepsEditor";

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
    testsPreSteps: ScriptStep[];
    setTestsPreSteps: (next: ScriptStep[]) => void;
    testsPostSteps: ScriptStep[];
    setTestsPostSteps: (next: ScriptStep[]) => void;
    vizScriptText: string;
    setVizScriptText: (text: string) => void;
    runVizScript: () => void;
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
    testsPreSteps,
    setTestsPreSteps,
    testsPostSteps,
    setTestsPostSteps,
    vizScriptText,
    setVizScriptText,
    runVizScript,
    testsOutput,
    theme
}: TestsTabProps) {
    return (
        <>
            <div className={styles.testsToolbar}>
                <SegmentedControl
                    value={testsMode}
                    onChange={setTestsMode}
                    size="sm"
                    options={[
                        { value: "pre", label: "Pre-request" },
                        { value: "post", label: "Post-response" },
                        { value: "viz", label: "Visualize" }
                    ]}
                />
                <div className="toolbarRight" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                        className={`${styles.toolbarChip} ${showTestOutput ? styles.toolbarChipOn : ''}`}
                        onClick={() => setShowTestOutput((prev) => !prev)}
                    >Output</button>
                    <button
                        className={`${styles.toolbarChip} ${showTestInput ? styles.toolbarChipOn : ''}`}
                        onClick={() => setShowTestInput((prev) => !prev)}
                    >Test Input</button>
                    <Button
                        variant="primary"
                        className="compact"
                        style={{ height: '28px', padding: '0 12px', fontSize: 'var(--text-xs)', fontWeight: 600 }}
                        onClick={testsMode === 'viz' ? runVizScript : runTests}
                    >{testsMode === 'viz' ? 'Run Visualization' : 'Run Tests'}</Button>
                </div>
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
                    <ScriptStepsEditor
                        steps={testsPreSteps}
                        onChange={setTestsPreSteps}
                        theme={theme}
                        placeholder="// Pre-request step (JavaScript)"
                    />
                )}
                {testsMode === "post" && (
                    <ScriptStepsEditor
                        steps={testsPostSteps}
                        onChange={setTestsPostSteps}
                        theme={theme}
                        placeholder="// Post-response step (JavaScript)"
                    />
                )}
                {testsMode === "viz" && (
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '4px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <CodeMirror
                            value={vizScriptText}
                            theme={cmTheme(theme)}
                            extensions={[javascript(), ...searchWithReplace()]}
                            onChange={(value) => setVizScriptText(value)}
                            basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: '13px' }}
                            placeholder={"// Visualization script — build a chart spec and call:\n// pm.visualizer.set({ type: 'bar', x: 'name', y: 'revenue' });"}
                        />
                    </div>
                )}
                {showTestOutput && (() => {
                    const summary = summarizeTests(testsOutput);
                    return (
                        <div className={styles.testsOutput}>
                            <div style={{ display: 'flex', gap: '12px', padding: '6px 8px', marginBottom: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                <span style={{ color: 'var(--success)' }}>✓ {summary.passed} passed</span>
                                <span style={{ color: summary.failed ? 'var(--error)' : 'var(--muted)' }}>✗ {summary.failed} failed</span>
                                {summary.errored > 0 && <span style={{ color: 'var(--error)' }}>⚠ {summary.errored} errored</span>}
                                <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{summary.duration} ms</span>
                            </div>
                            {summary.groups.map((group) => (
                                <div key={group.name} style={{ marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'color-mix(in srgb, var(--border) 30%, transparent)', fontSize: '0.75rem', fontWeight: 700 }}>
                                        <span>{group.name}</span>
                                        <span style={{ color: 'var(--success)' }}>{group.passed}✓</span>
                                        {group.failed > 0 && <span style={{ color: 'var(--error)' }}>{group.failed}✗</span>}
                                        {group.errored > 0 && <span style={{ color: 'var(--error)' }}>{group.errored}⚠</span>}
                                    </div>
                                    {group.entries.map((entry, index) => (
                                        <div className={`log ${entry.type}`} key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px' }}>
                                            <span className="log-type">
                                                {entry.type === "pass" ? "PASS" : entry.type === "fail" ? "FAIL" : "ERROR"}
                                            </span>
                                            <span className="log-text">{entry.text}</span>
                                            {entry.errorMessage && <span className="log-error">— {entry.errorMessage}</span>}
                                            {typeof entry.duration === "number" && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem' }}>{entry.duration} ms</span>}
                                        </div>
                                    ))}
                                </div>
                            ))}
                            {summary.console.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Console</div>
                                    {summary.console.map((entry, index) => (
                                        <div className={`log ${entry.type}`} key={index}>
                                            <span className="log-type">{entry.type.toUpperCase()}</span>
                                            <span className="log-text">{entry.text}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </>
    );
}
