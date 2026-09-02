import { exportPortable, type AppState } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef } from "../resolve/refs";
import { requestItemToCurl } from "../exec/toCurl";
import { emit } from "./emit";
import { withState } from "./store";
import { UsageError } from "../errors";
import type { CommandOutput } from "../reporters";

export const exportCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("export [ref]")
      .description("export a request as curl, or a collection/library as portiq.json")
      .option("--format <format>", "curl | portiq", "portiq")
      .option("--id <uuid>", "resolve by id instead of path")
      .option("--all", "export the entire library (portiq format only)")
      .action((ref: string | undefined, opts: { format: string; id?: string; all?: boolean }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state): CommandOutput => {
          if (opts.format === "curl") {
            if (!ref && !opts.id) throw new UsageError("curl export requires a request <ref> or --id");
            const r = resolveRef(state, { ref, id: opts.id });
            if (!r.request) throw new UsageError("curl export target must be a request");
            return { kind: "message", text: requestItemToCurl(r.request) };
          }
          if (opts.format !== "portiq") throw new UsageError(`Unknown --format "${opts.format}" (allowed: curl, portiq)`);
          let slice: AppState = state;
          if (!opts.all) {
            if (!ref && !opts.id) throw new UsageError("portiq export requires a collection <ref>, --id, or --all");
            const r = resolveRef(state, { ref, id: opts.id });
            if (!r.collection) throw new UsageError("portiq export target must be a collection (or pass --all)");
            slice = { ...state, collections: [r.collection], environments: [] };
          }
          const portable = exportPortable(slice, { exportedAt: new Date(ctx.now()).toISOString() });
          return { kind: "message", text: JSON.stringify(portable, null, 2) };
        });
        emit(ctx, flags, output);
      });
  },
};
