import { createMockManager, generateRoutesFromCollection, type MockServerManager } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef } from "../resolve/refs";
import { withState } from "./store";
import { emit } from "./emit";
import { UsageError, RuntimeError } from "../errors";
import type { CommandOutput } from "../reporters";

export interface MockDeps {
  createManager?: () => MockServerManager;
  waitForShutdown?: (port: number) => Promise<void>;
}

/** Resolves when the process receives SIGINT/SIGTERM; listeners are removed before resolving. */
function defaultWaitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 3000;
  const n = Number(raw);
  // 0 is accepted (and used by tests) as the OS-assigned-ephemeral-port sentinel
  // that packages/core's MockServerManager.start() honors; negative/non-integer
  // values and values above the valid TCP port range are rejected here.
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new UsageError(`--port must be an integer between 0 and 65535, got "${raw}"`);
  }
  return n;
}

export function mockCommand(deps: MockDeps = {}): CommandModule {
  const createManager = deps.createManager ?? createMockManager;
  const waitForShutdown = deps.waitForShutdown ?? defaultWaitForShutdown;

  return {
    register(program: Command, ctx: CliContext) {
      program
        .command("mock <ref>")
        .description("start an in-process HTTP mock server from a saved collection")
        .option("--port <number>", "port to listen on (default 3000)")
        .action(async (ref: string, opts: { port?: string }, cmd: Command) => {
          const flags = parseGlobalFlags(cmd);
          const port = parsePort(opts.port);

          const collection = withState(ctx, flags, (state) => {
            const resolved = resolveRef(state, { ref });
            if (resolved.kind !== "collection" || !resolved.collection) {
              throw new UsageError(`mock requires a collection reference; "${ref}" is a ${resolved.kind}`);
            }
            return resolved.collection;
          });

          const routes = generateRoutesFromCollection(collection);
          const manager = createManager();
          const result = await manager.start({ id: collection.name, port, routes });
          if ("error" in result) {
            throw new RuntimeError(result.error);
          }
          const boundPort = result.port;

          ctx.stdout.write(
            `Mock server "${collection.name}" listening on http://localhost:${boundPort} (${routes.length} routes). Press Ctrl-C to stop.\n`
          );
          const output: CommandOutput = {
            kind: "table",
            columns: ["Method", "Path", "Status"],
            rows: routes.map((r) => [r.method, r.path, String(r.statusCode ?? 200)]),
          };
          emit(ctx, flags, output);

          await waitForShutdown(boundPort);

          await manager.stop({ id: collection.name });
          ctx.stdout.write(`Stopped mock server "${collection.name}".\n`);
        });
    },
  };
}
