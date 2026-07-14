import { Handle, Position, type NodeProps } from "@xyflow/react";
export function TransformNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ width: 140, borderRadius: 6, background: "rgba(45,212,191,0.1)", border: "1.5px dashed #2dd4bf", padding: "6px 8px", color: "var(--text)" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#2dd4bf" }}>ƒ Transform</div>
      <div style={{ fontSize: "0.72rem" }}>{d.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
