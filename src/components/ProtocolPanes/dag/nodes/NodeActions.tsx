import { Pencil, Play, Circle, FlagTriangleRight, Trash2 } from "lucide-react";
import { STATUS } from "./nodeStyles";

export interface NodeActionHandlers {
  onEdit?: () => void;
  onRunOnly?: () => void;
  onRunFrom?: () => void;
  onRunUpTo?: () => void;
  onDelete?: () => void;
  status?: string;
}

const btn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22,
  border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--muted)",
  borderRadius: 6, cursor: "pointer", padding: 0,
};

function stop(fn?: () => void) {
  return (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); fn?.(); };
}

export function NodeActions(h: NodeActionHandlers) {
  const failed = h.status === "error";
  return (
    <div className="dag-node-actions nodrag" onMouseDown={(e) => e.stopPropagation()} style={{ position: "absolute", top: -12, right: 6, display: "flex", gap: 4, zIndex: 3 }}>
      {h.onEdit && <button type="button" title="Edit" style={btn} onClick={stop(h.onEdit)}><Pencil size={12} /></button>}
      {h.onRunFrom && (
        <button type="button" title={failed ? "Retry from here" : "Run from here"} onClick={stop(h.onRunFrom)}
          style={{ ...btn, color: failed ? STATUS.error.color : "var(--accent)", borderColor: failed ? STATUS.error.color : "var(--accent)" }}>
          <Play size={12} />
        </button>
      )}
      {h.onRunOnly && <button type="button" title="Run only this step" style={btn} onClick={stop(h.onRunOnly)}><Circle size={11} /></button>}
      {h.onRunUpTo && <button type="button" title="Run up to here" style={btn} onClick={stop(h.onRunUpTo)}><FlagTriangleRight size={12} /></button>}
      {h.onDelete && <button type="button" title="Delete step" style={{ ...btn, color: STATUS.error.color }} onClick={stop(h.onDelete)}><Trash2 size={12} /></button>}
    </div>
  );
}
