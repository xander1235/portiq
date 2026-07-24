import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { listRequestsWithPaths, isFlow } from "../resolve/refs";
import { UsageError } from "../errors";
import { emit } from "./emit";
import { withState } from "./store";
import type { CommandOutput } from "../reporters";

const KINDS = new Set(["collections", "requests", "envs", "flows"]);

export const lsCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("ls [kind]")
      .description("list collections | requests | envs | flows")
      .action((kind: string | undefined, _o, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const which = kind ?? "collections";
        if (!KINDS.has(which)) throw new UsageError(`Unknown ls kind "${which}" (allowed: ${[...KINDS].join(", ")})`);
        const output = withState(ctx, flags, (state): CommandOutput => {
          if (which === "collections") {
            return { kind: "table", columns: ["id", "name", "requests"], rows: (state.collections ?? []).map((c) => [c.id, c.name, String(listRequestsWithPaths({ ...state, collections: [c] }).length)]) };
          }
          if (which === "envs") {
            return { kind: "table", columns: ["id", "name", "vars"], rows: (state.environments ?? []).map((e) => [e.id, e.name, String(e.vars?.length ?? 0)]) };
          }
          const reqs = listRequestsWithPaths(state).filter((r) => (which === "flows" ? isFlow(r.item) : true));
          return { kind: "table", columns: ["path", "protocol", "method", "url"], rows: reqs.map((r) => [r.path, r.item.protocol, r.item.method, r.item.url]) };
        });
        emit(ctx, flags, output);
      });
  },
};
