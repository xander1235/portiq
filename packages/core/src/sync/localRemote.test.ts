import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitRemote } from "./localRemote";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-git-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("createLocalGitRemote", () => {
  it("ensureRepo initializes an empty repo and fetchWorkspace is empty", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    const info = await r.ensureRepo();
    expect(info.defaultBranch).toBe("main");
    expect(await r.fetchWorkspace()).toEqual({ fileMap: {} });
  });

  it("pushFiles then fetchWorkspace round-trips content", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    await r.ensureRepo();
    await r.pushFiles({ "workspace/settings.json": { a: 1 } }, ["workspace/settings.json"]);
    const { fileMap } = await r.fetchWorkspace();
    expect(fileMap!["workspace/settings.json"]).toEqual({ a: 1 });
  });

  it("pushFiles deletes stale files under a managed prefix", async () => {
    const r = createLocalGitRemote({ dir: tempDir() });
    await r.ensureRepo();
    await r.pushFiles({ "workspace/collections/a/collection.json": { id: "a" } }, ["workspace/collections/"]);
    await r.pushFiles({ "workspace/collections/b/collection.json": { id: "b" } }, ["workspace/collections/"]);
    const { fileMap } = await r.fetchWorkspace();
    expect(fileMap!["workspace/collections/a/collection.json"]).toBeUndefined();
    expect(fileMap!["workspace/collections/b/collection.json"]).toEqual({ id: "b" });
  });
});
