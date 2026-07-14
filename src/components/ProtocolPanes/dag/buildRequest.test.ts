import { describe, it, expect } from "vitest";
import { buildSendPayload } from "./buildRequest";
import type { RequestConfig } from "./types";

const ctx = { steps: { login: { response: { data: { token: "T", id: 9 } } } }, env: { HOST: "https://h" } };

function cfg(over: Partial<RequestConfig>): RequestConfig {
  return { method: "GET", url: "", headers: "", body: "", params: "", pathVars: "", ...over };
}

describe("buildSendPayload", () => {
  it("resolves url + host env and substitutes path vars", () => {
    const p = buildSendPayload(cfg({
      method: "GET", url: "{{env.HOST}}/users/{id}", pathVars: "id={{steps.login.response.data.id}}",
    }), ctx as any);
    expect(p.url).toBe("https://h/users/9");
  });
  it("injects a resolved header", () => {
    const p = buildSendPayload(cfg({ headers: '{"Authorization":"Bearer {{steps.login.response.data.token}}"}' }), ctx as any);
    expect(p.headers.Authorization).toBe("Bearer T");
  });
  it("appends query params", () => {
    const p = buildSendPayload(cfg({ url: "https://h/s", params: "q=hello\nlimit=5" }), ctx as any);
    expect(p.url).toBe("https://h/s?q=hello&limit=5");
  });
  it("resolves body references", () => {
    const p = buildSendPayload(cfg({ method: "POST", body: '{"t":"{{steps.login.response.data.token}}"}' }), ctx as any);
    expect(p.body).toBe('{"t":"T"}');
  });
  it("omits body for GET", () => {
    const p = buildSendPayload(cfg({ method: "GET", body: "x" }), ctx as any);
    expect(p.body).toBeUndefined();
  });
  it("falls back to empty headers on invalid JSON without throwing", () => {
    expect(() => buildSendPayload(cfg({ headers: "not json{" }), ctx as any)).not.toThrow();
    const p = buildSendPayload(cfg({ headers: "not json{" }), ctx as any);
    expect(p.headers).toEqual({});
  });
  it("url-encodes query param values", () => {
    const p = buildSendPayload(cfg({ url: "https://h/s", params: "q=a b&c" }), ctx as any);
    expect(p.url).toContain("q=a%20b%26c");
  });
  it("substitutes :key style path vars", () => {
    const p = buildSendPayload(cfg({ url: "https://h/users/:id", pathVars: "id=42" }), ctx as any);
    expect(p.url).toBe("https://h/users/42");
  });
  it("uppercases a lowercase method", () => {
    const p = buildSendPayload(cfg({ method: "post", body: "x" }), ctx as any);
    expect(p.method).toBe("POST");
    expect(p.body).toBeDefined();
  });
});
