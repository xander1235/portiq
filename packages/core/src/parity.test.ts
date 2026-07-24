import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpTransport } from "./index";

let server: Server | null = null;
function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as any).port));
  });
}
afterEach(() => { server?.close(); server = null; });

describe("golden parity: HTTP result shape", () => {
  it("returns exactly the keys the renderer expects", async () => {
    const port = await listen((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ a: 1 }));
    });
    const r = await new HttpTransport({ appVersion: "test" }).send({
      method: "GET", url: `http://127.0.0.1:${port}/`, httpVersion: "1.1",
    });
    expect(Object.keys(r as object).sort()).toEqual(
      ["body", "duration", "headers", "httpVersion", "json", "status", "statusText", "time"].sort()
    );
    const rr = r as any;
    expect(rr.time).toBe(rr.duration);
    expect(rr.json).toEqual({ a: 1 });
    expect(typeof rr.headers["content-type"]).toBe("string");
  });
});
