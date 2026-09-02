import { describe, it, expect, vi, afterEach } from "vitest";
import { StateChangeDetector, debounce } from "./stateWatcher";

describe("StateChangeDetector", () => {
  it("seeds lastKnownVersion from readVersion when no initialVersion is given", () => {
    const d = new StateChangeDetector({ readVersion: () => 5, onExternalChange: () => {} });
    expect(d.version).toBe(5);
  });

  it("fires onExternalChange when the on-disk version advances past last-known", () => {
    let disk = 5;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 5,
    });
    disk = 6;
    d.check();
    expect(seen).toEqual([6]);
    expect(d.version).toBe(6);
  });

  it("does NOT fire for this process's own writes (noteLocalWrite)", () => {
    let disk = 5;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 5,
    });
    disk = 6;
    d.noteLocalWrite(6); // the app itself just saved version 6
    d.check();
    expect(seen).toEqual([]);
  });

  it("does not re-fire when the version is unchanged", () => {
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => 7,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 7,
    });
    d.check();
    d.check();
    expect(seen).toEqual([]);
  });

  it("reset() re-syncs after a local clear so the reset itself is not treated as external", () => {
    let disk = 9;
    const seen: number[] = [];
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 9,
    });
    disk = 0; // clear() wiped kv_version → version back to 0
    d.reset(0);
    d.check();
    expect(seen).toEqual([]);
  });

  it("swallows a throwing readVersion without crashing the host process", () => {
    const d = new StateChangeDetector({
      readVersion: () => { throw new Error("db locked"); },
      onExternalChange: () => {},
      initialVersion: 5,
    });
    expect(() => d.check()).not.toThrow();
  });

  it("swallows a throwing onExternalChange and still records the new version", () => {
    let disk = 5;
    const d = new StateChangeDetector({
      readVersion: () => disk,
      onExternalChange: () => { throw new Error("reload failed"); },
      initialVersion: 5,
    });
    disk = 6;
    expect(() => d.check()).not.toThrow();
    expect(d.version).toBe(6);
  });
});

describe("debounce", () => {
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of calls into a single trailing invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d();
    d.cancel();
    vi.advanceTimersByTime(150);
    expect(fn).not.toHaveBeenCalled();
  });
});
