import { ConflictError, type AppState, type AppStateStore } from "@portiq/core";

export function emptyState(): AppState {
  return { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 30 };
}

export function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function withOptimisticWrite<T>(
  store: AppStateStore,
  mutate: (state: AppState) => { next: AppState; result: T }
): T {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { state, version } = store.load();
    const base = state ? (structuredClone(state) as AppState) : emptyState();
    const { next, result } = mutate(base);
    try {
      store.save(next, version);
      return result;
    } catch (err) {
      if (err instanceof ConflictError && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("Optimistic write failed: version conflict after retry");
}
