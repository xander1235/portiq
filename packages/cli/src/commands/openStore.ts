import { openAppStateStore, type AppStateStore } from "@portiq/core";
import type { CliContext } from "../context";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";

export function openStoreForWrite(ctx: CliContext, flags: { dataDir?: string }): AppStateStore {
  const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(resolveConfigPath(ctx.env)));
  return openAppStateStore({ dataDir });
}
