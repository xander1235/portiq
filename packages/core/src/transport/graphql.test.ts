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

  it("re-checks the host policy on every redirect hop", async () => {
    const target = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { ok: true } }));
    });
    const redirector = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${(target.address() as any).port}/graphql`);
      res.end();
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", () => resolve()));
    try {
      const redirectPort = (redirector.address() as any).port;
      const blocked = await sendGraphQL({
        url: `http://127.0.0.1:${redirectPort}/graphql`,
        query: "{ ok }",
        hostGuard: (url) => {
          if (new URL(url).port !== String(redirectPort)) throw new Error("redirect blocked");
        },
      });
      expect("error" in blocked && blocked.error).toMatch(/redirect blocked/);

      const ok = await sendGraphQL({ url: `http://127.0.0.1:${redirectPort}/graphql`, query: "{ ok }" });
      expect("status" in ok && ok.status).toBe(200);
      expect("json" in ok && ok.json).toEqual({ data: { ok: true } });
    } finally {
      target.close();
      redirector.close();
    }
  });

  it("times out when the server never responds", async () => {
    const port = await listen(() => { /* never respond */ });
    const r = await sendGraphQL({ url: `http://127.0.0.1:${port}/graphql`, query: "{ ok }", timeoutMs: 100 });
    expect("timedOut" in r && r.timedOut).toBe(true);
  });
});
