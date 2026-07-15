import { useEffect, useMemo, useState } from "react";
import type {
  DagGraph, DagNode, RequestConfig, RequestNodeData, PayloadNodeData,
  ConditionNodeData, TransformNodeData, StepResult, StepsContext,
} from "./types";
import { resolveTemplate, type ResolveContext } from "./resolver";
import { resolveStepConfig, savedRequestToConfig } from "./linkResolve";
import { suggestRefs } from "./refSuggest";
import { TokenField } from "./TokenField";

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
    <div style={{ width: 360, borderLeft: "2px solid var(--border)", background: "var(--panel)", overflow: "auto" }}>
      <div style={{ padding: "14px 15px 0" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={node.label} onChange={e => onUpdate(node.id, { label: e.target.value })}
            style={{ font: "650 15px/1 system-ui", flex: 1, background: "transparent", border: "none", color: "var(--text)", outline: "none" }} />
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
          <input value={nameDraft} onChange={e => setNameDraft(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
            onBlur={commitName} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={{ font: '600 11px/1 var(--font-mono, monospace)', color: "#ff9f88",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
              padding: "4px 8px", borderRadius: 6, width: 120 }} />
          <span style={{ font: "400 10.5px/1 system-ui", color: "var(--muted)" }}>used as {"{{"}{nameDraft}.…{"}}"}</span>
        </div>
      </div>
      <div style={{ padding: 15 }}>
        {node.type === "request" && (
          <RequestInspector node={node} savedRequests={savedRequests} patchData={patchData}
            patchOverride={patchOverride} onDetach={() => onDetach(node.id)}
            graph={graph} steps={steps} env={env} />
        )}
        {node.type === "payload" && (
          <PayloadInspector data={node.data as PayloadNodeData} patchData={patchData} />
        )}
        {node.type === "condition" && (
          <TokenField value={(node.data as ConditionNodeData).expression || ""} onChange={(v) => patchData({ expression: v })}
            rows={4} placeholder="steps.login.response.status === 200" />
        )}
        {node.type === "transform" && (
          <TokenField value={(node.data as TransformNodeData).script || ""} onChange={(v) => patchData({ script: v })}
            rows={12} placeholder="emit({ id: steps.list.response.data.items[0].id })" />
        )}

        {node.type === "request" && (
          <ResultTabs tab={tab} setTab={setTab} stepResult={stepResult}
            resolved={buildResolvedPreview(node.data as RequestNodeData, lookupConfig, steps, env)} />
        )}
      </div>
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
      <TokenField value={data.content || ""} onChange={(v) => patchData({ content: v })} rows={12}
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
      <div style={{ marginBottom: 15 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, font: "600 10.5px/1 system-ui", color: "var(--muted)" }}>
          <span>Linked request</span>
          {linked && <button type="button" onClick={onDetach} style={{ color: "#ff9f88", cursor: "pointer", fontWeight: 600, background: "none", border: "none", padding: 0, font: "inherit" }}>Detach to copy</button>}
        </div>
        <select value={data.linkedRequestId || ""} onChange={e => patchData({ linkedRequestId: e.target.value || undefined })}
          style={{ width: "100%", background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", color: "var(--text)" }}>
          <option value="">(inline / none)</option>
          {savedRequests.map((r: any) => <option key={r.id} value={r.id}>{r.name || r.url}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 15 }}>
        <label style={{ font: "600 10.5px/1 system-ui", color: "var(--muted)" }}>Method {linked ? "(override)" : ""}</label>
        <select value={val("method") || "GET"} onChange={e => patchOverride("method", e.target.value)}
          style={{ display: "block", marginTop: 6, background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)" }}>
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      {FIELDS.map(([k, lbl]) => {
        const fieldValue = val(k);
        return (
          <div key={k} style={{ marginBottom: 15 }}>
            <label style={{ display: "block", font: "600 10.5px/1 system-ui", color: "var(--muted)", marginBottom: 6 }}>{lbl} {linked ? "(override)" : ""}</label>
            <TokenField value={fieldValue} onChange={(v) => patchOverride(k, v)} rows={k === "body" || k === "headers" ? 4 : 2}
              placeholder={k === "headers" ? '{"Authorization":"Bearer {{steps.login.response.body.token}}"}' : ""} />
            {hasRunData && fieldValue.includes("{{") && (
              <div style={{ font: '400 10.5px/1.4 var(--font-mono, monospace)', color: "#4fdccf", marginTop: 6 }}>→ {resolveTemplate(fieldValue, resolveCtx)}</div>
            )}
            {refSuggestions.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {refSuggestions.map(s => (
                  <button key={s} type="button" title={`Insert ${s}`} onClick={() => patchOverride(k, fieldValue + s)}
                    style={{ font: '500 10px/1 var(--font-mono, monospace)', color: "#8fd7cf", cursor: "pointer",
                      background: "color-mix(in srgb, var(--method-get) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--method-get) 28%, transparent)",
                      padding: "4px 7px", borderRadius: 6 }}>{s}</button>
                ))}
              </div>
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
      <div style={{ display: "flex", gap: 2, marginBottom: 8, borderBottom: "1px solid var(--border)" }}>
        {(["resolved", "request", "response"] as ResultTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ font: "600 12px/1 system-ui", background: "none", border: "none",
            color: tab === t ? "var(--text)" : "var(--muted)", padding: "9px 12px", cursor: "pointer",
            borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent" }}>{t}</button>
        ))}
      </div>
      <pre style={{ fontSize: "0.68rem", whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
        {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}

export default Inspector;
