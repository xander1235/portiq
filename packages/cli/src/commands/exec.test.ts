import { describe, it, expect } from "vitest";
import { buildExecRequest } from "./exec";

describe("buildExecRequest", () => {
  it("builds from curl-like flags", () => {
    const req = buildExecRequest({ url: "https://x/", method: "POST", header: ["Accept: application/json"], data: '{"a":1}' });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://x/");
    expect(req.headersRows?.[0]).toEqual({ key: "Accept", value: "application/json", comment: "", enabled: true });
    expect(req.bodyType).toBe("raw");
    expect(req.bodyText).toBe('{"a":1}');
  });

  it("defaults to POST when data is present without an explicit method", () => {
    expect(buildExecRequest({ url: "https://x/", header: [], data: "x=1" }).method).toBe("POST");
  });

  it("parses --from-curl", () => {
    const req = buildExecRequest({ header: [], fromCurl: "curl -X PUT https://x/items -H 'X-A: 1'" });
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://x/items");
    expect(req.headersRows?.some((r) => r.key === "X-A" && r.value === "1")).toBe(true);
  });

  it("throws UsageError when neither url nor --from-curl is given", () => {
    expect(() => buildExecRequest({ header: [] })).toThrow();
  });
});
