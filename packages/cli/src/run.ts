import { CommanderError } from "commander";
import type { CliContext } from "./context";
import { buildProgram, type CommandModule } from "./registry";
import { builtinCommands } from "./commands";
import { EXIT, UsageError, toExitCode } from "./errors";

const SUCCESS_CODES = new Set(["commander.helpDisplayed", "commander.version", "commander.help"]);

export async function runCli(ctx: CliContext, extra: CommandModule[] = []): Promise<number> {
  const program = buildProgram(ctx, [...builtinCommands, ...extra]);
  try {
    await program.parseAsync(ctx.argv, { from: "user" });
    return process.exitCode ? Number(process.exitCode) : EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (SUCCESS_CODES.has(err.code)) return EXIT.SUCCESS;
      ctx.stderr.write(`${err.message}\n`);
      return EXIT.USAGE;
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.stderr.write(`${err instanceof UsageError ? "usage error" : "error"}: ${message}\n`);
    return toExitCode(err);
  }
}
