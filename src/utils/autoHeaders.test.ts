import { describe, it, expect } from "vitest";
import { computeAutoHeaders, byteLength } from "./autoHeaders";

const keys = (headers: Array<{ key: string }>) => headers.map((h) => h.key);
const find = (headers: Array<{ key: string; value: string }>, key: string) =>
    headers.find((h) => h.key.toLowerCase() === key.toLowerCase());

describe("byteLength", () => {
    it("counts UTF-8 bytes, not code points", () => {
        expect(byteLength("abc")).toBe(3);
        expect(byteLength("€")).toBe(3);
        expect(byteLength("😀")).toBe(4);
    });
});

describe("computeAutoHeaders", () => {
    it("derives Host from the URL", () => {
        const headers = computeAutoHeaders({ method: "GET", url: "https://api.example.com:8443/v1/items", bodyType: "none" });
        expect(find(headers, "Host")?.value).toBe("api.example.com:8443");
    });

    it("omits Host for an invalid/relative URL", () => {
        const headers = computeAutoHeaders({ method: "GET", url: "/relative/path", bodyType: "none" });
        expect(find(headers, "Host")).toBeUndefined();
    });

    it("always includes User-Agent, Accept and Connection", () => {
        const headers = computeAutoHeaders({ method: "GET", url: "https://x.test/", bodyType: "none", appVersion: "1.2.3" });
        expect(find(headers, "User-Agent")?.value).toBe("Portiq/1.2.3");
        expect(find(headers, "Accept")?.value).toBe("*/*");
        expect(find(headers, "Connection")?.value).toBe("keep-alive");
    });

    it("never advertises Accept-Encoding (responses are not decompressed)", () => {
        const headers = computeAutoHeaders({ method: "POST", url: "https://x.test/", bodyType: "json", body: "{}" });
        expect(find(headers, "Accept-Encoding")).toBeUndefined();
    });

    it("computes Content-Length from the body for a body-carrying method", () => {
        const headers = computeAutoHeaders({ method: "POST", url: "https://x.test/", bodyType: "json", body: '{"a":1}' });
        expect(find(headers, "Content-Length")?.value).toBe("7");
    });

    it("omits Content-Length for GET", () => {
        const headers = computeAutoHeaders({ method: "GET", url: "https://x.test/", bodyType: "json", body: '{"a":1}' });
        expect(find(headers, "Content-Length")).toBeUndefined();
    });

    it("omits Content-Length when body type is none", () => {
        const headers = computeAutoHeaders({ method: "POST", url: "https://x.test/", bodyType: "none" });
        expect(find(headers, "Content-Length")).toBeUndefined();
    });

    it("marks multipart Content-Length as calculated on send", () => {
        const headers = computeAutoHeaders({ method: "POST", url: "https://x.test/", bodyType: "multipart", multipartCount: 2 });
        expect(find(headers, "Content-Length")?.value).toBe("calculated on send");
    });

    it("skips headers the user has already set (case-insensitive)", () => {
        const headers = computeAutoHeaders({
            method: "POST",
            url: "https://x.test/",
            bodyType: "json",
            body: "{}",
            userHeaderKeys: new Set(["user-agent", "accept"]),
        });
        expect(keys(headers)).not.toContain("User-Agent");
        expect(keys(headers)).not.toContain("Accept");
        expect(find(headers, "Host")).toBeDefined();
    });
});
