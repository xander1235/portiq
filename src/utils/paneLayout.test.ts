import { describe, it, expect } from "vitest";
import { clampTopHeight, clampRightWidth, resolvePaneLayout } from "./paneLayout";

const WIN = { width: 1600, height: 1000 };
const DEFAULTS = { topHeight: 500, rightWidth: 260 };

describe("clampTopHeight", () => {
  it("keeps an in-range value", () => {
    expect(clampTopHeight(500, 1000)).toBe(500);
  });
  it("floors at 100", () => {
    expect(clampTopHeight(10, 1000)).toBe(100);
  });
  it("caps at windowHeight - 150", () => {
    expect(clampTopHeight(9999, 1000)).toBe(850);
  });
});

describe("clampRightWidth", () => {
  it("keeps an in-range value", () => {
    expect(clampRightWidth(260, 1600)).toBe(260);
  });
  it("floors at 150", () => {
    expect(clampRightWidth(10, 1600)).toBe(150);
  });
  it("caps at windowWidth / 2", () => {
    expect(clampRightWidth(9999, 1600)).toBe(800);
  });
});

describe("resolvePaneLayout", () => {
  it("uses saved values when present and in-range", () => {
    expect(resolvePaneLayout({ topHeight: 400, rightWidth: 300 }, DEFAULTS, WIN))
      .toEqual({ topHeight: 400, rightWidth: 300 });
  });
  it("falls back to defaults when saved is undefined", () => {
    expect(resolvePaneLayout(undefined, DEFAULTS, WIN))
      .toEqual({ topHeight: 500, rightWidth: 260 });
  });
  it("uses default per-axis when only one axis is saved", () => {
    expect(resolvePaneLayout({ topHeight: 400 }, DEFAULTS, WIN))
      .toEqual({ topHeight: 400, rightWidth: 260 });
  });
  it("clamps a layout saved on a larger screen", () => {
    // saved on a tall/wide screen, now viewed on a small window
    expect(resolvePaneLayout({ topHeight: 900, rightWidth: 700 }, DEFAULTS, { width: 800, height: 600 }))
      .toEqual({ topHeight: 450, rightWidth: 400 });
  });
  it("ignores NaN / non-finite saved values", () => {
    expect(resolvePaneLayout({ topHeight: NaN, rightWidth: Infinity }, DEFAULTS, WIN))
      .toEqual({ topHeight: 500, rightWidth: 260 });
  });
});
