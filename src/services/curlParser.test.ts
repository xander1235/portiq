import { describe, it, expect } from "vitest";
import {
  looksLikeCurl,
  parseCurl,
  inferRequestNameFromUrl,
  collectTemplateVars,
  findParameterizableVars,
  parameterizeParsedCurl,
} from "./curlParser";

describe("looksLikeCurl", () => {
  it("detects a curl command", () => {
    expect(looksLikeCurl("curl https://x.com")).toBe(true);
    expect(looksLikeCurl("  curl -X POST https://x.com  ")).toBe(true);
  });
  it("rejects non-curl text", () => {
    expect(looksLikeCurl("https://x.com")).toBe(false);
    expect(looksLikeCurl('{"a":1}')).toBe(false);
    expect(looksLikeCurl("curly braces")).toBe(false);
    expect(looksLikeCurl("")).toBe(false);
  });
});

describe("parseCurl", () => {
  it("parses a bare URL as GET", () => {
    const r = parseCurl("curl https://api.example.com/users");
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("throws when there is no URL", () => {
    expect(() => parseCurl("curl -X POST")).toThrow();
  });

  it("throws when not a curl command", () => {
    expect(() => parseCurl("wget https://x.com")).toThrow();
  });

  it("parses method, header and JSON body", () => {
    const r = parseCurl(
      `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"a"}'`
    );
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("json");
    expect(r.bodyText).toBe('{"name":"a"}');
    expect(r.headersRows.find((h) => h.key === "Content-Type")?.value).toBe("application/json");
  });

  it("infers POST when data present without -X", () => {
    const r = parseCurl(`curl https://x.com -d 'a=1'`);
    expect(r.method).toBe("POST");
  });

  it("parses multiple headers", () => {
    const r = parseCurl(`curl https://x.com -H 'A: 1' -H 'B: 2'`);
    expect(r.headersRows.find((h) => h.key === "A")?.value).toBe("1");
    expect(r.headersRows.find((h) => h.key === "B")?.value).toBe("2");
  });

  it("parses x-www-form-urlencoded body into rows", () => {
    const r = parseCurl(
      `curl -X POST https://x.com -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2'`
    );
    expect(r.bodyType).toBe("form");
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("parses -F multipart form into rows", () => {
    const r = parseCurl(`curl -X POST https://x.com -F a=1 -F b=2`);
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("multipart");
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("extracts basic auth from -u into authConfig and drops the header", () => {
    const r = parseCurl(`curl https://x.com -u alice:secret`);
    expect(r.authType).toBe("basic");
    expect(r.authConfig.basic).toEqual({ username: "alice", password: "secret" });
    expect(r.headersRows.find((h) => h.key.toLowerCase() === "authorization")).toBeUndefined();
  });

  it("extracts Bearer auth from an Authorization header", () => {
    const r = parseCurl(`curl https://x.com -H 'Authorization: Bearer tok123'`);
    expect(r.authType).toBe("bearer");
    expect(r.authConfig.bearer.token).toBe("tok123");
    expect(r.headersRows.find((h) => h.key.toLowerCase() === "authorization")).toBeUndefined();
  });

  it("maps -b/--cookie to a Cookie header", () => {
    const r = parseCurl(`curl https://x.com -b 'sid=abc'`);
    expect(r.headersRows.find((h) => h.key === "Cookie")?.value).toBe("sid=abc");
  });

  it("moves -G data into query params and keeps GET", () => {
    const r = parseCurl(`curl -G https://x.com/search -d q=1 -d r=2`);
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://x.com/search");
    expect(r.paramsRows.map((row) => [row.key, row.value])).toEqual([["q", "1"], ["r", "2"]]);
  });

  it("splits an inline query string into paramsRows", () => {
    const r = parseCurl(`curl 'https://x.com/search?a=1&b=2'`);
    expect(r.url).toBe("https://x.com/search");
    expect(r.paramsRows.map((row) => [row.key, row.value])).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("handles backslash line continuations", () => {
    const r = parseCurl("curl https://x.com \\\n  -H 'A: 1' \\\n  -d 'x=1'");
    expect(r.method).toBe("POST");
    expect(r.headersRows.find((h) => h.key === "A")?.value).toBe("1");
  });

  it("keeps -d @file as a raw body placeholder", () => {
    const r = parseCurl("curl -X POST https://x.com -d @payload.json");
    expect(r.bodyType).toBe("raw");
    expect(r.bodyText).toBe("@payload.json");
  });

  it("keeps -F field=@file as a multipart file-row placeholder", () => {
    const r = parseCurl("curl -X POST https://x.com -F file=@logo.png");
    expect(r.bodyType).toBe("multipart");
    const row = r.bodyRows.find((b) => b.key === "file");
    expect(row?.kind).toBe("file");
    expect(row?.fileName).toBe("logo.png");
  });

  it("preserves {{template}} vars in the URL path when a query string is present", () => {
    const r = parseCurl("curl 'https://x.com/{{id}}?a=1'");
    expect(r.url).toBe("https://x.com/{{id}}");
    expect(r.paramsRows.map((row) => [row.key, row.value])).toEqual([["a", "1"]]);
  });

  it("keeps '=' inside a multipart field value", () => {
    const r = parseCurl("curl -X POST https://x.com -F 'token=dG9rZW4='");
    const row = r.bodyRows.find((b) => b.key === "token");
    expect(row?.value).toBe("dG9rZW4=");
  });

  it("keeps '=' inside a urlencoded body value", () => {
    const r = parseCurl(
      `curl -X POST https://x.com -H 'Content-Type: application/x-www-form-urlencoded' -d 'q=a=b'`
    );
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["q", "a=b"]]);
  });

  it("keeps '=' inside a --data=VALUE form value", () => {
    const r = parseCurl("curl -X POST https://x.com --data=q=a=b");
    expect(r.bodyRows.map((row) => [row.key, row.value])).toEqual([["q", "a=b"]]);
  });
});

describe("inferRequestNameFromUrl", () => {
  it("uses the last path segment", () => {
    expect(inferRequestNameFromUrl("https://x.com/api/users")).toBe("users");
  });
  it("falls back to hostname when path is empty", () => {
    expect(inferRequestNameFromUrl("https://x.com")).toBe("x.com");
  });
});

describe("collectTemplateVars", () => {
  it("finds template vars across url, headers and body", () => {
    const r = parseCurl(
      `curl 'https://x.com/{{id}}' -H 'Authorization: Bearer {{token}}' -d '{{payload}}'`
    );
    const vars = collectTemplateVars(r).sort();
    expect(vars).toEqual(["id", "payload", "token"]);
  });
  it("returns an empty array when there are no template vars", () => {
    expect(collectTemplateVars(parseCurl("curl https://x.com"))).toEqual([]);
  });
});

describe("findParameterizableVars", () => {
  it("returns env vars whose value appears literally in the request", () => {
    const r = parseCurl("curl https://api.example.com/users");
    const found = findParameterizableVars(r, {
      baseUrl: "https://api.example.com",
      unused: "nope-not-here",
      blank: "",
    });
    expect(found).toEqual([{ name: "baseUrl", value: "https://api.example.com" }]);
  });
});

describe("parameterizeParsedCurl", () => {
  it("replaces a literal with a {{var}} reference in the url", () => {
    const r = parseCurl("curl https://api.example.com/users");
    const out = parameterizeParsedCurl(r, "https://api.example.com", "baseUrl");
    expect(out.url).toBe("{{baseUrl}}/users");
  });
  it("replaces a literal in header values", () => {
    const r = parseCurl("curl https://x.com -H 'Authorization: Bearer tok123'");
    // auth extracted → token lives in authConfig.bearer.token
    const out = parameterizeParsedCurl(r, "tok123", "token");
    expect(out.authConfig.bearer.token).toBe("{{token}}");
  });
});
