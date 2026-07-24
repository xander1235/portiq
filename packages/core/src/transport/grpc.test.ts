import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { GrpcTransport } from "./grpc";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;

/** Start an in-process Echo server on an ephemeral port; returns "127.0.0.1:<port>". */
function startEchoServer(
  impl: {
    Unary?: grpc.handleUnaryCall<any, any>;
    ServerStream?: grpc.handleServerStreamingCall<any, any>;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
      ServerStream: (call: any) => {
        for (let i = 0; i < 3; i++) call.write({ message: "chunk-" + i });
        call.end();
      },
      ...impl,
    });
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  server?.forceShutdown();
  server = null;
});

describe("GrpcTransport unary", () => {
  it("performs a unary call and returns the decoded message", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "world" },
      callType: "UNARY",
      tls: false,
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.statusMessage).toBe("OK");
    expect(r.json).toEqual({ message: "hi world" });
    expect(r.error).toBeNull();
    expect(JSON.parse(r.body)).toEqual({ message: "hi world" });
  });

  it("maps a server error to its gRPC status code", async () => {
    const target = await startEchoServer({
      Unary: (_call: any, cb: any) =>
        cb({ code: grpc.status.NOT_FOUND, details: "nope" }),
    });
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.NOT_FOUND);
    expect(r.statusMessage).toBe("NOT_FOUND");
    expect(r.error).toContain("nope");
    expect(r.json).toBeNull();
  });

  it("resolves INVALID_ARGUMENT when required fields are missing", async () => {
    const t = new GrpcTransport();
    const r = await t.send({ url: "", service: "", method: "", protoPath: FIXTURE });
    expect(r.statusCode).toBe(grpc.status.INVALID_ARGUMENT);
    expect(r.error).toBeTruthy();
  });

  it("resolves UNIMPLEMENTED for an unknown method", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "DoesNotExist",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.UNIMPLEMENTED);
    expect(r.error).toBeTruthy();
  });
});

describe("GrpcTransport deadline & cancel", () => {
  it("returns DEADLINE_EXCEEDED when the server is slower than the deadline", async () => {
    const target = await startEchoServer({
      Unary: (call: any, cb: any) => {
        setTimeout(() => cb(null, { message: "late " + call.request.message }), 300);
      },
    });
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      deadline: 100,
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(r.error).toBeTruthy();
  });

  it("returns CANCELLED when cancel(requestId) is called mid-flight", async () => {
    const target = await startEchoServer({
      Unary: (call: any, cb: any) => {
        setTimeout(() => cb(null, { message: "slow " + call.request.message }), 500);
      },
    });
    const t = new GrpcTransport();
    const promise = t.send({
      requestId: "rq-1",
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "x" },
      deadline: 5000,
      protoPath: FIXTURE,
    });
    setTimeout(() => t.cancel("rq-1"), 50);
    const r = await promise;
    expect(r.statusCode).toBe(grpc.status.CANCELLED);
  });

  it("cancel with no requestId returns an error object", () => {
    const t = new GrpcTransport();
    expect(t.cancel("")).toEqual({ error: "Missing request ID" });
  });
});
