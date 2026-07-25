import { describe, it, expect } from "vitest";
import { buildGrpcPayload, normalizeGrpcResult } from "./grpcExec";
import type { RequestItem } from "../model/request";
import type { GrpcSendResult } from "../transport/grpc";

const item = (over: Partial<RequestItem> = {}): RequestItem => ({
  type: "request", id: "g1", name: "grpc", description: "", tags: [],
  protocol: "grpc", method: "", url: "grpc://{{host}}:50051",
  grpcConfig: {
    service: "echo.EchoService", method: "Unary",
    requestBody: '{"message":"{{who}}"}',
    metadata: { "x-token": "{{tok}}" },
    callType: "UNARY", deadline: 5000, tls: false, protoContent: 'syntax="proto3";',
  },
  ...over,
});

describe("buildGrpcPayload", () => {
  it("interpolates url, body, and metadata and forwards proto content", () => {
    const p = buildGrpcPayload(item(), { host: "127.0.0.1", who: "world", tok: "abc" }, "rq-1");
    expect(p.url).toBe("grpc://127.0.0.1:50051");
    expect(p.body).toEqual({ message: "world" });
    expect(p.metadata).toEqual({ "x-token": "abc" });
    expect(p.service).toBe("echo.EchoService");
    expect(p.method).toBe("Unary");
    expect(p.callType).toBe("UNARY");
    expect(p.protoContent).toBe('syntax="proto3";');
    expect(p.requestId).toBe("rq-1");
  });

  it("defaults an empty grpcConfig to UNARY + empty body", () => {
    const p = buildGrpcPayload(item({ grpcConfig: { service: "S", method: "M" } }), {});
    expect(p.callType).toBe("UNARY");
    expect(p.body).toEqual({});
    expect(p.deadline).toBe(30000);
  });

  describe("tls resolution", () => {
    it("derives tls=false from a grpc:// url when grpcConfig.tls is undefined", () => {
      const p = buildGrpcPayload(
        item({ url: "grpc://host:1", grpcConfig: { service: "S", method: "M", tls: undefined } }),
        {}
      );
      expect(p.tls).toBe(false);
    });

    it("derives tls=true from a grpcs:// url when grpcConfig.tls is undefined", () => {
      const p = buildGrpcPayload(
        item({ url: "grpcs://host:1", grpcConfig: { service: "S", method: "M", tls: undefined } }),
        {}
      );
      expect(p.tls).toBe(true);
    });

    it("respects an explicit tls:false even against a grpcs:// url", () => {
      const p = buildGrpcPayload(
        item({ url: "grpcs://host:1", grpcConfig: { service: "S", method: "M", tls: false } }),
        {}
      );
      expect(p.tls).toBe(false);
    });

    it("respects an explicit tls:true even against a grpc:// url", () => {
      const p = buildGrpcPayload(
        item({ url: "grpc://host:1", grpcConfig: { service: "S", method: "M", tls: true } }),
        {}
      );
      expect(p.tls).toBe(true);
    });
  });
});

describe("normalizeGrpcResult", () => {
  const raw: GrpcSendResult = {
    statusCode: 0, statusMessage: "OK", duration: 12,
    metadata: { a: "1" }, trailers: { b: "2" },
    body: '{"message":"hi"}', json: { message: "hi" }, error: null, messages: [],
  };
  it("maps a unary result (streamed=false)", () => {
    const n = normalizeGrpcResult(raw, "UNARY");
    expect(n.protocol).toBe("grpc");
    expect(n.streamed).toBe(false);
    expect(n.json).toEqual({ message: "hi" });
    expect(n.statusCode).toBe(0);
    expect(n.callType).toBe("UNARY");
  });
  it("maps a streamed result (streamed=true, messages carried)", () => {
    const n = normalizeGrpcResult({ ...raw, json: null, messages: [{ n: 1 }, { n: 2 }] }, "SERVER_STREAM");
    expect(n.streamed).toBe(true);
    expect(n.messages).toHaveLength(2);
    expect(n.json).toBeNull();
  });
});

describe("buildGrpcPayload advanced fields", () => {
  it("parses messages (JSON strings) and forwards reflection + auth", () => {
    const p = buildGrpcPayload(item({
      grpcConfig: {
        service: "S", method: "M", callType: "CLIENT_STREAM",
        messages: ['{"message":"a"}', '{"message":"b"}'],
        useReflection: true,
        tlsConfig: { rootCertsPem: "CA" },
        callToken: "tok",
      },
    }), {});
    expect(p.messages).toEqual([{ message: "a" }, { message: "b" }]);
    expect(p.useReflection).toBe(true);
    expect(p.tlsConfig).toEqual({ rootCertsPem: "CA" });
    expect(p.callToken).toBe("tok");
  });
});
