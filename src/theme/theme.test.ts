import { describe, it, expect } from "vitest";
import { resolveTheme, resolvePreference, themeForPreference } from "./theme";

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

describe("resolvePreference", () => {
  it("defaults to system when nothing stored", () => {
    expect(resolvePreference(null)).toBe("system");
  });
  it("preserves explicit light/dark preferences", () => {
    expect(resolvePreference("light")).toBe("light");
    expect(resolvePreference("dark")).toBe("dark");
  });
  it("recognizes an explicit system preference", () => {
    expect(resolvePreference("system")).toBe("system");
  });
  it("falls back to system for invalid values", () => {
    expect(resolvePreference("purple")).toBe("system");
  });
});

describe("themeForPreference", () => {
  it("follows the OS when preference is system", () => {
    expect(themeForPreference("system", true)).toBe("light");
    expect(themeForPreference("system", false)).toBe("dark");
  });
  it("overrides the OS when preference is explicit", () => {
    expect(themeForPreference("dark", true)).toBe("dark");
    expect(themeForPreference("light", false)).toBe("light");
  });
});
