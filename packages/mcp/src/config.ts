import { SERVER_VERSION } from "./version";

export interface ServerConfig {
  dataDir?: string;
  allowWrites: boolean;
  appVersion: string;
}

const DATA_DIR_PREFIX = "--data-dir=";

export function parseServerConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const envFlag = env.PORTIQ_MCP_ALLOW_WRITES;
  let allowWrites = envFlag === "1" || envFlag === "true";
  let dataDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-writes") {
      allowWrites = true;
    } else if (arg === "--data-dir") {
      dataDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith(DATA_DIR_PREFIX)) {
      dataDir = arg.slice(DATA_DIR_PREFIX.length);
    }
  }

  return {
    dataDir,
    allowWrites,
    appVersion: env.PORTIQ_MCP_APP_VERSION || SERVER_VERSION,
  };
}
