import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore } from "./kvStore";
import { migrateBlobIfNeeded, recomposeLegacyBlob } from "./migrate";
import { INDEX_KEY, COL_PREFIX, ENV_PREFIX, LEGACY_BLOB_KEY, recomposeState, openEntityStore } from "./entityStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), "portiq-mig-")); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const blob = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [] }, { id: "c2", name: "B", items: [] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 30,
  uiDraft: { tab: "params" },
});

describe("migrateBlobIfNeeded", () => {
  it("decomposes a legacy appState blob into entity rows and keeps the blob", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    expect(migrateBlobIfNeeded(kv)).toBe(true);
    expect(kv.keys(COL_PREFIX).sort()).toEqual(["ent:col:c1", "ent:col:c2"]);
    expect(kv.keys(ENV_PREFIX)).toEqual(["ent:env:e1"]);
    expect(kv.get(INDEX_KEY)).toBeTruthy();
    expect(kv.get(LEGACY_BLOB_KEY)).toBeTruthy(); // NOT deleted
    expect(recomposeState(kv).state).toEqual(blob()); // fidelity incl. extras
    kv.close();
  });

  it("is a no-op when an index already exists", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    migrateBlobIfNeeded(kv);
    expect(migrateBlobIfNeeded(kv)).toBe(false);
    kv.close();
  });

  it("is a no-op on an empty store", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    expect(migrateBlobIfNeeded(kv)).toBe(false);
    kv.close();
  });

  it.each([
    ["the literal null", "null"],
    ["an array", "[]"],
    ["a primitive string", '"just a string"'],
  ])("returns false (and does not throw) when the legacy blob is valid JSON but not a plain object: %s", (_label, degenerateBlob) => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, degenerateBlob);
    expect(() => migrateBlobIfNeeded(kv)).not.toThrow();
    expect(migrateBlobIfNeeded(kv)).toBe(false);
    expect(kv.get(INDEX_KEY)).toBeNull();
    kv.close();
  });

  it("openEntityStore does not throw when the legacy blob is a degenerate JSON value", () => {
    const dir = tempDir();
    const kv = openKvStore({ dataDir: dir });
    kv.set(LEGACY_BLOB_KEY, "null");
    kv.close();
    expect(() => {
      const s = openEntityStore({ dataDir: dir });
      s.close();
    }).not.toThrow();
  });
});

describe("recomposeLegacyBlob (rollback)", () => {
  it("rewrites the appState blob from entity rows", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(blob()));
    migrateBlobIfNeeded(kv);
    kv.deleteKey(LEGACY_BLOB_KEY);            // simulate a stale/removed blob
    expect(recomposeLegacyBlob(kv)).toBe(true);
    expect(JSON.parse(kv.get(LEGACY_BLOB_KEY)!)).toEqual(blob());
    kv.close();
  });

  it("returns false when there are no entities", () => {
    const kv = openKvStore({ dataDir: tempDir() });
    expect(recomposeLegacyBlob(kv)).toBe(false);
    kv.close();
  });
});
