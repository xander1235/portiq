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

describe("runFlow transform + loop", () => {
  it("runs a transform script and exposes emitted data downstream", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 200, headers: {}, data: { items: [{ id: 3 }] }, time: 1 })
                        .mockResolvedValueOnce({ status: 200, headers: {}, data: {}, time: 1 });
    const g = { version: 2 as const, positions: {}, nodes: [
      { id: "a", type: "request" as const, name: "list", label: "L", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/list", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const },
      { id: "t", type: "transform" as const, name: "pick", label: "T", data: { script: "emit({ firstId: steps.list.response.data.items[0].id })" }, status: "idle" as const },
      { id: "b", type: "request" as const, name: "get", label: "G", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/{id}", headers: "", body: "", params: "", pathVars: "id={{steps.pick.response.data.firstId}}" } }, status: "idle" as const },
    ], edges: [{ id: "e1", from: "a", to: "t" }, { id: "e2", from: "t", to: "b" }] };
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: () => {} });
    expect(send.mock.calls[1][0].url).toBe("https://api/3");
  });

  it("loops a request until terminateWhen is true", async () => {
    let n = 0;
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: { page: ++n, done: n >= 3 }, time: 1 }));
    const g = { version: 2 as const, positions: {}, nodes: [
      { id: "a", type: "request" as const, name: "poll", label: "P", data: { overrides: {}, inlineConfig: { method: "GET", url: "https://api/poll", headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const },
    ], edges: [{ id: "self", from: "a", to: "a", maxIterations: 10, terminateWhen: "steps.poll.response.data.done === true" }] };
    await runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: () => {} });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sets node status to error and resolves runFlow (does not reject) when a transform script throws", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: {}, time: 1 }));
    const g = { version: 2 as const, positions: {}, nodes: [
      { id: "t", type: "transform" as const, name: "boom", label: "Boom", data: { script: "throw new Error('x')" }, status: "idle" as const },
    ], edges: [] };
    const statusById: Record<string, string> = {};
    await expect(runFlow(g, { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statusById[id] = s; } })).resolves.toBeDefined();
    expect(statusById.t).toBe("error");
  });
});

import { descendants } from "./traverse"; // ensure traverse is importable in this suite

describe("runFlow modes", () => {
  function reqNode(id: string, url: string) {
    return { id, type: "request" as const, name: id, label: id,
      data: { overrides: {}, inlineConfig: { method: "GET", url, headers: "", body: "", params: "", pathVars: "" } }, status: "idle" as const };
  }
  const chain = () => graph({
    nodes: [reqNode("a", "a"), reqNode("b", "{{steps.a.response.body.v}}"), reqNode("c", "c")],
    edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "c" }],
  });

  it("mode 'only' runs just the target and reuses priorSteps", async () => {
    const send = vi.fn(async (p: any) => ({ status: 200, headers: {}, data: { echoed: p.url }, time: 1 }));
    const statuses: Record<string, string> = {};
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { statuses[id] = s; } },
      { mode: "only", targetId: "b", priorSteps: { a: { response: { status: 200, body: { v: "X" }, data: { v: "X" } } } } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].url).toBe("X");   // b resolved a's reused result
    expect(statuses).toEqual({ b: expect.any(String) }); // only b got status updates
    expect(statuses.a).toBeUndefined();
  });

  it("mode 'from' runs target + descendants, reusing upstream", async () => {
    const send = vi.fn(async (p: any) => ({ status: 200, headers: {}, data: { echoed: p.url }, time: 1 }));
    const ran: string[] = [];
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { if (s === "success") ran.push(id); } },
      { mode: "from", targetId: "b", priorSteps: { a: { response: { status: 200, body: { v: "X" }, data: { v: "X" } } } } });
    expect(ran).toEqual(["b", "c"]);               // a not re-run
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("mode 'upTo' runs ancestors + target and stops", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, data: {}, time: 1 }));
    const ran: string[] = [];
    await runFlow(chain(), { sendRequest: send, lookupConfig: () => undefined, env: {}, onStatus: (id, s) => { if (s === "success") ran.push(id); } },
      { mode: "upTo", targetId: "b" });
    expect(ran).toEqual(["a", "b"]);               // c not run
  });
});
