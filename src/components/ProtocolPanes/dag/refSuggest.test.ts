import { describe, it, expect } from "vitest";
import { suggestRefs } from "./refSuggest";
import type { DagGraph, StepsContext } from "./types";

const g: DagGraph = {
  version: 2, positions: {},
  nodes: [
    { id: "a", type: "request", name: "login", label: "Login", data: { overrides: {} }, status: "idle" },
    { id: "b", type: "request", name: "me", label: "Me", data: { overrides: {} }, status: "idle" },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
};

describe("suggestRefs", () => {
  it("suggests upstream step names (not self)", () => {
    const s = suggestRefs(g, "b", {});
    expect(s).toContain("{{steps.login.response.body}}");
    expect(s.some(x => x.includes("steps.me"))).toBe(false);
  });
  it("suggests concrete response field paths from a prior run", () => {
    const steps: StepsContext = { login: { response: { status: 200, data: { token: "T", user: { id: 1 } } } } };
    const s = suggestRefs(g, "b", steps);
    expect(s).toContain("{{steps.login.response.data.token}}");
    expect(s).toContain("{{steps.login.response.data.user.id}}");
  });
});
