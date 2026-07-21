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
// Syntax/gutter colors darkened to meet WCAG AA (>=4.5:1) on the white bg —
// the previous values (key 3.97, str 4.33, num 4.03, punct 2.57, gutter 1.88)
// were too faint to read in the light theme.
const LIGHT: Palette = {
  bg: "#ffffff", text: "#2b3240", caret: "#d15a2c", selection: "#dbeafe",
  gutterBg: "#fafbfc", gutterText: "#6b7280", border: "#eceef2",
  key: "#0a6b64", str: "#1f6b38", num: "#a8410f", bool: "#6b4fd0", nul: "#6b4fd0", punct: "#5c6472",
};

function build(p: Palette, dark: boolean): Extension {
  const view = EditorView.theme(
    {
      "&": { color: p.text, backgroundColor: p.bg, fontSize: "13px" },
      ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "1.5", caretColor: p.caret },
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
  hideFirstIndent: false,
  highlightActiveBlock: true,
  colors: {
    dark: "#3a4260", // clearly visible on the near-black editor bg
    activeDark: "#5f6b93",
    light: "#cdd2dd",
    activeLight: "#a6aebf",
  },
});
