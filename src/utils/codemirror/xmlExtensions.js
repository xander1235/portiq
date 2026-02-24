import { linter } from '@codemirror/lint';

export const xmlLinter = linter((view) => {
    const diagnostics = [];
    const text = view.state.doc.toString();
    if (!text.trim()) return diagnostics;

    // Mask interpolations to avoid valid variables throwing syntax errors
    const masked = text.replace(/\{\{[^}]+\}\}/g, m => 'x'.repeat(m.length));

    const parser = new DOMParser();
    const doc = parser.parseFromString(masked, "text/xml");
    const parseError = doc.querySelector("parsererror");

    if (parseError) {
        let line = 1, col = 1, msg = parseError.textContent || "Invalid XML";
        const chromeMatch = msg.match(/line (\d+) at column (\d+)/);
        if (chromeMatch) {
            line = parseInt(chromeMatch[1], 10);
            col = parseInt(chromeMatch[2], 10);
        }
        let pos = 0;
        try {
            if (line <= view.state.doc.lines) {
                pos = view.state.doc.line(line).from + Math.max(0, col - 1);
            }
        } catch (e) { }

        diagnostics.push({
            from: pos,
            to: pos,
            severity: "error",
            message: msg.slice(0, 150)
        });
    }
    return diagnostics;
});
