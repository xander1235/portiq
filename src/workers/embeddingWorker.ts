import { pipeline, env, PipelineType } from '@xenova/transformers';
import { get, set } from 'idb-keyval';

// Configure transformers.js for the browser
env.allowLocalModels = false;
env.useBrowserCache = true;

const DB_KEY = 'semantic_embeddings_db';

interface EmbeddingData {
    text: string;
    vec: number[];
}

interface EmbeddingsDb {
    [key: string]: EmbeddingData;
}

class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance: any = null;

    static async getInstance(progress_callback: any = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                quantized: true // Use INT8 for much smaller download (~22MB)
            });
        }
        return this.instance;
    }
}

let embeddingsDb: EmbeddingsDb = {}; // In-memory cache

async function loadDb() {
    const data = await get(DB_KEY);
    if (data) embeddingsDb = data as EmbeddingsDb;
}

async function saveDb() {
    await set(DB_KEY, embeddingsDb);
}

function getSafeText(req: any) {
    const parts = [
        req.name || "",
        req.method || "GET",
        req.url ? req.url.split('?')[0] : "", // Strip query constraints which may have secrets
        req.description || ""
    ];
    return parts.join(" ").trim();
}

self.addEventListener('message', async (event: MessageEvent) => {
    const { type, id, payload } = event.data;

    try {
        if (type === 'INIT') {
            await loadDb();
            // Pre-load the model so the user sees progress immediately
            await PipelineSingleton.getInstance((x: any) => {
                self.postMessage({ type: 'PROGRESS', payload: x });
            });
            self.postMessage({ type: 'INIT_DONE', id });
        }
        else if (type === 'INDEX_ALL') {
            await loadDb();
            const extractor = await PipelineSingleton.getInstance();
            const endpoints = payload as any[];
            let changed = false;

            let indexedCount = 0;
            for (const req of endpoints) {
                const safeText = getSafeText(req);

                if (!safeText) continue;

                if (!embeddingsDb[req.id] || embeddingsDb[req.id].text !== safeText) {
                    const output = await extractor(safeText, { pooling: 'mean', normalize: true });
                    embeddingsDb[req.id] = {
                        text: safeText,
                        vec: Array.from(output.data) as number[] // Convert Float32Array to standard array for IDB saving
                    };
                    changed = true;
                }

                indexedCount++;
                // Occasional progress updates
                if (indexedCount % 10 === 0) {
                    self.postMessage({ type: 'INDEX_PROGRESS', payload: { count: indexedCount, total: endpoints.length } });
                }
            }

            if (changed) await saveDb();
            self.postMessage({ type: 'INDEX_DONE', id });
        }
        else if (type === 'UPDATE_REQ') {
            const extractor = await PipelineSingleton.getInstance();
            const req = payload as any;
            const safeText = getSafeText(req);

            if (safeText && (!embeddingsDb[req.id] || embeddingsDb[req.id].text !== safeText)) {
                const output = await extractor(safeText, { pooling: 'mean', normalize: true });
                embeddingsDb[req.id] = {
                    text: safeText,
                    vec: Array.from(output.data) as number[]
                };
                await saveDb();
            }
            self.postMessage({ type: 'UPDATE_DONE', id });
        }
        else if (type === 'REMOVE_REQ') {
            const reqId = payload as string;
            if (embeddingsDb[reqId]) {
                delete embeddingsDb[reqId];
                await saveDb();
            }
            self.postMessage({ type: 'REMOVE_DONE', id });
        }
        else if (type === 'SEARCH') {
            const extractor = await PipelineSingleton.getInstance();
            const { query, activeReqIds } = payload as { query: string, activeReqIds?: string[] };

            if (!query.trim()) {
                self.postMessage({ type: 'SEARCH_RESULT', id, payload: [] });
                return;
            }

            const output = await extractor(query, { pooling: 'mean', normalize: true });
            const queryVec = output.data as Float32Array;

            const results: { id: string, score: number }[] = [];
            for (const [reqId, data] of Object.entries(embeddingsDb)) {
                if (activeReqIds && !activeReqIds.includes(reqId)) continue;

                // Dot product of two normalized vectors = Cosine Similarity
                let dotProduct = 0;
                for (let i = 0; i < queryVec.length; i++) {
                    dotProduct += queryVec[i] * (data as EmbeddingData).vec[i];
                }

                if (dotProduct > 0.4) { // Only fairly relevant matches
                    results.push({ id: reqId, score: dotProduct });
                }
            }

            // Sort descending by score
            results.sort((a, b) => b.score - a.score);
            self.postMessage({ type: 'SEARCH_RESULT', id, payload: results.slice(0, 10) });
        }
    } catch (e: any) {
        self.postMessage({ type: 'ERROR', id, payload: (e as Error).message });
    }
});
