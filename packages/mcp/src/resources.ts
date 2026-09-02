import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestItem } from "@portiq/core";
import type { ServerContext } from "./context";
import { jsonResource } from "./util/mcpJson";

const JSON_META = { mimeType: "application/json" };

function flows(ctx: ServerContext): RequestItem[] {
  return ctx.store.flattenRequests().filter((r) => !!r.dagGraph);
}

export function registerResources(server: McpServer, ctx: ServerContext): void {
  server.registerResource("collections", "portiq://collections", { title: "Collections", ...JSON_META }, (uri) =>
    jsonResource(uri, ctx.store.collections().map((c) => ({ id: c.id, name: c.name, items: c.items?.length ?? 0 })))
  );

  server.registerResource("environments", "portiq://environments", { title: "Environments", ...JSON_META }, (uri) =>
    jsonResource(uri, ctx.store.environments().map((e) => ({ id: e.id, name: e.name, vars: e.vars?.length ?? 0 })))
  );

  server.registerResource("flows", "portiq://flows", { title: "Flows", ...JSON_META }, (uri) =>
    jsonResource(uri, flows(ctx).map((f) => ({ id: f.id, name: f.name })))
  );

  server.registerResource("history", "portiq://history", { title: "History", ...JSON_META }, (uri) =>
    jsonResource(uri, (ctx.store.load().state?.history as unknown[] | undefined) ?? [])
  );

  server.registerResource(
    "collection",
    new ResourceTemplate("portiq://collection/{id}", { list: undefined }),
    { title: "Collection", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.collections().find((c) => c.id === id);
      return jsonResource(uri, found ?? { error: `Collection '${id}' not found` });
    }
  );

  server.registerResource(
    "request",
    new ResourceTemplate("portiq://request/{id}", { list: undefined }),
    { title: "Request", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.flattenRequests().find((r) => r.id === id);
      return jsonResource(uri, found ?? { error: `Request '${id}' not found` });
    }
  );

  server.registerResource(
    "environment",
    new ResourceTemplate("portiq://environment/{id}", { list: undefined }),
    { title: "Environment", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = ctx.store.environments().find((e) => e.id === id);
      return jsonResource(uri, found ?? { error: `Environment '${id}' not found` });
    }
  );

  server.registerResource(
    "flow",
    new ResourceTemplate("portiq://flow/{id}", { list: undefined }),
    { title: "Flow", ...JSON_META },
    (uri, variables) => {
      const id = String(variables.id);
      const found = flows(ctx).find((f) => f.id === id);
      return jsonResource(uri, found ?? { error: `Flow '${id}' not found` });
    }
  );
}
