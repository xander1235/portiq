import { describe, it, expect } from "vitest";
import { requestItemToCurl } from "../exec/toCurl";
import type { RequestItem } from "@portiq/core";

const req: RequestItem = {
  type: "request", id: "r1", name: "Create", description: "", tags: [], protocol: "http",
  method: "POST", url: "https://x/users",
  headersRows: [{ key: "Accept", value: "application/json", comment: "", enabled: true }],
  authType: "bearer",
  authConfig: { bearer: { token: "{{token}}" }, basic: { username: "", password: "" }, api_key: { key: "", value: "", add_to: "header" } },
  paramsRows: [{ key: "page", value: "2", comment: "", enabled: true }],
  bodyType: "json", bodyText: '{"a":1}',
};

describe("requestItemToCurl", () => {
  it("emits method, url with params, headers, auth, and body verbatim", () => {
    const curl = requestItemToCurl(req);
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("https://x/users?page=2");
    expect(curl).toContain("-H 'Accept: application/json'");
    expect(curl).toContain("-H 'Authorization: Bearer {{token}}'");
    expect(curl).toContain(`-d '{"a":1}'`);
  });
});
