import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleDot, handleStyle, skipReasonText, tint } from "./nodeStyles";
import { NodeActions } from "./NodeActions";

const VIOLET = "var(--method-patch)";

function ConditionNodeImpl({ data, selected }: NodeProps) {
  const d = data as any;
  const sel = !!selected;
  return (
    <div style={{ position: "relative", width: 74, height: 74 }}>
      {sel && (
        <NodeActions
          onEdit={d.onEdit}
          onRunFrom={d.onRunFrom}
          onRunOnly={d.onRunOnly}
          onRunUpTo={d.onRunUpTo}
          onDelete={d.onDelete}
          status={d.status}
        />
      )}
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={{ position: "absolute", inset: 6, transform: "rotate(45deg)", background: tint(VIOLET),
        border: `1.5px solid ${VIOLET}`, borderRadius: 9, outline: sel ? "2px solid var(--accent)" : "none" }} />
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

export const ConditionNode = memo(ConditionNodeImpl);
