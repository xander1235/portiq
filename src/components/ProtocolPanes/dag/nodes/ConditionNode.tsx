import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleDot, handleStyle, skipReasonText, tint } from "./nodeStyles";
import { NodeActions } from "./NodeActions";

const VIOLET = "var(--method-patch)";

export function ConditionNode({ data, selected }: NodeProps) {
  const d = data as any;
  return (
    <div style={{ position: "relative", width: 74, height: 74 }}>
      <NodeActions
        onEdit={(data as any).onEdit}
        onRunFrom={(data as any).onRunFrom}
        onRunOnly={(data as any).onRunOnly}
        onRunUpTo={(data as any).onRunUpTo}
        onDelete={(data as any).onDelete}
        status={(data as any).status}
      />
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: tint(VIOLET),
        border: `1.5px solid ${VIOLET}`, borderRadius: 9, outline: selected ? "2px solid var(--accent)" : "none" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        font: '700 8.5px/1.2 var(--font-mono, monospace)', color: VIOLET, textAlign: "center", padding: 6, wordBreak: "break-word" }}>{d.label}</div>
      {d.status === "skipped" && (
        <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", width: 120,
          textAlign: "center", font: "500 10px/1 system-ui", color: "var(--muted)", whiteSpace: "nowrap", marginTop: 4 }}>{skipReasonText(d.reason)}</div>
      )}
      <Handle id="true" type="source" position={Position.Bottom} style={handleDot("#2ecc71")} />
      <Handle id="false" type="source" position={Position.Right} style={handleDot("#ff5555")} />
    </div>
  );
}
