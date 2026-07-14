import { describe, it, expect, vi } from "vitest";
import { runFlow, topoSort } from "./engine";
import type { DagGraph } from "./types";

function graph(partial: Partial<DagGraph>): DagGraph {
  return { version: 2, nodes: [], edges: [], positions: {}, ...partial };
}

const okSend = vi.fn(async (p: any) => ({ status: 200, statusText: "OK", headers: {}, data: { echoedUrl: p.url }, time: 5 }));

describe("topoSort", () => {
  it("orders by dependency", () => {
    const g = graph({
      nodes: [
        { id: "b", type: "request", name: "b", label: "B", data: { overrides: {}, inlineConfig: { method: "GET", url: "b", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "a", type: "request", name: "a", label: "A", data: { overrides: {}, inlineConfig: { method: "GET", url: "a", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "a", to: "b" }],
    });
    expect(topoSort(g)).toEqual(["a", "b"]);
  });
});

describe("runFlow", () => {
  it("runs requests in order and exposes step outputs to downstream references", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { token: "T" }, time: 1 })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: {}, time: 1 });
    const g = graph({
      nodes: [
        { id: "n1", type: "request", name: "login", label: "Login", data: { overrides: {}, inlineConfig: { method: "POST", url: "https://api/login", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "n2", type: "request", name: "me", label: "Me", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/me", headers: '{"Authorization":"Bearer {{steps.login.response.data.token}}"}', body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "n1", to: "n2" }],
    });
    const statuses: string[] = [];
    const ctx = await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (_id, s) => statuses.push(s) });
    expect(ctx.login.response?.data).toEqual({ token: "T" });
    // downstream request received the resolved auth header
    expect(send.mock.calls[1][0].headers.Authorization).toBe("Bearer T");
    expect(statuses).toContain("success");
  });

  it("skips a node whose only upstream errored (no runOnFailure)", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 500, error: "boom", headers: {}, data: null, time: 1 });
    const g = graph({
      nodes: [
        { id: "n1", type: "request", name: "a", label: "A", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/a", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "n2", type: "request", name: "b", label: "B", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/b", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [{ id: "e", from: "n1", to: "n2" }],
    });
    const statusById: Record<string, string> = {};
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statusById[id] = s; } });
    expect(statusById.n2).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("evaluates a condition and blocks the losing branch", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: {}, time: 1 }));
    const g = graph({
      nodes: [
        { id: "start", type: "request", name: "start", label: "S", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/s", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "cond", type: "condition", name: "cond", label: "C", data: { expression: "steps.start.response.status === 200" }, status: "idle" },
        { id: "yes", type: "request", name: "yes", label: "Y", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/yes", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
        { id: "no", type: "request", name: "no", label: "N", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/no", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" },
      ],
      edges: [
        { id: "e1", from: "start", to: "cond" },
        { id: "e2", from: "cond", to: "yes", branch: "true" },
        { id: "e3", from: "cond", to: "no", branch: "false" },
      ],
    });
    const statusById: Record<string, string> = {};
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statusById[id] = s; } });
    expect(statusById.yes).toBe("success");
    expect(statusById.no).toBe("skipped");
  });
});
