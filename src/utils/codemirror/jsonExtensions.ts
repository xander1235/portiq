import { linter } from '@codemirror/lint';
import { jsonParseLinter } from '@codemirror/lang-json';
import { ViewPlugin, Decoration, type DecorationSet, type ViewUpdate, type EditorView } from "@codemirror/view";
import { stripJsonComments, findJsonCommentRanges } from "@portiq/core";

export const customJsonLinter = linter((view: any) => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];

    try {
        const noComments = stripJsonComments(text);
        const masked = noComments.replace(/\{\{[^}]+\}\}/g, (m: string) => '"' + 'x'.repeat(Math.max(0, m.length - 2)) + '"');
        JSON.parse(masked);
        return [];
    } catch {
        const diagnostics = jsonParseLinter()(view);
        const interpolations: any[] = [];
        const regex = /\{\{[^}]+\}\}/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            interpolations.push({ from: match.index, to: match.index + match[0].length });
        }
        return diagnostics.filter(d => {
            return !interpolations.some(i => (d.to >= i.from - 2 && d.from <= i.to + 2));
        });
    }
});

// The stock json() grammar has no comment tokens, so // and /* */ lines render
// as plain text. This plugin paints comment ranges (computed with the same
// string-aware scanner core uses to strip them) with the theme's comment style.
const jsonCommentMark = Decoration.mark({ class: "cm-json-comment", inclusive: false });

class JsonCommentHighlighter {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView): DecorationSet {
        const text = view.state.doc.toString();
        return Decoration.set(
            findJsonCommentRanges(text).map(({ from, to }) => jsonCommentMark.range(from, to)),
            true
        );
    }
}

export const jsonCommentHighlight = ViewPlugin.fromClass(JsonCommentHighlighter, {
    decorations: (v) => v.decorations,
});
