import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_ROOT, SYNC_REPO_NAME } from "./constants";
import { registerSyncRemote } from "./registry";
import type { FetchWorkspaceResult, SyncRemote } from "./types";

export interface LocalGitRemoteOptions {
  dir: string;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).toString();
}

function hasCommits(dir: string): boolean {
  try {
    git(dir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function trackedFiles(dir: string): string[] {
  if (!hasCommits(dir)) return [];
  return git(dir, ["ls-files"]).split("\n").map((l) => l.trim()).filter(Boolean);
}

export function createLocalGitRemote(opts: LocalGitRemoteOptions): SyncRemote {
  const { dir } = opts;

  return {
    async getIdentity() {
      return { login: "local" };
    },

    async ensureRepo() {
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, ".git"))) {
        git(dir, ["init", "-b", "main"]);
      }
      // Throwaway identity so commits succeed in CI where global git config is absent.
      try { git(dir, ["config", "user.email"]); } catch { git(dir, ["config", "user.email", "portiq@local"]); }
      try { git(dir, ["config", "user.name"]); } catch { git(dir, ["config", "user.name", "Portiq Sync"]); }
      return { owner: "local", repo: SYNC_REPO_NAME, defaultBranch: "main" };
    },

    async fetchWorkspace(): Promise<FetchWorkspaceResult> {
      const fileMap: Record<string, any> = {};
      for (const path of trackedFiles(dir)) {
        if (!path.startsWith(`${WORKSPACE_ROOT}/`)) continue;
        fileMap[path] = JSON.parse(readFileSync(join(dir, path), "utf8"));
      }
      return { fileMap };
    },

    async pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]) {
      for (const [path, content] of Object.entries(desiredFiles)) {
        const abs = join(dir, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, JSON.stringify(content, null, 2));
        git(dir, ["add", "--", path]);
      }

      const stale = trackedFiles(dir).filter(
        (path) =>
          !(path in desiredFiles) &&
          managedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)),
      );
      for (const path of stale) {
        rmSync(join(dir, path), { force: true });
        git(dir, ["rm", "--cached", "--", path]);
      }

      // Commit only if the index changed.
      const status = git(dir, ["status", "--porcelain"]).trim();
      if (status) git(dir, ["commit", "-m", "Sync workspace", "--no-verify"]);
    },
  };
}

registerSyncRemote("local", (o: LocalGitRemoteOptions) => createLocalGitRemote(o));
