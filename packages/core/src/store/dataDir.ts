import { homedir } from "node:os";
import path from "node:path";

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
  // Join with the target platform's separator, not the host's, so a resolver
  // asked for a darwin/linux path while running on Windows (tests, or any
  // cross-platform tooling) still returns POSIX paths. In production the
  // platform is always the host, so this is a no-op there.
  const p = platform === "win32" ? path.win32 : path.posix;

  if (platform === "darwin") {
    return p.join(home, "Library", "Application Support", APP_NAME);
  }
  if (platform === "win32") {
    const base = env.APPDATA ?? p.join(home, "AppData", "Roaming");
    return p.join(base, APP_NAME);
  }
  const base = env.XDG_CONFIG_HOME ?? p.join(home, ".config");
  return p.join(base, APP_NAME);
}

export function resolveDbPath(opts: ResolveDataDirOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(resolveDataDir(opts), DB_FILE);
}
