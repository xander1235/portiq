import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpTransport } from "@portiq/core";
import type { RequestItem } from "@portiq/core";
import { runRequestItem } from "./run";
import { startTestHttpServer } from "../testkit/httpServer";

let server: { url: string; close: () => Promise<void> };
beforeAll(async () => { server = await startTestHttpServer(); });
afterAll(async () => { await server.close(); });

const transport = new HttpTransport({ appVersion: "test" });

describe("runRequestItem", () => {
  it("sends an http GET and normalizes the response", async () => {
    const item: RequestItem = {
      type: "request", id: "r1", name: "get", description: "", tags: [],
      protocol: "http", method: "GET", url: `${server.url}/ping`,
    };
    const { response } = await runRequestItem(item, { transport });
    expect(response.status).toBe(200);
    expect(response.json.method).toBe("GET");
    expect(response.json.path).toBe("/ping");
  });

  it("runs post-script tests against the response", async () => {
    const item: RequestItem = {
      type: "request", id: "r2", name: "tested", description: "", tags: [],
      protocol: "http", method: "GET", url: `${server.url}/x`,
      testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('ok', () => pm.response.to.have.status(200));" }],
    };
    const { tests } = await runRequestItem(item, { transport });
    expect(tests.passed).toBe(1);
    expect(tests.failed).toBe(0);
  });

  it("rejects unsupported protocols with a clear message", async () => {
    const item: RequestItem = {
      type: "request", id: "r3", name: "ws", description: "", tags: [],
      protocol: "websocket", method: "GET", url: "wss://x",
    };
    await expect(runRequestItem(item, { transport })).rejects.toThrow(/not supported headlessly/i);
  });
});
