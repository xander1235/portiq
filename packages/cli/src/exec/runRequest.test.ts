import { describe, it, expect, vi } from "vitest";
import { runRequest, defaultHostGuard, type RunDeps } from "./runRequest";
import type { HttpResult, RequestItem } from "@portiq/core";
import type { GrpcSendResult } from "@portiq/core/grpc";

const okResult: HttpResult = {
  status: 200, statusText: "OK", time: 5, duration: 5,
  headers: { "content-type": "application/json" }, body: '{"id":1}', json: { id: 1 }, httpVersion: "auto",
};

const grpcResult: GrpcSendResult = {
  statusCode: 0, statusMessage: "OK", duration: 7, metadata: {}, trailers: {},
  body: '{"message":"hi world"}', json: { message: "hi world" }, error: null, messages: [],
};

function deps(sendImpl: () => Promise<unknown>): RunDeps {
  return {
    transport: { send: vi.fn(sendImpl), cancel: vi.fn() } as unknown as RunDeps["transport"],
    sendGraphQL: vi.fn(async () => okResult) as unknown as RunDeps["sendGraphQL"],
    now: () => 0,
    grpcTransport: { send: vi.fn(async () => grpcResult), cancel: vi.fn() } as unknown as RunDeps["grpcTransport"],
  };
}

const httpReq = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "r1", name: "Get", description: "", tags: [],
  protocol: "http", method: "GET", url: "https://x/", bodyType: "none", ...over,
});

function grpcDeps(sendImpl: () => Promise<unknown>): RunDeps {
  return { ...deps(async () => okResult), grpcTransport: { send: vi.fn(sendImpl), cancel: vi.fn() } as unknown as RunDeps["grpcTransport"] };
}

const grpcReq = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "g1", name: "Echo", description: "", tags: [],
  protocol: "grpc", method: "", url: "grpc://127.0.0.1:50051",
  grpcConfig: { service: "echo.EchoService", method: "Unary", requestBody: '{"message":"world"}', callType: "UNARY", tls: false, protoContent: 'x' },
  ...over,
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

describe("runRequest graphql", () => {
  it("interpolates header values with env vars before sending", async () => {
    const sendGraphQL = vi.fn(async () => okResult);
    const d = { ...deps(async () => okResult), sendGraphQL: sendGraphQL as unknown as RunDeps["sendGraphQL"] };
    const req = httpReq({
      protocol: "graphql",
      method: "POST",
      graphqlConfig: { query: "{ hello }", headers: { Authorization: "Bearer {{token}}", "X-Name": "{{name}}" } },
    });
    await runRequest(req, { token: "abc", name: "portiq" }, d);
    expect(sendGraphQL).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer abc", "X-Name": "portiq" },
      })
    );
  });
});

describe("runRequest gRPC", () => {
  it("checks the host guard against the resolved grpc url before dispatch", async () => {
    const guard = vi.fn();
    const d = { ...grpcDeps(async () => grpcResult), hostGuard: guard };
    await runRequest(grpcReq(), {}, d);
    expect(guard).toHaveBeenCalledWith("grpc://127.0.0.1:50051");
  });

  it("dispatches a gRPC request and returns a normalized grpc result", async () => {
    const outcome = await runRequest(grpcReq(), {}, grpcDeps(async () => grpcResult));
    expect(outcome.error).toBeNull();
    expect(outcome.response).toBeNull();
    expect(outcome.grpc?.protocol).toBe("grpc");
    expect(outcome.grpc?.json).toEqual({ message: "hi world" });
    expect(outcome.request.protocol).toBe("grpc");
    expect(outcome.request.method).toBe("UNARY");
  });

  it("surfaces a gRPC error status via the grpc result", async () => {
    const outcome = await runRequest(grpcReq(), {}, grpcDeps(async () => ({ ...grpcResult, statusCode: 5, statusMessage: "NOT_FOUND", json: null, error: "nope" })));
    expect(outcome.grpc?.statusCode).toBe(5);
    expect(outcome.grpc?.error).toBe("nope");
  });

  it("still rejects websocket with a RuntimeError", async () => {
    await expect(runRequest(grpcReq({ protocol: "websocket" }), {}, grpcDeps(async () => grpcResult))).rejects.toThrow(/websocket/i);
  });
});

describe("defaultHostGuard", () => {
  it("enforces PORTIQ_EXEC_ALLOW / PORTIQ_EXEC_DENY from the environment", async () => {
    const prevAllow = process.env.PORTIQ_EXEC_ALLOW;
    const prevDeny = process.env.PORTIQ_EXEC_DENY;
    try {
      process.env.PORTIQ_EXEC_ALLOW = "example.com";
      delete process.env.PORTIQ_EXEC_DENY;
      const allowGuard = defaultHostGuard();
      expect(() => allowGuard("https://example.com/x")).not.toThrow();
      expect(() => allowGuard("https://evil.com/x")).toThrow(/allow-list/i);

      process.env.PORTIQ_EXEC_ALLOW = "*";
      process.env.PORTIQ_EXEC_DENY = "blocked.com";
      const denyGuard = defaultHostGuard();
      expect(() => denyGuard("https://ok.com/x")).not.toThrow();
      expect(() => denyGuard("https://blocked.com/x")).toThrow(/deny-list|allow-list|not permitted/i);
    } finally {
      if (prevAllow === undefined) delete process.env.PORTIQ_EXEC_ALLOW; else process.env.PORTIQ_EXEC_ALLOW = prevAllow;
      if (prevDeny === undefined) delete process.env.PORTIQ_EXEC_DENY; else process.env.PORTIQ_EXEC_DENY = prevDeny;
    }
  });

  it("is a no-op when no policy env vars are set", () => {
    const prevAllow = process.env.PORTIQ_EXEC_ALLOW;
    const prevDeny = process.env.PORTIQ_EXEC_DENY;
    try {
      delete process.env.PORTIQ_EXEC_ALLOW;
      delete process.env.PORTIQ_EXEC_DENY;
      expect(defaultHostGuard()("https://anything.com/x")).toBeUndefined();
    } finally {
      if (prevAllow === undefined) delete process.env.PORTIQ_EXEC_ALLOW; else process.env.PORTIQ_EXEC_ALLOW = prevAllow;
      if (prevDeny === undefined) delete process.env.PORTIQ_EXEC_DENY; else process.env.PORTIQ_EXEC_DENY = prevDeny;
    }
  });
});
