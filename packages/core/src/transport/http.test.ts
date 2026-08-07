import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpTransport, scrubUrls } from "./http";

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

  it("re-checks the host policy on every redirect hop", async () => {
    const target = createServer((_req, res) => res.end("target"));
    const redirector = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${(target.address() as any).port}/`);
      res.end();
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", () => resolve()));
    try {
      const redirectPort = (redirector.address() as any).port;
      const blocked = new HttpTransport({
        appVersion: "test",
        hostGuard: (url) => {
          if (new URL(url).port !== String(redirectPort)) throw new Error("redirect blocked");
        },
      });
      const r = await blocked.send({ method: "GET", url: `http://127.0.0.1:${redirectPort}/`, httpVersion: "auto" });
      expect("error" in r && r.error).toMatch(/redirect blocked/);

      const allowed = new HttpTransport({ appVersion: "test" });
      const ok = await allowed.send({ method: "GET", url: `http://127.0.0.1:${redirectPort}/`, httpVersion: "auto" });
      expect("status" in ok && ok.status).toBe(200);
      expect("body" in ok && ok.body).toBe("target");
    } finally {
      target.close();
      redirector.close();
    }
  });

  it("rejects the request when the initial URL fails the host policy", async () => {
    const t = new HttpTransport({ appVersion: "test", hostGuard: () => { throw new Error("nope"); } });
    const r = await t.send({ method: "GET", url: "http://127.0.0.1:1/", httpVersion: "auto" });
    expect("error" in r && r.error).toBe("nope");
  });

  it("aborts responses whose declared content-length exceeds the cap", async () => {
    const port = await listen((_req, res) => {
      res.setHeader("content-length", String(60 * 1024 * 1024));
      res.end("small");
    });
    const t = new HttpTransport({ appVersion: "test" });
    const r = await t.send({ method: "GET", url: `http://127.0.0.1:${port}/`, httpVersion: "auto" });
    expect("error" in r && r.error).toMatch(/maximum size/);
  });

  it("scrubUrls strips credentials and query strings from URLs in error messages", () => {
    const scrubbed = scrubUrls(
      "fetch failed: GET https://user:pass@api.example.com/x?token=secret&a=1 -> connect ECONNREFUSED"
    );
    expect(scrubbed).not.toContain("user");
    expect(scrubbed).not.toContain("pass");
    expect(scrubbed).not.toContain("token=secret");
    expect(scrubbed).toContain("https://api.example.com/x");
    expect(scrubUrls("plain message")).toBe("plain message");
  });
});
