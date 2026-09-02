import { describe, it, expect } from "vitest";
import { selectReporter, JsonReporter, JunitReporter, PrettyReporter } from "./index";
import { testSummaryToJUnit } from "./junit";
import type { CommandOutput } from "./types";
import type { TestSummary, NormalizedGrpcResponse } from "@portiq/core";

const summary: TestSummary = {
  passed: 1, failed: 1, errored: 0, duration: 12,
  groups: [{
    name: "status", passed: 1, failed: 1, errored: 0, duration: 12,
    entries: [
      { type: "pass", text: "is 200", label: "post", group: "status", duration: 5 },
      { type: "fail", text: "has token", label: "post", group: "status", duration: 7, errorType: "Error", errorMessage: "missing" },
    ],
  }],
  console: [],
};

describe("selectReporter", () => {
  it("defaults to json when not a TTY", () => {
    expect(selectReporter({ isTTY: false, color: false })).toBeInstanceOf(JsonReporter);
  });
  it("honors an explicit junit choice", () => {
    expect(selectReporter({ reporter: "junit", isTTY: true, color: false })).toBeInstanceOf(JunitReporter);
  });
});

describe("JsonReporter", () => {
  it("serializes a table output to parseable JSON", () => {
    const out: CommandOutput = { kind: "table", columns: ["a"], rows: [["1"]] };
    const parsed = JSON.parse(new JsonReporter().write(out));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows[0][0]).toBe("1");
  });

  it("redacts sensitive headers in request and response", () => {
    const out: CommandOutput = {
      kind: "execution",
      request: { protocol: "http", method: "GET", url: "https://x/", headers: { Authorization: "Bearer sekret", Cookie: "a=b", "X-Keep": "1" } },
      response: {
        status: 200, statusText: "OK", time: 1, duration: 1, httpVersion: "auto",
        headers: { "set-cookie": "sid=abc", "content-type": "application/json" },
        body: "{}", json: {},
      },
      error: null, tests: null,
    };
    const parsed = JSON.parse(new JsonReporter().write(out));
    expect(parsed.request.headers.Authorization).toBe("<REDACTED>");
    expect(parsed.request.headers.Cookie).toBe("<REDACTED>");
    expect(parsed.request.headers["X-Keep"]).toBe("1");
    expect(parsed.response.headers["set-cookie"]).toBe("<REDACTED>");
  });

  it("redacts headers inside suite items", () => {
    const out: CommandOutput = {
      kind: "suite",
      label: "API",
      items: [{ name: "Get", response: {
        status: 200, statusText: "OK", time: 1, duration: 1, httpVersion: "auto",
        headers: { "x-api-key": "abc123" }, body: "{}", json: {},
      }, error: null }],
      tests: { passed: 1, failed: 0, errored: 0, duration: 1, groups: [], console: [] },
    };
    const parsed = JSON.parse(new JsonReporter().write(out));
    expect(parsed.items[0].response.headers["x-api-key"]).toBe("<REDACTED>");
  });
});

describe("testSummaryToJUnit", () => {
  it("emits a testsuite with a failure element", () => {
    const xml = testSummaryToJUnit(summary, "run");
    expect(xml).toContain('<testsuites tests="2" failures="1" errors="0"');
    expect(xml).toContain('name="has token"');
    expect(xml).toContain("<failure");
  });

  it("strips XML-invalid control characters from text", () => {
    const xml = testSummaryToJUnit(
      { ...summary, groups: [{ ...summary.groups[0], entries: [{ type: "fail", text: "bad\x01char\x7f", label: "post", group: "status", duration: 1, errorMessage: "err\x02" }] }] },
      "run"
    );
    expect(xml).not.toContain("\x01");
    expect(xml).not.toContain("\x7f");
    expect(xml).not.toContain("\x02");
  });
});

const grpcResp: NormalizedGrpcResponse = {
  protocol: "grpc", callType: "SERVER_STREAM", statusCode: 0, statusMessage: "OK", duration: 9,
  metadata: {}, trailers: {}, messages: [{ n: 1 }, { n: 2 }], json: null, body: "[]", streamed: true, error: null,
};

describe("PrettyReporter gRPC", () => {
  it("renders a streamed gRPC response with status, call type, and message count", () => {
    const out = new PrettyReporter(false).write({
      kind: "execution",
      request: { protocol: "grpc", method: "SERVER_STREAM", url: "grpc://x", headers: {} },
      response: null, error: null, tests: null, grpc: grpcResp,
    });
    expect(out).toContain("SERVER_STREAM grpc://x");
    expect(out).toContain("OK");
    expect(out).toContain("2 messages");
  });

  it("renders a gRPC error status", () => {
    const out = new PrettyReporter(false).write({
      kind: "execution",
      request: { protocol: "grpc", method: "UNARY", url: "grpc://x", headers: {} },
      response: null, error: "nope", tests: null,
      grpc: { ...grpcResp, callType: "UNARY", statusCode: 5, statusMessage: "NOT_FOUND", messages: [], streamed: false, error: "nope" },
    });
    expect(out).toContain("NOT_FOUND");
    expect(out).toContain("nope");
  });
});

describe("JsonReporter gRPC", () => {
  it("serializes the grpc field", () => {
    const parsed = JSON.parse(new JsonReporter().write({
      kind: "execution",
      request: { protocol: "grpc", method: "UNARY", url: "grpc://x", headers: {} },
      response: null, error: null, tests: null, grpc: grpcResp,
    }));
    expect(parsed.grpc.streamed).toBe(true);
    expect(parsed.grpc.messages).toHaveLength(2);
  });
});
