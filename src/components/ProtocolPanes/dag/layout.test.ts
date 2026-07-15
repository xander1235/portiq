import { describe, it, expect } from "vitest";
import { autoLayout } from "./layout";
import type { DagGraph } from "./types";

const g: DagGraph = {
  version: 2, positions: {},
  nodes: [
    { id: "a", type: "request", name: "a", label: "A", data: { overrides: {} }, status: "idle" },
    { id: "b", type: "request", name: "b", label: "B", data: { overrides: {} }, status: "idle" },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
};

describe("autoLayout", () => {
  it("assigns positions for every node", () => {
    const pos = autoLayout(g);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
    expect(typeof pos.a.x).toBe("number");
    expect(typeof pos.a.y).toBe("number");
  });
  it("places a downstream node below/after its source", () => {
    const pos = autoLayout(g);
    expect(pos.b.y).toBeGreaterThanOrEqual(pos.a.y);
  });
});
