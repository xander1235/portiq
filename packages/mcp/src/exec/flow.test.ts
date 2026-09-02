import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpTransport } from "@portiq/core";
import type { RequestItem } from "@portiq/core";
import type { DagGraph } from "@portiq/core/flows";
import { runSavedFlow, toFlowRequestConfig } from "./flow";
import { startTestHttpServer } from "../testkit/httpServer";

let server: { url: string; close: () => Promise<void> };
beforeAll(async () => { server = await startTestHttpServer(); });
afterAll(async () => { await server.close(); });

describe("toFlowRequestConfig", () => {
  it("emits raw (untemplated) fields with headers as a JSON string", () => {
    const item: RequestItem = {
      type: "request", id: "r1", name: "r", description: "", tags: [],
      protocol: "http", method: "post", url: "{{baseUrl}}/x",
      headersRows: [{ key: "X-A", value: "1", comment: "", enabled: true }],
      bodyType: "raw", bodyText: "hello",
    };
    const cfg = toFlowRequestConfig(item);
    expect(cfg.method).toBe("POST");
    expect(cfg.url).toBe("{{baseUrl}}/x");
    expect(JSON.parse(cfg.headers)).toEqual({ "X-A": "1" });
    expect(cfg.body).toBe("hello");
  });
});

describe("runSavedFlow", () => {
  it("executes a single-request flow against the test server", async () => {
    const graph: DagGraph = {
      version: 2,
      nodes: [{
        id: "n1", type: "request", name: "step1", label: "Step 1", status: "idle",
        data: { overrides: {}, inlineConfig: { method: "GET", url: `${server.url}/flow`, headers: "", body: "", params: "", pathVars: "" } },
      }],
      edges: [],
      positions: {},
    };
    const steps = await runSavedFlow(graph, {
      transport: new HttpTransport({ appVersion: "test" }),
      env: {},
      lookupRequest: () => undefined,
    });
    expect(steps.step1.response?.status).toBe(200);
  });
});
