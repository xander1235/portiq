import type { CommandModule } from "../registry";
import { whereCommand } from "./where";
import { configCommand } from "./config";
import { lsCommand } from "./ls";
import { getCommand } from "./get";
import { searchCommand } from "./search";
import { execCommand } from "./exec";
import { runCommand } from "./run";
import { importCommand } from "./import";
import { exportCommand } from "./export";
import { mcpCommand } from "./mcp";
import { mockCommand } from "./mock";

export const builtinCommands: CommandModule[] = [
  lsCommand,
  getCommand,
  searchCommand,
  runCommand,
  execCommand,
  importCommand,
  exportCommand,
  whereCommand,
  configCommand,
  mcpCommand(),
  mockCommand(),
];
