import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStateStore } from "./appStateStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-app-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [{
    id: "c1", name: "API",
    items: [
      { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" },
      { type: "folder", id: "f1", name: "sub", items: [
        { type: "request", id: "r2", name: "Post", description: "", tags: [], protocol: "http", method: "POST", url: "https://y" },
      ]},
    ],
  }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [{ key: "baseUrl", value: "https://x", comment: "", enabled: true }] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("appStateStore", () => {
  it("returns null state with version 0 when empty", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    expect(s.load()).toEqual({ state: null, version: 0 });
    s.close();
  });

  it("saves and reloads AppState", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    const v = s.save(sample());
    expect(v).toBe(1);
    const { state, version } = s.load();
    expect(version).toBe(1);
    expect(state?.collections[0].name).toBe("API");
    s.close();
  });

  it("flattens requests across folders", () => {
    const s = openAppStateStore({ dataDir: tempDir() });
    s.save(sample());
    const reqs = s.flattenRequests();
    expect(reqs.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    s.close();
  });
});
