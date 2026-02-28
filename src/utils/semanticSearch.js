let worker = null;
let currentResolve = null;
let currentReject = null;
let currentId = 0;
let progressCallback = null;

export const SemanticSearch = {
    init: (onProgress) => {
        if (!worker) {
            // Setup Web Worker via Vite's special import syntax
            worker = new Worker(new URL('../workers/embeddingWorker.js', import.meta.url), { type: 'module' });

            worker.addEventListener('message', (event) => {
                const { type, id, payload } = event.data;

                if (type === 'PROGRESS' || type === 'INDEX_PROGRESS') {
                    if (progressCallback) progressCallback(payload, type);
                } else if (type === 'ERROR') {
                    console.error("Semantic Search Error:", payload);
                    if (currentReject && currentId === id) currentReject(new Error(payload));
                } else if (type.endsWith('_DONE') || type === 'SEARCH_RESULT') {
                    if (currentResolve && currentId === id) currentResolve(payload);
                }
            });
        }

        progressCallback = onProgress;

        return SemanticSearch._send('INIT');
    },

    _send: (type, payload) => {
        if (!worker) return Promise.reject("Semantic Search worker not initialized. Enable it in settings.");
        return new Promise((resolve, reject) => {
            currentId++;
            currentResolve = resolve;
            currentReject = reject;
            worker.postMessage({ type, id: currentId, payload });
        });
    },

    indexAll: (endpoints) => SemanticSearch._send('INDEX_ALL', endpoints),

    updateRequest: (req) => SemanticSearch._send('UPDATE_REQ', req),

    removeRequest: (reqId) => SemanticSearch._send('REMOVE_REQ', reqId),

    search: async (query, activeReqIds) => {
        const results = await SemanticSearch._send('SEARCH', { query, activeReqIds });
        return results;
    }
};
