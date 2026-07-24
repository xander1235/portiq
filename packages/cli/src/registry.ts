import { Command, Option } from "commander";
import type { CliContext } from "./context";
import { CLI_NAME, CLI_VERSION } from "./version";

export interface GlobalFlags {
  dataDir?: string;
  env?: string;
  var: string[];
  reporter?: "pretty" | "json" | "junit";
  output?: string;
  timeout?: number;
  failOnTest?: boolean;
  dryRun?: boolean;
  color: boolean;
}

export interface CommandModule {
  register(program: Command, ctx: CliContext): void;
}

export function parseGlobalFlags(cmd: Command): GlobalFlags {
  const o = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    dataDir: o.dataDir as string | undefined,
    env: o.env as string | undefined,
    var: (o.var as string[] | undefined) ?? [],
    reporter: o.reporter as GlobalFlags["reporter"],
    output: o.output as string | undefined,
    timeout: o.timeout !== undefined ? Number(o.timeout) : undefined,
    failOnTest: o.failOnTest as boolean | undefined,
    dryRun: o.dryRun as boolean | undefined,
    color: o.color !== false,
  };
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function buildProgram(ctx: CliContext, modules: CommandModule[]): Command {
  const program = new Command();
  program
    .name(CLI_NAME)
    .version(CLI_VERSION)
    .description("Portiq API client — run your API library from the terminal")
    .option("--data-dir <path>", "override the Portiq data directory")
    .option("--env <name>", "environment to interpolate variables from")
    .option("--var <k=v>", "override a variable (repeatable)", collect, [])
    .addOption(new Option("--reporter <format>", "output format").choices(["pretty", "json", "junit"]))
    .option("-o, --output <file>", "write the report to a file instead of stdout")
    .option("--timeout <ms>", "request timeout in milliseconds")
    .option("--fail-on-test", "exit 2 when any test fails")
    .option("--dry-run", "resolve the request without sending it")
    .option("--no-color", "disable ANSI color");
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => ctx.stdout.write(str),
    writeErr: (str) => ctx.stderr.write(str),
  });
  for (const m of modules) m.register(program, ctx);
  return program;
}
