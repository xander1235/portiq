import { getSearchQuery, setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { keymap } from '@codemirror/view';

export function createCustomSearchPanel(view: any) {
    const panel = document.createElement("div");
    panel.className = "cm-search cm-panel my-custom-search-panel";

    // Set initial state from existing query if any
    const query = getSearchQuery(view.state);
    const searchStr = query.search || "";
    const replaceStr = query.replace || "";
    const isCaseSensitive = query.caseSensitive || false;
    const isRegexp = query.regexp || false;
    const showReplace = !!window.__cm_show_replace;
    const readOnly = view.state.readOnly;

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
    const searchInp = panel.querySelector('input[name="search"]') as HTMLInputElement;
    const replaceInp = panel.querySelector('input[name="replace"]') as HTMLInputElement | null;
    const caseCb = panel.querySelector('input[name="casesensitive"]') as HTMLInputElement;
    const regexCb = panel.querySelector('input[name="regexp"]') as HTMLInputElement;
    const showReplaceCb = panel.querySelector('input[name="showReplace"]') as HTMLInputElement | null;
    const replaceRow = panel.querySelector('.cm-replace-row') as HTMLElement | null;
    const searchRow = panel.querySelector('.cm-search-row') as HTMLElement;

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

    panel.addEventListener("keydown", (e: KeyboardEvent) => {
        if (view.runScopeHandlers(view, e as any, "search-panel")) {
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

    if (replaceInp) replaceInp.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            replaceNext(view);
        }
    });

    const nextBtn = panel.querySelector('button[name="next"]');
    if (nextBtn) nextBtn.addEventListener("click", () => findNext(view));
    
    const prevBtn = panel.querySelector('button[name="prev"]');
    if (prevBtn) prevBtn.addEventListener("click", () => findPrevious(view));

    if (!readOnly) {
        const replaceBtn = panel.querySelector('button[name="replace"]');
        if (replaceBtn) replaceBtn.addEventListener("click", () => replaceNext(view));
        
        const replaceAllBtn = panel.querySelector('button[name="replaceAll"]');
        if (replaceAllBtn) replaceAllBtn.addEventListener("click", () => replaceAll(view));
    }
    
    const closeBtn = panel.querySelector('button[name="close"]');
    if (closeBtn) closeBtn.addEventListener("click", () => closeSearchPanel(view));

    if (showReplaceCb) {
        showReplaceCb.addEventListener("change", (e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            window.__cm_show_replace = checked;
            if (replaceRow) replaceRow.style.display = checked ? "flex" : "none";
            if (searchRow) searchRow.style.marginBottom = checked ? "6px" : "0";
            if (checked && replaceInp) replaceInp.focus();
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
                if (searchRow) searchRow.style.marginBottom = "6px";
                if (showReplaceCb) showReplaceCb.checked = true;
                if (replaceInp) replaceInp.focus();
            } else {
                if (searchInp) {
                    searchInp.focus();
                    searchInp.select();
                }
            }
        },
        get pos() { return 80; }, // typical priority for search panels
        get top() { return true; } // forces panel to the top instead of bottom
    };
}

export const customSearchKeymap = keymap.of([
    {
        key: "Mod-f",
        run: (view: any) => {
            window.__cm_show_replace = false;
            openSearchPanel(view);
            return true;
        }
    },
    {
        key: "Mod-r",
        run: (view: any) => {
            window.__cm_show_replace = true;
            openSearchPanel(view);
            return true;
        }
    }
]);
