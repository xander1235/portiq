import { describe, it, expect } from "vitest";
import { createTestHarness, summarizeTests, type TestEntry } from "./testRunner";

describe("createTestHarness", () => {
  it("records pass and fail independently without aborting siblings", async () => {
    const out: TestEntry[] = [];
    const t = 100;
    const pm = createTestHarness(out, "post-script", () => t);
    await pm.test("a passes", () => {});
    await pm.test("b fails", () => { throw new Error("boom"); });
    await pm.test("c passes", () => {});
    expect(out.map(e => [e.text, e.type])).toEqual([
      ["a passes", "pass"],
      ["b fails", "fail"],
      ["c passes", "pass"],
    ]);
    expect(out[1].errorMessage).toBe("boom");
    expect(out.every(e => e.group === "Ungrouped")).toBe(true);
    expect(out.every(e => e.duration === 0)).toBe(true);
  });

  it("attaches tests to the active describe group and restores after", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("Auth", async () => {
      await pm.test("has token", () => {});
    });
    await pm.test("top level", () => {});
    expect(out[0].group).toBe("Auth");
    expect(out[1].group).toBe("Ungrouped");
  });

  it("records a group-level error when a describe body throws but keeps other groups", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("Broken", () => { throw new Error("setup failed"); });
    await pm.describe("Fine", async () => { await pm.test("ok", () => {}); });
    expect(out[0]).toMatchObject({ type: "error", group: "Broken", errorMessage: "setup failed" });
    expect(out[1]).toMatchObject({ type: "pass", group: "Fine", text: "ok" });
  });

  it("captures the group synchronously at test-call time for async bodies", async () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    await pm.describe("G", async () => {
      await pm.test("async work", async () => { await Promise.resolve(); });
    });
    expect(out[0].group).toBe("G");
  });

  it("groups correctly when describe/test are NOT awaited (sync bodies, Postman-style)", () => {
    const out: TestEntry[] = [];
    const pm = createTestHarness(out, "post-script", () => 0);
    // No await — the default usage pattern.
    pm.describe("Status", () => {
      pm.test("is 200", () => {});
      pm.test("fails", () => { throw new Error("x"); });
    });
    pm.test("ungrouped ok", () => {});
    expect(out.map((e) => [e.text, e.group, e.type])).toEqual([
      ["is 200", "Status", "pass"],
      ["fails", "Status", "fail"],
      ["ungrouped ok", "Ungrouped", "pass"],
    ]);
  });
});

describe("summarizeTests", () => {
  it("aggregates totals, per-group breakdown, and console entries", () => {
    const entries: TestEntry[] = [
      { type: "pass", text: "a", label: "l", group: "G1", duration: 5 },
      { type: "fail", text: "b", label: "l", group: "G1", duration: 3, errorMessage: "x" },
      { type: "error", text: "G2", label: "l", group: "G2" },
      { type: "log", text: "hello", label: "l", group: "Ungrouped" },
    ];
    const s = summarizeTests(entries);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errored).toBe(1);
    expect(s.duration).toBe(8);
    expect(s.groups.find(g => g.name === "G1")).toMatchObject({ passed: 1, failed: 1, duration: 8 });
    expect(s.console).toHaveLength(1);
    expect(s.console[0].text).toBe("hello");
  });

  it("treats entries with no group as Ungrouped", () => {
    const s = summarizeTests([{ type: "pass", text: "a", label: "l" }]);
    expect(s.groups[0].name).toBe("Ungrouped");
    expect(s.passed).toBe(1);
  });
});
