import { SERVER_VERSION } from "./version";

export interface ServerConfig {
  dataDir?: string;
  allowWrites: boolean;
  appVersion: string;
  transport?: "stdio" | "http";
  httpHost?: string;
  httpPort?: number;
  authToken?: string;
  execAllow?: string[];
  execDeny?: string[];
}

const DATA_DIR_PREFIX = "--data-dir=";
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3939;

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

function splitHosts(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseServerConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  let allowWrites = truthy(env.PORTIQ_MCP_ALLOW_WRITES);
  let dataDir: string | undefined;
  let transport: "stdio" | "http" = truthy(env.PORTIQ_MCP_HTTP) ? "http" : "stdio";
  let httpHost = env.PORTIQ_MCP_HOST || DEFAULT_HTTP_HOST;
  let httpPort = env.PORTIQ_MCP_PORT ? Number(env.PORTIQ_MCP_PORT) : DEFAULT_HTTP_PORT;
  let authToken = env.PORTIQ_MCP_AUTH_TOKEN || undefined;
  const execAllow = splitHosts(env.PORTIQ_MCP_EXEC_ALLOW);
  const execDeny = splitHosts(env.PORTIQ_MCP_EXEC_DENY);

  // Reads a `--flag value` or `--flag=value` option; returns null if `arg` is not this flag.
  const takeValue = (arg: string, flag: string, i: number): { value: string; next: number } | null => {
    if (arg === flag) return { value: argv[i + 1] ?? "", next: i + 1 };
    if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), next: i };
    return null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-writes") { allowWrites = true; continue; }
    if (arg === "--http") { transport = "http"; continue; }
    if (arg === "--stdio") { transport = "stdio"; continue; }
    if (arg === "--data-dir") { dataDir = argv[i + 1]; i += 1; continue; }
    if (arg.startsWith(DATA_DIR_PREFIX)) { dataDir = arg.slice(DATA_DIR_PREFIX.length); continue; }

    const host = takeValue(arg, "--host", i);
    if (host) { httpHost = host.value; i = host.next; continue; }
    const port = takeValue(arg, "--port", i);
    if (port) { httpPort = Number(port.value); i = port.next; continue; }
    const token = takeValue(arg, "--auth-token", i);
    if (token) { authToken = token.value; i = token.next; continue; }
    const allow = takeValue(arg, "--exec-allow", i);
    if (allow) { execAllow.push(...splitHosts(allow.value)); i = allow.next; continue; }
    const deny = takeValue(arg, "--exec-deny", i);
    if (deny) { execDeny.push(...splitHosts(deny.value)); i = deny.next; continue; }
  }

  return {
    dataDir,
    allowWrites,
    appVersion: env.PORTIQ_MCP_APP_VERSION || SERVER_VERSION,
    transport,
    httpHost,
    httpPort,
    authToken,
    execAllow,
    execDeny,
  };
}
