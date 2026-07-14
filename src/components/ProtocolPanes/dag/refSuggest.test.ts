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
  it("excludes downstream and sibling nodes, not just self", () => {
    const g2: DagGraph = {
      version: 2, positions: {},
      nodes: [
        { id: "a", type: "request", name: "login", label: "Login", data: { overrides: {} }, status: "idle" },
        { id: "b", type: "request", name: "step2", label: "Step2", data: { overrides: {} }, status: "idle" },
        { id: "c", type: "request", name: "sibling", label: "Sibling", data: { overrides: {} }, status: "idle" },
        { id: "d", type: "request", name: "downstream", label: "Downstream", data: { overrides: {} }, status: "idle" },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "a", to: "c" },
        { id: "e3", from: "b", to: "d" },
      ],
    };
    const s = suggestRefs(g2, "b", {});
    expect(s).toContain("{{steps.login.response.body}}");
    expect(s.some(x => x.includes("steps.step2"))).toBe(false);
    expect(s.some(x => x.includes("steps.sibling"))).toBe(false);
    expect(s.some(x => x.includes("steps.downstream"))).toBe(false);
  });
});
