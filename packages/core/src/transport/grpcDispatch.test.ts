import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ProtocolRegistry } from "../protocols";
import { GrpcTransport } from "./grpc";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;
function startEchoServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, {
      Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
    });
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}
afterEach(() => { server?.forceShutdown(); server = null; });

describe("gRPC generic-dispatch parity", () => {
  it("buildRequest forwards protoContent", () => {
    const grpcHandler = ProtocolRegistry.get("grpc")!;
    const built = grpcHandler.buildRequest({
      url: "127.0.0.1:50051",
      service: "echo.EchoService",
      method: "Unary",
      requestBody: '{"message":"x"}',
      protoContent: "syntax=\"proto3\";",
    });
    expect(built.protoContent).toBe("syntax=\"proto3\";");
    expect(built.service).toBe("echo.EchoService");
  });

  it("runs a saved gRPC request through registry → buildRequest → transport → parseResponse", async () => {
    const target = await startEchoServer();
    // A saved RequestItem, exactly as a generic executor would see it (protocol + config fields).
    const saved = {
      protocol: "grpc",
      url: target,
      service: "echo.EchoService",
      method: "Unary",
      requestBody: JSON.stringify({ message: "world" }),
      callType: "UNARY",
      tls: false,
    };

    // Generic step 1: look the handler up by protocol id (no gRPC-specific branch).
    const handler = ProtocolRegistry.get(saved.protocol)!;
    expect(handler.id).toBe("grpc");

    // Generic step 2: build the payload. Attach the proto file the transport needs.
    const payload = { ...handler.buildRequest(saved), protoPath: FIXTURE };

    // Generic step 3: send via the exported transport.
    const raw = await new GrpcTransport().send(payload as any);

    // Generic step 4: normalize for the surface.
    const normalized = handler.parseResponse(raw);
    expect(normalized.statusCode).toBe(0);
    expect(normalized.json).toEqual({ message: "hi world" });
    expect(normalized.error).toBeNull();
  });
});
