import React from "react";

export interface AddStepPickerProps {
  savedRequests: any[];
  onAddRequest: (method: string) => void;
  onLinkRequest: (req: any) => void;
  onAddPayload: () => void;
  onAddCondition: () => void;
  onAddTransform: () => void;
  onClose: () => void;
}

const card: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", textAlign: "left",
  width: "100%", border: "1px solid var(--border)", background: "var(--panel-2)", borderRadius: 10, padding: "9px 11px", color: "var(--text)", cursor: "pointer", marginBottom: 6 };
const ic = (fg: string): React.CSSProperties => ({ width: 28, height: 28, borderRadius: 8, flex: "none",
  display: "flex", alignItems: "center", justifyContent: "center", font: '800 8.5px/1 var(--font-mono, monospace)',
  background: `color-mix(in srgb, ${fg} 15%, transparent)`, color: fg });

export function AddStepPicker(p: AddStepPickerProps) {
  return (
    <div style={{ position: "absolute", zIndex: 20, top: 60, left: 10, width: 300, background: "var(--panel)",
      border: "1px solid var(--border)", borderRadius: 12, padding: 12, maxHeight: 460, overflow: "auto", boxShadow: "0 10px 30px rgba(0,0,0,.45)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <b style={{ fontSize: "0.85rem" }}>Add step</b><button className="ghost" onClick={p.onClose}>✕</button>
      </div>
      <button style={card} onClick={() => { p.onAddRequest("GET"); p.onClose(); }}>
        <span style={ic("var(--method-post)")}>API</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Request</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Call an endpoint</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddPayload(); p.onClose(); }}>
        <span style={ic("var(--method-get)")}>{"{ }"}</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Payload</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Inject a JSON body</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddCondition(); p.onClose(); }}>
        <span style={ic("var(--method-patch)")}>◆</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Condition</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Branch on a response</div></div>
      </button>
      <button style={card} onClick={() => { p.onAddTransform(); p.onClose(); }}>
        <span style={ic("var(--method-get)")}>ƒ</span><div><div style={{ font: "650 12.5px/1 system-ui" }}>Transform</div><div style={{ font: "400 10.5px/1.3 system-ui", color: "var(--muted)", marginTop: 2 }}>Reshape data (JS)</div></div>
      </button>
      <label style={{ font: "600 10px/1 system-ui", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", display: "block", margin: "10px 0 6px" }}>Link a saved request</label>
      {p.savedRequests.map(r => (
        <button key={r.id} className="ghost" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
          onClick={() => { p.onLinkRequest(r); p.onClose(); }}>{r.name || r.url}</button>
      ))}
    </div>
  );
}

export default AddStepPicker;
