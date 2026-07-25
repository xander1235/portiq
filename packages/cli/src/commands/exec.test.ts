import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Writable } from "node:stream";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExecRequest, execCommand } from "./exec";
import { buildProgram } from "../registry";
import type { CliContext } from "../context";

describe("buildExecRequest", () => {
  it("builds from curl-like flags", () => {
    const req = buildExecRequest({ url: "https://x/", method: "POST", header: ["Accept: application/json"], data: '{"a":1}' });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://x/");
    expect(req.headersRows?.[0]).toEqual({ key: "Accept", value: "application/json", comment: "", enabled: true });
    expect(req.bodyType).toBe("raw");
    expect(req.bodyText).toBe('{"a":1}');
  });

  it("defaults to POST when data is present without an explicit method", () => {
    expect(buildExecRequest({ url: "https://x/", header: [], data: "x=1" }).method).toBe("POST");
  });

  it("parses --from-curl", () => {
    const req = buildExecRequest({ header: [], fromCurl: "curl -X PUT https://x/items -H 'X-A: 1'" });
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://x/items");
    expect(req.headersRows?.some((r) => r.key === "X-A" && r.value === "1")).toBe(true);
  });

  it("throws UsageError when neither url nor --from-curl is given", () => {
    expect(() => buildExecRequest({ header: [] })).toThrow();
  });
});

function run(args: string[]): Promise<{ out: string; code: number | undefined }> {
  let buf = "";
  const sink = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  const ctx: CliContext = { argv: [], env: {}, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const prev = process.exitCode;
  process.exitCode = undefined;
  return buildProgram(ctx, [execCommand]).parseAsync(args, { from: "user" })
    .then(() => ({ out: buf, code: process.exitCode as number | undefined }))
    .catch((e) => { throw e; })
    .finally(() => { const c = process.exitCode; process.exitCode = prev; void c; });
}

describe("exec gRPC", () => {
  let server: grpc.Server;
  let target: string;
  let protoFile: string;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-grpc-"));
    protoFile = join(dir, "echo.proto");
    writeFileSync(protoFile, `syntax="proto3";package echo;message EchoRequest{string message=1;}message EchoReply{string message=1;}service EchoService{rpc Unary(EchoRequest)returns(EchoReply);}`, "utf8");
    const def = protoLoader.loadSync(protoFile, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as any;
    server = new grpc.Server();
    server.addService(pkg.echo.EchoService.service, { Unary: (call: any, cb: any) => cb(null, { message: "hi " + call.request.message }) });
    target = await new Promise<string>((res, rej) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => e ? rej(e) : res(`grpc://127.0.0.1:${p}`)));
  });
  afterAll(() => { server.forceShutdown(); });

  it("runs a unary gRPC exec and prints the decoded json", async () => {
    const { out } = await run(["exec", target, "--grpc", "--service", "echo.EchoService", "-X", "Unary", "--proto", protoFile, "-d", '{"message":"cli"}', "--reporter", "json"]);
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("execution");
    expect(parsed.grpc.statusCode).toBe(0);
    expect(parsed.grpc.json).toEqual({ message: "hi cli" });
  });
});
