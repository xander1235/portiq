import { openKvStore, ConflictError, type KvStore } from "./kvStore";
import type { ResolveDataDirOptions } from "./dataDir";
import type { AppState, Collection, Environment } from "../model";

export const INDEX_KEY = "ent:index";
export const LEGACY_BLOB_KEY = "appState";
export const COL_PREFIX = "ent:col:";
export const ENV_PREFIX = "ent:env:";

/** AppState top-level fields promoted to their own rows / the index meta. */
const RESERVED = new Set(["collections", "environments", "activeCollectionId", "activeEnvId", "historyRetentionDays"]);

export interface EntityIndex {
  collectionIds: string[];
  environmentIds: string[];
  meta: {
    activeCollectionId: string;
    activeEnvId: string | null;
    historyRetentionDays: number;
    extras: Record<string, unknown>;
  };
}

export function toEntityIndex(state: AppState): EntityIndex {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (!RESERVED.has(k)) extras[k] = v;
  return {
    collectionIds: (state.collections ?? []).map((c) => c.id),
    environmentIds: (state.environments ?? []).map((e) => e.id),
    meta: {
      activeCollectionId: state.activeCollectionId ?? "",
      activeEnvId: state.activeEnvId ?? null,
      historyRetentionDays: state.historyRetentionDays ?? 30,
      extras,
    },
  };
}

function readIndex(kv: KvStore): { index: EntityIndex | null; version: number } {
  const { value, version } = kv.getVersioned(INDEX_KEY);
  if (!value) return { index: null, version };
  try { return { index: JSON.parse(value) as EntityIndex, version }; }
  catch { return { index: null, version }; }
}

/** Recompose the full AppState from the index + per-entity rows. Reused by migrate.ts. */
export function recomposeState(kv: KvStore): { state: AppState | null; version: number } {
  const { index, version } = readIndex(kv);
  if (!index) return { state: null, version };
  const collections: Collection[] = [];
  for (const id of index.collectionIds) {
    const raw = kv.get(COL_PREFIX + id);
    if (raw) collections.push(JSON.parse(raw) as Collection);
  }
  const environments: Environment[] = [];
  for (const id of index.environmentIds) {
    const raw = kv.get(ENV_PREFIX + id);
    if (raw) environments.push(JSON.parse(raw) as Environment);
  }
  const state = {
    ...index.meta.extras,
    collections,
    environments,
    activeCollectionId: index.meta.activeCollectionId,
    activeEnvId: index.meta.activeEnvId,
    historyRetentionDays: index.meta.historyRetentionDays,
  } as AppState;
  return { state, version };
}

export interface EntityStore {
  loadState(): { state: AppState | null; version: number };
  saveState(state: AppState, expectedVersion?: number): number;
  getCollection(id: string): { collection: Collection | null; version: number };
  upsertCollection(collection: Collection, expectedVersion?: number): number;
  deleteCollection(id: string, expectedVersion?: number): void;
  getEnvironment(id: string): { environment: Environment | null; version: number };
  upsertEnvironment(env: Environment, expectedVersion?: number): number;
  deleteEnvironment(id: string, expectedVersion?: number): void;
  raw: KvStore;
  close(): void;
}

