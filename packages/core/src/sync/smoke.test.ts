import { describe, it, expect } from "vitest";
import { SYNC_REPO_NAME, WORKSPACE_ROOT, WORKSPACE_MANAGED_PREFIXES, HISTORY_PREFIX } from "./index";

describe("@portiq/core/sync constants", () => {
  it("preserves the sync repo name and workspace root verbatim", () => {
    expect(SYNC_REPO_NAME).toBe("portiq-sync");
    expect(WORKSPACE_ROOT).toBe("workspace");
  });

  it("declares the workspace managed prefixes and history prefix", () => {
    expect(WORKSPACE_MANAGED_PREFIXES).toEqual([
      "workspace/manifest.json",
      "workspace/settings.json",
      "workspace/draft/",
      "workspace/environments/",
      "workspace/collections/",
    ]);
    expect(HISTORY_PREFIX).toBe("workspace/history/");
  });
});
