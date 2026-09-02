import { describe, it, expect, afterEach } from "vitest";
import { openAppStateStore, ConflictError, type AppState } from "@portiq/core";
import { withOptimisticWrite, withEntityRetry, emptyState, newId } from "./write";
import { withTempDataDir } from "../testkit/tempStore";

const dirs: Array<() => void> = [];
afterEach(() => { while (dirs.length) dirs.pop()!(); });

describe("write helpers", () => {
  it("emptyState is a valid blank AppState", () => {
    const s = emptyState();
    expect(s.collections).toEqual([]);
    expect(s.environments).toEqual([]);
    expect(s.historyRetentionDays).toBeGreaterThan(0);
  });

  it("newId returns a prefixed unique id", () => {
    expect(newId("col")).toMatch(/^col-/);
    expect(newId("col")).not.toBe(newId("col"));
  });

  it("withOptimisticWrite persists a mutation", () => {
    const { dir, cleanup } = withTempDataDir();
    dirs.push(cleanup);
    const store = openAppStateStore({ dataDir: dir });
    dirs.push(() => store.close());
    const added = withOptimisticWrite<string>(store, (state: AppState) => {
      state.collections.push({ id: "c9", name: "New", items: [] });
      return { next: state, result: "c9" };
    });
    expect(added).toBe("c9");
    expect(store.collections().find((c) => c.id === "c9")?.name).toBe("New");
  });
});

describe("withEntityRetry", () => {
  it("returns the result on success", () => {
    expect(withEntityRetry(() => 42)).toBe(42);
  });

  it("retries once then rethrows a persistent ConflictError", () => {
    let calls = 0;
    expect(() =>
      withEntityRetry(() => {
        calls += 1;
        throw new ConflictError("k", 1, 2);
      })
    ).toThrow(ConflictError);
    expect(calls).toBe(2);
  });
});
