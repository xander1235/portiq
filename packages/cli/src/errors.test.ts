import { describe, it, expect } from "vitest";
import { UsageError, RuntimeError, TestFailureError, toExitCode, EXIT } from "./errors";

describe("toExitCode", () => {
  it("maps UsageError to 3", () => {
    expect(toExitCode(new UsageError("bad flag"))).toBe(EXIT.USAGE);
  });
  it("maps TestFailureError to 2", () => {
    expect(toExitCode(new TestFailureError("2 tests failed"))).toBe(EXIT.TEST);
  });
  it("maps RuntimeError to 1", () => {
    expect(toExitCode(new RuntimeError("connection refused"))).toBe(EXIT.RUNTIME);
  });
  it("maps unknown throwables to 1", () => {
    expect(toExitCode(new Error("boom"))).toBe(EXIT.RUNTIME);
    expect(toExitCode("nope")).toBe(EXIT.RUNTIME);
  });
});
