import { openEntityStore, type EntityStore } from "./entityStore";
import type { KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment, RequestItem, FolderItem } from "../model";

export interface AppStateStore {
  load(): { state: AppState | null; version: number };
  save(state: AppState, expectedVersion?: number): number;
  collections(): Collection[];
  environments(): Environment[];
  flattenRequests(): RequestItem[];
  /** Fine-grained per-entity access (used by MCP/CLI writers). */
  entities: EntityStore;
  close(): void;
}

function collect(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") collect(item.items, out);
  }
}

export function openAppStateStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): AppStateStore {
  const entities = openEntityStore(opts, kv);

  function load(): { state: AppState | null; version: number } {
    return entities.loadState();
  }

  return {
    load,
    save(state, expectedVersion) {
      return entities.saveState(state, expectedVersion);
    },
    collections() {
      return load().state?.collections ?? [];
    },
    environments() {
      return load().state?.environments ?? [];
    },
    flattenRequests() {
      const out: RequestItem[] = [];
      for (const c of load().state?.collections ?? []) collect(c.items, out);
      return out;
    },
    entities,
    close() {
      entities.close();
    },
  };
}
