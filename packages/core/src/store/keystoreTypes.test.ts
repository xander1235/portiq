import { describe, it, expect } from "vitest";
import { ENC_PREFIX, isEncrypted, tagCipher, untagCipher } from "./keystoreTypes";

describe("keystore tagging", () => {
  it("tags and detects encrypted values", () => {
    const tagged = tagCipher("YWJj");
    expect(tagged).toBe(`${ENC_PREFIX}YWJj`);
    expect(isEncrypted(tagged)).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it("untags a tagged value and rejects an untagged one", () => {
    expect(untagCipher(`${ENC_PREFIX}YWJj`)).toBe("YWJj");
    expect(() => untagCipher("plain")).toThrow(/not encrypted/i);
  });
});
