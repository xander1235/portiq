import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { lineNumbers } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { cmTheme } from "../../theme/codemirrorTheme";
import type { Theme } from "../../theme/theme";
import styles from "./ui.module.css";

export function JsonView({ value, theme, editable = false, onChange, toolbar, gutter = true }: {
  value: string; theme: Theme; editable?: boolean; onChange?: (v: string) => void;
  toolbar?: React.ReactNode; gutter?: boolean;
}) {
  const extensions = [json(), EditorView.lineWrapping];
  if (gutter) extensions.push(lineNumbers());
  return (
    <div className={styles.jsonView}>
      {toolbar && <div className={styles.jsonBar}>{toolbar}</div>}
      <CodeMirror
        value={value}
        theme={cmTheme(theme)}
        extensions={extensions}
        editable={editable}
        readOnly={!editable}
        onChange={onChange}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
