import { spawn as nodeSpawn } from "node:child_process";
import type { Command } from "commander";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule } from "../registry";

export type McpSpawner = (
  command: string,
  args: string[],
  opts: { stdio: "inherit"; env: NodeJS.ProcessEnv }
) => { on(event: "error" | "exit", cb: (arg: unknown) => void): void };

const defaultSpawner: McpSpawner = (command, args, opts) => nodeSpawn(command, args, opts);

export function mcpCommand(spawner: McpSpawner = defaultSpawner): CommandModule {
  return {
    register(program: Command, ctx: CliContext) {
      program
        .command("mcp")
        .description("start the stdio MCP server (spawns the portiq-mcp binary from @portiq/mcp)")
        .allowUnknownOption(true)
        .helpOption(false)
        .argument("[args...]", "arguments forwarded to portiq-mcp")
        .action((args: string[], _opts, cmd: Command) => {
          void parseGlobalFlags(cmd);
          return new Promise<void>((resolve) => {
            const child = spawner("portiq-mcp", args ?? [], { stdio: "inherit", env: ctx.env });
            child.on("error", (err) => {
              const code = (err as { code?: string }).code;
              if (code === "ENOENT") {
                ctx.stdout.write("portiq-mcp is not installed. Install it with: npm i -g @portiq/mcp\n");
              } else {
                ctx.stdout.write(`Failed to launch portiq-mcp: ${(err as Error).message}\n`);
              }
              process.exitCode = 1;
              resolve();
            });
            child.on("exit", (codeArg) => {
              const code = typeof codeArg === "number" ? codeArg : 0;
              if (code) process.exitCode = code;
              resolve();
            });
          });
        });
    },
  };
}
