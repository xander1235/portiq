import { Octokit } from "@octokit/rest";
import { WORKSPACE_ROOT, LEGACY_STATE_FILE, SYNC_REPO_NAME } from "./constants";
import { encodeContent, decodeContent } from "./serialize";
import { registerSyncRemote } from "./registry";
import type { FetchWorkspaceResult, SyncRemote, SyncRepoInfo } from "./types";

/** The exact subset of the Octokit REST surface used by the github remote. */
export interface OctokitLike {
  rest: {
    users: { getAuthenticated(): Promise<{ data: { login: string } }> };
    repos: {
      get(p: any): Promise<any>;
      createForAuthenticatedUser(p: any): Promise<any>;
      createOrUpdateFileContents(p: any): Promise<any>;
      getContent(p: any): Promise<any>;
      deleteFile(p: any): Promise<any>;
    };
    git: {
      getRef(p: any): Promise<any>;
      getCommit(p: any): Promise<any>;
      getTree(p: any): Promise<any>;
      getBlob(p: any): Promise<any>;
    };
  };
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

export interface GithubRemoteOptions {
  token: string;
  /** Injectable client for tests; defaults to a real Octokit bound to token. */
  client?: OctokitLike;
}

export function createGithubRemote(opts: GithubRemoteOptions): SyncRemote {
  if (!opts.token && !opts.client) throw new Error("No GitHub token found.");
  const octokit: OctokitLike = opts.client ?? (new Octokit({ auth: opts.token }) as unknown as OctokitLike);

  let cached: SyncRepoInfo | null = null;

  async function ensureRepo(): Promise<SyncRepoInfo> {
    if (cached) return cached;
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owner = user.login;
    try {
      const { data: repo } = await octokit.rest.repos.get({ owner, repo: SYNC_REPO_NAME });
      cached = { owner, repo: SYNC_REPO_NAME, defaultBranch: repo.default_branch || "main" };
    } catch (e: any) {
      if (e.status === 404) {
        const { data: createdRepo } = await octokit.rest.repos.createForAuthenticatedUser({
          name: SYNC_REPO_NAME,
          private: true,
          auto_init: true,
          description: "Portiq App Sync Repository",
        });
        cached = { owner, repo: SYNC_REPO_NAME, defaultBranch: createdRepo.default_branch || "main" };
      } else {
        throw e;
      }
    }
    return cached;
  }

  async function getRepoTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data: commit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.object.sha });
    const { data: tree } = await octokit.rest.git.getTree({ owner, repo, tree_sha: commit.tree.sha, recursive: "true" });
    return (tree.tree || []) as TreeEntry[];
  }

  return {
    async getIdentity() {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      return { login: user.login };
    },

    ensureRepo,

    async fetchWorkspace(): Promise<FetchWorkspaceResult> {
      const { owner, repo, defaultBranch } = await ensureRepo();
      const tree = await getRepoTree(owner, repo, defaultBranch);
      const workspaceEntries = tree.filter((e) => e.type === "blob" && e.path.startsWith(`${WORKSPACE_ROOT}/`));

      if (workspaceEntries.length === 0) {
        try {
          const response: any = await octokit.rest.repos.getContent({ owner, repo, path: LEGACY_STATE_FILE, ref: defaultBranch });
          return { legacy: decodeContent(response.data.content) };
        } catch (e: any) {
          if (e.status === 404) throw new Error("No synced workspace found in the repository.");
          throw e;
        }
      }

      const fileMap: Record<string, any> = {};
      for (const entry of workspaceEntries) {
        const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
        fileMap[entry.path] = decodeContent(blob.data.content);
      }
      return { fileMap };
    },

    async pushFiles(desiredFiles: Record<string, any>, managedPrefixes: string[]) {
      const { owner, repo, defaultBranch } = await ensureRepo();
      const branch = defaultBranch;
      const tree = await getRepoTree(owner, repo, branch);
      const existingBlobs = new Map<string, string>(
        tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
      );

      for (const [path, content] of Object.entries(desiredFiles)) {
        const encodedContent = encodeContent(content);
        const updateFile = async (sha?: string) =>
          octokit.rest.repos.createOrUpdateFileContents({
            owner, repo, path, branch,
            message: `Sync ${path}`,
            content: encodedContent,
            ...(sha ? { sha } : {}),
          });

        try {
          await updateFile(existingBlobs.get(path));
        } catch (error: any) {
          const needsShaRetry = error?.status === 422 && /sha/i.test(error?.message || "");
          if (!needsShaRetry) throw error;
          const currentFile: any = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
          const currentSha = currentFile?.data?.sha;
          if (!currentSha) throw error;
          await updateFile(currentSha);
          existingBlobs.set(path, currentSha);
        }

        existingBlobs.delete(path);
      }

      const stalePaths = Array.from(existingBlobs.keys()).filter((path) =>
        managedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)),
      );
      for (const path of stalePaths) {
        await octokit.rest.repos.deleteFile({
          owner, repo, path, branch,
          message: `Remove stale synced file ${path}`,
          sha: existingBlobs.get(path)!,
        });
      }
    },
  };
}

registerSyncRemote("github", (o: GithubRemoteOptions) => createGithubRemote(o));
