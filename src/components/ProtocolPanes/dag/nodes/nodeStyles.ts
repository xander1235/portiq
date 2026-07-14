import type { CSSProperties } from "react";

export const METHOD_COLOR: Record<string, string> = {
  GET: "var(--method-get)", POST: "var(--method-post)", PUT: "var(--method-put)",
  PATCH: "var(--method-patch)", DELETE: "var(--method-delete)",
  HEAD: "var(--muted)", OPTIONS: "var(--muted)",
};

export const STATUS: Record<string, { color: string; label: string }> = {
  idle: { color: "var(--muted)", label: "Idle" },
  pending: { color: "var(--muted)", label: "…" },
  running: { color: "#f1c40f", label: "Run" },
  success: { color: "#2ecc71", label: "OK" },
  error: { color: "#ff5555", label: "Fail" },
  skipped: { color: "var(--muted)", label: "skipped" },
};

export const ACCENT = "var(--accent)";

/** Translucent tint of a (possibly var()) color for chip/tile backgrounds. */
export const tint = (color: string, pct = 15): string =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function skipReasonText(reason?: string): string {
  if (reason === "upstream-error") return "skipped · upstream failed";
  if (reason === "losing-branch") return "skipped · branch not taken";
  return "skipped";
}

export const nodeCard: CSSProperties = {
  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14,
  boxShadow: "0 8px 22px rgba(0,0,0,.4)", color: "var(--text)",
};

export const handleStyle: CSSProperties = {
  width: 9, height: 9, borderRadius: "50%", background: "var(--bg)",
  border: "2px solid var(--accent)",
};

export const tile = (color: string): CSSProperties => ({
  width: 34, height: 34, borderRadius: 9, flex: "none",
  display: "flex", alignItems: "center", justifyContent: "center",
  font: '800 9px/1 var(--font-mono, monospace)', letterSpacing: ".04em",
  background: tint(color), color,
});

export const statusPill = (status: string): CSSProperties => {
  const c = (STATUS[status] || STATUS.idle).color;
  return {
    font: "700 9px/1 system-ui", padding: "4px 8px", borderRadius: 20,
    background: tint(c, 18), color: c, whiteSpace: "nowrap",
  };
};

export const refTag: CSSProperties = {
  font: '500 10.5px/1 var(--font-mono, monospace)', color: "var(--muted)",
};

export const urlText: CSSProperties = {
  font: '400 10.5px/1.3 var(--font-mono, monospace)', color: "var(--muted)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 6,
};
