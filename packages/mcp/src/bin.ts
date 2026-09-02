#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerConfig } from "./config";
import { buildContext } from "./context";
import { createMcpServer } from "./server";
import { startHttpServer } from "./transport/http";

async function main(): Promise<void> {
  const config = parseServerConfig(process.argv.slice(2), process.env);
  const ctx = buildContext(config);

  if (config.transport === "http") {
    const host = config.httpHost ?? "127.0.0.1";
    const port = config.httpPort ?? 3939;
    if (host !== "127.0.0.1" && host !== "localhost" && !config.authToken) {
      console.error(`[portiq-mcp] WARNING: binding to ${host} without --auth-token; anyone who can reach this host can use the server.`);
    }
    const handle = await startHttpServer(ctx, { host, port, authToken: config.authToken });
    const shutdown = (): void => { void handle.close().then(() => ctx.close()).finally(() => process.exit(0)); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    console.error(`[portiq-mcp] HTTP transport ready on ${handle.url} (writes ${config.allowWrites ? "ENABLED" : "disabled"}${config.authToken ? ", auth REQUIRED" : ""})`);
    return;
  }

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
