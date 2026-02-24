import { linter } from '@codemirror/lint';
import { jsonParseLinter } from '@codemirror/lang-json';

export const customJsonLinter = linter((view) => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];

    try {
        const noComments = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
        const masked = noComments.replace(/\{\{[^}]+\}\}/g, m => '"' + 'x'.repeat(Math.max(0, m.length - 2)) + '"');
        JSON.parse(masked);
        return [];
    } catch (e) {
        const diagnostics = jsonParseLinter()(view);
        const interpolations = [];
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
