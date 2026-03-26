import Fuse from "fuse.js";

export function flattenCollections(collections: any[]) {
    const allRequests: any[] = [];

    const extractRequests = (items: any[], collectionId: string, collectionName: string) => {
        if (!items || !Array.isArray(items)) return;
        items.forEach((item: any) => {
            if (item.type === "request") {
                allRequests.push({
                    collectionId,
                    collectionName,
                    ...item
                });
            } else if (item.type === "folder" && item.items) {
                extractRequests(item.items, collectionId, collectionName);
            }
        });
    };

    collections.forEach((col: any) => {
        extractRequests(col.items, col.id, col.name);
        // Fallback or legacy support just in case
        if (col.requests && Array.isArray(col.requests)) {
            col.requests.forEach((req: any) => {
                allRequests.push({
                    collectionId: col.id,
                    collectionName: col.name,
                    ...req
                });
            });
        }
    });

    return allRequests;
}

export function searchRequestsContext(prompt: string, collections: any[]) {
    // Flatten all requests from all collections into a single array
    const allRequests = flattenCollections(collections);

    if (allRequests.length === 0) return [];

    const fuse = new Fuse(allRequests, {
        keys: ["name", "url", "method"],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true
    });

    // Remove conversational filler words so they don't skew the fuzzy search
    const stopWords = ['find', 'load', 'open', 'get', 'fetch', 'show', 'the', 'a', 'an', 'request', 'endpoint', 'api'];
    const cleanedPrompt = prompt.replace(/[^\w\s-]/gi, '').toLowerCase().trim();
    const tokens = cleanedPrompt.split(/\s+/).filter(t => t.length > 1 && !stopWords.includes(t));

    const searchQuery = tokens.join(" ") || prompt;

    let results = fuse.search(searchQuery);

    // Filter out bad matches (lower score is better in fuse.js)
    results = results.filter(res => res.score !== undefined && res.score < 0.4);

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
        } as any;
    });
}
