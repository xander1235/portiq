import { Handle, Position, type NodeProps } from "@xyflow/react";
export function PayloadNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ width: 170, borderRadius: 10, background: "rgba(45,212,191,0.12)", border: "1.5px solid #2dd4bf", padding: "8px 10px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#2dd4bf" }}>{"{ } Payload"}</div>
      <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{d.label}</div>
      <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{d.name}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
