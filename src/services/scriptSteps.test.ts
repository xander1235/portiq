import { describe, it, expect } from "vitest";
import { toSteps, emptyStep, genStepId, ScriptStep } from "./scriptSteps";

describe("toSteps", () => {
  it("returns existing steps when the array is non-empty", () => {
    const steps: ScriptStep[] = [{ id: "a", name: "One", script: "x" }];
    expect(toSteps(steps, "legacy")).toEqual(steps);
  });

  it("assigns a missing id but preserves an existing one", () => {
    const result = toSteps(
      [{ name: "n", script: "s" } as any, { id: "keep-me", name: "n2", script: "s2" }],
      undefined
    );
    expect(result[0].id).toBeTruthy();
    expect(result[1].id).toBe("keep-me");
  });

  it("wraps a legacy blob into a single Step 1", () => {
    const result = toSteps(undefined, "pm.test('t', () => {})");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Step 1");
    expect(result[0].script).toBe("pm.test('t', () => {})");
    expect(result[0].id).toBeTruthy();
  });

  it("ignores a whitespace-only legacy blob", () => {
    expect(toSteps(undefined, "   \n ")).toEqual([]);
  });

  it("returns [] when there is nothing to migrate", () => {
    expect(toSteps(undefined, undefined)).toEqual([]);
    expect(toSteps([], "")).toEqual([]);
  });
});

describe("emptyStep / genStepId", () => {
  it("emptyStep has the given name, empty script, and an id", () => {
    const s = emptyStep("Step 2");
    expect(s.name).toBe("Step 2");
    expect(s.script).toBe("");
    expect(s.id).toBeTruthy();
  });

  it("genStepId returns distinct ids", () => {
    expect(genStepId()).not.toBe(genStepId());
  });
});
