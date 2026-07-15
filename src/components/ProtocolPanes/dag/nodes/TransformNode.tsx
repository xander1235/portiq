import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeCard, handleStyle, refTag, skipReasonText, tint } from "./nodeStyles";
import { NodeActions } from "./NodeActions";

const TEAL = "var(--method-get)";

export function TransformNode({ data, selected }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ ...nodeCard, position: "relative", width: 160, padding: "10px 12px", background: tint(TEAL, 8),
      border: `1px dashed ${TEAL}`, outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}>
      <NodeActions
        onEdit={(data as any).onEdit}
        onRunFrom={(data as any).onRunFrom}
        onRunOnly={(data as any).onRunOnly}
        onRunUpTo={(data as any).onRunUpTo}
        onDelete={(data as any).onDelete}
        status={(data as any).status}
      />
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ font: '800 10px/1 var(--font-mono, monospace)', color: TEAL }}>ƒ TRANSFORM</div>
      <div style={{ font: "650 12.5px/1.15 system-ui", marginTop: 4 }}>{d.label}</div>
      <div style={{ ...refTag, marginTop: 3 }}>@{d.name}</div>
      {d.status === "skipped" && <div style={{ font: "500 10px/1 system-ui", color: "var(--muted)", marginTop: 4 }}>{skipReasonText(d.reason)}</div>}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}
