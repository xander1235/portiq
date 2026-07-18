import { describe, it, expect } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("honors a stored dark preference over OS", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
  });
  it("honors a stored light preference over OS", () => {
    expect(resolveTheme("light", false)).toBe("light");
  });
  it("falls back to OS light when nothing stored", () => {
    expect(resolveTheme(null, true)).toBe("light");
  });
  it("falls back to OS dark when nothing stored", () => {
    expect(resolveTheme(null, false)).toBe("dark");
  });
  it("ignores an invalid stored value and uses OS", () => {
    expect(resolveTheme("purple", true)).toBe("light");
  });
});
