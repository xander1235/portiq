import { Handle, Position, type NodeProps } from "@xyflow/react";
import { METHOD_COLOR, STATUS, nodeCard, handleStyle, tile, statusPill, refTag, urlText, skipReasonText } from "./nodeStyles";

export function RequestNode({ data, selected }: NodeProps) {
  const d = data as any;
  const method = (d.method || "GET").toUpperCase();
  const color = METHOD_COLOR[method] || "var(--muted)";
  const status = d.status || "idle";
  return (
    <div style={{ ...nodeCard, width: 226, padding: 12, display: "flex", gap: 11,
      outline: selected ? "2px solid var(--accent)" : "none", outlineOffset: 2 }}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div style={tile(color)}>{method}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: "650 13.5px/1.15 system-ui", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          {d.brokenLink && <span title="Linked request missing" style={{ color: "#ff5555" }}>⚠</span>}
          <span style={statusPill(status)}>{(STATUS[status] || STATUS.idle).label}</span>
        </div>
        <div style={{ ...refTag, marginTop: 4 }}>@{d.name}</div>
        {d.io && <div style={urlText}>{d.io}</div>}
        {status === "skipped" && (
          <div style={{ font: "500 10px/1 system-ui", color: "var(--muted)", marginTop: 4 }}>{skipReasonText(d.reason)}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}
