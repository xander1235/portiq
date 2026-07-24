import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpTransport } from "./http";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("HttpTransport", () => {
  it("performs a GET and normalizes the result (auto)", async () => {
    const port = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "GET", url: `http://127.0.0.1:${port}/`, httpVersion: "auto" });
    expect("status" in r && r.status).toBe(200);
    expect("json" in r && r.json).toEqual({ ok: true, method: "GET" });
    expect("httpVersion" in r && r.httpVersion).toBe("auto");
  });

  it("sends a POST body over HTTP/1.1", async () => {
    let received = "";
    const port = await listen((req, res) => {
      req.on("data", (c) => (received += c));
      req.on("end", () => { res.statusCode = 201; res.end("created"); });
    });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "POST", url: `http://127.0.0.1:${port}/`, body: "hello", httpVersion: "1.1" });
    expect("status" in r && r.status).toBe(201);
    expect(received).toBe("hello");
    expect("httpVersion" in r && r.httpVersion).toMatch(/^HTTP\/1/);
  });

  it("returns a timeout result when the server hangs", async () => {
    const port = await listen(() => { /* never respond */ });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "GET", url: `http://127.0.0.1:${port}/`, timeoutMs: 100, httpVersion: "1.1" });
    expect("timedOut" in r && r.timedOut).toBe(true);
  });
});
