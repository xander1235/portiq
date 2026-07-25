import { describe, it, expect } from "vitest";
import { buildHttpSendPayload } from "./httpSend";
import { InvalidJsonBodyError, type AssemblableRequest, type Environment } from "@portiq/core";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [{ key: "baseUrl", value: "https://api.test", comment: "", enabled: true }],
};

const base = (over: Partial<AssemblableRequest> = {}): AssemblableRequest => ({
  protocol: "http", method: "get", url: "{{baseUrl}}/users", bodyType: "none",
  ...over,
});

describe("buildHttpSendPayload", () => {
  it("delegates to core assembleRequest (url interpolated, method uppercased)", () => {
    const payload = buildHttpSendPayload(base(), { env });
    expect(payload.method).toBe("GET");
    expect(payload.url).toBe("https://api.test/users");
  });

  it("guarantees headers is always a plain object, never undefined", () => {
    const payload = buildHttpSendPayload(base(), { env });
    expect(payload.headers).toEqual({});
  });

  it("passes requestId through so cancellation can correlate the send", () => {
    const payload = buildHttpSendPayload(base(), { env, requestId: "http-abc" });
    expect(payload.requestId).toBe("http-abc");
  });

  it("propagates InvalidJsonBodyError for a malformed json body (caller maps it to UI error state)", () => {
    const req = base({ method: "post", bodyType: "json", bodyText: "{ not json" });
    expect(() => buildHttpSendPayload(req, { env })).toThrow(InvalidJsonBodyError);
  });
});
