#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerConfig } from "./config";
import { buildContext } from "./context";
import { createMcpServer } from "./server";

async function main(): Promise<void> {
  const config = parseServerConfig(process.argv.slice(2), process.env);
  const ctx = buildContext(config);
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive by reading stdin.
  process.on("SIGINT", () => { ctx.close(); process.exit(0); });
  process.on("SIGTERM", () => { ctx.close(); process.exit(0); });
  console.error(`[portiq-mcp] ready (writes ${config.allowWrites ? "ENABLED" : "disabled"})`);
}

main().catch((err) => {
  console.error("[portiq-mcp] fatal:", err);
  process.exit(1);
});
