import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore, ConflictError } from "./kvStore";
import { openEntityStore, INDEX_KEY, COL_PREFIX, LEGACY_BLOB_KEY } from "./entityStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-ent-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [
    { id: "c1", name: "API", items: [{ type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" }] },
    { id: "c2", name: "Other", items: [] },
  ],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
  uiDraftFoo: { open: true }, // arbitrary extra must survive round-trip
});

describe("entityStore round-trip", () => {
  it("returns null/version 0 when empty", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    expect(s.loadState()).toEqual({ state: null, version: 0 });
    s.close();
  });

  it("saveState decomposes into per-entity rows and recomposes identically (incl. extras)", () => {
    const dir = tempDir();
    const s = openEntityStore({ dataDir: dir });
    const v = s.saveState(sample());
    expect(v).toBe(1);
    const kv = s.raw;
    expect(kv.keys(COL_PREFIX).sort()).toEqual(["ent:col:c1", "ent:col:c2"]);
    expect(kv.get(INDEX_KEY)).toBeTruthy();
    expect(kv.get(LEGACY_BLOB_KEY)).toBeTruthy(); // dual-written for rollback
    const { state } = s.loadState();
    expect(state).toEqual(sample());
    s.close();
  });

  it("saveState only bumps versions of changed collections (diff)", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const c1v = s.getCollection("c1").version;
    const c2v = s.getCollection("c2").version;
    const next = sample();
    next.collections[0].name = "API v2"; // change c1 only
    s.saveState(next, s.loadState().version);
    expect(s.getCollection("c1").version).toBe(c1v + 1);
    expect(s.getCollection("c2").version).toBe(c2v); // untouched
    s.close();
  });

  it("saveState throws ConflictError on a stale whole-state version", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());       // version 1
    const changed = sample();
    changed.collections[0].name = "API v2";
    s.saveState(changed);        // version 2 (genuine change)
    expect(() => s.saveState(sample(), 1)).toThrow(ConflictError);
    s.close();
  });

  it("no-op saveState does not bump the global write version (no autosave livelock)", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const before = s.raw.globalWriteVersion();
    const v = s.saveState(sample());
    expect(s.raw.globalWriteVersion()).toBe(before); // no row writes at all
    expect(v).toBe(1);                               // whole-state version unchanged
    s.close();
  });

  it("a genuine change still dual-writes the legacy blob and bumps the version", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const changed = sample();
    changed.collections[0].name = "API v2";
    const v = s.saveState(changed);
    expect(v).toBe(2);
    expect(JSON.parse(s.raw.get(LEGACY_BLOB_KEY)!).collections[0].name).toBe("API v2");
    s.close();
  });

  it("per-entity upsert of different collections does not conflict (fine-grained)", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const c1 = s.getCollection("c1");
    const c2 = s.getCollection("c2");
    // two writers each hold their own entity version and both succeed
    s.upsertCollection({ ...c1.collection!, name: "A2" }, c1.version);
    s.upsertCollection({ ...c2.collection!, name: "B2" }, c2.version);
    expect(s.getCollection("c1").collection?.name).toBe("A2");
    expect(s.getCollection("c2").collection?.name).toBe("B2");
    s.close();
  });

  it("per-entity upsert throws ConflictError on a stale entity version", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    const { collection, version } = s.getCollection("c1");
    s.upsertCollection({ ...collection!, name: "A2" }, version);          // now version+1
    expect(() => s.upsertCollection({ ...collection!, name: "A3" }, version)).toThrow(ConflictError);
    s.close();
  });

  it("upsertCollection adds a brand-new collection to the index", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    s.upsertCollection({ id: "c9", name: "New", items: [] });
    expect(s.loadState().state?.collections.map((c) => c.id).sort()).toEqual(["c1", "c2", "c9"]);
    s.close();
  });

  it("deleteCollection removes the row and de-indexes it", () => {
    const s = openEntityStore({ dataDir: tempDir() });
    s.saveState(sample());
    s.deleteCollection("c2");
    expect(s.getCollection("c2").collection).toBeNull();
    expect(s.loadState().state?.collections.map((c) => c.id)).toEqual(["c1"]);
    s.close();
  });
});

describe("entityStore auto-migration", () => {
  it("adopts an existing legacy appState blob on open", () => {
    const dir = tempDir();
    const kv = openKvStore({ dataDir: dir });
    kv.set(LEGACY_BLOB_KEY, JSON.stringify(sample()));
    kv.close();
    const s = openEntityStore({ dataDir: dir });
    expect(s.loadState().state).toEqual(sample());
    s.close();
  });
});
