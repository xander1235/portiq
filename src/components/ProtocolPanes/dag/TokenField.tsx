import type React from "react";
import { splitTemplate } from "./tokenize";

export function TokenField({ value, onChange, rows = 2, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  const shared: React.CSSProperties = {
    margin: 0, padding: "9px 11px", border: 0, width: "100%", boxSizing: "border-box",
    font: '400 11.5px/1.5 var(--font-mono, monospace)', whiteSpace: "pre-wrap", wordBreak: "break-word",
    gridArea: "1 / 1", background: "transparent", letterSpacing: 0,
  };
  return (
    <div style={{ display: "grid", background: "#0f1420", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div aria-hidden style={{ ...shared, color: "var(--text)", pointerEvents: "none" }}>
        {splitTemplate(value).map((seg, i) => seg.ref
          ? <span key={i} style={{ color: "#ffb59c" }}>{seg.text}</span>
          : <span key={i}>{seg.text}</span>)}
        {"​"}
      </div>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        spellCheck={false} style={{ ...shared, color: "transparent", caretColor: "var(--text)", resize: "vertical", outline: "none" }} />
    </div>
  );
}

export default TokenField;
