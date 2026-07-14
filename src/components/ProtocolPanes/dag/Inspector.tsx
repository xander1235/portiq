import { useEffect, useMemo, useState } from "react";
import type {
  DagGraph, DagNode, RequestConfig, RequestNodeData, PayloadNodeData,
  ConditionNodeData, TransformNodeData, StepResult, StepsContext,
} from "./types";
import { resolveTemplate, type ResolveContext } from "./resolver";
import { resolveStepConfig, savedRequestToConfig } from "./linkResolve";
import { suggestRefs } from "./refSuggest";

export interface InspectorProps {
  node: DagNode;
  stepResult?: StepResult;
  savedRequests: any[];
  env: Record<string, string>;
  steps: StepsContext;
  graph: DagGraph;
  onUpdate: (id: string, patch: Partial<DagNode>) => void;
  onDetach: (id: string) => void;
  onClose: () => void;
}

type ResultTab = "resolved" | "request" | "response";

/** Templated fields of a resolved RequestConfig, after {{...}} substitution. */
interface ResolvedPreview {
  brokenLink: boolean;
  method: string;
  url: string;
  headers: string;
  body: string;
  params: string;
  pathVars: string;
}

export function Inspector({ node, stepResult, savedRequests, env, steps, graph, onUpdate, onDetach, onClose }: InspectorProps) {
  const [tab, setTab] = useState<ResultTab>("resolved");
  const [nameDraft, setNameDraft] = useState(node.name);

  // Reset the in-progress draft whenever the selected node changes, or when the
  // persisted name changes (e.g. after slug normalization on commit), so the
  // input doesn't show stale/raw text or leak a draft from another node.
  useEffect(() => {
    setNameDraft(node.name);
  }, [node.id, node.name]);

  const commitName = () => {
    if (nameDraft !== node.name) onUpdate(node.id, { name: nameDraft });
  };

  const patchData = (patch: Record<string, unknown>) =>
    onUpdate(node.id, { data: { ...(node.data as unknown as Record<string, unknown>), ...patch } as unknown as DagNode["data"] });
  const patchOverride = (k: string, v: string) => {
    const data = node.data as RequestNodeData;
    patchData({ overrides: { ...data.overrides, [k]: v } });
  };

  const savedRequestById = useMemo(() => {
    const map = new Map<string, any>();
    (savedRequests || []).forEach(r => { if (r && r.id != null) map.set(String(r.id), r); });
    return map;
  }, [savedRequests]);
  const lookupConfig = (id: string): RequestConfig | undefined => {
    const saved = savedRequestById.get(id);
    return saved ? savedRequestToConfig(saved) : undefined;
  };

  return (
    <div style={{ width: 320, borderLeft: "1px solid var(--border)", padding: 12, overflow: "auto", background: "var(--bg)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input value={node.label} onChange={e => onUpdate(node.id, { label: e.target.value })}
          style={{ fontWeight: 700, flex: 1 }} />
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Reference name</label>
      <input value={nameDraft} onChange={e => setNameDraft(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
        onBlur={commitName}
        onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        style={{ width: "100%", marginBottom: 8 }} />

      {node.type === "request" && (
        <RequestInspector node={node} savedRequests={savedRequests} patchData={patchData}
          patchOverride={patchOverride} onDetach={() => onDetach(node.id)}
          graph={graph} steps={steps} env={env} />
      )}
      {node.type === "payload" && (
        <PayloadInspector data={node.data as PayloadNodeData} patchData={patchData} />
      )}
      {node.type === "condition" && (
        <textarea value={(node.data as ConditionNodeData).expression || ""} onChange={e => patchData({ expression: e.target.value })}
          rows={4} style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="steps.login.response.status === 200" />
      )}
      {node.type === "transform" && (
        <textarea value={(node.data as TransformNodeData).script || ""} onChange={e => patchData({ script: e.target.value })}
          rows={12} style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="emit({ id: steps.list.response.data.items[0].id })" />
      )}

      {node.type === "request" && (
        <ResultTabs tab={tab} setTab={setTab} stepResult={stepResult}
          resolved={buildResolvedPreview(node.data as RequestNodeData, lookupConfig, steps, env)} />
      )}
    </div>
  );
}

function PayloadInspector({ data, patchData }: { data: PayloadNodeData; patchData: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Content type</label>
        <select value={data.contentType || "json"} onChange={e => patchData({ contentType: e.target.value })}>
          <option value="json">JSON</option>
          <option value="text">Text</option>
        </select>
      </div>
      <textarea value={data.content || ""} onChange={e => patchData({ content: e.target.value })}
        rows={12} style={{ width: "100%", fontFamily: "monospace", fontSize: "0.72rem" }}
        placeholder='{"key": "{{steps.login.response.body.token}}"}' />
    </div>
  );
}

function RequestInspector({ node, savedRequests, patchData, patchOverride, onDetach, graph, steps, env }: {
  node: DagNode;
  savedRequests: any[];
  patchData: (patch: Record<string, unknown>) => void;
  patchOverride: (k: string, v: string) => void;
  onDetach: () => void;
  graph: DagGraph;
  steps: StepsContext;
  env: Record<string, string>;
}) {
  const data = node.data as RequestNodeData;
  const linked = !!data.linkedRequestId;
  const cfg: Partial<RequestConfig> = linked ? {} : (data.inlineConfig || {});
  const val = (k: keyof RequestConfig): string => (data.overrides[k] ?? (linked ? "" : cfg[k]) ?? "");
  const FIELDS: [keyof RequestConfig, string][] = [
    ["url", "URL"], ["headers", "Headers (JSON)"], ["body", "Body"],
    ["params", "Params (k=v)"], ["pathVars", "Path vars (k=v)"],
  ];
  const refSuggestions = useMemo(() => suggestRefs(graph, node.id, steps), [graph, node.id, steps]);
  const hasRunData = Object.keys(steps).length > 0;
  const resolveCtx: ResolveContext = { steps, env };
  return (
    <div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Linked request</label>
      <select value={data.linkedRequestId || ""} onChange={e => patchData({ linkedRequestId: e.target.value || undefined })}
        style={{ width: "100%", marginBottom: 6 }}>
        <option value="">(inline / none)</option>
        {savedRequests.map((r: any) => <option key={r.id} value={r.id}>{r.name || r.url}</option>)}
      </select>
      {linked && <button className="ghost" onClick={onDetach} style={{ marginBottom: 8 }}>Detach to copy</button>}
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <select value={val("method") || "GET"} onChange={e => patchOverride("method", e.target.value)}>
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      <datalist id={`ref-suggestions-${node.id}`}>
        {refSuggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      {FIELDS.map(([k, lbl]) => {
        const fieldValue = val(k);
        return (
          <div key={k} style={{ marginBottom: 6 }}>
            <label style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>{lbl} {linked ? "(override)" : ""}</label>
            <textarea value={fieldValue} onChange={e => patchOverride(k, e.target.value)} rows={k === "body" || k === "headers" ? 4 : 2}
              // @ts-expect-error `list` isn't in React's textarea typings, but browsers honor it for datalist wiring
              list={`ref-suggestions-${node.id}`}
              style={{ width: "100%", fontFamily: "monospace", fontSize: "0.72rem" }}
              placeholder={k === "headers" ? '{"Authorization":"Bearer {{steps.login.response.body.token}}"}' : ""} />
            {hasRunData && fieldValue.includes("{{") && (
              <div style={{ fontSize: "0.62rem", color: "#2dd4bf" }}>→ {resolveTemplate(fieldValue, resolveCtx)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Resolve the effective (linked + override) request config, then substitute {{...}} templates,
 *  so the inspector can preview what will actually be sent — independent of a prior run result. */
function buildResolvedPreview(
  data: RequestNodeData,
  lookup: (id: string) => RequestConfig | undefined,
  steps: StepsContext,
  env: Record<string, string>,
): ResolvedPreview {
  const { config, brokenLink } = resolveStepConfig(data, lookup);
  const ctx: ResolveContext = { steps, env };
  return {
    brokenLink,
    method: config.method,
    url: resolveTemplate(config.url, ctx),
    headers: resolveTemplate(config.headers, ctx),
    body: resolveTemplate(config.body, ctx),
    params: resolveTemplate(config.params, ctx),
    pathVars: resolveTemplate(config.pathVars, ctx),
  };
}

function ResultTabs({ tab, setTab, stepResult, resolved }: {
  tab: ResultTab; setTab: (t: ResultTab) => void; stepResult?: StepResult; resolved: ResolvedPreview;
}) {
  const content: unknown = tab === "resolved" ? resolved
    : tab === "request" ? (stepResult?.request ?? "Run the flow to see the request that was sent.")
    : (stepResult?.response ?? "Run the flow to see the response.");
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {(["resolved", "request", "response"] as ResultTab[]).map(t => (
          <button key={t} className="ghost" onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 700 : 400 }}>{t}</button>
        ))}
      </div>
      <pre style={{ fontSize: "0.68rem", whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
        {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}

export default Inspector;
