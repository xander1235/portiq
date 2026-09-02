import { openAppStateStore, recomposeLegacyBlob, type AppState, type AppStateStore } from "@portiq/core";
import type { CliContext } from "../context";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";
import { RuntimeError } from "../errors";

function open(ctx: CliContext, flags: { dataDir?: string }): { store: AppStateStore; state: AppState } {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  const store = openAppStateStore({ dataDir });
  const { state } = store.load();
  if (!state) {
    store.close();
    throw new RuntimeError(`No Portiq data found at ${dataDir}. Run the desktop app or import a collection first.`);
  }
  return { store, state };
}

export function withState<T>(ctx: CliContext, flags: { dataDir?: string }, fn: (state: AppState, store: AppStateStore) => T): T {
  const { store, state } = open(ctx, flags);
  try {
    return fn(state, store);
  } finally {
    store.close();
  }
}

export async function withStateAsync<T>(
  ctx: CliContext,
  flags: { dataDir?: string },
  fn: (state: AppState, store: AppStateStore) => Promise<T>
): Promise<T> {
  const { store, state } = open(ctx, flags);
  try {
    return await fn(state, store);
  } finally {
    store.close();
  }
}

/** Rollback helper: rewrite the legacy `appState` blob from per-entity rows. */
export function recomposeBlob(ctx: CliContext, flags: { dataDir?: string }): boolean {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  const store = openAppStateStore({ dataDir });
  try {
    return recomposeLegacyBlob(store.entities.raw);
  } finally {
    store.close();
  }
}
