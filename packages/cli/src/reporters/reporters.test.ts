import { describe, it, expect } from "vitest";
import { selectReporter, JsonReporter, JunitReporter } from "./index";
import { testSummaryToJUnit } from "./junit";
import type { CommandOutput } from "./types";
import type { TestSummary } from "@portiq/core";

const summary: TestSummary = {
  passed: 1, failed: 1, errored: 0, duration: 12,
  groups: [{
    name: "status", passed: 1, failed: 1, errored: 0, duration: 12,
    entries: [
      { type: "pass", text: "is 200", label: "post", group: "status", duration: 5 },
      { type: "fail", text: "has token", label: "post", group: "status", duration: 7, errorType: "Error", errorMessage: "missing" },
    ],
  }],
  console: [],
};

describe("selectReporter", () => {
  it("defaults to json when not a TTY", () => {
    expect(selectReporter({ isTTY: false, color: false })).toBeInstanceOf(JsonReporter);
  });
  it("honors an explicit junit choice", () => {
    expect(selectReporter({ reporter: "junit", isTTY: true, color: false })).toBeInstanceOf(JunitReporter);
  });
});

describe("JsonReporter", () => {
  it("serializes a table output to parseable JSON", () => {
    const out: CommandOutput = { kind: "table", columns: ["a"], rows: [["1"]] };
    const parsed = JSON.parse(new JsonReporter().write(out));
    expect(parsed.kind).toBe("table");
    expect(parsed.rows[0][0]).toBe("1");
  });
});

describe("testSummaryToJUnit", () => {
  it("emits a testsuite with a failure element", () => {
    const xml = testSummaryToJUnit(summary, "run");
    expect(xml).toContain('<testsuites tests="2" failures="1" errors="0"');
    expect(xml).toContain('name="has token"');
    expect(xml).toContain("<failure");
  });
});
