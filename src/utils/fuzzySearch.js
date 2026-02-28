import Fuse from "fuse.js";

/**
 * Perform a fuzzy search across all requests in all collections.
 * @param {string} prompt The user's input prompt containing keywords.
 * @param {Array} collections The full collections array containing folders and requests.
 * @returns {Array} Top 5 matching request objects with minimal context.
 */
export function searchRequestsContext(prompt, collections) {
    // Flatten all requests from all collections into a single array
    const allRequests = [];
    collections.forEach(col => {
        if (col.requests && Array.isArray(col.requests)) {
            col.requests.forEach(req => {
                allRequests.push({
                    collectionId: col.id,
                    collectionName: col.name,
                    ...req
                });
            });
        }
    });

    if (allRequests.length === 0) return [];

    const fuse = new Fuse(allRequests, {
        keys: ["name", "url", "method"],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
        useExtendedSearch: true
    });

    // Tokenize the prompt to search each word independently (OR logic in extended search)
    // E.g. "find the user api" -> "'find | 'the | 'user | 'api"
    const cleanedPrompt = prompt.replace(/[^\w\s-]/gi, '').trim();
    const tokens = cleanedPrompt.split(/\s+/).filter(t => t.length > 2);
    const searchQuery = tokens.map(t => `'${t}`).join(" | ") || prompt;

    const results = fuse.search(searchQuery);

    return results.slice(0, 5).map(res => {
        const r = res.item;
        return {
            id: r.id,
            collectionId: r.collectionId,
            collectionName: r.collectionName,
            name: r.name,
            method: r.method,
            url: r.url,
            authType: r.authType,
            headersText: r.headersText,
            bodyText: r.bodyText
        };
    });
}
