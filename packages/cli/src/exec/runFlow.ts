import { runFlow, savedRequestToConfig, type RequestConfig, type StepsContext } from "@portiq/core/flows";
import { HttpTransport, summarizeTests, type HttpResult, type RequestItem, type TestEntry, type TestSummary } from "@portiq/core";

export async function runSavedFlow(
  item: RequestItem,
  allRequests: RequestItem[],
  vars: Record<string, string>,
  transport: HttpTransport,
  timeoutMs?: number
): Promise<{ steps: StepsContext; tests: TestSummary }> {
  const graph = item.dagGraph;
  if (!graph) return { steps: {}, tests: summarizeTests([]) };

  const byId = new Map(allRequests.map((r) => [r.id, r]));
  const lookupConfig = (id: string): RequestConfig | undefined => {
    const req = byId.get(id);
    return req ? savedRequestToConfig(req) : undefined;
  };

  const statuses: Record<string, string> = {};
  const nodeName = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  const steps = await runFlow(graph, {
    env: vars,
    lookupConfig,
    sendRequest: async (payload) => {
      const res = await transport.send({ method: payload.method, url: payload.url, headers: payload.headers, body: payload.body, timeoutMs: payload.timeoutMs ?? timeoutMs, httpVersion: "auto" });
      if ("error" in res && (res as { status?: unknown }).status === undefined) return { status: 0, error: (res as { error: string }).error };
      const r = res as HttpResult;
      return { status: r.status, statusText: r.statusText, headers: r.headers, data: r.json ?? r.body, time: r.time };
    },
    onStatus: (id, status) => { statuses[id] = status; },
  });

  const entries: TestEntry[] = Object.entries(statuses).map(([id, status]) => ({
    type: status === "error" ? "fail" : status === "skipped" ? "info" : "pass",
    text: nodeName(id),
    label: "flow",
    group: "flow",
  }));
  return { steps, tests: summarizeTests(entries) };
}
