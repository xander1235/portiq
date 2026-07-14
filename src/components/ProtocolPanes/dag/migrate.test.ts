import { describe, it, expect } from "vitest";
import { migrateV1 } from "./migrate";

const legacy = {
  nodes: [
    { id: "n1", type: "request", label: "Login", config: { method: "POST", url: "https://api/login", headers: "{}", body: "{}", params: "", pathVars: "" }, status: "idle" },
    { id: "n2", type: "transform", label: "Pick", transformConfig: { script: "emit({ id: body.id })" }, status: "idle" },
    { id: "n3", type: "condition", label: "OK?", conditionConfig: { expression: "status === 200" }, status: "idle" },
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }],
  positions: { n1: { x: 0, y: 0 } },
};

describe("migrateV1", () => {
  it("produces a v2 graph with unique slug names", () => {
    const { graph } = migrateV1(legacy);
    expect(graph.version).toBe(2);
    expect(graph.nodes.map(n => n.name)).toEqual(["login", "pick", "ok"]);
  });
  it("maps request config into inlineConfig", () => {
    const { graph } = migrateV1(legacy);
    const login = graph.nodes.find(n => n.id === "n1")!;
    expect((login.data as any).inlineConfig.url).toBe("https://api/login");
    expect((login.data as any).overrides).toEqual({});
  });
  it("carries transform and condition scripts", () => {
    const { graph } = migrateV1(legacy);
    expect((graph.nodes.find(n => n.id === "n2")!.data as any).script).toBe("emit({ id: body.id })");
    expect((graph.nodes.find(n => n.id === "n3")!.data as any).expression).toBe("status === 200");
  });
  it("emits a migration note about implicit merge", () => {
    const { notes } = migrateV1(legacy);
    expect(notes.some(n => n.toLowerCase().includes("reference"))).toBe(true);
  });
  it("handles empty/absent legacy state", () => {
    const { graph } = migrateV1(null);
    expect(graph.nodes).toEqual([]);
  });
});
