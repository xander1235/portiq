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
});
