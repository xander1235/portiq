import { writeFileSync } from "node:fs";
import type { CliContext } from "../context";
import { selectReporter, type CommandOutput } from "../reporters";
import type { GlobalFlags } from "../registry";

export function emit(ctx: CliContext, flags: GlobalFlags, output: CommandOutput): void {
  const reporter = selectReporter({ reporter: flags.reporter, isTTY: ctx.isTTY, color: flags.color });
  const text = reporter.write(output);
  if (flags.output) {
    writeFileSync(flags.output, text.endsWith("\n") ? text : text + "\n", "utf8");
  } else {
    ctx.stdout.write(text.endsWith("\n") ? text : text + "\n");
  }
}
