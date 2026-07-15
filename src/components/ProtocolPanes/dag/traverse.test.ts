import { describe, it, expect } from "vitest";
import { descendants, ancestors } from "./traverse";
import type { DagGraph } from "./types";

function g(edges: [string, string][]): DagGraph {
  const ids = Array.from(new Set(edges.flat()));
  return {
    version: 2,
    nodes: ids.map(id => ({ id, type: "request", name: id, label: id,
      data: { overrides: {}, inlineConfig: { method: "GET", url: id, headers: "", body: "", params: "", pathVars: "" } }, status: "idle" })),
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
    positions: {},
  };
}

describe("descendants", () => {
  it("includes the node and everything reachable downstream", () => {
    const graph = g([["a", "b"], ["b", "c"], ["b", "d"]]);
    expect(descendants(graph, "b")).toEqual(new Set(["b", "c", "d"]));
  });
  it("is just the node when it has no out-edges", () => {
    expect(descendants(g([["a", "b"]]), "b")).toEqual(new Set(["b"]));
  });
  it("ignores self-edges", () => {
    const graph = g([["a", "a"], ["a", "b"]]);
    expect(descendants(graph, "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("ancestors", () => {
  it("includes the node and everything that reaches it", () => {
    const graph = g([["a", "b"], ["b", "c"], ["x", "c"]]);
    expect(ancestors(graph, "c")).toEqual(new Set(["c", "b", "a", "x"]));
  });
  it("is just the node when it has no in-edges", () => {
    expect(ancestors(g([["a", "b"]]), "a")).toEqual(new Set(["a"]));
  });
});
