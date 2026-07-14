import { Handle, Position, type NodeProps } from "@xyflow/react";
export function ConditionNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: "rgba(167,139,250,0.15)", border: "1.5px solid #a78bfa", borderRadius: 8 }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", color: "#a78bfa" }}>{d.label}</div>
      <Handle id="true" type="source" position={Position.Bottom} style={{ background: "#22c55e" }} />
      <Handle id="false" type="source" position={Position.Right} style={{ background: "#ff5555" }} />
    </div>
  );
}
