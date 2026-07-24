import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { sendGraphQL } from "./graphql";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("sendGraphQL", () => {
  it("posts a query and returns a normalized result", async () => {
    let body = "";
    const port = await listen((req, res) => {
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: { hello: "world" } }));
      });
    });
    const r = await sendGraphQL({ url: `http://127.0.0.1:${port}/graphql`, query: "{ hello }", variables: '{"a":1}' });
    expect("status" in r && r.status).toBe(200);
    expect("json" in r && r.json).toEqual({ data: { hello: "world" } });
    expect(JSON.parse(body)).toMatchObject({ query: "{ hello }", variables: { a: 1 } });
  });

  it("returns an error for invalid variables JSON", async () => {
    const r = await sendGraphQL({ url: "http://127.0.0.1:1/graphql", query: "{ x }", variables: "{bad" });
    expect("error" in r && r.error).toMatch(/variables must be valid JSON/i);
  });
});
