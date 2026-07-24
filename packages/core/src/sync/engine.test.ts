import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitRemote } from "./localRemote";
import { syncPush, pullMerged, syncPullToStore, syncStatus, SyncConflictError } from "./engine";
import { openAppStateStore } from "../store/appStateStore";
import type { AppState } from "../model";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-eng-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const sample = (): AppState => ({
  collections: [{ id: "c1", name: "API", items: [
    { type: "request", id: "r1", name: "Get", description: "", tags: [], protocol: "http", method: "GET", url: "https://x" } as any,
  ] }],
  activeCollectionId: "c1",
  environments: [{ id: "e1", name: "Local", vars: [] }],
  activeEnvId: "e1",
  historyRetentionDays: 7,
});

describe("engine push/pull round-trip via local git remote", () => {
  it("pushes then pulls back an equivalent AppState", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    const { appState } = await pullMerged(remote, { collections: [], activeCollectionId: "", environments: [], activeEnvId: null, historyRetentionDays: 7 } as AppState);
    expect(appState.collections[0].id).toBe("c1");
    expect((appState.collections[0].items[0] as any).id).toBe("r1");
  });
});

describe("syncPullToStore optimistic concurrency", () => {
  it("writes the merged state through the store at the loaded version", async () => {
    const dataDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample()); // version 1
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    const res = await syncPullToStore(remote, {}, store);
    expect(res.version).toBe(2);
    expect(store.load().version).toBe(2);
    store.close();
  });

  it("throws SyncConflictError when the store version changed during pull", async () => {
    const dataDir = tempDir();
    const store = openAppStateStore({ dataDir });
    store.save(sample()); // version 1
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    await syncPush(remote, sample());
    // Simulate a concurrent writer bumping the version after load but before save
    // by wrapping the store: load reports v1, but the underlying store is at v2.
    const racing = openAppStateStore({ dataDir });
    const conflicting = {
      load: () => ({ state: sample(), version: 1 }),
      save: (s: AppState, v?: number) => racing.save(s, v),
      collections: racing.collections, environments: racing.environments,
      flattenRequests: racing.flattenRequests, close: racing.close,
    };
    racing.save(sample()); // underlying now version 2
    await expect(syncPullToStore(remote, {}, conflicting as any)).rejects.toBeInstanceOf(SyncConflictError);
    racing.close();
    store.close();
  });
});

describe("syncStatus", () => {
  it("reports inSync=false with a removed diff when the remote lacks a local collection", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    const status = await syncStatus(remote, sample());
    expect(status.remoteExists).toBe(false);
    expect(status.inSync).toBe(false);
    expect(status.diffs.some((d) => d.state === "added")).toBe(true); // local-only files are "added" vs remote
  });

  it("reports inSync=true right after a push", async () => {
    const remote = createLocalGitRemote({ dir: tempDir() });
    await remote.ensureRepo();
    const state = sample();
    await syncPush(remote, state);
    const status = await syncStatus(remote, state);
    expect(status.inSync).toBe(true);
    expect(status.diffs).toHaveLength(0);
  });
});
