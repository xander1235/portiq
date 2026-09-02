import type { AppState, Collection, FolderItem, RequestItem } from "@portiq/core";

export interface SearchHit {
  type: "request" | "collection" | "environment" | "flow";
  id: string;
  name: string;
  detail?: string;
  score: number;
}

function scoreText(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  if (!h) return 0;
  const idx = h.indexOf(needle);
  if (idx === -1) return 0;
  // Exact match beats prefix beats substring; shorter haystacks rank higher.
  if (h === needle) return 100;
  if (idx === 0) return 60;
  return 30 + Math.max(0, 10 - Math.floor(idx / 4));
}

function walk(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") walk(item.items, out);
  }
}

export function searchLibrary(state: AppState | null, query: string, limit = 25): SearchHit[] {
  const needle = (query || "").trim().toLowerCase();
  if (!state || !needle) return [];

  const hits: SearchHit[] = [];

  const collections: Collection[] = state.collections ?? [];
  for (const c of collections) {
    const cScore = scoreText(c.name, needle);
    if (cScore > 0) hits.push({ type: "collection", id: c.id, name: c.name, score: cScore });

    const requests: RequestItem[] = [];
    walk(c.items ?? [], requests);
    for (const r of requests) {
      const fields = [r.name, r.method, r.url, ...(r.tags ?? [])];
      const best = Math.max(...fields.map((f) => scoreText(String(f ?? ""), needle)), 0);
      if (best > 0) {
        hits.push({
          type: r.dagGraph ? "flow" : "request",
          id: r.id,
          name: r.name,
          detail: `${r.method} ${r.url}`,
          score: best,
        });
      }
    }
  }

  for (const e of state.environments ?? []) {
    const eScore = scoreText(e.name, needle);
    if (eScore > 0) hits.push({ type: "environment", id: e.id, name: e.name, score: eScore });
  }

  hits.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
