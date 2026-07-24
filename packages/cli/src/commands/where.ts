import { resolveDbPath } from "@portiq/core";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { loadConfig, resolveConfigPath, resolveEffectiveDataDir } from "../config";
import { emit } from "./emit";

export const whereCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    program
      .command("where")
      .description("print the resolved data directory, database, and config paths")
      .action((_opts, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        const configPath = resolveConfigPath(ctx.env);
        const dataDir = resolveEffectiveDataDir(flags, ctx.env, loadConfig(configPath));
        emit(ctx, flags, {
          kind: "entity",
          entity: { dataDir, dbPath: resolveDbPath({ dataDir }), configPath },
        });
      });
  },
};
