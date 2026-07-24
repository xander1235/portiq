import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir } from "@portiq/core";

export interface CliConfig {
  dataDir?: string;
  reporter?: "pretty" | "json" | "junit";
  env?: string;
}

const CONFIG_FILE = "cli-config.json";

export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home?: string
): string {
  const stripped = { ...env };
  delete stripped.PORTIQ_DATA_DIR;
  const base = resolveDataDir({ env: stripped, platform, home });
  return join(base, CONFIG_FILE);
}

export function loadConfig(configPath: string): CliConfig {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(configPath: string, config: CliConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function resolveEffectiveDataDir(
  flags: { dataDir?: string },
  env: NodeJS.ProcessEnv,
  config: CliConfig
): string {
  if (flags.dataDir) return resolveDataDir({ dataDir: flags.dataDir });
  if (env.PORTIQ_DATA_DIR) return resolveDataDir({ env });
  if (config.dataDir) return resolveDataDir({ dataDir: config.dataDir });
  return resolveDataDir({ env });
}
