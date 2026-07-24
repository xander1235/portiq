import { parseCurl, type RequestRow } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { type ResolvableRequest } from "../resolve/httpPayload";
import { resolveHttpPayload } from "../resolve/httpPayload";
import { runRequest, defaultRunDeps, type RunDeps } from "../exec/runRequest";
import { resolveVars } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";
import { UsageError } from "../errors";
import type { CommandOutput } from "../reporters";
import type { AppState, RequestItem } from "@portiq/core";

export interface ExecOptions {
  url?: string;
  method?: string;
  header: string[];
  data?: string;
  fromCurl?: string;
}

function headerRows(headers: string[]): RequestRow[] {
  return headers.map((h) => {
    const idx = h.indexOf(":");
    const key = idx === -1 ? h.trim() : h.slice(0, idx).trim();
    const value = idx === -1 ? "" : h.slice(idx + 1).trim();
    return { key, value, comment: "", enabled: true };
  });
}

export function buildExecRequest(opts: ExecOptions): ResolvableRequest {
  if (opts.fromCurl) {
    const parsed = parseCurl(opts.fromCurl);
    return {
      protocol: "http", method: parsed.method, url: parsed.url,
      headersRows: parsed.headersRows, paramsRows: parsed.paramsRows,
      authType: parsed.authType, authConfig: parsed.authConfig,
      bodyType: parsed.bodyType, bodyText: parsed.bodyText, bodyRows: parsed.bodyRows,
    };
  }
  if (!opts.url) throw new UsageError("exec requires a <url> or --from-curl");
  const method = opts.method ? opts.method.toUpperCase() : opts.data !== undefined ? "POST" : "GET";
  return {
    protocol: "http", method, url: opts.url,
    headersRows: headerRows(opts.header),
    bodyType: opts.data !== undefined ? "raw" : "none",
    bodyText: opts.data,
  };
}

export const execCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("exec [url]")
      .description("send an ad-hoc request (curl-like flags or --from-curl); not saved")
      .option("-X, --method <method>", "HTTP method")
      .option("-H, --header <header>", "request header 'Key: Value' (repeatable)", (v: string, p: string[]) => p.concat([v]), [])
      .option("-d, --data <body>", "request body")
      .option("--from-curl <command>", "parse a curl command string")
      .action(async (url: string | undefined, opts: Omit<ExecOptions, "url">, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const req = buildExecRequest({ ...opts, url });
        const vars = safeResolveVars(ctx, flags);

        if (flags.dryRun) {
          const { view } = resolveHttpPayload(req, vars, { timeoutMs: flags.timeout });
          emit(ctx, flags, { kind: "entity", entity: { ...view } } as CommandOutput);
          return;
        }

        const deps: RunDeps = defaultRunDeps();
        const item: RequestItem = { type: "request", id: "adhoc", name: "adhoc", description: "", tags: [], ...req } as RequestItem;
        const outcome = await runRequest(item, vars, deps, { timeoutMs: flags.timeout, runTests: false });
        emit(ctx, flags, { kind: "execution", request: outcome.request, response: outcome.response, error: outcome.error, tests: null });
        if (outcome.error) process.exitCode = 1;
      });
  },
};

function safeResolveVars(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  // exec works without a store; resolve vars best-effort.
  try {
    return withStateAsyncSync(ctx, flags);
  } catch {
    const vars: Record<string, string> = {};
    for (const pair of flags.var) {
      const idx = pair.indexOf("=");
      if (idx === -1) throw new UsageError(`Invalid --var "${pair}", expected key=value`);
      vars[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return vars;
  }
}

// Synchronous store read for var resolution (open+load+close are all sync in core).
function withStateAsyncSync(ctx: CliContext, flags: { dataDir?: string; env?: string; var: string[] }): Record<string, string> {
  return withState(ctx, flags, (state: AppState) => resolveVars(state, flags));
}
