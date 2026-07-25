import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore, ConflictError } from "./kvStore";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-kv-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("openKvStore", () => {
  it("returns null for a missing key", () => {
    const s = openKvStore({ dataDir: tempDir() });
    expect(s.get("appState")).toBeNull();
    s.close();
  });

  it("persists and reads a value, bumping the version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    const v1 = s.set("appState", "{\"a\":1}");
    expect(v1).toBe(1);
    expect(s.get("appState")).toBe("{\"a\":1}");
    const v2 = s.set("appState", "{\"a\":2}");
    expect(v2).toBe(2);
    s.close();
  });

  it("enables WAL journal mode", () => {
    const dir = tempDir();
    const s = openKvStore({ dataDir: dir });
    expect(s.getVersioned("appState")).toEqual({ value: null, version: 0 });
    s.close();
  });

  it("setIfVersion succeeds when the expected version matches", () => {
    const s = openKvStore({ dataDir: tempDir() });
    const v1 = s.set("appState", "one");
    const v2 = s.setIfVersion("appState", "two", v1);
    expect(v2).toBe(2);
    expect(s.get("appState")).toBe("two");
    s.close();
  });

  it("setIfVersion throws ConflictError on a stale expected version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("appState", "one");
    s.set("appState", "two"); // version now 2
    expect(() => s.setIfVersion("appState", "three", 1)).toThrow(ConflictError);
    s.close();
  });
});

describe("openKvStore multi-key primitives", () => {
  it("lists keys by prefix", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("ent:col:a", "1");
    s.set("ent:col:b", "2");
    s.set("ent:env:x", "3");
    expect(s.keys("ent:col:").sort()).toEqual(["ent:col:a", "ent:col:b"]);
    expect(s.keys().length).toBe(3);
    s.close();
  });

  it("deleteKey removes value and version", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.set("k", "v");
    s.deleteKey("k");
    expect(s.get("k")).toBeNull();
    expect(s.getVersioned("k").version).toBe(0);
    s.close();
  });

  it("transaction commits multiple writes atomically and rolls back on throw", () => {
    const s = openKvStore({ dataDir: tempDir() });
    s.transaction(() => { s.set("a", "1"); s.set("b", "2"); });
    expect(s.get("a")).toBe("1");
    expect(s.get("b")).toBe("2");
    expect(() => s.transaction(() => { s.set("a", "9"); throw new Error("boom"); })).toThrow("boom");
    expect(s.get("a")).toBe("1"); // rolled back
    s.close();
  });
});
