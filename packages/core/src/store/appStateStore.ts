import { openKvStore, type KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment, RequestItem, FolderItem } from "../model";

const APP_STATE_KEY = "appState";

export interface AppStateStore {
  load(): { state: AppState | null; version: number };
  save(state: AppState, expectedVersion?: number): number;
  collections(): Collection[];
  environments(): Environment[];
  flattenRequests(): RequestItem[];
  close(): void;
}

function collect(items: (FolderItem | RequestItem)[], out: RequestItem[]): void {
  for (const item of items) {
    if (item.type === "request") out.push(item);
    else if (item.type === "folder") collect(item.items, out);
  }
}

export function openAppStateStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): AppStateStore {
  const store = kv ?? openKvStore(opts);

  function load(): { state: AppState | null; version: number } {
    const { value, version } = store.getVersioned(APP_STATE_KEY);
    if (!value) return { state: null, version };
    try {
      return { state: JSON.parse(value) as AppState, version };
    } catch {
      return { state: null, version };
    }
  }

  return {
    load,
    save(state, expectedVersion) {
      const encoded = JSON.stringify(state);
      return expectedVersion === undefined
        ? store.set(APP_STATE_KEY, encoded)
        : store.setIfVersion(APP_STATE_KEY, encoded, expectedVersion);
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
    close() {
      store.close();
    },
  };
}
