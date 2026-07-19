import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { search } from "@codemirror/search";
import { createCustomSearchPanel, customSearchKeymap } from "../../../utils/codemirror/customSearchPanel";
import styles from "../RequestEditor.module.css";
import { cmTheme } from "../../../theme/codemirrorTheme";
import type { Theme } from "../../../theme/theme";
import { ScriptStep, emptyStep } from "../../../services/scriptSteps";

const searchWithReplace = () => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap,
];

interface ScriptStepsEditorProps {
    steps: ScriptStep[];
    onChange: (next: ScriptStep[]) => void;
    theme: Theme;
    placeholder?: string;
}

export function ScriptStepsEditor({ steps, onChange, theme, placeholder }: ScriptStepsEditorProps) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [starter, setStarter] = useState<ScriptStep>(() => emptyStep("Step 1"));

    const patch = (id: string, fields: Partial<ScriptStep>) =>
        onChange(steps.map((s) => (s.id === id ? { ...s, ...fields } : s)));
    const remove = (id: string) => onChange(steps.filter((s) => s.id !== id));
    const move = (index: number, delta: number) => {
        const next = [...steps];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };
    const add = () => onChange([...steps, emptyStep(`Step ${steps.length + 1}`)]);
    const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

    const patchStarter = (fields: Partial<ScriptStep>) => {
        const next = { ...starter, ...fields };
        setStarter(next);
        onChange([next]);
    };

    if (steps.length === 0) {
        const isCollapsed = !!collapsed[starter.id];
        return (
            <div className={styles.stepsList}>
                <div className={styles.stepCard} key={starter.id}>
                    <div className={styles.stepHeader}>
                        <button
                            className={styles.stepIconBtn}
                            title={isCollapsed ? "Expand" : "Collapse"}
                            onClick={() => toggle(starter.id)}
                        >
                            {isCollapsed ? "▸" : "▾"}
                        </button>
                        <input
                            className={styles.stepName}
                            value={starter.name}
                            spellCheck={false}
                            placeholder="Step 1"
                            onChange={(e) => patchStarter({ name: e.target.value })}
                        />
                        <button className={styles.stepIconBtn} title="Move up" disabled>↑</button>
                        <button className={styles.stepIconBtn} title="Move down" disabled>↓</button>
                        <button className={styles.stepIconBtn} title="Remove step" disabled>✕</button>
                    </div>
                    {!isCollapsed && (
                        <div className={styles.stepBody}>
                            <CodeMirror
                                value={starter.script}
                                theme={cmTheme(theme)}
                                extensions={[javascript(), ...searchWithReplace()]}
                                onChange={(value) => patchStarter({ script: value })}
                                basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: "13px" }}
                                placeholder={placeholder}
                            />
                        </div>
                    )}
                </div>
                <button className={styles.stepAdd} onClick={add}>+ Add step</button>
            </div>
        );
    }

    return (
        <div className={styles.stepsList}>
            {steps.map((step, index) => {
                const isCollapsed = !!collapsed[step.id];
                return (
                    <div className={styles.stepCard} key={step.id}>
                        <div className={styles.stepHeader}>
                            <button
                                className={styles.stepIconBtn}
                                title={isCollapsed ? "Expand" : "Collapse"}
                                onClick={() => toggle(step.id)}
                            >
                                {isCollapsed ? "▸" : "▾"}
                            </button>
                            <input
                                className={styles.stepName}
                                value={step.name}
                                spellCheck={false}
                                placeholder={`Step ${index + 1}`}
                                onChange={(e) => patch(step.id, { name: e.target.value })}
                            />
                            <button className={styles.stepIconBtn} title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                            <button className={styles.stepIconBtn} title="Move down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>↓</button>
                            <button className={styles.stepIconBtn} title="Remove step" onClick={() => remove(step.id)}>✕</button>
                        </div>
                        {!isCollapsed && (
                            <div className={styles.stepBody}>
                                <CodeMirror
                                    value={step.script}
                                    theme={cmTheme(theme)}
                                    extensions={[javascript(), ...searchWithReplace()]}
                                    onChange={(value) => patch(step.id, { script: value })}
                                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                                    style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: "13px" }}
                                    placeholder={placeholder}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
            <button className={styles.stepAdd} onClick={add}>+ Add step</button>
        </div>
    );
}