export function openEntityStore(opts: ResolveDataDirOptions = {}, kv?: KvStore): EntityStore {
  const store = kv ?? openKvStore(opts);

  function saveState(state: AppState, expectedVersion?: number): number {
    return store.transaction(() => {
      const { index: prev, version } = readIndex(store);
      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new ConflictError(INDEX_KEY, expectedVersion, version);
      }
      const staleCols = new Set(prev?.collectionIds ?? []);
      for (const c of state.collections ?? []) {
        const encoded = JSON.stringify(c);
        if (store.get(COL_PREFIX + c.id) !== encoded) store.set(COL_PREFIX + c.id, encoded);
        staleCols.delete(c.id);
      }
      for (const id of staleCols) store.deleteKey(COL_PREFIX + id);

      const staleEnvs = new Set(prev?.environmentIds ?? []);
      for (const e of state.environments ?? []) {
        const encoded = JSON.stringify(e);
        if (store.get(ENV_PREFIX + e.id) !== encoded) store.set(ENV_PREFIX + e.id, encoded);
        staleEnvs.delete(e.id);
      }
      for (const id of staleEnvs) store.deleteKey(ENV_PREFIX + id);

      // Dual-write the legacy blob so a downgraded/old binary keeps reading valid data.
      store.set(LEGACY_BLOB_KEY, JSON.stringify(state));
      // The index row's version IS the whole-state version (preserves the ConflictError contract).
      return store.set(INDEX_KEY, JSON.stringify(toEntityIndex(state)));
    });
  }

  function ensureIndexed(kind: "col" | "env", id: string): void {
    const { index } = readIndex(store);
    if (!index) {
      store.set(INDEX_KEY, JSON.stringify({
        collectionIds: kind === "col" ? [id] : [],
        environmentIds: kind === "env" ? [id] : [],
        meta: { activeCollectionId: kind === "col" ? id : "", activeEnvId: null, historyRetentionDays: 30, extras: {} },
      } satisfies EntityIndex));
      return;
    }
    const list = kind === "col" ? index.collectionIds : index.environmentIds;
    if (!list.includes(id)) {
      list.push(id);
      store.set(INDEX_KEY, JSON.stringify(index));
    }
  }

  function deIndex(kind: "col" | "env", id: string): void {
    const { index } = readIndex(store);
    if (!index) return;
    if (kind === "col") index.collectionIds = index.collectionIds.filter((x) => x !== id);
    else index.environmentIds = index.environmentIds.filter((x) => x !== id);
    store.set(INDEX_KEY, JSON.stringify(index));
  }

  return {
    loadState: () => recomposeState(store),
    saveState,
    getCollection(id) {
      const { value, version } = store.getVersioned(COL_PREFIX + id);
      return { collection: value ? (JSON.parse(value) as Collection) : null, version };
    },
    upsertCollection(collection, expectedVersion) {
      return store.transaction(() => {
        const key = COL_PREFIX + collection.id;
        const encoded = JSON.stringify(collection);
        const next = expectedVersion === undefined ? store.set(key, encoded) : store.setIfVersion(key, encoded, expectedVersion);
        ensureIndexed("col", collection.id);
        return next;
      });
    },
    deleteCollection(id, expectedVersion) {
      store.transaction(() => {
        if (expectedVersion !== undefined) {
          const { version } = store.getVersioned(COL_PREFIX + id);
          if (version !== expectedVersion) throw new ConflictError(COL_PREFIX + id, expectedVersion, version);
        }
        store.deleteKey(COL_PREFIX + id);
        deIndex("col", id);
      });
    },
    getEnvironment(id) {
      const { value, version } = store.getVersioned(ENV_PREFIX + id);
      return { environment: value ? (JSON.parse(value) as Environment) : null, version };
    },
    upsertEnvironment(env, expectedVersion) {
      return store.transaction(() => {
        const key = ENV_PREFIX + env.id;
        const encoded = JSON.stringify(env);
        const next = expectedVersion === undefined ? store.set(key, encoded) : store.setIfVersion(key, encoded, expectedVersion);
        ensureIndexed("env", env.id);
        return next;
      });
    },
    deleteEnvironment(id, expectedVersion) {
      store.transaction(() => {
        if (expectedVersion !== undefined) {
          const { version } = store.getVersioned(ENV_PREFIX + id);
          if (version !== expectedVersion) throw new ConflictError(ENV_PREFIX + id, expectedVersion, version);
        }
        store.deleteKey(ENV_PREFIX + id);
        deIndex("env", id);
      });
    },
    raw: store,
    close() {
      if (!kv) store.close();
    },
  };
}
