import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";
import { loadConfig, resolveConfigPath, saveConfig, type CliConfig } from "../config";
import { UsageError } from "../errors";
import { emit } from "./emit";
import { recomposeBlob } from "./store";

const SETTABLE = new Set(["dataDir", "reporter", "env"]);

export const configCommand: CommandModule = {
  register(program: Command, ctx: CliContext) {
    const config = program.command("config").description("view or edit CLI configuration");

    config
      .command("path")
      .description("print the config file path")
      .action((_o, cmd: Command) => {
        emit(ctx, parseGlobalFlags(cmd), { kind: "message", text: resolveConfigPath(ctx.env) });
      });

    config
      .command("set <key> <value>")
      .description("set a config key (dataDir | reporter | env)")
      .action((key: string, value: string, _o, cmd: Command) => {
        if (!SETTABLE.has(key)) throw new UsageError(`Unknown config key "${key}" (allowed: ${[...SETTABLE].join(", ")})`);
        const path = resolveConfigPath(ctx.env);
        const next = { ...loadConfig(path), [key]: value } as CliConfig;
        saveConfig(path, next);
        emit(ctx, parseGlobalFlags(cmd), { kind: "message", text: `set ${key} = ${value}` });
      });

    config
      .option("--recompose-legacy-blob", "rewrite the appState blob from per-entity rows (run before downgrading)")
      .action((opts: { recomposeLegacyBlob?: boolean }, cmd: Command) => {
        const flags = parseGlobalFlags(cmd);
        if (opts.recomposeLegacyBlob) {
          const ok = recomposeBlob(ctx, flags);
          emit(ctx, flags, { kind: "message", text: ok ? "Recomposed appState blob from entity rows." : "No entity rows to recompose." });
          return;
        }
        const current = loadConfig(resolveConfigPath(ctx.env)) as Record<string, unknown>;
        emit(ctx, flags, { kind: "entity", entity: current });
      });
  },
};
