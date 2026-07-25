import { describe, it, expect } from "vitest";
import { compileHostPolicy, makeHostGuard } from "./hostPolicy";

describe("compileHostPolicy", () => {
  it("allows any host when both lists are empty", () => {
    expect(compileHostPolicy([], []).check("https://anything.example.com/x").allowed).toBe(true);
  });

  it("deny-list blocks matching hosts even if allow-listed (deny wins)", () => {
    const p = compileHostPolicy(["api.example.com"], ["api.example.com"]);
    const r = p.check("https://api.example.com/users");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/deny-list/i);
  });

  it("non-empty allow-list default-denies unlisted hosts", () => {
    const p = compileHostPolicy(["api.example.com"], []);
    expect(p.check("https://api.example.com/x").allowed).toBe(true);
    const r = p.check("https://evil.test/x");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/allow-list/i);
  });

  it("supports wildcard subdomains", () => {
    const p = compileHostPolicy(["*.example.com"], []);
    expect(p.check("https://a.example.com/x").allowed).toBe(true);
    expect(p.check("https://example.com/x").allowed).toBe(true);
    expect(p.check("https://other.test/x").allowed).toBe(false);
  });

  it("matches port only when the pattern specifies one", () => {
    const p = compileHostPolicy([], ["localhost:3000"]);
    expect(p.check("http://localhost:3000/x").allowed).toBe(false);
    expect(p.check("http://localhost:4000/x").allowed).toBe(true);
  });

  it("denies unparseable targets only when an allow-list is active", () => {
    expect(compileHostPolicy(["a.com"], []).check("not a url").allowed).toBe(false);
    expect(compileHostPolicy([], []).check("not a url").allowed).toBe(true);
  });
});

describe("makeHostGuard", () => {
  it("throws with the deny reason", () => {
    const guard = makeHostGuard(compileHostPolicy([], ["api.example.com"]));
    expect(() => guard("https://api.example.com/x")).toThrow(/deny-list/i);
  });

  it("does not throw for allowed hosts", () => {
    const guard = makeHostGuard(compileHostPolicy([], []));
    expect(() => guard("https://ok.test/x")).not.toThrow();
  });
});
