import { Handle, Position, type NodeProps } from "@xyflow/react";

const METHOD_COLORS: Record<string, string> = { GET: "#22c55e", POST: "#f59e0b", PUT: "#3b82f6", PATCH: "#a78bfa", DELETE: "#ff5555", HEAD: "#64748b", OPTIONS: "#64748b" };
const STATUS_RING: Record<string, string> = { idle: "#334155", running: "#f59e0b", success: "#22c55e", error: "#ff5555", skipped: "#64748b", pending: "#a78bfa" };

export function RequestNode({ data }: NodeProps) {
  const d = data as any;
  const method = d.method || "GET";
  return (
    <div style={{ width: 200, borderRadius: 10, background: "rgba(17,24,39,0.92)", border: `1.5px solid ${STATUS_RING[d.status] || "#334155"}`, padding: "8px 10px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "0.6rem", fontWeight: 800, color: METHOD_COLORS[method] || "#64748b" }}>{method}</span>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
        {d.brokenLink && <span title="Linked request missing" style={{ marginLeft: "auto", color: "#ff5555" }}>⚠</span>}
      </div>
      <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{d.name}</div>
      {d.io && <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: 4 }}>{d.io}</div>}
      {d.status === "skipped" && d.reason && (
        <div style={{ fontSize: "0.58rem", color: "#64748b" }}>
          {d.reason === "upstream-error" ? "skipped: upstream failed" : d.reason === "losing-branch" ? "skipped: branch not taken" : "skipped"}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
