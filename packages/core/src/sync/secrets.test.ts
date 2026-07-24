import { describe, it, expect } from "vitest";
import {
  isSecretPlaceholder,
  parseSecretPlaceholder,
  sanitizeRequestSecrets,
  restoreRequestSecrets,
  sanitizeSensitiveRows,
} from "./secrets";

describe("secret placeholders", () => {
  it("recognizes portiq and legacy commu placeholders", () => {
    expect(isSecretPlaceholder("__PORTIQ_SECRET__:foo")).toBe(true);
    expect(isSecretPlaceholder("__COMMU_SECRET__:foo")).toBe(true);
    expect(isSecretPlaceholder("plain")).toBe(false);
  });

  it("parses the scope back out of a placeholder", () => {
    expect(parseSecretPlaceholder("__PORTIQ_SECRET__:auth:bearer:token")).toBe("auth:bearer:token");
    expect(parseSecretPlaceholder("plain")).toBeNull();
  });
});

describe("sanitize/restore round-trip", () => {
  it("masks a bearer token on sanitize and restores it from local on pull", () => {
    const local = { id: "r1", authConfig: { bearer: { token: "SECRET" }, basic: {}, api_key: {} } };
    const sanitized = sanitizeRequestSecrets(local, "request:r1");
    expect(isSecretPlaceholder(sanitized.authConfig.bearer.token)).toBe(true);

    const restored = restoreRequestSecrets(sanitized, local);
    expect(restored.authConfig.bearer.token).toBe("SECRET");
  });

  it("masks sensitive rows by key name", () => {
    const rows = [
      { key: "Authorization", value: "Bearer xyz", comment: "", enabled: true },
      { key: "X-Trace", value: "keep", comment: "", enabled: true },
    ];
    const out = sanitizeSensitiveRows(rows, "headersRows");
    expect(isSecretPlaceholder(out[0].value)).toBe(true);
    expect(out[1].value).toBe("keep");
  });
});
