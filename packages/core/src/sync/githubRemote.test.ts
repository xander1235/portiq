import { describe, it, expect } from "vitest";
import { createGithubRemote, type OctokitLike } from "./githubRemote";
import { encodeContent } from "./serialize";

/** Minimal in-memory fake of the Octokit surface used by the github remote. */
function fakeOctokit(overrides: Partial<any> = {}): OctokitLike {
  return {
    rest: {
      users: { getAuthenticated: async () => ({ data: { login: "octo" } }) },
      repos: {
        get: async () => ({ data: { default_branch: "main" } }),
        createForAuthenticatedUser: async () => ({ data: { default_branch: "main" } }),
        createOrUpdateFileContents: async () => ({ data: {} }),
        getContent: async () => ({ data: { sha: "server-sha" } }),
        deleteFile: async () => ({ data: {} }),
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "ref-sha" } } }),
        getCommit: async () => ({ data: { tree: { sha: "tree-sha" } } }),
        getTree: async () => ({ data: { tree: [] } }),
        getBlob: async () => ({ data: { content: encodeContent({}) } }),
      },
      ...overrides.rest,
    },
  } as OctokitLike;
}

describe("createGithubRemote", () => {
  it("ensureRepo returns the existing repo's default branch", async () => {
    const r = createGithubRemote({ token: "t", client: fakeOctokit() });
    expect(await r.ensureRepo()).toEqual({ owner: "octo", repo: "portiq-sync", defaultBranch: "main" });
  });

  it("falls back to legacy state.json when no workspace tree exists", async () => {
    const client = fakeOctokit();
    client.rest.repos.getContent = async () => ({ data: { content: encodeContent({ ui_url: "x" }) } });
    const r = createGithubRemote({ token: "t", client });
    const result = await r.fetchWorkspace();
    expect(result.legacy).toEqual({ ui_url: "x" });
  });

  it("retries a 422 sha error by re-fetching the current sha", async () => {
    let attempts = 0;
    const client = fakeOctokit();
    await r_pushShaRetry(client, () => { attempts++; });
    async function r_pushShaRetry(c: OctokitLike, onCall: () => void) {
      c.rest.repos.createOrUpdateFileContents = async (p: any) => {
        onCall();
        if (!p.sha) { const e: any = new Error("sha mismatch"); e.status = 422; throw e; }
        return { data: {} };
      };
      const remote = createGithubRemote({ token: "t", client: c });
      await remote.pushFiles({ "workspace/settings.json": { a: 1 } }, ["workspace/"]);
    }
    expect(attempts).toBe(2); // first (no sha) throws 422, retry (with server-sha) succeeds
  });
});
