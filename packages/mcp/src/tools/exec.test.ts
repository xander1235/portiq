import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { AppState } from "@portiq/core";
import { buildContext } from "../context";
import { createMcpServer } from "../server";
import { connectInProcess } from "../testkit/inProcessClient";
import { withTempDataDir, seedStore } from "../testkit/tempStore";
import { startTestHttpServer } from "../testkit/httpServer";
import { startEchoGrpcServer, type GrpcTestServer } from "../testkit/grpcServer";

let http: { url: string; close: () => Promise<void> };
beforeAll(async () => { http = await startTestHttpServer(); });
afterAll(async () => { await http.close(); });

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Ping", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/ping`,
        testsPostSteps: [{ id: "s1", name: "ok", script: "pm.test('200', () => pm.response.to.have.status(200));" }] },
      { type: "request", id: "fl1", name: "Flow", description: "", tags: [], protocol: "http", method: "GET", url: `${http.url}/f`,
        dagGraph: { version: 2, nodes: [{ id: "n1", type: "request", name: "step1", label: "S1", status: "idle",
          data: { overrides: {}, inlineConfig: { method: "GET", url: `${http.url}/f`, headers: "", body: "", params: "", pathVars: "" } } }], edges: [], positions: {} } },
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

async function client() {
  const { dir, cleanup } = withTempDataDir();
  dirs.push(cleanup);
  seedStore(dir, sample());
  const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
  dirs.push(() => ctx.close());
  const c = await connectInProcess(createMcpServer(ctx));
  dirs.push(() => { void c.close(); });
  return c;
}

const call = async (c: Awaited<ReturnType<typeof client>>, name: string, args: Record<string, unknown>) =>
  JSON.parse((await c.callTool({ name, arguments: args })).content[0].text as string);

describe("exec tools", () => {
  it("run_request returns a normalized response and test results", async () => {
    const c = await client();
    const out = await call(c, "run_request", { id: "r1" });
    expect(out.response.status).toBe(200);
    expect(out.tests.passed).toBe(1);
  });

  it("run_ad_hoc_request sends an inline request", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", { method: "GET", url: `${http.url}/adhoc` });
    expect(out.response.json.path).toBe("/adhoc");
  });

  it("run_collection aggregates test totals", async () => {
    const c = await client();
    const out = await call(c, "run_collection", { collectionId: "c1" });
    expect(out.totals.passed).toBe(1);
    expect(out.requests.length).toBeGreaterThanOrEqual(1);
  });

  it("run_flow executes a saved flow", async () => {
    const c = await client();
    const out = await call(c, "run_flow", { id: "fl1" });
    expect(out.step1.response.status).toBe(200);
  });

  it("run_request errors on an unknown id", async () => {
    const c = await client();
    const res = await c.callTool({ name: "run_request", arguments: { id: "nope" } });
    expect(res.isError).toBe(true);
  });
});

describe("exec tools gRPC", () => {
  let grpcServer: GrpcTestServer;
  beforeAll(async () => { grpcServer = await startEchoGrpcServer(); });
  afterAll(async () => { await grpcServer.close(); });

  it("run_ad_hoc_request performs a unary gRPC call (explicit tls:false for a plaintext server)", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", {
      protocol: "grpc", url: grpcServer.target, method: "Unary",
      service: "echo.EchoService", body: '{"message":"world"}',
      protoContent: grpcServer.protoContent, callType: "UNARY", tls: false,
    });
    expect(out.response.protocol).toBe("grpc");
    expect(out.response.json).toEqual({ message: "hi world" });
  });

  it("run_request runs a SAVED gRPC request", async () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    seedStore(dir, {
      collections: [{ id: "c1", name: "gRPC", items: [
        { type: "request", id: "gr1", name: "Echo", description: "", tags: [],
          protocol: "grpc", method: "", url: grpcServer.target,
          grpcConfig: { service: "echo.EchoService", method: "Unary",
            requestBody: '{"message":"saved"}', callType: "UNARY", tls: false, protoContent: grpcServer.protoContent } },
      ] }],
      activeCollectionId: "c1", environments: [], activeEnvId: null, historyRetentionDays: 7,
    });
    const ctx = buildContext({ dataDir: dir, allowWrites: false, appVersion: "test" });
    dirs.push(() => ctx.close());
    const c = await connectInProcess(createMcpServer(ctx));
    dirs.push(() => { void c.close(); });
    const out = await call(c, "run_request", { id: "gr1" });
    expect(out.response.json).toEqual({ message: "hi saved" });
  });

  it("run_ad_hoc_request performs a CLIENT_STREAM call with batch messages", async () => {
    const c = await client();
    const out = await call(c, "run_ad_hoc_request", {
      protocol: "grpc", url: grpcServer.target, method: "ClientStream",
      service: "echo.EchoService", callType: "CLIENT_STREAM",
      messages: ['{"message":"a"}', '{"message":"b"}'],
      protoContent: grpcServer.protoContent, tls: false,
    });
    expect(out.response.streamed).toBe(true);
    expect(out.response.json).toEqual({ message: "got:a,b" });
  });
});
