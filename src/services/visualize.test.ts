import { describe, it, expect } from "vitest";
import { autoChartConfig, normalizeVizSpec } from "./visualize";

const rows = [
  { name: "Alpha", revenue: 100, region: "US" },
  { name: "Beta", revenue: 250, region: "EU" },
  { name: "Gamma", revenue: 75, region: "US" },
];

describe("autoChartConfig", () => {
  it("returns null for empty or non-array input", () => {
    expect(autoChartConfig([])).toBeNull();
    expect(autoChartConfig(null as any)).toBeNull();
  });

  it("picks a label column and a numeric value column", () => {
    const spec = autoChartConfig(rows)!;
    expect(spec.type).toBe("bar");
    expect(spec.y).toBe("revenue");
    expect(spec.x).toBe("name");
    expect(spec.points).toEqual([
      { label: "Alpha", value: 100 },
      { label: "Beta", value: 250 },
      { label: "Gamma", value: 75 },
    ]);
  });

  it("caps points at 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ k: `r${i}`, v: i }));
    expect(autoChartConfig(many)!.points.length).toBe(20);
  });
});

describe("normalizeVizSpec", () => {
  it("accepts a valid spec and resolves points from rows", () => {
    const spec = normalizeVizSpec({ type: "line", x: "name", y: "revenue", title: "Rev" }, rows)!;
    expect(spec.type).toBe("line");
    expect(spec.title).toBe("Rev");
    expect(spec.points[1]).toEqual({ label: "Beta", value: 250 });
  });

  it("falls back to bar for an unknown chart type", () => {
    const spec = normalizeVizSpec({ type: "donut", x: "name", y: "revenue" }, rows)!;
    expect(spec.type).toBe("bar");
  });

  it("returns null when the value column is missing or non-numeric", () => {
    expect(normalizeVizSpec({ type: "bar", x: "name", y: "region" }, rows)).toBeNull();
    expect(normalizeVizSpec({ type: "bar", x: "name", y: "nope" }, rows)).toBeNull();
  });

  it("accepts an explicit points array without rows", () => {
    const spec = normalizeVizSpec({ type: "pie", points: [{ label: "a", value: 1 }] }, [])!;
    expect(spec.type).toBe("pie");
    expect(spec.points).toEqual([{ label: "a", value: 1 }]);
  });

  it("returns null for null/garbage spec", () => {
    expect(normalizeVizSpec(null, rows)).toBeNull();
    expect(normalizeVizSpec({}, rows)).toBeNull();
  });
});
