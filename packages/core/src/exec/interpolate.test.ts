import { describe, it, expect } from "vitest";
import { getEnvVars, getSecretVars, interpolate } from "./interpolate";
import type { Environment, EnvVar } from "../model";

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

describe("getEnvVars — enabled/key edge cases (renderer parity)", () => {
  it("treats a row with enabled left undefined as enabled (matches the row-filter convention used everywhere else in the app)", () => {
    const withImplicit: Environment = {
      id: "e2", name: "Implicit",
      vars: [{ key: "implicit", value: "v", comment: "" } as unknown as EnvVar],
    };
    expect(getEnvVars(withImplicit)).toEqual({ implicit: "v" });
  });

  it("excludes a row with an empty key even when enabled", () => {
    const withEmptyKey: Environment = {
      id: "e3", name: "EmptyKey",
      vars: [{ key: "", value: "x", comment: "", enabled: true }],
    };
    expect(getEnvVars(withEmptyKey)).toEqual({});
  });
});

describe("getSecretVars", () => {
  it("includes only enabled vars marked secret with a non-empty value", () => {
    const env: Environment = {
      id: "e4", name: "Secrets",
      vars: [
        { key: "apiKey", value: "sekret", comment: "", enabled: true, secret: true },
        { key: "plain", value: "visible", comment: "", enabled: true },
        { key: "disabledSecret", value: "nope", comment: "", enabled: false, secret: true },
        { key: "emptySecret", value: "", comment: "", enabled: true, secret: true },
      ],
    };
    expect(getSecretVars(env)).toEqual({ apiKey: "sekret" });
  });

  it("treats a secret row with enabled left undefined as enabled", () => {
    const env: Environment = {
      id: "e5", name: "ImplicitSecret",
      vars: [{ key: "implicitSecret", value: "abc", comment: "", secret: true } as unknown as EnvVar],
    };
    expect(getSecretVars(env)).toEqual({ implicitSecret: "abc" });
  });

  it("returns an empty map for a null environment", () => {
    expect(getSecretVars(null)).toEqual({});
  });
});
