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

export function AddStepPicker(p: AddStepPickerProps) {
  return (
    <div style={{ position: "absolute", zIndex: 20, top: 48, left: 10, width: 320, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, maxHeight: 420, overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <b>Add step</b><button className="ghost" onClick={p.onClose}>✕</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => (
          <button key={m} className="ghost" onClick={() => { p.onAddRequest(m); p.onClose(); }}>{m}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button className="ghost" onClick={() => { p.onAddPayload(); p.onClose(); }}>+ Payload</button>
        <button className="ghost" onClick={() => { p.onAddCondition(); p.onClose(); }}>+ Condition</button>
        <button className="ghost" onClick={() => { p.onAddTransform(); p.onClose(); }}>+ Transform</button>
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Link a saved request</label>
      {p.savedRequests.map(r => (
        <button key={r.id} className="ghost" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
          onClick={() => { p.onLinkRequest(r); p.onClose(); }}>{r.name || r.url}</button>
      ))}
    </div>
  );
}

export default AddStepPicker;
