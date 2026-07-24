import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "Portiq";
export const DB_FILE = "appdata.sqlite";

export interface ResolveDataDirOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Resolve the canonical Portiq data directory, matching Electron's userData
 *  convention without depending on Electron. */
export function resolveDataDir(opts: ResolveDataDirOptions = {}): string {
  const env = opts.env ?? process.env;
  if (opts.dataDir) return opts.dataDir;
  if (env.PORTIQ_DATA_DIR) return env.PORTIQ_DATA_DIR;

  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME);
  }
  if (platform === "win32") {
    const base = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(base, APP_NAME);
  }
  const base = env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(base, APP_NAME);
}

export function resolveDbPath(opts: ResolveDataDirOptions = {}): string {
  return join(resolveDataDir(opts), DB_FILE);
}
