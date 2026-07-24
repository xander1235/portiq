import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openAppStateStore, type AppState } from "@portiq/core";
import type { SyncRemote, SyncRepoInfo, FetchWorkspaceResult } from "@portiq/core/sync";
import { buildProgram } from "../registry";
import { syncCommand, type SyncDeps } from "./sync";
import type { CliContext } from "../context";
import { UsageError } from "../errors";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-sync-cli-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function seedState(dir: string): AppState {
  const state: AppState = {
    collections: [
      {
        id: "c1",
        name: "API",
        items: [
          {
            type: "request",
            id: "r1",
            name: "Ping",
            description: "",
            tags: [],
            protocol: "http",
            method: "GET",
            url: "https://example.test/ping",
            bodyType: "none",
          },
        ],
      },
    ],
    activeCollectionId: "c1",
    environments: [],
    activeEnvId: null,
    historyRetentionDays: 7,
  };
  const store = openAppStateStore({ dataDir: dir });
  store.save(state);
  store.close();
  return state;
}

/** In-memory SyncRemote fake — holds a fileMap and mimics createLocalGitRemote's shape
 *  closely enough for engine round-trips (push -> fileMap, status/pull read it back). */
class FakeRemote implements SyncRemote {
  fileMap: Record<string, unknown> = {};

  async getIdentity(): Promise<{ login: string }> {
    return { login: "tester" };
  }

  async ensureRepo(): Promise<SyncRepoInfo> {
    return { owner: "tester", repo: "portiq-sync", defaultBranch: "main" };
  }

  async fetchWorkspace(): Promise<FetchWorkspaceResult> {
    return { fileMap: this.fileMap };
  }

  async pushFiles(desiredFiles: Record<string, unknown>): Promise<void> {
    this.fileMap = desiredFiles;
  }
}

function cli(
  args: string[],
  deps: SyncDeps,
  env: NodeJS.ProcessEnv = {}
): Promise<{ out: string; code: number | undefined }> {
  let buf = "";
  const sink = new Writable({
    write(c, _e, cb) {
      buf += c.toString();
      cb();
    },
  });
  const ctx: CliContext = { argv: [], env, cwd: "/", stdout: sink, stderr: sink, isTTY: false, now: () => 0 };
  const prev = process.exitCode;
  process.exitCode = undefined;
  return buildProgram(ctx, [syncCommand(deps)])
    .parseAsync(args, { from: "user" })
    .then(() => ({ out: buf, code: process.exitCode as number | undefined }))
    .finally(() => {
      process.exitCode = prev;
    });
}

describe("sync command", () => {
  it("push populates the remote and prints a success message", async () => {
    const dir = tempDir();
    seedState(dir);
    const fake = new FakeRemote();

    const { out } = await cli(["sync", "push", "--data-dir", dir, "--reporter", "json"], {
      remoteFactory: () => fake,
    });

    expect(Object.keys(fake.fileMap).length).toBeGreaterThan(0);
    expect(out).toMatch(/unmasked/);
    const parsed = JSON.parse(out.slice(out.indexOf("{")));
    expect(parsed.kind).toBe("message");
    expect(parsed.text).toMatch(/Pushed local workspace to tester/);
  });

  it("status reports inSync:true right after a push into the fake", async () => {
    const dir = tempDir();
    seedState(dir);
    const fake = new FakeRemote();

    await cli(["sync", "push", "--data-dir", dir, "--reporter", "json"], { remoteFactory: () => fake });
    const { out } = await cli(["sync", "status", "--data-dir", dir, "--reporter", "json"], {
      remoteFactory: () => fake,
    });

    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("entity");
    expect(parsed.entity.inSync).toBe(true);
    expect(parsed.entity.diffs).toEqual([]);
  });

  it("status reports drift for a fresh fake against a seeded store", async () => {
    const dir = tempDir();
    seedState(dir);
    const fake = new FakeRemote(); // empty fileMap — never pushed

    const { out } = await cli(["sync", "status", "--data-dir", dir, "--reporter", "json"], {
      remoteFactory: () => fake,
    });

    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("entity");
    expect(parsed.entity.inSync).toBe(false);
    expect(parsed.entity.diffs.length).toBeGreaterThan(0);
  });

  it("pull writes the pulled collection into a separate store and reports version/counts", async () => {
    const pushDir = tempDir();
    seedState(pushDir);
    const fake = new FakeRemote();
    await cli(["sync", "push", "--data-dir", pushDir, "--reporter", "json"], { remoteFactory: () => fake });

    const pullDir = tempDir(); // separate, empty store
    const { out } = await cli(["sync", "pull", "--data-dir", pullDir, "--reporter", "json"], {
      remoteFactory: () => fake,
    });

    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("message");
    expect(parsed.text).toMatch(/version 1/);
    expect(parsed.text).toMatch(/1 collections/);
    expect(parsed.text).toMatch(/0 environments/);

    const store = openAppStateStore({ dataDir: pullDir });
    const { state } = store.load();
    store.close();
    expect(state?.collections?.[0]?.id).toBe("c1");
    expect((state?.collections?.[0]?.items?.[0] as { id?: string })?.id).toBe("r1");
  });

  it("push rejects with a UsageError when no token is available (real default remote builder)", async () => {
    const dir = tempDir();
    seedState(dir);

    let caught: unknown;
    try {
      await cli(["sync", "push", "--data-dir", dir], {}, {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toMatch(/token/i);
  });
});
