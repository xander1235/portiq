import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { resolveRef } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";
import type { CommandOutput } from "../reporters";

export const getCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("get <ref>")
      .description("inspect a resolved request, collection, environment, or flow")
      .option("--id <uuid>", "resolve by id instead of path")
      .action((ref: string, opts: { id?: string }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state): CommandOutput => {
          const r = resolveRef(state, { ref, id: opts.id });
          if (r.kind === "collection" && r.collection) {
            return { kind: "entity", entity: { kind: "collection", id: r.collection.id, name: r.collection.name, path: r.path } };
          }
          if (r.kind === "environment" && r.environment) {
            return { kind: "entity", entity: { kind: "environment", id: r.environment.id, name: r.environment.name, vars: r.environment.vars?.map((v) => v.key) ?? [] } };
          }
          const req = r.request!;
          return { kind: "entity", entity: { kind: r.kind, id: req.id, name: req.name, path: r.path, protocol: req.protocol, method: req.method, url: req.url, headers: req.headersRows ?? [], bodyType: req.bodyType ?? "none" } };
        });
        emit(ctx, flags, output);
      });
  },
};
