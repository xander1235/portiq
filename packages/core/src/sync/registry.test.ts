import { describe, it, expect } from "vitest";
import { registerSyncRemote, getSyncRemoteFactory, listSyncRemoteKinds } from "./registry";
import type { SyncRemote } from "./types";

const fakeFactory = (): SyncRemote => ({
  getIdentity: async () => ({ login: "test" }),
  ensureRepo: async () => ({ owner: "test", repo: "portiq-sync", defaultBranch: "main" }),
  fetchWorkspace: async () => ({ fileMap: {} }),
  pushFiles: async () => {},
});

describe("SyncRemoteRegistry", () => {
  it("registers and resolves a remote factory by kind", () => {
    registerSyncRemote("unit-test-remote", fakeFactory);
    expect(getSyncRemoteFactory("unit-test-remote")).toBe(fakeFactory);
    expect(listSyncRemoteKinds()).toContain("unit-test-remote");
  });

  it("returns null for an unknown kind", () => {
    expect(getSyncRemoteFactory("nope")).toBeNull();
  });
});
