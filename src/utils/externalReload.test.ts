import { describe, it, expect } from "vitest";
import { computeExternalReloadAction } from "./externalReload";

describe("computeExternalReloadAction", () => {
  it("reloads silently when there are no pending local edits", () => {
    expect(computeExternalReloadAction({ hasPendingLocalEdits: false })).toBe("reload");
  });

  it("prompts when there are pending local edits", () => {
    expect(computeExternalReloadAction({ hasPendingLocalEdits: true })).toBe("prompt");
  });
});
