import { Handle, Position, type NodeProps } from "@xyflow/react";
export function ConditionNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: "rgba(167,139,250,0.15)", border: "1.5px solid #a78bfa", borderRadius: 8 }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", color: "#a78bfa" }}>{d.label}</div>
      {d.status === "skipped" && d.reason && (
        <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 100, textAlign: "center", fontSize: "0.58rem", color: "#64748b", whiteSpace: "nowrap" }}>
          {d.reason === "upstream-error" ? "skipped: upstream failed" : d.reason === "losing-branch" ? "skipped: branch not taken" : "skipped"}
        </div>
      )}
      <Handle id="true" type="source" position={Position.Bottom} style={{ background: "#22c55e" }} />
      <Handle id="false" type="source" position={Position.Right} style={{ background: "#ff5555" }} />
    </div>
  );
}
