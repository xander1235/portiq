import Fuse from "fuse.js";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { listRequestsWithPaths, type RequestWithPath } from "../resolve/refs";
import { emit } from "./emit";
import { withState } from "./store";

export const searchCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("search <query>")
      .description("fuzzy-search the library")
      .action((query: string, _o, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const output = withState(ctx, flags, (state) => {
          const items = listRequestsWithPaths(state);
          const fuse = new Fuse<RequestWithPath>(items, {
            includeScore: true,
            threshold: 0.4,
            keys: [
              { name: "path", weight: 0.5 },
              { name: "item.name", weight: 0.3 },
              { name: "item.url", weight: 0.2 },
            ],
          });
          const hits = fuse.search(query).map((h) => h.item);
          return {
            kind: "table" as const,
            columns: ["path", "protocol", "method", "url"],
            rows: hits.map((r) => [r.path, r.item.protocol, r.item.method, r.item.url]),
          };
        });
        emit(ctx, flags, output);
      });
  },
};
