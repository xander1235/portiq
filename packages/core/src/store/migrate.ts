import type { KvStore } from "./kvStore";
import { INDEX_KEY, LEGACY_BLOB_KEY, COL_PREFIX, ENV_PREFIX, toEntityIndex, recomposeState } from "./entityStore";
import type { AppState } from "../model";

/**
 * Forward migration: if the per-entity index is absent but a legacy `appState`
 * blob exists, decompose the blob into per-entity rows. The blob is KEPT (never
 * deleted) as a rollback backup. Idempotent. Returns true iff it migrated.
 */
export function migrateBlobIfNeeded(kv: KvStore): boolean {
  return kv.transaction(() => {
    if (kv.get(INDEX_KEY) !== null) return false;
    const raw = kv.get(LEGACY_BLOB_KEY);
    if (!raw) return false;
    let state: AppState;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      state = parsed as AppState;
    } catch { return false; }
    for (const c of state.collections ?? []) kv.set(COL_PREFIX + c.id, JSON.stringify(c));
    for (const e of state.environments ?? []) kv.set(ENV_PREFIX + e.id, JSON.stringify(e));
    kv.set(INDEX_KEY, JSON.stringify(toEntityIndex(state)));
    return true;
  });
}

/**
 * Rollback / downgrade helper: rewrite the legacy `appState` blob from the
 * current per-entity rows so an old binary that only reads `appState` sees the
 * latest data. Returns true iff entity rows existed.
 */
export function recomposeLegacyBlob(kv: KvStore): boolean {
  const { state } = recomposeState(kv);
  if (!state) return false;
  kv.set(LEGACY_BLOB_KEY, JSON.stringify(state));
  return true;
}
