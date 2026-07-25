import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import { loadProtoViaReflection } from "./grpcReflection";
import { findService } from "./grpcProto";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "echo.proto");

let server: grpc.Server | null = null;

function startReflectiveServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const def = protoLoader.loadSync(FIXTURE, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, { Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }) });
    new ReflectionService(def).addToServer(server);
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve(`127.0.0.1:${port}`);
    });
  });
}
afterEach(() => { server?.forceShutdown(); server = null; });

describe("loadProtoViaReflection", () => {
  it("resolves a service descriptor from a reflection endpoint", async () => {
    const target = await startReflectiveServer();
    const pkg = await loadProtoViaReflection(target, grpc.credentials.createInsecure(), "echo.EchoService");
    const ctor = findService(pkg, "echo.EchoService");
    expect(typeof ctor.service).toBe("object");
  });
});
