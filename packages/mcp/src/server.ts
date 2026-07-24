import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./version";
import type { ServerContext } from "./context";
import { registerResources } from "./resources";
import { registerReadTools } from "./tools/read";
import { registerExecTools } from "./tools/exec";
import { registerWriteTools } from "./tools/write";

const INSTRUCTIONS = [
  "Portiq API library over MCP.",
  "Resources browse the library (portiq://collections, portiq://request/{id}, etc.).",
  "Read/execute tools (list_*, get_*, search, run_*, import_curl) are always available.",
  "Write tools (create_*, update_*, delete_*, set_environment_variable, save_ad_hoc_as_request)",
  "are disabled unless the server is started with --allow-writes (or PORTIQ_MCP_ALLOW_WRITES=1).",
].join(" ");

export function createMcpServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS }
  );

  // Additive registrars — each owns its own file; the factory never edits a switchboard.
  registerResources(server, ctx);
  registerReadTools(server, ctx);
  registerExecTools(server, ctx);
  registerWriteTools(server, ctx);

  return server;
}
