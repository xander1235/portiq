import { describe, it, expect } from "vitest";
import {
  assembleRequest,
  resolveVars,
  stripJsonComments,
  findJsonCommentRanges,
  InvalidJsonBodyError,
  type AssemblableRequest,
} from "./assembleRequest";
import type { Environment } from "../model";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [
    { key: "baseUrl", value: "https://api.test", comment: "", enabled: true },
    { key: "token", value: "sekret", comment: "", enabled: true },
    { key: "disabled", value: "nope", comment: "", enabled: false },
  ],
};

const base = (over: Partial<AssemblableRequest> = {}): AssemblableRequest => ({
  protocol: "http", method: "get", url: "{{baseUrl}}/users", bodyType: "none",
  ...over,
});

describe("resolveVars", () => {
  it("overlays overrides on enabled env vars", () => {
    expect(resolveVars(env, { token: "override" }))
      .toEqual({ baseUrl: "https://api.test", token: "override" });
  });
  it("returns overrides only when env is null", () => {
    expect(resolveVars(null, { a: "1" })).toEqual({ a: "1" });
  });
});

describe("stripJsonComments", () => {
  it("removes // and /* */ comments outside strings", () => {
    expect(stripJsonComments('{"a":1} // x')).toContain('{"a":1}');
    expect(stripJsonComments("{/* c */}")).toBe("{}");
  });

  it("preserves // and /* text inside string values (URLs, paths)", () => {
    const body = JSON.stringify({
      callback: "https://api.example.com/cb?a=1//2",
      path: "C:\\foo\\bar",
      note: "not a /* comment */",
    });
    expect(stripJsonComments(body)).toBe(body);
    // And the result must still be valid JSON.
    expect(JSON.parse(stripJsonComments(body))).toEqual({
      callback: "https://api.example.com/cb?a=1//2",
      path: "C:\\foo\\bar",
      note: "not a /* comment */",
    });
  });

  it("handles string escapes so a \\\" or \\\\ does not close the string", () => {
    const body = '"say \\"hi\\" // still string" // real comment';
    expect(stripJsonComments(body)).toBe('"say \\"hi\\" // still string" ');
  });

  it("strips real comments even when surrounded by comment-y strings", () => {
    const out = stripJsonComments('{"url": "https://x.com/a"} /* tail */');
    expect(out).toBe('{"url": "https://x.com/a"} ');
    expect(JSON.parse(out)).toEqual({ url: "https://x.com/a" });
  });

  it("handles an unterminated block comment and a trailing line comment", () => {
    expect(stripJsonComments('{"a":1} /* open')).toBe('{"a":1} ');
    expect(stripJsonComments('{"a":1} // last')).toBe('{"a":1} ');
  });
});

describe("findJsonCommentRanges", () => {
  it("returns line and block comment ranges outside strings", () => {
    const text = '{"a":1} // x\n{"b":2} /* c */';
    expect(findJsonCommentRanges(text)).toEqual([
      { from: 8, to: 12 },
      { from: 21, to: 28 },
    ]);
  });

  it("excludes the newline from line-comment ranges", () => {
    const text = '{"a":1} // x\n{"b":2}';
    expect(findJsonCommentRanges(text)).toEqual([{ from: 8, to: 12 }]);
    expect(text.slice(8, 12)).toBe("// x");
  });

  it("ignores comment-looking text inside strings", () => {
    const text = '{"url": "https://x.com/a//b", "note": "/* nope */"}';
    expect(findJsonCommentRanges(text)).toEqual([]);
  });

  it("covers an unterminated block comment to the end of input", () => {
    const text = '{"a":1} /* open';
    expect(findJsonCommentRanges(text)).toEqual([{ from: 8, to: 15 }]);
  });
});

describe("assembleRequest", () => {
  it("interpolates the url and uppercases the method", () => {
    const p = assembleRequest(base(), { env });
    expect(p.method).toBe("GET");
    expect(p.url).toBe("https://api.test/users");
    expect(p.httpVersion).toBe("auto");
  });

  it("compiles bearer auth into an Authorization header (value interpolated)", () => {
    const p = assembleRequest(base({
      authType: "bearer",
      authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
    }), { env });
    expect(p.headers?.Authorization).toBe("Bearer sekret");
  });

  it("appends api_key query auth to the url", () => {
    const p = assembleRequest(base({
      authType: "api_key",
      authConfig: { bearer: { token: "" }, basic: { username: "", password: "" }, api_key: { key: "k", value: "{{token}}", add_to: "query" } },
    }), { env });
    expect(p.url).toBe("https://api.test/users?k=sekret");
  });

  it("lets manual headers win over auth headers (headersText JSON precedence)", () => {
    const p = assembleRequest(base({
      headersText: '{"Authorization":"manual"}',
      headersRows: [{ key: "X-Ignored", value: "1", comment: "", enabled: true }],
      authType: "bearer",
      authConfig: { bearer: { token: "x" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
    }), { env });
    expect(p.headers?.Authorization).toBe("manual");
    expect(p.headers?.["X-Ignored"]).toBeUndefined(); // headersText wins, rows ignored
  });

  it("uses table rows when headersText is empty (keys raw, values interpolated)", () => {
    const p = assembleRequest(base({
      headersRows: [{ key: "X-Token", value: "{{token}}", comment: "", enabled: true }],
    }), { env });
    expect(p.headers?.["X-Token"]).toBe("sekret");
  });

  it("compacts a json body, stripping comments", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "json", bodyText: '{\n  "a": "{{token}}" // note\n}',
    }), { env });
    expect(p.body).toBe('{"a":"sekret"}');
  });

  it("throws InvalidJsonBodyError on a malformed json body", () => {
    expect(() => assembleRequest(base({ method: "POST", bodyType: "json", bodyText: "{ not json" }), { env }))
      .toThrow(InvalidJsonBodyError);
  });

  it("builds a form body with URLSearchParams", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "form",
      bodyRows: [{ key: "a", value: "1", comment: "", enabled: true }, { key: "b", value: "{{token}}", comment: "", enabled: true }],
    }), { env });
    expect(p.body).toBe("a=1&b=sekret");
  });

  it("builds multipart parts and leaves body undefined", () => {
    const p = assembleRequest(base({
      method: "POST", bodyType: "multipart",
      bodyRows: [{ key: "field", value: "{{token}}", comment: "", enabled: true, kind: "text" }],
    }), { env });
    expect(p.multipartParts).toEqual([{ kind: "text", name: "field", value: "sekret" }]);
    expect(p.body).toBeUndefined();
  });

  it("encodes spaces in query params as %20 (not +) and fixes a missing host:port slash", () => {
    const p = assembleRequest(base({
      url: "https://api.test:8080users",
      paramsRows: [{ key: "q", value: "a b", comment: "", enabled: true }],
    }), { env });
    expect(p.url).toBe("https://api.test:8080/users?q=a%20b");
  });

  it("carries requestId, timeoutMs override and httpVersion through", () => {
    const p = assembleRequest(base({ requestTimeoutMs: 5000, httpVersion: "2" }), { env, requestId: "abc", timeoutMs: 9000 });
    expect(p.requestId).toBe("abc");
    expect(p.timeoutMs).toBe(9000);
    expect(p.httpVersion).toBe("2");
  });
});
