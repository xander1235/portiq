import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpTransport } from "@portiq/core";
import type { RequestItem } from "@portiq/core";
import { runRequestItem } from "./run";
import { startTestHttpServer } from "../testkit/httpServer";
import { GrpcTransport } from "@portiq/core/grpc";
import { startEchoGrpcServer, type GrpcTestServer } from "../testkit/grpcServer";

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

describe("runRequestItem gRPC", () => {
  let grpcServer: GrpcTestServer;
  beforeAll(async () => { grpcServer = await startEchoGrpcServer(); });
  afterAll(async () => { await grpcServer.close(); });

  const grpcItem = (over: Partial<import("@portiq/core").GrpcConfig> = {}): RequestItem => ({
    type: "request", id: "g1", name: "echo", description: "", tags: [],
    protocol: "grpc", method: "", url: grpcServer.target,
    grpcConfig: { service: "echo.EchoService", method: "Unary", requestBody: '{"message":"world"}',
      callType: "UNARY", tls: false, protoContent: grpcServer.protoContent, ...over },
  });

  it("dispatches a unary gRPC call and normalizes the response", async () => {
    const { response } = await runRequestItem(grpcItem(), { transport, grpcTransport: new GrpcTransport() });
    const r = response as import("@portiq/core").NormalizedGrpcResponse;
    expect(r.protocol).toBe("grpc");
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "hi world" });
    expect(r.streamed).toBe(false);
  });

  it("aggregates a server-streaming gRPC call into messages[]", async () => {
    const { response } = await runRequestItem(
      grpcItem({ method: "ServerStream", callType: "SERVER_STREAM" }),
      { transport, grpcTransport: new GrpcTransport() }
    );
    const r = response as import("@portiq/core").NormalizedGrpcResponse;
    expect(r.statusCode).toBe(0);
    expect(r.streamed).toBe(true);
    expect(r.messages).toEqual([{ message: "chunk-0" }, { message: "chunk-1" }, { message: "chunk-2" }]);
  });
});
