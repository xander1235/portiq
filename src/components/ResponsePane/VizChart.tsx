// src/components/ResponsePane/VizChart.tsx
import React from "react";
import type { VizSpec, VizPoint } from "../../services/visualize";

// Categorical palette validated against the app's chart surfaces via the dataviz
// skill's validate_palette.js (CVD ΔE >= 8.4, normal-vision ΔE >= 19.3, contrast
// >= 3:1 on both surfaces). Dark-surface steps are the default; light-surface
// steps override under :root[data-theme="light"] — defined globally in
// src/styles.css as --viz-series-0..7, same token pattern as --bg/--text/--muted.
const VIZ_SERIES_COUNT = 8;
const VIZ_CHART_CLASS = "viz-chart-root";

function seriesColor(i: number): string {
  return `var(--viz-series-${i % VIZ_SERIES_COUNT})`;
}

const W = 640;
const H = 280;
const PAD = { top: 24, right: 16, bottom: 48, left: 48 };

function BarChart({ points }: { points: VizPoint[] }) {
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const bw = plotW / points.length;
  return (
    <>
      {points.map((p, i) => {
        const h = (p.value / max) * plotH;
        const x = PAD.left + i * bw + bw * 0.15;
        const y = PAD.top + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw * 0.7} height={h} rx={3} fill={seriesColor(i)} />
            <text x={x + bw * 0.35} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {p.label.length > 8 ? p.label.slice(0, 7) + "…" : p.label}
            </text>
            <text x={x + bw * 0.35} y={y - 4} textAnchor="middle" fontSize="10" fill="var(--text)">{p.value}</text>
          </g>
        );
      })}
    </>
  );
}

function LineChart({ points }: { points: VizPoint[] }) {
  const max = Math.max(...points.map((p) => p.value), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: PAD.left + i * step,
    y: PAD.top + plotH - (p.value / max) * plotH,
    p,
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  return (
    <>
      <path d={path} fill="none" stroke={seriesColor(0)} strokeWidth={2} />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={3} fill={seriesColor(0)} />
          <text x={c.x} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {c.p.label.length > 8 ? c.p.label.slice(0, 7) + "…" : c.p.label}
          </text>
        </g>
      ))}
    </>
  );
}

function PieChart({ points }: { points: VizPoint[] }) {
  const total = points.reduce((s, p) => s + p.value, 0) || 1;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 40;
  // Precompute each slice's start angle from the sum of preceding values, so
  // nothing is reassigned mid-render (n <= 20, so the O(n^2) sum is negligible).
  const START = -Math.PI / 2;
  const slices = points.map((p, i) => {
    const before = points.slice(0, i).reduce((s, q) => s + q.value, 0);
    const start = START + (before / total) * Math.PI * 2;
    const sweep = (p.value / total) * Math.PI * 2;
    return { start, sweep };
  });
  return (
    <>
      {points.map((p, i) => {
        const { start, sweep } = slices[i];
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const end = start + sweep;
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const large = sweep > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
            fill={seriesColor(i)}
            stroke="var(--bg)"
            strokeWidth={1}
          />
        );
      })}
    </>
  );
}

export function VizChart({ spec }: { spec: VizSpec }) {
  if (!spec || !spec.points || spec.points.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.8rem", padding: "16px" }}>No data to chart.</div>;
  }
  return (
    <div className={VIZ_CHART_CLASS}>
      {spec.title && <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "8px" }}>{spec.title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title || `${spec.type} chart`}>
        {spec.type === "bar" && <BarChart points={spec.points} />}
        {spec.type === "line" && <LineChart points={spec.points} />}
        {spec.type === "pie" && <PieChart points={spec.points} />}
      </svg>
      {spec.type === "pie" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
          {spec.points.map((p, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", color: "var(--muted)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seriesColor(i) }} />
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
