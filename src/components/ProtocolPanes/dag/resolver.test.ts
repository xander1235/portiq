import { describe, it, expect } from "vitest";
import { resolveTemplate, getByPath } from "./resolver";
import type { StepsContext } from "./types";

const steps: StepsContext = {
  login: { response: { status: 200, headers: { "x-token": "abc" }, data: { token: "t0", user: { id: 7 } } } },
  list: { response: { status: 200, data: { items: [{ id: 1, active: false }, { id: 2, active: true }] } } },
};
const ctx = { steps, env: { BASE_URL: "https://api.test" } };

describe("getByPath", () => {
  it("reads nested paths", () => {
    expect(getByPath(steps, "login.response.data.token")).toBe("t0");
    expect(getByPath(steps, "login.response.data.user.id")).toBe(7);
  });
  it("returns undefined for missing paths", () => {
    expect(getByPath(steps, "login.response.data.nope")).toBeUndefined();
  });
});

describe("resolveTemplate", () => {
  it("resolves a step body reference", () => {
    expect(resolveTemplate("Bearer {{steps.login.response.data.token}}", ctx)).toBe("Bearer t0");
  });
  it("resolves a header reference", () => {
    expect(resolveTemplate("{{steps.login.response.headers.x-token}}", ctx)).toBe("abc");
  });
  it("resolves env references", () => {
    expect(resolveTemplate("{{env.BASE_URL}}/v1", ctx)).toBe("https://api.test/v1");
  });
  it("resolves an expression escape", () => {
    expect(resolveTemplate("{{= steps.list.response.data.items.filter(i => i.active)[0].id }}", ctx)).toBe("2");
  });
  it("stringifies object results as JSON", () => {
    expect(resolveTemplate("{{steps.login.response.data.user}}", ctx)).toBe('{"id":7}');
  });
  it("renders missing refs as empty string", () => {
    expect(resolveTemplate("x{{steps.login.response.data.missing}}y", ctx)).toBe("xy");
  });
  it("passes through plain text", () => {
    expect(resolveTemplate("no refs here", ctx)).toBe("no refs here");
  });
});
