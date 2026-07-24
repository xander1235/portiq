import { describe, it, expect } from "vitest";
import { resolveHttpPayload, stripJsonComments, type ResolvableRequest } from "./httpPayload";
import { UsageError } from "../errors";

const vars = { baseUrl: "https://api.test", token: "abc" };

describe("resolveHttpPayload", () => {
  it("interpolates the url and merges auth + table headers", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "GET", url: "{{baseUrl}}/users",
      headersRows: [{ key: "X-Trace", value: "1", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
      paramsRows: [{ key: "page", value: "2", comment: "", enabled: true }],
      bodyType: "none",
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.url).toBe("https://api.test/users?page=2");
    expect(payload.headers?.Authorization).toBe("Bearer abc");
    expect(payload.headers?.["X-Trace"]).toBe("1");
    expect(payload.body).toBeUndefined();
  });

  it("adds api_key auth to the query when configured", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "GET", url: "https://x/",
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "k", value: "{{token}}", add_to: "query" } },
      bodyType: "none",
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.url).toBe("https://x/?k=abc");
  });

  it("compacts a json body and sets it", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "POST", url: "https://x/",
      bodyType: "json", bodyText: '{\n  "a": "{{token}}" // note\n}',
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.body).toBe('{"a":"abc"}');
  });

  it("throws UsageError on invalid json body", () => {
    const req: ResolvableRequest = { protocol: "http", method: "POST", url: "https://x/", bodyType: "json", bodyText: "{ not json" };
    expect(() => resolveHttpPayload(req, vars)).toThrow(UsageError);
  });

  it("builds a form body", () => {
    const req: ResolvableRequest = {
      protocol: "http", method: "POST", url: "https://x/",
      bodyType: "form", bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
    };
    const { payload } = resolveHttpPayload(req, vars);
    expect(payload.body).toBe("a=1&b=abc");
  });
});

describe("stripJsonComments", () => {
  it("removes // and /* */ comments", () => {
    expect(stripJsonComments('{"a":1} // x')).toContain('{"a":1}');
    expect(stripJsonComments("{/* c */}")).toBe("{}");
  });
});
