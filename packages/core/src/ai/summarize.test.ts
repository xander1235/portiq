import { describe, it, expect } from "vitest";
import { summarizeResponse } from "./summarize";

describe("summarizeResponse", () => {
  it("reports when there is no response", () => {
    expect(summarizeResponse(null)).toEqual({ summary: "No response yet.", hints: [] });
  });

  it("surfaces the error as a hint", () => {
    expect(summarizeResponse({ error: "boom" })).toEqual({ summary: "Request failed.", hints: ["boom"] });
  });

  it("hints on 4xx and reports row counts for data arrays", () => {
    const s = summarizeResponse({ status: 401, statusText: "Unauthorized", json: {} });
    expect(s.summary).toBe("Status 401 Unauthorized.");
    expect(s.hints).toContain("Check auth headers and required fields.");

    const rows = summarizeResponse({ status: 200, statusText: "OK", json: { data: [1, 2, 3] } });
    expect(rows.hints).toContain("Returned 3 rows.");
  });
});
