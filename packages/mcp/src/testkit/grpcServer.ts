import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ECHO_PROTO = `syntax = "proto3";
package echo;
message EchoRequest { string message = 1; }
message EchoReply { string message = 1; }
service EchoService {
  rpc Unary (EchoRequest) returns (EchoReply);
  rpc ServerStream (EchoRequest) returns (stream EchoReply);
  rpc ClientStream (stream EchoRequest) returns (EchoReply);
}`;

export interface GrpcTestServer {
  target: string;
  protoContent: string;
  close: () => Promise<void>;
}

/** Start an in-process echo gRPC server on an ephemeral port. */
export function startEchoGrpcServer(): Promise<GrpcTestServer> {
  const dir = mkdtempSync(join(tmpdir(), "mcp-grpc-"));
  const file = join(dir, "echo.proto");
  writeFileSync(file, ECHO_PROTO, "utf8");
  const def = protoLoader.loadSync(file, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const server = new grpc.Server();
  server.addService(pkg.echo.EchoService.service, {
    Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }),
    ServerStream: (call: any) => {
      for (let i = 0; i < 3; i++) call.write({ message: "chunk-" + i });
      call.end();
    },
    ClientStream: (call: any, cb: any) => {
      const parts: string[] = [];
      call.on("data", (m: any) => parts.push(m.message));
      call.on("end", () => cb(null, { message: "got:" + parts.join(",") }));
    },
  });
  return new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      resolve({
        target: `127.0.0.1:${port}`,
        protoContent: ECHO_PROTO,
        close: () => new Promise<void>((r) => server.tryShutdown(() => r())),
      });
    });
  });
}
