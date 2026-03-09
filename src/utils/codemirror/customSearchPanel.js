import { getSearchQuery, setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { keymap } from '@codemirror/view';

export function createCustomSearchPanel(view) {
    const panel = document.createElement("div");
    panel.className = "cm-search cm-panel my-custom-search-panel";

    // Set initial state from existing query if any
    let query = getSearchQuery(view.state);
    let searchStr = query.search || "";
    let replaceStr = query.replace || "";
    let isCaseSensitive = query.caseSensitive || false;
    let isRegexp = query.regexp || false;
    let showReplace = !!window.__cm_show_replace;
    let readOnly = view.state.readOnly;

    panel.innerHTML = `
        <div class="cm-search-row" style="display: flex; gap: 8px; align-items: center; width: 100%; margin-bottom: ${showReplace && !readOnly ? '6px' : '0'};">
            <input type="text" name="search" class="cm-textfield" placeholder="Find..." value="${searchStr.replace(/"/g, '&quot;')}">
            <button type="button" name="next" class="cm-search-btn">Next</button>
            <button type="button" name="prev" class="cm-search-btn">Prev</button>
            ${!readOnly ? `<label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" name="showReplace" ${showReplace ? "checked" : ""}> Replace</label>` : ''}
            <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" name="casesensitive" ${isCaseSensitive ? "checked" : ""}> Aa</label>
            <label style="display:flex; align-items:center; gap:4px;"><input type="checkbox" name="regexp" ${isRegexp ? "checked" : ""}> .*</label>
            <button type="button" name="close" style="margin-left: auto; border:none; background:transparent; cursor:pointer;" title="Close">✕</button>
        </div>
        ${!readOnly ? `
        <div class="cm-replace-row" style="display: ${showReplace ? "flex" : "none"}; gap: 8px; align-items: center; width: 100%;">
            <input type="text" name="replace" class="cm-textfield" placeholder="Replace..." value="${replaceStr.replace(/"/g, '&quot;')}">
            <button type="button" name="replace" class="cm-search-btn">Replace</button>
            <button type="button" name="replaceAll" class="cm-search-btn">All</button>
        </div>` : ''}
    `;

    // Add event listeners
    const searchInp = panel.querySelector('input[name="search"]');
    const replaceInp = panel.querySelector('input[name="replace"]');
    const caseCb = panel.querySelector('input[name="casesensitive"]');
    const regexCb = panel.querySelector('input[name="regexp"]');
    const showReplaceCb = panel.querySelector('input[name="showReplace"]');
    const replaceRow = panel.querySelector('.cm-replace-row');
    const searchRow = panel.querySelector('.cm-search-row');

    const updateQuery = () => {
        const newQuery = new SearchQuery({
            search: searchInp.value,
            replace: replaceInp ? replaceInp.value : "",
            caseSensitive: caseCb.checked,
            regexp: regexCb.checked
        });
        view.dispatch({ effects: setSearchQuery.of(newQuery) });
    };

    searchInp.addEventListener("input", updateQuery);
    if (replaceInp) replaceInp.addEventListener("input", updateQuery);
    caseCb.addEventListener("change", updateQuery);
    regexCb.addEventListener("change", updateQuery);

    panel.addEventListener("keydown", (e) => {
        if (view.runScopeHandlers(view, e, "search-panel")) {
            e.preventDefault();
        } else if (e.key === "Enter" && e.target === searchInp) {
            e.preventDefault();
            if (e.shiftKey) findPrevious(view);
            else findNext(view);
        } else if (e.key === "Enter" && e.target === replaceInp) {
            e.preventDefault();
            replaceNext(view);
        }
    });

    if (replaceInp) replaceInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            replaceNext(view);
        }
    });

    panel.querySelector('button[name="next"]').addEventListener("click", () => findNext(view));
    panel.querySelector('button[name="prev"]').addEventListener("click", () => findPrevious(view));
    if (!readOnly) {
        panel.querySelector('button[name="replace"]').addEventListener("click", () => replaceNext(view));
        panel.querySelector('button[name="replaceAll"]').addEventListener("click", () => replaceAll(view));
    }
    panel.querySelector('button[name="close"]').addEventListener("click", () => closeSearchPanel(view));

    if (showReplaceCb) {
        showReplaceCb.addEventListener("change", (e) => {
            window.__cm_show_replace = e.target.checked;
            replaceRow.style.display = e.target.checked ? "flex" : "none";
            searchRow.style.marginBottom = e.target.checked ? "6px" : "0";
            if (e.target.checked) replaceInp.focus();
        });
    }

    return {
        dom: panel,
        update() {
            const currentQuery = getSearchQuery(view.state);
            if (currentQuery.search !== searchInp.value) searchInp.value = currentQuery.search;
            if (replaceInp && currentQuery.replace !== replaceInp.value) replaceInp.value = currentQuery.replace;
            if (currentQuery.caseSensitive !== caseCb.checked) caseCb.checked = currentQuery.caseSensitive;
            if (currentQuery.regexp !== regexCb.checked) regexCb.checked = currentQuery.regexp;
        },
        mount() {
            if (window.__cm_show_replace && replaceRow) {
                replaceRow.style.display = "flex";
                searchRow.style.marginBottom = "6px";
                showReplaceCb.checked = true;
                replaceInp.focus();
            } else {
                searchInp.focus();
                searchInp.select();
            }
        },
        get pos() { return 80; }, // typical priority for search panels
        get top() { return true; } // forces panel to the top instead of bottom
    };
}

export const customSearchKeymap = keymap.of([
    {
        key: "Mod-f",
        run: (view) => {
            window.__cm_show_replace = false;
            openSearchPanel(view);
            return true;
        }
    },
    {
        key: "Mod-r",
        run: (view) => {
            window.__cm_show_replace = true;
            openSearchPanel(view);
            return true;
        }
    }
]);
