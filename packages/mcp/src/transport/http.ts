import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ServerContext } from "../context";
import { createMcpServer } from "../server";

export interface HttpTransportOptions {
  host: string;
  port: number;
  authToken?: string;
  path?: string;
}

export interface HttpServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function jsonError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

export async function startHttpServer(ctx: ServerContext, opts: HttpTransportOptions): Promise<HttpServerHandle> {
  const path = opts.path ?? "/mcp";

  // Single-session stateful transport: one client at a time (local single-user use).
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== path) return jsonError(res, 404, -32601, "Not found");

      if (opts.authToken) {
        const header = req.headers.authorization ?? "";
        if (header !== `Bearer ${opts.authToken}`) return jsonError(res, 401, -32001, "Unauthorized");
      }

      try {
        await transport.handleRequest(req, res); // handles POST / GET(SSE) / DELETE; reads the body stream itself
      } catch (err) {
        if (!res.headersSent) jsonError(res, 500, -32603, (err as Error).message);
      }
    })();
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port, opts.host, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    url: `http://${opts.host}:${port}${path}`,
    port,
    close: async () => {
      await transport.close();
      await server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
