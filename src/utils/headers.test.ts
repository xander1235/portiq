import { describe, it, expect } from "vitest";
import { applyBodyContentType, type HeaderRow } from "./headers";

const rows = (...entries: Array<[string, string]>): HeaderRow[] =>
    entries.map(([key, value]) => ({ key, value, comment: "", enabled: true }));

describe("applyBodyContentType", () => {
    it("removes the Content-Type header when body type is none", () => {
        const result = applyBodyContentType(rows(["Content-Type", "application/json"], ["X-Test", "1"]), "none");
        expect(result.find((r) => r.key.toLowerCase() === "content-type")).toBeUndefined();
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("X-Test");
    });

    it("removes Content-Type case-insensitively", () => {
        const result = applyBodyContentType(rows(["content-type", "text/plain"]), "none");
        expect(result).toHaveLength(0);
    });

    it("updates an existing Content-Type to match the body type", () => {
        const result = applyBodyContentType(rows(["Content-Type", "text/plain"]), "json");
        expect(result[0].value).toBe("application/json");
        expect(result[0].enabled).toBe(true);
    });

    it("re-enables a disabled Content-Type row when a body type is chosen", () => {
        const input: HeaderRow[] = [{ key: "Content-Type", value: "text/plain", enabled: false, comment: "" }];
        const result = applyBodyContentType(input, "xml");
        expect(result[0].value).toBe("application/xml");
        expect(result[0].enabled).toBe(true);
    });

    it("appends a Content-Type header when none exists", () => {
        const result = applyBodyContentType(rows(["X-Test", "1"]), "form");
        expect(result).toHaveLength(2);
        expect(result[1]).toMatchObject({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
    });

    it("leaves rows untouched for an unknown body type", () => {
        const input = rows(["Content-Type", "application/json"]);
        const result = applyBodyContentType(input, "mystery");
        expect(result).toEqual(input);
    });

    it("does not mutate the input array", () => {
        const input = rows(["Content-Type", "application/json"]);
        applyBodyContentType(input, "none");
        expect(input).toHaveLength(1);
    });
});
