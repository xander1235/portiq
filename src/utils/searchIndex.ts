import Fuse from "fuse.js";

export type SearchEntityType = "request" | "folder" | "collection" | "environment";

export interface SearchEntity {
  type: SearchEntityType;
  id: string;
  label: string;        // display name
  sublabel?: string;    // context line (collection name, or "METHOD url")
  keywords?: string;    // hidden extra search text (tags + description)
  collectionId?: string;
  method?: string;
}

export interface RevealTarget {
  type: "request" | "folder";
  id: string;
  collectionId: string;
  nonce: number;
}

export function buildSearchEntities(collections: any[], environments: any[]): SearchEntity[] {
  const out: SearchEntity[] = [];

  const walk = (items: any[], collectionId: string, collectionName: string) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item?.type === "folder") {
        out.push({ type: "folder", id: item.id, label: item.name, sublabel: collectionName, collectionId });
        walk(item.items || [], collectionId, collectionName);
      } else if (item?.type === "request") {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const keywords = [...tags, item.description || ""].join(" ").trim();
        out.push({
          type: "request",
          id: item.id,
          label: item.name,
          sublabel: [item.method, item.url].filter(Boolean).join(" "),
          keywords: keywords || undefined,
          collectionId,
          method: item.method,
        });
      }
    }
  };

  for (const col of collections || []) {
    out.push({ type: "collection", id: col.id, label: col.name });
    walk(col.items || [], col.id, col.name);
  }
  for (const env of environments || []) {
    out.push({ type: "environment", id: env.id, label: env.name });
  }
  return out;
}

const FUSE_OPTIONS = {
  keys: ["label", "sublabel", "keywords"],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
};

export function searchEntities(entities: SearchEntity[], query: string, limit = 8): SearchEntity[] {
  const q = query.trim();
  if (!q) return [];
  const fuse = new Fuse(entities, FUSE_OPTIONS);
  return fuse.search(q).slice(0, limit).map((r) => r.item);
}

/**
 * Ancestor folder ids leading to `targetId` (root→leaf), excluding the target.
 * Returns [] for a top-level item, null when the target isn't found.
 */
export function findAncestorFolderIds(items: any[], targetId: string): string[] | null {
  const dfs = (nodes: any[], trail: string[]): string[] | null => {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (node?.id === targetId) return trail;
      if (node?.type === "folder") {
        const found = dfs(node.items || [], [...trail, node.id]);
        if (found) return found;
      }
    }
    return null;
  };
  return dfs(items, []);
}
