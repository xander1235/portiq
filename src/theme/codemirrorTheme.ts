import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { Theme } from "./theme";

type Palette = {
  bg: string; text: string; caret: string; selection: string;
  gutterBg: string; gutterText: string; border: string;
  key: string; str: string; num: string; bool: string; nul: string; punct: string;
};

const DARK: Palette = {
  bg: "#0c0e13", text: "#c9d1e0", caret: "#ff7a59", selection: "#2a3346",
  gutterBg: "#0a0c10", gutterText: "#5a6478", border: "#222839",
  key: "#2ed3c6", str: "#8fe3a1", num: "#ff9d73", bool: "#b79cff", nul: "#b79cff", punct: "#5f6a80",
};
const LIGHT: Palette = {
  bg: "#ffffff", text: "#2b3240", caret: "#d15a2c", selection: "#dbeafe",
  gutterBg: "#fafbfc", gutterText: "#b3bac6", border: "#eceef2",
  key: "#0e8f86", str: "#2f8a4a", num: "#d15a2c", bool: "#6b4fd0", nul: "#6b4fd0", punct: "#9aa2b0",
};

function build(p: Palette, dark: boolean): Extension {
  const view = EditorView.theme(
    {
      "&": { color: p.text, backgroundColor: p.bg, fontSize: "13px" },
      ".cm-content": { fontFamily: '"Fira Code", monospace', lineHeight: "1.5", caretColor: p.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: p.selection,
      },
      ".cm-gutters": { backgroundColor: p.gutterBg, color: p.gutterText, border: "none", borderRight: `1px solid ${p.border}` },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-activeLine": { backgroundColor: "transparent" },
    },
    { dark }
  );
  const highlight = syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.propertyName, t.definition(t.propertyName)], color: p.key },
      { tag: [t.string, t.special(t.string)], color: p.str },
      { tag: [t.number], color: p.num },
      { tag: [t.bool, t.keyword], color: p.bool },
      { tag: [t.null], color: p.nul },
      { tag: [t.punctuation, t.separator, t.brace, t.bracket], color: p.punct },
    ])
  );
  return [view, highlight];
}

export const brandDark = build(DARK, true);
export const brandLight = build(LIGHT, false);
export function cmTheme(theme: Theme): Extension {
  return theme === "light" ? brandLight : brandDark;
}

// Subtle vertical guides at each indentation level, like Postman/VS Code, so
// nested JSON/XML is easy to scan. The package picks light/dark automatically
// from the active editor theme's `dark` flag, so one extension serves both.
export const indentGuides: Extension = indentationMarkers({
  thickness: 1,
  hideFirstIndent: true,
  highlightActiveBlock: true,
  colors: {
    dark: "#2b3348",
    activeDark: "#485270",
    light: "#e0e3ea",
    activeLight: "#c2c7d2",
  },
});
