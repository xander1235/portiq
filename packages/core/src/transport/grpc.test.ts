import { describe, it, expect, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import { GrpcTransport } from "./grpc";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");
const TLS = join(here, "fixtures", "tls");

let server: grpc.Server | null = null;
let tlsServer: grpc.Server | null = null;

/** Start an in-process Echo server on an ephemeral port; returns "127.0.0.1:<port>". */
function startEchoServer(
  impl: {
    Unary?: grpc.handleUnaryCall<any, any>;
    ServerStream?: grpc.handleServerStreamingCall<any, any>;
    ClientStream?: grpc.handleClientStreamingCall<any, any>;
    BidiStream?: grpc.handleBidiStreamingCall<any, any>;
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
      ClientStream: (call: any, cb: any) => {
        const parts: string[] = [];
        call.on("data", (msg: any) => parts.push(msg.message));
        call.on("end", () => cb(null, { message: "got:" + parts.join(",") }));
      },
      BidiStream: (call: any) => {
        call.on("data", (msg: any) => call.write({ message: "echo:" + msg.message }));
        call.on("end", () => call.end());
      },
      ...impl,
    });
    new ReflectionService(def).addToServer(server);
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

/** Start an in-process mTLS Echo server on an ephemeral port; returns "127.0.0.1:<port>". */
function startMtlsEchoServer(onToken: (t: string | undefined) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    tlsServer = new grpc.Server();
    tlsServer.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => {
        onToken(call.metadata.get("authorization")[0] as string | undefined);
        cb(null, { message: "secure " + call.request.message });
      },
    });
    const creds = grpc.ServerCredentials.createSsl(
      readFileSync(join(TLS, "ca.crt")),
      [{ private_key: readFileSync(join(TLS, "server.key")), cert_chain: readFileSync(join(TLS, "server.crt")) }],
      true // require + verify client cert (mTLS)
    );
    tlsServer.bindAsync("127.0.0.1:0", creds, (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  tlsServer?.forceShutdown();
  tlsServer = null;
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

  it("closes the channel when the method is unknown (no leaked channel)", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const closeSpy = vi.spyOn(grpc.Client.prototype, "close");
    try {
      await t.send({
        url: target,
        service: "echo.EchoService",
        method: "DoesNotExist",
        protoPath: FIXTURE,
      });
      expect(closeSpy).toHaveBeenCalled();
    } finally {
      closeSpy.mockRestore();
    }
  });
});

describe("GrpcTransport callType validation", () => {
  it("resolves INVALID_ARGUMENT when callType doesn't match the method's real streaming shape", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    // ServerStream is actually SERVER_STREAM (responseStream: true); declaring UNARY must be rejected
    // rather than silently dropping every streamed message and resolving OK with an empty body.
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "ServerStream",
      body: { message: "go" },
      callType: "UNARY",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.INVALID_ARGUMENT);
    expect(r.error).toBeTruthy();
    expect(r.messages).toEqual([]);
  });

  it("resolves INVALID_ARGUMENT when a unary method is called as SERVER_STREAM", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "go" },
      callType: "SERVER_STREAM",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(grpc.status.INVALID_ARGUMENT);
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

describe("GrpcTransport server streaming", () => {
  it("aggregates all streamed messages into messages[]", async () => {
    const target = await startEchoServer({}); // default ServerStream writes 3 chunks
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "ServerStream",
      body: { message: "go" },
      callType: "SERVER_STREAM",
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.messages).toEqual([
      { message: "chunk-0" },
      { message: "chunk-1" },
      { message: "chunk-2" },
    ]);
    expect(JSON.parse(r.body)).toHaveLength(3);
    expect(r.json).toBeNull();
  });
});

describe("GrpcTransport client streaming", () => {
  it("sends all request messages and returns the single aggregated reply", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "ClientStream",
      callType: "CLIENT_STREAM",
      messages: [{ message: "a" }, { message: "b" }, { message: "c" }],
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "got:a,b,c" });
    expect(r.messages).toEqual([]);
  });
});

describe("GrpcTransport bidi streaming", () => {
  it("sends all request messages and aggregates all streamed replies", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "BidiStream",
      callType: "BIDI_STREAM",
      messages: [{ message: "x" }, { message: "y" }],
      protoPath: FIXTURE,
    });
    expect(r.statusCode).toBe(0);
    expect(r.messages).toEqual([{ message: "echo:x" }, { message: "echo:y" }]);
    expect(r.json).toBeNull();
    expect(JSON.parse(r.body)).toHaveLength(2);
  });
});

describe("GrpcTransport via reflection", () => {
  it("performs a unary call with NO proto supplied (descriptors from reflection)", async () => {
    const target = await startEchoServer({});
    const t = new GrpcTransport();
    const r = await t.send({
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "reflected" },
      callType: "UNARY",
      tls: false,
      useReflection: true,
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "hi reflected" });
  });
});

describe("GrpcTransport advanced auth", () => {
  it("performs an mTLS unary call with a custom CA + client cert and injects a call-credential token", async () => {
    let seenToken: string | undefined;
    const target = await startMtlsEchoServer((t) => { seenToken = t; });
    const t = new GrpcTransport();
    const r = await t.send({
      url: `grpcs://${target}`,
      service: "echo.EchoService",
      method: "Unary",
      body: { message: "world" },
      callType: "UNARY",
      protoPath: FIXTURE,
      tlsConfig: {
        rootCertsPem: readFileSync(join(TLS, "ca.crt"), "utf8"),
        clientCertPem: readFileSync(join(TLS, "client.crt"), "utf8"),
        clientKeyPem: readFileSync(join(TLS, "client.key"), "utf8"),
      },
      callToken: "s3cr3t",
    });
    expect(r.statusCode).toBe(0);
    expect(r.json).toEqual({ message: "secure world" });
    expect(seenToken).toBe("Bearer s3cr3t");
  });
});
