import { describe, it, expect } from "vitest";
import { getEnvVars, interpolate } from "./interpolate";
import type { Environment } from "../model";

const env: Environment = {
  id: "e1", name: "Local",
  vars: [
    { key: "baseUrl", value: "https://api.test", comment: "", enabled: true },
    { key: "token", value: "abc", comment: "", enabled: true },
    { key: "disabled", value: "nope", comment: "", enabled: false },
  ],
};

describe("interpolation", () => {
  it("reduces enabled env vars to a map", () => {
    expect(getEnvVars(env)).toEqual({ baseUrl: "https://api.test", token: "abc" });
  });

  it("substitutes {{var}} tokens", () => {
    expect(interpolate("{{baseUrl}}/users?t={{token}}", getEnvVars(env)))
      .toBe("https://api.test/users?t=abc");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(interpolate("x={{missing}}", getEnvVars(env))).toBe("x=");
  });

  it("passes non-strings through unchanged", () => {
    expect(interpolate(42 as unknown as string, {})).toBe(42);
  });
});
