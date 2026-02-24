import { Decoration, ViewPlugin, MatchDecorator, hoverTooltip } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';

const envVarMatcher = new MatchDecorator({
    regexp: /\{\{([^}]+)\}\}/g,
    decoration: (match) => Decoration.mark({
        class: "cm-env-var",
        attributes: { "data-env-key": match[1].trim() }
    })
});

export const envVarHighlightPlugin = ViewPlugin.fromClass(
    class {
        constructor(view) {
            this.decorations = envVarMatcher.createDeco(view);
        }
        update(update) {
            this.decorations = envVarMatcher.updateDeco(update, this.decorations);
        }
    },
    {
        decorations: (v) => v.decorations
    }
);

export const createEnvAutoComplete = (getEnvVars) => {
    return autocompletion({
        override: [(context) => {
            let word = context.matchBefore(/\{\{\w*/);
            if (!word) return null;
            if (word.from === word.to && !context.explicit) return null;
            const currentEnvVars = getEnvVars();
            return {
                from: word.from + 2,
                options: Object.entries(currentEnvVars).map(([k, v]) => ({
                    label: k,
                    type: "variable",
                    detail: String(v) || "",
                    apply: `${k}}}`
                }))
            };
        }]
    });
};

export const createEnvHoverTooltip = (getEnvVars, setCmEnvEdit) => {
    return hoverTooltip((view, pos, side) => {
        const text = view.state.doc.toString();
        const regex = /\{\{([^}]+)\}\}/g;
        let match;
        const currentEnvVars = getEnvVars();
        while ((match = regex.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (pos >= start && pos <= end) {
                const key = match[1].trim();
                const val = currentEnvVars[key];
                const exists = Object.prototype.hasOwnProperty.call(currentEnvVars, key);
                return {
                    pos: start,
                    end: end,
                    above: true,
                    create() {
                        const dom = document.createElement("div");
                        dom.style.background = "var(--panel-2)";
                        dom.style.border = "1px solid var(--border)";
                        dom.style.borderRadius = "4px";
                        dom.style.padding = "4px 8px";
                        dom.style.fontSize = "0.80rem";
                        dom.style.boxShadow = "0 4px 12px rgba(0,0,0,0.6)";
                        dom.style.whiteSpace = "nowrap";
                        dom.style.fontFamily = '"Space Grotesk", sans-serif';
                        dom.style.display = "flex";
                        dom.style.alignItems = "center";
                        dom.style.gap = "8px";

                        dom.style.pointerEvents = "auto";
                        dom.onmousedown = (e) => e.stopPropagation();

                        const textSpan = document.createElement("span");
                        textSpan.style.color = exists ? "var(--text)" : "#ff5555";
                        textSpan.textContent = exists ? `${key}: ${val}` : `Unresolved variable: ${key}`;

                        const editBtn = document.createElement("span");
                        editBtn.textContent = "✎ Edit";
                        editBtn.style.color = "var(--accent-blue)";
                        editBtn.style.cursor = "pointer";
                        editBtn.style.fontSize = "0.75rem";
                        editBtn.style.fontWeight = "bold";
                        editBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCmEnvEdit({ key, value: String(val || "") });
                        };

                        dom.appendChild(editBtn);
                        dom.appendChild(textSpan);

                        return { dom };
                    }
                };
            }
        }
        return null;
    });
};
