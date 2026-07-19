export interface VizPoint {
  label: string;
  value: number;
}

export type VizType = "bar" | "line" | "pie";

export interface VizSpec {
  type: VizType;
  x: string;
  y: string;
  series?: string;
  title?: string;
  points: VizPoint[];
}

const MAX_POINTS = 20;
const VALID_TYPES: VizType[] = ["bar", "line", "pie"];

function isNumeric(v: any): boolean {
  return typeof v === "number" && !Number.isNaN(v);
}

function buildPoints(rows: any[], labelKey: string, valueKey: string): VizPoint[] {
  return rows.slice(0, MAX_POINTS).map((row, i) => ({
    label: String(row?.[labelKey] ?? `#${i + 1}`),
    value: Number(row?.[valueKey]),
  })).filter((p) => isNumeric(p.value));
}

export function autoChartConfig(rows: any[]): VizSpec | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const keys = Object.keys(rows[0] || {});
  const valueKey = keys.find((k) => rows.some((r) => isNumeric(r?.[k])));
  if (!valueKey) return null;
  const labelKey = keys.find((k) => k !== valueKey && typeof rows[0]?.[k] !== "object") || keys[0] || valueKey;
  const points = buildPoints(rows, labelKey, valueKey);
  if (points.length === 0) return null;
  return { type: "bar", x: labelKey, y: valueKey, title: valueKey, points };
}

export function normalizeVizSpec(spec: any, rows: any[]): VizSpec | null {
  if (!spec || typeof spec !== "object") return null;

  const type: VizType = VALID_TYPES.includes(spec.type) ? spec.type : "bar";
  const title = typeof spec.title === "string" ? spec.title : undefined;
  const series = typeof spec.series === "string" ? spec.series : undefined;

  // Explicit points win.
  if (Array.isArray(spec.points) && spec.points.length > 0) {
    const points = spec.points
      .map((p: any) => ({ label: String(p?.label ?? ""), value: Number(p?.value) }))
      .filter((p: VizPoint) => isNumeric(p.value))
      .slice(0, MAX_POINTS);
    if (points.length === 0) return null;
    return { type, x: String(spec.x ?? "label"), y: String(spec.y ?? "value"), series, title, points };
  }

  // Otherwise resolve against rows.
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const x = typeof spec.x === "string" ? spec.x : Object.keys(rows[0] || {})[0];
  const y = typeof spec.y === "string" ? spec.y : "";
  if (!y || !rows.some((r) => isNumeric(r?.[y]))) return null;
  const points = buildPoints(rows, x, y);
  if (points.length === 0) return null;
  return { type, x, y, series, title, points };
}
