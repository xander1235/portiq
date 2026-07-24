import { describe, it, expect, vi } from "vitest";
import { runRequest, type RunDeps } from "./runRequest";
import type { HttpResult, RequestItem } from "@portiq/core";

const okResult: HttpResult = {
  status: 200, statusText: "OK", time: 5, duration: 5,
  headers: { "content-type": "application/json" }, body: '{"id":1}', json: { id: 1 }, httpVersion: "auto",
};

function deps(sendImpl: () => Promise<unknown>): RunDeps {
  return {
    transport: { send: vi.fn(sendImpl), cancel: vi.fn() } as unknown as RunDeps["transport"],
    sendGraphQL: vi.fn(async () => okResult) as unknown as RunDeps["sendGraphQL"],
    now: () => 0,
  };
}

const httpReq = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "r1", name: "Get", description: "", tags: [],
  protocol: "http", method: "GET", url: "https://x/", bodyType: "none", ...over,
});

describe("runRequest", () => {
  it("sends an http request and returns the response", async () => {
    const outcome = await runRequest(httpReq(), {}, deps(async () => okResult));
    expect(outcome.error).toBeNull();
    expect(outcome.response?.status).toBe(200);
  });

  it("surfaces a transport error", async () => {
    const outcome = await runRequest(httpReq(), {}, deps(async () => ({ error: "ECONNREFUSED" })));
    expect(outcome.response).toBeNull();
    expect(outcome.error).toBe("ECONNREFUSED");
  });

  it("runs post-test steps against the response", async () => {
    const req = httpReq({
      testsPostSteps: [{ id: "s1", name: "status", script: "pm.test('200', () => pm.response.to.have.status(200));" }],
    });
    const outcome = await runRequest(req, {}, deps(async () => okResult));
    expect(outcome.tests?.passed).toBe(1);
    expect(outcome.tests?.failed).toBe(0);
  });

  it("rejects unsupported protocols with a RuntimeError", async () => {
    await expect(runRequest(httpReq({ protocol: "websocket" }), {}, deps(async () => okResult))).rejects.toThrow(/websocket/i);
  });
});
