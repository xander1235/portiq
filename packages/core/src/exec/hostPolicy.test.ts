import { describe, it, expect } from "vitest";
import { compileHostPolicy, makeHostGuard, parseHostTarget, splitHostList } from "./hostPolicy";

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

  it("treats a bare '*' as match-all, with deny still winning", () => {
    const p = compileHostPolicy(["*"], ["blocked.com"]);
    expect(p.check("https://anything.example.com/x").allowed).toBe(true);
    expect(p.check("https://blocked.com/x").allowed).toBe(false);
    expect(p.check("https://blocked.com/x").reason).toMatch(/deny-list/i);
  });

  it("matches port only when the pattern specifies one", () => {
    const p = compileHostPolicy([], ["localhost:3000"]);
    expect(p.check("http://localhost:3000/x").allowed).toBe(false);
    expect(p.check("http://localhost:4000/x").allowed).toBe(true);
  });

  it("treats an omitted port as the scheme default (default-port parity)", () => {
    const deny443 = compileHostPolicy([], ["h:443"]);
    expect(deny443.check("https://h/").allowed).toBe(false);
    expect(deny443.check("http://h/").allowed).toBe(true);
    expect(deny443.check("http://h:443/").allowed).toBe(false);

    const allow443 = compileHostPolicy(["h:443"], []);
    expect(allow443.check("https://h/").allowed).toBe(true);
    expect(allow443.check("http://h/").allowed).toBe(false);
  });

  it("parses bare gRPC-style targets (host:port) and matches patterns", () => {
    const p = compileHostPolicy([], ["localhost:50051"]);
    expect(p.check("localhost:50051").allowed).toBe(false);
    expect(p.check("localhost:50052").allowed).toBe(true);
    const allowed = compileHostPolicy(["localhost:50051"], []);
    expect(allowed.check("localhost:50051").allowed).toBe(true);
    expect(allowed.check("localhost:9999").allowed).toBe(false);
  });

  it("handles IPv6 literal targets and patterns", () => {
    const p = compileHostPolicy([], ["[::1]:50051"]);
    expect(p.check("[::1]:50051").allowed).toBe(false);
    expect(p.check("grpc://[::1]:50051").allowed).toBe(false);
    expect(p.check("[::1]:50052").allowed).toBe(true);
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

describe("parseHostTarget", () => {
  it("returns the effective default port for URLs without an explicit port", () => {
    expect(parseHostTarget("https://api.example.com/x")).toEqual({ host: "api.example.com", port: "443" });
    expect(parseHostTarget("http://api.example.com/")).toEqual({ host: "api.example.com", port: "80" });
    expect(parseHostTarget("grpc://internal:50051")).toEqual({ host: "internal", port: "50051" });
  });

  it("parses bare targets", () => {
    expect(parseHostTarget("localhost:50051")).toEqual({ host: "localhost", port: "50051" });
    expect(parseHostTarget("api.example.com")).toEqual({ host: "api.example.com", port: "" });
    expect(parseHostTarget("grpc://h")).toEqual({ host: "h", port: "80" });
  });

  it("parses IPv6 literals", () => {
    expect(parseHostTarget("[::1]:50051")).toEqual({ host: "::1", port: "50051" });
    expect(parseHostTarget("http://[::1]/")).toEqual({ host: "::1", port: "80" });
  });

  it("returns null for unparseable input", () => {
    expect(parseHostTarget("")).toBeNull();
    expect(parseHostTarget("foo:bar")).toBeNull();
    expect(parseHostTarget("http://")).toBeNull();
  });
});

describe("splitHostList", () => {
  it("splits comma-separated lists and trims", () => {
    expect(splitHostList(" a.com, b.com , c.com ")).toEqual(["a.com", "b.com", "c.com"]);
    expect(splitHostList("")).toEqual([]);
    expect(splitHostList(undefined)).toEqual([]);
  });
});
