import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { RequestEditor } from "../RequestPane/RequestEditor.jsx";
import { ResponseViewer } from "../ResponsePane/ResponseViewer.jsx";
import { jsonToCsv, jsonToXml, xmlToJson } from "../../services/format.js";
import { applyDerivedFields, filterRows, sortRows } from "../../services/table.js";

/* ─── Constants ─── */
const NODE_W = 180, NODE_H = 52, GAP_X = 80, GAP_Y = 56, CANVAS_PAD = 40;
const COND_SIZE = 48;
const XFORM_W = 110, XFORM_H = 34;
const ACCENT = "#fb923c";
const COND_CLR = "#a78bfa";
const XFORM_CLR = "#2dd4bf";
const YES_CLR = "#22c55e";
const NO_CLR = "#ff5555";
const STATUS = {
  idle: { color: "#64748b", bg: "#64748b10", label: "Idle" },
  pending: { color: "#a78bfa", bg: "#a78bfa10", label: "…" },
  running: { color: "#f59e0b", bg: "#f59e0b10", label: "Run" },
  success: { color: "#22c55e", bg: "#22c55e10", label: "Done" },
  error: { color: "#ff5555", bg: "#ff555510", label: "Err" },
  skipped: { color: "#64748b", bg: "#64748b08", label: "Skip" },
};
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_COLORS = { GET: "#22c55e", POST: "#f59e0b", PUT: "#3b82f6", PATCH: "#a78bfa", DELETE: "#ff5555", HEAD: "#64748b", OPTIONS: "#64748b" };
const STORAGE_KEY = "commu_dag_flow_state_v1";
const REQUEST_TABS = ["Params", "Headers", "Auth", "Body", "Tests"];
const RESPONSE_TABS = ["Pretty", "Raw", "XML", "Table", "Visualize", "Headers"];

function findArrayPaths(value, prefix = "$") {
  const paths = [];
  if (Array.isArray(value)) {
    paths.push(prefix);
    value.forEach((item, idx) => {
      paths.push(...findArrayPaths(item, `${prefix}[${idx}]`));
    });
    return paths;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      paths.push(...findArrayPaths(child, `${prefix}.${key}`));
    });
  }
  return paths;
}

function getValueByPath(root, path) {
  if (!path || path === "$") return root;
  const cleaned = path.replace(/^\$\./, "");
  const parts = cleaned.split(".").flatMap((part) => {
    const match = part.match(/(\w+)\[(\d+)\]/);
    if (match) return [match[1], Number(match[2])];
    return [part];
  });
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), root);
}

function getDims(node) {
  if (!node) return { w: NODE_W, h: NODE_H };
  if (node.type === "condition") return { w: COND_SIZE, h: COND_SIZE };
  if (node.type === "transform") return { w: XFORM_W, h: XFORM_H };
  return { w: NODE_W, h: NODE_H };
}

/* ─── Helpers ─── */
const uid = (pfx = "n") => `${pfx}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function evaluateCondition(expr, ctx, iteration) {
  if (!expr || !expr.trim()) return true;
  try {
    const fn = new Function("status", "body", "headers", "ctx", "iteration", `return (${expr});`);
    return !!fn(ctx?.response?.status, ctx?.response?.data, ctx?.response?.headers, ctx, iteration);
  } catch { return false; }
}

function runTransformScript(script, inCtx) {
  if (!script || !script.trim()) return { emissions: [inCtx], error: null };
  const emissions = [];
  const emit = (data) => emissions.push(typeof data === "object" && data !== null ? { ...data } : { _value: data });
  try {
    const fn = new Function("ctx", "status", "body", "headers", "emit", "reqBody", "reqHeaders", "params", script);
    fn(inCtx, inCtx?.response?.status, inCtx?.response?.data,
      inCtx?.response?.headers, emit,
      inCtx?.request?.body, inCtx?.request?.headers, inCtx?.request?.params);
  } catch (err) { return { error: err.message, emissions: [] }; }
  if (emissions.length === 0) emissions.push(inCtx);
  return { emissions, error: null };
}

function getSvgCoords(e, canvasRef) {
  const r = canvasRef.current?.getBoundingClientRect();
  if (!r) return { x: 0, y: 0 };
  return { x: e.clientX - r.left + (canvasRef.current?.scrollLeft || 0), y: e.clientY - r.top + (canvasRef.current?.scrollTop || 0) };
}

function getCompiledAuthHeaders(type, config, customRows) {
  if (type === "none") return {};
  if (type === "bearer" && config?.bearer?.token) {
    return { "Authorization": `Bearer ${config.bearer.token}` };
  }
  if (type === "basic" && (config?.basic?.username || config?.basic?.password)) {
    const creds = `${config.basic.username || ""}:${config.basic.password || ""}`;
    return { "Authorization": `Basic ${btoa(creds)}` };
  }
  if (type === "api_key" && config?.api_key?.add_to === "header" && config?.api_key?.key) {
    return { [config.api_key.key]: config.api_key.value || "" };
  }
  if (type === "custom") {
    return (customRows || [])
      .filter((row) => row.key && row.enabled !== false)
      .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
  }
  return {};
}

function getCompiledAuthParams(type, config) {
  if (type === "api_key" && config?.api_key?.add_to === "query" && config?.api_key?.key) {
    return { [config.api_key.key]: config.api_key.value || "" };
  }
  return {};
}

/* ─── Auto-layout (BFS layering) ─── */
function autoLayout(nodes, edges) {
  if (nodes.length === 0) return {};
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const adj = {}, inDeg = {};
  nodes.forEach(n => { adj[n.id] = []; inDeg[n.id] = 0; });
  edges.forEach(e => { if (e.from === e.to) return; adj[e.from]?.push(e.to); inDeg[e.to] = (inDeg[e.to] || 0) + 1; });
  const layers = [], visited = new Set();
  let queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  if (queue.length === 0) queue = [nodes[0].id];
  while (queue.length && visited.size < nodes.length) {
    layers.push([...queue]); queue.forEach(id => visited.add(id));
    const next = [];
    queue.forEach(id => (adj[id] || []).forEach(to => {
      if (!visited.has(to) && !next.includes(to) && edges.filter(e => e.to === to && e.from !== e.to).every(e => visited.has(e.from))) next.push(to);
    }));
    if (!next.length) { const rem = nodes.find(n => !visited.has(n.id)); if (rem) next.push(rem.id); }
    queue = next;
  }
  const rest = nodes.filter(n => !visited.has(n.id)); if (rest.length) layers.push(rest.map(n => n.id));
  const maxLayerW = Math.max(400, layers.reduce((mx, l) => Math.max(mx, l.reduce((s, id) => s + getDims(byId[id]).w, 0) + (l.length - 1) * GAP_X), 0));
  const pos = {}; let curY = CANVAS_PAD;
  layers.forEach(layer => {
    const items = layer.map(id => ({ id, d: getDims(byId[id]) }));
    const totalW = items.reduce((s, it) => s + it.d.w, 0) + (items.length - 1) * GAP_X;
    const maxH = items.reduce((mx, it) => Math.max(mx, it.d.h), 0);
    let curX = CANVAS_PAD + (maxLayerW - totalW) / 2;
    items.forEach(({ id, d }) => { pos[id] = { x: Math.max(CANVAS_PAD, curX), y: curY + (maxH - d.h) / 2 }; curX += d.w + GAP_X; });
    curY += maxH + GAP_Y;
  });
  return pos;
}

/* ─── SVG edge path ─── */
function getEdgePath(fp, fd, tp, td, isSelf, exitSide = "bottom") {
  if (isSelf) { const cx = fp.x + fd.w / 2, ty = fp.y; return `M ${cx - 14} ${ty} C ${cx - 14} ${ty - 48}, ${cx + 14} ${ty - 48}, ${cx + 14} ${ty}`; }
  let x1, y1;
  if (exitSide === "right") { x1 = fp.x + fd.w; y1 = fp.y + fd.h / 2; }
  else { x1 = fp.x + fd.w / 2; y1 = fp.y + fd.h; }
  const x2 = tp.x + td.w / 2, y2 = tp.y;
  if (exitSide === "right") {
    const cpX = Math.max(36, Math.abs(x2 - x1) * 0.45);
    const cpY = Math.max(28, Math.abs(y2 - y1) * 0.35);
    return `M ${x1} ${y1} C ${x1 + cpX} ${y1}, ${x2} ${y2 - cpY}, ${x2} ${y2}`;
  }
  const cpOff = Math.max(28, Math.abs(y2 - y1) * 0.45);
  return `M ${x1} ${y1} C ${x1} ${y1 + cpOff}, ${x2} ${y2 - cpOff}, ${x2} ${y2}`;
}

function getEdgeMid(fp, fd, tp, td) {
  return { x: (fp.x + fd.w / 2 + tp.x + td.w / 2) / 2, y: (fp.y + fd.h + tp.y) / 2 };
}

/* ─── Icons ─── */
function IconX({ size = 12, stroke = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconPlay({ size = 12, stroke = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconGrid({ size = 12, stroke = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconTrash({ size = 12, stroke = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function IconDiamond({ size = 14, stroke = "currentColor", fill = "none" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 12 12 22 2 12" />
    </svg>
  );
}

function IconHex({ size = 14, stroke = "currentColor", fill = "none" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="7 3 17 3 22 12 17 21 7 21 2 12" />
    </svg>
  );
}

function IconPlus({ size = 12, stroke = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/* ─── Reusable tiny components ─── */
function Lbl({ text, hint }) {
  return (<div><div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--text)" }}>{text}</div>
    {hint && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "1px" }}>{hint}</div>}</div>);
}
function CtxSection({ title, value, isError }) {
  if (value === undefined || value === null || value === "") return null;
  const d = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  return (<div><div style={{ fontSize: "0.72rem", fontWeight: 600, color: isError ? "#ff5555" : "var(--text-muted)", marginBottom: "3px" }}>{title}</div>
    <div style={{
      padding: "6px 8px", borderRadius: "6px", background: "var(--bg)", border: `1px solid ${isError ? "#ff555530" : "var(--border)"}`,
      fontFamily: "var(--font-mono, monospace)", fontSize: "0.72rem", color: isError ? "#ff5555" : "var(--text)",
      whiteSpace: "pre-wrap", maxHeight: "160px", overflow: "auto", wordBreak: "break-all"
    }}>{d}</div></div>);
}

const OVERLAY = { position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" };
const MODAL_BOX = { background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "85vh" };
const MODAL_HEADER = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const MODAL_BTNS = { display: "flex", gap: "6px" };

function ModalShell({ width, icon, iconColor, title, onRemove, onClose, children }) {
  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...MODAL_BOX, width }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={MODAL_HEADER}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              {icon && <span style={{ fontSize: "1rem", color: iconColor }}>{icon}</span>}
              <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--text)" }}>{title}</span>
            </div>
            <div style={MODAL_BTNS}>
              {onRemove && (
                <button className="ghost icon-button icon-plain" onClick={onRemove} style={{ fontSize: "0.68rem", color: "#ff5555", padding: "3px 7px" }}>
                  <IconTrash size={12} />
                </button>
              )}
              <button className="ghost icon-button icon-plain" onClick={onClose} style={{ fontSize: "0.82rem", padding: "3px 7px" }}>
                <IconX size={12} />
              </button>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   CONDITION CONFIG MODAL
   ═══════════════════════════════════════════════ */
function ConditionConfigModal({ node, edges, onUpdateConfig, onUpdateLabel, onRemove, onClose }) {
  const cfg = node.conditionConfig || {};
  const set = (k, v) => onUpdateConfig(node.id, { ...cfg, [k]: v });
  const yesTargets = edges.filter(e => e.from === node.id && e.branch === "true").length;
  const noTargets = edges.filter(e => e.from === node.id && e.branch === "false").length;
  return (
    <ModalShell width="460px" icon={<IconDiamond />} iconColor={COND_CLR} title="Condition" onRemove={onRemove} onClose={onClose}>
      <div><Lbl text="Label" /><input className="input" value={node.label} onChange={e => onUpdateLabel(node.id, e.target.value)} style={{ marginTop: "4px" }} /></div>
      <div>
        <Lbl text="Condition Expression" hint="JS expr. Available: status, body, headers, ctx, iteration. Return truthy for YES." />
        <textarea className="input" rows={4} value={cfg.expression || ""} onChange={e => set("expression", e.target.value)}
          placeholder='e.g. status === 200 && body.success === true'
          style={{ marginTop: "4px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: "12px", padding: "8px 10px", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: YES_CLR }} />
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: YES_CLR }}>YES</span>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>→ {yesTargets} target{yesTargets !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: NO_CLR }} />
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: NO_CLR }}>NO</span>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>→ {noTargets} target{noTargets !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: "1.5" }}>
        Drag from the <b style={{ color: YES_CLR }}>green Y handle</b> (bottom) to connect the TRUE path.
        Drag from the <b style={{ color: NO_CLR }}>red N handle</b> (right) to connect the FALSE path.
      </div>
    </ModalShell>
  );
}


/* ═══════════════════════════════════════════════
   TRANSFORM CONFIG MODAL (Script-based)
   ═══════════════════════════════════════════════ */
function TransformConfigModal({ node, context, onUpdateConfig, onUpdateLabel, onRemove, onClose }) {
  const cfg = node.transformConfig || {};
  const set = (k, v) => onUpdateConfig(node.id, { ...cfg, [k]: v });
  const emissions = context?._emissions;
  return (
    <ModalShell width="560px" icon={<IconHex />} iconColor={XFORM_CLR} title="Transform Script" onRemove={onRemove} onClose={onClose}>
      <div><Lbl text="Label" /><input className="input" value={node.label} onChange={e => onUpdateLabel(node.id, e.target.value)} style={{ marginTop: "4px" }} /></div>
      <div>
        <Lbl text="Script" hint="Write JS. Call emit(data) to send output downstream. Multiple emit() calls produce multiple outputs." />
        <textarea className="input" rows={10} value={cfg.script || ""} onChange={e => set("script", e.target.value)}
          placeholder={`// Available: ctx, status, body, headers, emit\n// reqBody, reqHeaders, params\n\n// Single output:\nemit({ userId: body.id, token: headers["x-token"] });\n\n// Multiple outputs (fan-out):\nfor (const item of body.items) {\n  emit({ id: item.id, name: item.name });\n}`}
          style={{ marginTop: "4px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical", lineHeight: "1.5", tabSize: 2 }} />
      </div>
      <div style={{ padding: "6px 10px", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: "1.6" }}>
          <b style={{ color: XFORM_CLR }}>Globals:</b> <code>ctx</code> · <code>status</code> · <code>body</code> · <code>headers</code> · <code>emit(data)</code><br />
          <code>reqBody</code> · <code>reqHeaders</code> · <code>params</code><br />
          Call <code>emit(obj)</code> one or more times. Each call sends a separate output to all downstream nodes.
          If no <code>emit()</code> is called, incoming context is forwarded as-is.
        </div>
      </div>
      {emissions && emissions.length > 0 && (
        <div>
          <Lbl text={`Emissions (${emissions.length})`} />
          <div style={{ maxHeight: "160px", overflow: "auto", marginTop: "4px" }}>
            {emissions.map((em, i) => (
              <div key={i} style={{
                padding: "5px 8px", borderRadius: "5px", background: "var(--bg)", border: "1px solid var(--border)",
                fontFamily: "var(--font-mono, monospace)", fontSize: "0.68rem", color: "var(--text)", marginBottom: "3px",
                whiteSpace: "pre-wrap", wordBreak: "break-all"
              }}>
                <span style={{ color: XFORM_CLR, fontSize: "0.6rem", fontWeight: 600 }}>#{i + 1} </span>
                {typeof em === "object" ? JSON.stringify(em, null, 2) : String(em)}
              </div>
            ))}
          </div>
        </div>
      )}
      {context?.response?.error && <CtxSection title="Script Error" value={context.response.error} isError />}
    </ModalShell>
  );
}


/* ═══════════════════════════════════════════════
   STEP INSPECTOR MODAL (request nodes)
   ═══════════════════════════════════════════════ */
function StepInspectorModal({ node, context, onUpdateConfig, onUpdateLabel, onRemove, onClose }) {
  const ctx = context || {};
  const hasRun = !!(ctx.request || ctx.response);
  const [tab, setTab] = useState("config");
  useEffect(() => { setTab("config"); }, [node.id]);
  const tabs = hasRun
    ? [{ id: "config", label: "Config" }, { id: "request", label: "Request" }, { id: "response", label: "Response" }]
    : [{ id: "config", label: "Config" }];

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...MODAL_BOX, width: "580px" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS[node.status]?.color || STATUS.idle.color }} />
              <span style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--text)" }}>Step Inspector</span>
              <span style={{ fontSize: "0.68rem", fontWeight: 600, color: STATUS[node.status]?.color }}>{STATUS[node.status]?.label}</span>
              {ctx.loopIteration != null && <span style={{ fontSize: "0.62rem", background: "#a78bfa20", color: "#a78bfa", padding: "1px 6px", borderRadius: "3px" }}>iter {ctx.loopIteration}</span>}
              {ctx.response?.time != null && <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginLeft: "auto" }}>{ctx.response.time}ms</span>}
            </div>
            <div style={MODAL_BTNS}>
              <button className="ghost icon-button icon-plain" onClick={onRemove} style={{ fontSize: "0.68rem", color: "#ff5555", padding: "3px 7px" }}>
                <IconTrash size={12} />
              </button>
              <button className="ghost icon-button icon-plain" onClick={onClose} style={{ fontSize: "0.82rem", padding: "3px 7px" }}>
                <IconX size={12} />
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: "2px" }}>
            {tabs.map(t => (
              <button key={t.id} className="ghost" onClick={() => setTab(t.id)} style={{
                fontSize: "0.74rem", padding: "4px 12px", borderRadius: "5px 5px 0 0",
                fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? ACCENT : "var(--text-muted)",
                borderBottom: tab === t.id ? `2px solid ${ACCENT}` : "2px solid transparent",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
          {tab === "config" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ gridColumn: "1 / -1" }}><Lbl text="Label" /><input className="input" value={node.label} onChange={e => onUpdateLabel(node.id, e.target.value)} style={{ marginTop: "3px" }} /></div>
              <div><Lbl text="Method" /><select className="input" value={node.config.method} onChange={e => onUpdateConfig(node.id, "method", e.target.value)} style={{ marginTop: "3px" }}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><Lbl text="URL" /><input className="input" value={node.config.url} onChange={e => onUpdateConfig(node.id, "url", e.target.value)}
                placeholder="https://api.example.com/users/:id" style={{ marginTop: "3px" }} /></div>
              <div><Lbl text="Path Variables" hint="key=value per line" />
                <textarea className="input" rows={2} value={node.config.pathVars || ""} onChange={e => onUpdateConfig(node.id, "pathVars", e.target.value)}
                  placeholder={"id=123"} style={{ marginTop: "3px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical" }} /></div>
              <div><Lbl text="Query Params" hint="key=value per line" />
                <textarea className="input" rows={2} value={node.config.params || ""} onChange={e => onUpdateConfig(node.id, "params", e.target.value)}
                  placeholder={"page=1\nlimit=10"} style={{ marginTop: "3px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical" }} /></div>
              <div style={{ gridColumn: "1 / -1" }}><Lbl text="Headers (JSON)" />
                <textarea className="input" rows={2} value={node.config.headers} onChange={e => onUpdateConfig(node.id, "headers", e.target.value)}
                  style={{ marginTop: "3px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical" }} /></div>
              <div style={{ gridColumn: "1 / -1" }}><Lbl text="Body" />
                <textarea className="input" rows={3} value={node.config.body} onChange={e => onUpdateConfig(node.id, "body", e.target.value)}
                  style={{ marginTop: "3px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical" }} /></div>
            </div>
          )}
          {tab === "request" && hasRun && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <CtxSection title="Method" value={ctx.request?.method} />
              <CtxSection title="URL" value={ctx.request?.url} />
              <CtxSection title="Path Variables" value={ctx.request?.pathVars} />
              <CtxSection title="Query Params" value={ctx.request?.params} />
              <CtxSection title="Headers" value={ctx.request?.headers} />
              <CtxSection title="Body" value={ctx.request?.body} />
            </div>
          )}
          {tab === "response" && hasRun && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {ctx.response?.status != null && <CtxSection title="Status" value={`${ctx.response.status} ${ctx.response.statusText || ""}`} />}
              <CtxSection title="Headers" value={ctx.response?.headers} />
              <CtxSection title="Body" value={ctx.response?.data} />
              {ctx.response?.error && <CtxSection title="Error" value={ctx.response.error} isError />}
              {ctx.response?.time != null && <CtxSection title="Time" value={`${ctx.response.time} ms`} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   REQUEST + RESPONSE MODAL (full editor)
   ═══════════════════════════════════════════════ */
function RequestResponseModal({
  node,
  context,
  onUpdateConfig,
  onUpdateLabel,
  onRunRequest,
  onClose
}) {
  const [editingName, setEditingName] = useState(false);
  const [requestName, setRequestName] = useState(node.label || "Request");
  const [method, setMethod] = useState(node.config.method || "GET");
  const [url, setUrl] = useState(node.config.url || "");
  const [headersText, setHeadersText] = useState(node.config.headers || "{}");
  const [bodyText, setBodyText] = useState(node.config.body || "");
  const [pathVarsText, setPathVarsText] = useState(node.config.pathVars || "");
  const [paramsRows, setParamsRows] = useState([]);
  const [headersRows, setHeadersRows] = useState([]);
  const [bodyRows, setBodyRows] = useState([]);
  const [authRows, setAuthRows] = useState([]);
  const [authType, setAuthType] = useState("none");
  const [authConfig, setAuthConfig] = useState({
    bearer: { token: "" },
    basic: { username: "", password: "" },
    api_key: { add_to: "header", key: "", value: "" }
  });
  const [headersMode, setHeadersMode] = useState("table");
  const [bodyType, setBodyType] = useState("json");
  const [testsMode, setTestsMode] = useState("post");
  const [showTestInput, setShowTestInput] = useState(false);
  const [showTestOutput, setShowTestOutput] = useState(false);
  const [testsInputText, setTestsInputText] = useState("");
  const [testsPreText, setTestsPreText] = useState("");
  const [testsPostText, setTestsPostText] = useState("");
  const [testsOutput] = useState([]);
  const [activeRequestTab, setActiveRequestTab] = useState("Body");
  const [activeResponseTab, setActiveResponseTab] = useState("Pretty");
  const [responseState, setResponseState] = useState(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setRequestName(node.label || "Request");
    setMethod(node.config.method || "GET");
    setUrl(node.config.url || "");
    setHeadersText(node.config.headers || "{}");
    setBodyText(node.config.body || "");
    setPathVarsText(node.config.pathVars || "");
    const pRows = (node.config.params || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return { key: key?.trim() || "", value: rest.join("=").trim(), enabled: true };
      });
    setParamsRows(pRows);
    setResponseState(context?.response ? {
      status: context.response.status,
      statusText: context.response.statusText || "",
      headers: context.response.headers || {},
      body: typeof context.response.data === "string" ? context.response.data : JSON.stringify(context.response.data || "", null, 2),
      json: typeof context.response.data === "object" ? context.response.data : undefined
    } : null);
  }, [node.id]);

  useEffect(() => { onUpdateLabel(node.id, requestName); }, [requestName]);
  useEffect(() => { onUpdateConfig(node.id, "method", method); }, [method]);
  useEffect(() => { onUpdateConfig(node.id, "url", url); }, [url]);
  useEffect(() => { onUpdateConfig(node.id, "headers", headersText); }, [headersText]);
  useEffect(() => { onUpdateConfig(node.id, "body", bodyText); }, [bodyText]);
  useEffect(() => { onUpdateConfig(node.id, "pathVars", pathVarsText); }, [pathVarsText]);
  useEffect(() => {
    const text = (paramsRows || [])
      .filter(r => r.key && r.enabled !== false)
      .map(r => `${r.key}=${r.value}`)
      .join("\n");
    onUpdateConfig(node.id, "params", text);
  }, [paramsRows]);

  const getEnvVars = useCallback(() => [], []);
  const handleUpdateEnvVar = useCallback(() => { }, []);
  const updateRequestName = useCallback(() => { }, []);
  const updateRequestMethod = useCallback(() => { }, []);
  const updateRequestState = useCallback(() => { }, []);
  const setShowSnippetModal = useCallback(() => { }, []);
  const setContentType = useCallback(() => { }, []);

  const handleHeadersRowsChange = useCallback((rows) => {
    setHeadersRows(rows);
    const obj = rows
      .filter(r => r.key && r.enabled !== false)
      .reduce((acc, r) => ({ ...acc, [r.key]: r.value }), {});
    setHeadersText(JSON.stringify(obj, null, 2));
  }, []);

  const handleHeadersTextChange = useCallback((val) => {
    setHeadersText(val);
  }, []);

  const handleSend = useCallback(async () => {
    setIsSending(true);
    try {
      const reqState = {
        method,
        url,
        headersText,
        headersRows,
        bodyText,
        paramsRows,
        pathVarsText,
        authType,
        authConfig,
        authRows
      };
      const ctx = await onRunRequest(node, reqState);
      if (ctx?.response) {
        setResponseState({
          status: ctx.response.status,
          statusText: ctx.response.statusText || "",
          headers: ctx.response.headers || {},
          body: typeof ctx.response.data === "string" ? ctx.response.data : JSON.stringify(ctx.response.data || "", null, 2),
          json: typeof ctx.response.data === "object" ? ctx.response.data : undefined
        });
      }
    } finally {
      setIsSending(false);
    }
  }, [method, url, headersText, headersRows, bodyText, paramsRows, pathVarsText, authType, authConfig, authRows, node, onRunRequest]);

  const parsedJson = useMemo(() => {
    if (responseState?.json) return responseState.json;
    if (responseState?.body) {
      try { return JSON.parse(responseState.body); } catch { return null; }
    }
    return null;
  }, [responseState]);

  const [selectedTablePath, setSelectedTablePath] = useState("$");
  const tableCandidates = useMemo(() => {
    if (!parsedJson) return [];
    const paths = findArrayPaths(parsedJson);
    return paths.length ? paths : ["$"];
  }, [parsedJson]);

  const tableRows = useMemo(() => {
    if (!parsedJson) return [];
    const target = getValueByPath(parsedJson, selectedTablePath);
    if (Array.isArray(target)) return target;
    if (target && typeof target === "object") return [target];
    return [];
  }, [parsedJson, selectedTablePath]);

  const [search, setSearch] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [derivedName, setDerivedName] = useState("");
  const [derivedExpr, setDerivedExpr] = useState("");
  const [derivedFields, setDerivedFields] = useState([]);

  const computedRows = useMemo(() => {
    const filtered = filterRows(tableRows, search, searchKey);
    const withDerived = applyDerivedFields(filtered, derivedFields);
    return sortRows(withDerived, sortKey, sortDirection);
  }, [tableRows, search, searchKey, derivedFields, sortKey, sortDirection]);

  const csv = useMemo(() => parsedJson ? jsonToCsv(parsedJson) : "", [parsedJson]);
  const xml = useMemo(() => parsedJson ? `<response>\n${jsonToXml(parsedJson, 1)}\n</response>` : "", [parsedJson]);
  const pretty = useMemo(() => {
    if (parsedJson) return JSON.stringify(parsedJson, null, 2);
    if (responseState?.body) return responseState.body;
    return "";
  }, [responseState, parsedJson]);
  const raw = useMemo(() => responseState?.body || "", [responseState]);

  const downloadText = useCallback((name, text) => {
    const blob = new Blob([text || ""], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  const handleAddDerivedField = useCallback(() => {
    if (!derivedName || !derivedExpr) return;
    setDerivedFields(prev => [...prev, { name: derivedName, expr: derivedExpr }]);
    setDerivedName("");
    setDerivedExpr("");
  }, [derivedName, derivedExpr]);

  const handleSort = useCallback((key) => {
    setSortKey(key);
    setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
  }, []);

  const handleXmlToJson = useCallback(() => {
    if (!xml) return;
    try {
      const jsonObj = xmlToJson(xml);
      setResponseState({
        ...(responseState || {}),
        json: jsonObj,
        body: JSON.stringify(jsonObj, null, 2)
      });
      setActiveResponseTab("Pretty");
    } catch { }
  }, [xml, responseState]);

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={{ ...MODAL_BOX, width: "92vw", height: "86vh" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text)" }}>Request Step</div>
          <div style={{ marginLeft: "auto" }}>
            <button className="ghost icon-button icon-plain" onClick={onClose}><IconX size={14} /></button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <RequestEditor
              editingMainRequestName={editingName}
              setEditingMainRequestName={setEditingName}
              requestName={requestName}
              setRequestName={setRequestName}
              currentRequestId={node.id}
              updateRequestName={updateRequestName}
              setShowSnippetModal={setShowSnippetModal}
              method={method}
              setMethod={setMethod}
              updateRequestMethod={updateRequestMethod}
              url={url}
              setUrl={setUrl}
              getEnvVars={getEnvVars}
              handleUpdateEnvVar={handleUpdateEnvVar}
              handleSend={handleSend}
              isSending={isSending}
              requestTabs={REQUEST_TABS}
              activeRequestTab={activeRequestTab}
              setActiveRequestTab={setActiveRequestTab}
              headersMode={headersMode}
              setHeadersMode={setHeadersMode}
              bodyType={bodyType}
              setBodyType={setBodyType}
              setContentType={setContentType}
              bodyText={bodyText}
              setBodyText={setBodyText}
              showTestOutput={showTestOutput}
              setShowTestOutput={setShowTestOutput}
              showTestInput={showTestInput}
              setShowTestInput={setShowTestInput}
              testsMode={testsMode}
              setTestsMode={setTestsMode}
              runTests={() => { }}
              paramsRows={paramsRows}
              setParamsRows={setParamsRows}
              updateRequestState={updateRequestState}
              headersRows={headersRows}
              handleHeadersRowsChange={handleHeadersRowsChange}
              headersText={headersText}
              handleHeadersTextChange={handleHeadersTextChange}
              authType={authType}
              setAuthType={setAuthType}
              authConfig={authConfig}
              setAuthConfig={setAuthConfig}
              authRows={authRows}
              setAuthRows={setAuthRows}
              setCmEnvEdit={() => { }}
              bodyRows={bodyRows}
              setBodyRows={setBodyRows}
              testsInputText={testsInputText}
              setTestsInputText={setTestsInputText}
              testsPreText={testsPreText}
              setTestsPreText={setTestsPreText}
              testsPostText={testsPostText}
              setTestsPostText={setTestsPostText}
              testsOutput={testsOutput}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--border)", background: "var(--panel)" }}>
            <ResponseViewer
              response={responseState}
              responseTabs={RESPONSE_TABS}
              activeResponseTab={activeResponseTab}
              setActiveResponseTab={setActiveResponseTab}
              error=""
              pretty={pretty}
              raw={raw}
              xml={xml}
              handleXmlToJson={handleXmlToJson}
              search={search}
              setSearch={setSearch}
              searchKey={searchKey}
              setSearchKey={setSearchKey}
              computedRows={computedRows}
              selectedTablePath={selectedTablePath}
              setSelectedTablePath={setSelectedTablePath}
              tableCandidates={tableCandidates}
              sortKey={sortKey}
              setSortKey={setSortKey}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              downloadText={downloadText}
              csv={csv}
              tableRows={tableRows}
              derivedName={derivedName}
              setDerivedName={setDerivedName}
              derivedExpr={derivedExpr}
              setDerivedExpr={setDerivedExpr}
              handleAddDerivedField={handleAddDerivedField}
              handleSort={handleSort}
              responseSummary={{ summary: responseState ? "Response ready" : "No response yet.", hints: [] }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════
   ADD STEP PICKER MODAL
   ═══════════════════════════════════════════════ */
function flattenCollectionRequests(collections) {
  const results = [];
  if (!Array.isArray(collections)) return results;
  collections.forEach(col => {
    const walk = (items, path) => (items || []).forEach(item => {
      if (item.type === "request") results.push({ ...item, _colName: col.name, _path: path });
      else if (item.type === "folder" && item.items) walk(item.items, `${path}/${item.name}`);
    });
    walk(col.items, col.name);
  });
  return results;
}

const NEW_STEP_TYPES = [
  { method: "GET", color: "#22c55e", desc: "Retrieve" },
  { method: "POST", color: "#f59e0b", desc: "Create" },
  { method: "PUT", color: "#3b82f6", desc: "Replace" },
  { method: "PATCH", color: "#a78bfa", desc: "Update" },
  { method: "DELETE", color: "#ff5555", desc: "Remove" },
  { method: "HEAD", color: "#64748b", desc: "Headers" },
  { method: "OPTIONS", color: "#64748b", desc: "CORS" },
];

function AddStepPicker({ collections, onAddNew, onAddFromCollection, onClose }) {
  const [search, setSearch] = useState("");
  const allReqs = useMemo(() => flattenCollectionRequests(collections), [collections]);
  const filtered = useMemo(() => {
    if (!search.trim()) return allReqs;
    const q = search.toLowerCase();
    return allReqs.filter(r => (r.name || "").toLowerCase().includes(q) || (r.url || "").toLowerCase().includes(q) || (r.method || "").toLowerCase().includes(q) || (r._path || "").toLowerCase().includes(q));
  }, [allReqs, search]);

  return (
    <ModalShell width="560px" title="Add Step" onClose={onClose}>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Create a new request or use one from your collections</div>
      <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--text)" }}>New Request</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
        {NEW_STEP_TYPES.map(t => (
          <button key={t.method} className="ghost" onClick={() => { onAddNew(t.method); onClose(); }} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "10px 6px", borderRadius: "8px",
            border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer",
          }}><span style={{ fontSize: "0.74rem", fontWeight: 700, color: t.color, fontFamily: "var(--font-mono, monospace)" }}>{t.method}</span>
            <span style={{ fontSize: "0.58rem", color: "var(--text-muted)" }}>{t.desc}</span></button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--text)" }}>From Collection</div>
        <span style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{allReqs.length} req{allReqs.length !== 1 ? "s" : ""}</span>
      </div>
      <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ fontSize: "0.78rem" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxHeight: "220px", overflow: "auto" }}>
        {filtered.length === 0 && (<div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-muted)", fontSize: "0.74rem" }}>{allReqs.length === 0 ? "No requests in collections" : "No match"}</div>)}
        {filtered.map(req => (
          <button key={req.id} className="ghost" onClick={() => { onAddFromCollection(req); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "7px",
            border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer", textAlign: "left", width: "100%",
          }}>
            <span style={{ fontSize: "0.62rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: METHOD_COLORS[req.method] || "#64748b", minWidth: "44px" }}>{req.method || "GET"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.name || "Untitled"}</div>
              <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.url || "(no url)"}</div>
            </div>
            <span style={{ fontSize: "0.58rem", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{req._path}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}


/* ═══════════════════════════════════════════════
   MAIN DAG FLOW PANE
   ═══════════════════════════════════════════════ */
export function DagFlowPane({ collections }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [positions, setPositions] = useState({});
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [running, setRunning] = useState(false);
  const [contexts, setContexts] = useState({});
  const [dragLink, setDragLink] = useState(null);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [edgePopup, setEdgePopup] = useState(null);
  const canvasRef = useRef(null);
  const svgRef = useRef(null);

  /* ── Load persisted state ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.nodes)) setNodes(parsed.nodes);
      if (Array.isArray(parsed.edges)) setEdges(parsed.edges);
      if (parsed.positions && typeof parsed.positions === "object") setPositions(parsed.positions);
    } catch { }
  }, []);

  /* ── Persist state ── */
  useEffect(() => {
    try {
      const payload = { nodes, edges, positions };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { }
  }, [nodes, edges, positions]);

  /* ── Canvas size ── */
  const canvasSize = useMemo(() => {
    let maxX = 600, maxY = 300;
    nodes.forEach(n => {
      const p = positions[n.id]; if (!p) return;
      const d = getDims(n);
      maxX = Math.max(maxX, p.x + d.w + CANVAS_PAD + 40);
      maxY = Math.max(maxY, p.y + d.h + CANVAS_PAD + 60);
    });
    return { width: maxX, height: maxY };
  }, [positions, nodes]);

  const doAutoLayout = useCallback(() => { setPositions(autoLayout(nodes, edges)); }, [nodes, edges]);

  const getNewNodePos = useCallback(() => {
    const vals = Object.entries(positions).map(([id, p]) => { const n = nodes.find(nd => nd.id === id); return { ...p, h: getDims(n).h }; });
    const maxY = vals.length > 0 ? Math.max(...vals.map(v => v.y + v.h)) : 0;
    return { x: CANVAS_PAD, y: maxY > 0 ? maxY + GAP_Y : CANVAS_PAD };
  }, [positions, nodes]);

  /* ── Node CRUD ── */
  const addNodeWithMethod = useCallback((method) => {
    const id = uid("node");
    const n = { id, type: "request", label: `Step ${nodes.length + 1}`, config: { method: method || "GET", url: "", headers: "{}", body: "", params: "", pathVars: "" }, status: "idle" };
    setNodes(prev => [...prev, n]);
    setPositions(prev => ({ ...prev, [id]: getNewNodePos() }));
  }, [nodes.length, getNewNodePos]);

  const addNodeFromRequest = useCallback((req) => {
    const id = uid("node");
    const n = {
      id, type: "request", label: req.name || `Step ${nodes.length + 1}`, config: {
        method: req.method || "GET", url: req.url || "", headers: req.headersText || "{}",
        body: req.bodyText || "", params: (req.paramsRows || []).filter(r => r.key && r.enabled !== false).map(r => `${r.key}=${r.value}`).join("\n"), pathVars: "",
      }, status: "idle", _sourceRequestId: req.id
    };
    setNodes(prev => [...prev, n]);
    setPositions(prev => ({ ...prev, [id]: getNewNodePos() }));
  }, [nodes.length, getNewNodePos]);

  const removeNode = useCallback((id) => {
    setNodes(prev => {
      const node = prev.find(n => n.id === id);
      if (node?.type === "condition") {
        // Reconnect incoming → TRUE-branch targets only (drop FALSE branch)
        const inc = edges.filter(e => e.to === id);
        const trueOut = edges.filter(e => e.from === id && e.branch === "true");
        const newEdges = [];
        inc.forEach(ie => trueOut.forEach(oe => {
          if (!edges.some(e => e.from === ie.from && e.to === oe.to)) {
            newEdges.push({ id: uid("edge"), from: ie.from, to: oe.to, runOnFailure: ie.runOnFailure, branch: ie.branch });
          }
        }));
        setEdges(pr => [...pr.filter(e => e.from !== id && e.to !== id), ...newEdges]);
      } else if (node?.type === "transform") {
        const inc = edges.filter(e => e.to === id);
        const out = edges.filter(e => e.from === id);
        const newEdges = [];
        inc.forEach(ie => out.forEach(oe => {
          if (!edges.some(e => e.from === ie.from && e.to === oe.to)) {
            newEdges.push({ id: uid("edge"), from: ie.from, to: oe.to, runOnFailure: ie.runOnFailure, branch: ie.branch });
          }
        }));
        setEdges(pr => [...pr.filter(e => e.from !== id && e.to !== id), ...newEdges]);
      } else {
        setEdges(pr => pr.filter(e => e.from !== id && e.to !== id));
      }
      return prev.filter(n => n.id !== id);
    });
    setPositions(prev => { const p = { ...prev }; delete p[id]; return p; });
    setContexts(prev => { const c = { ...prev }; delete c[id]; return c; });
    if (selectedNodeId === id) setSelectedNodeId(null);
  }, [selectedNodeId, edges]);

  const updateNodeConfig = useCallback((id, field, value) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, config: { ...n.config, [field]: value } } : n));
  }, []);
  const updateNodeLabel = useCallback((id, label) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, label } : n));
  }, []);
  const updateConditionConfig = useCallback((id, newCfg) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, conditionConfig: newCfg } : n));
  }, []);
  const updateTransformConfig = useCallback((id, newCfg) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, transformConfig: newCfg } : n));
  }, []);

  /* ── Edge CRUD ── */
  const addEdge = useCallback((from, to, branch = null) => {
    setEdges(prev => {
      if (prev.some(e => e.from === from && e.to === to && e.branch === branch)) return prev;
      return [...prev, { id: uid("edge"), from, to, runOnFailure: false, branch, maxIterations: 10, terminateWhen: "", condition: "" }];
    });
  }, []);

  const updateEdge = useCallback((updated) => {
    setEdges(prev => prev.map(e => e.id === updated.id ? updated : e));
  }, []);

  const removeEdgeById = useCallback((edgeId) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId));
    setEdgePopup(null);
  }, []);

  /* ── Insert condition/transform on an edge ── */
  const handleInsertOnEdge = useCallback((edgeId, nodeType) => {
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) return;
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    const fp = positions[edge.from], tp = positions[edge.to];
    const newId = uid(nodeType === "condition" ? "cond" : "xform");
    const newNode = nodeType === "condition"
      ? { id: newId, type: "condition", label: "Condition", status: "idle", conditionConfig: { expression: "" } }
      : { id: newId, type: "transform", label: "Transform", status: "idle", transformConfig: { script: "" } };
    const d = getDims(newNode);
    const mid = (fp && tp) ? getEdgeMid(fp, getDims(fromNode), tp, getDims(toNode)) : { x: CANVAS_PAD, y: CANVAS_PAD };
    setNodes(prev => [...prev, newNode]);
    setPositions(prev => ({ ...prev, [newId]: { x: mid.x - d.w / 2, y: mid.y - d.h / 2 } }));
    if (nodeType === "condition") {
      // Incoming edge keeps original branch; outgoing to original target becomes TRUE branch
      setEdges(prev => [
        ...prev.filter(e => e.id !== edgeId),
        { id: uid("edge"), from: edge.from, to: newId, runOnFailure: edge.runOnFailure, branch: edge.branch },
        { id: uid("edge"), from: newId, to: edge.to, runOnFailure: false, branch: "true" },
      ]);
    } else {
      setEdges(prev => [
        ...prev.filter(e => e.id !== edgeId),
        { id: uid("edge"), from: edge.from, to: newId, runOnFailure: edge.runOnFailure, branch: edge.branch },
        { id: uid("edge"), from: newId, to: edge.to, runOnFailure: false, branch: null },
      ]);
    }
    setEdgePopup(null);
    setSelectedNodeId(newId);
  }, [edges, nodes, positions]);

  /* ── Drag to MOVE node ── */
  const handleNodeDragStart = useCallback((nodeId, e) => {
    e.stopPropagation(); e.preventDefault();
    const start = getSvgCoords(e, canvasRef);
    const pos = positions[nodeId]; if (!pos) return;
    const state = { offX: start.x - pos.x, offY: start.y - pos.y, moved: false };
    const onMove = (ev) => {
      const cur = getSvgCoords(ev, canvasRef);
      if (!state.moved && Math.hypot(cur.x - start.x, cur.y - start.y) < 4) return;
      state.moved = true;
      setPositions(prev => ({ ...prev, [nodeId]: { x: Math.max(0, cur.x - state.offX), y: Math.max(0, cur.y - state.offY) } }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
      if (!state.moved) { setSelectedNodeId(nodeId); setEdgePopup(null); }
    };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [positions]);

  /* ── Drag to LINK from handle ── */
  const handleDragLinkStart = useCallback((nodeId, e, branch = null) => {
    e.stopPropagation(); e.preventDefault();
    const start = getSvgCoords(e, canvasRef);
    setDragLink({ fromId: nodeId, mouseX: start.x, mouseY: start.y, branch });
    const onMove = (ev) => { const c = getSvgCoords(ev, canvasRef); setDragLink(prev => prev ? { ...prev, mouseX: c.x, mouseY: c.y } : null); };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
      const c = getSvgCoords(ev, canvasRef);
      const target = nodes.find(n => { const p = positions[n.id]; const d = getDims(n); return p && c.x >= p.x && c.x <= p.x + d.w && c.y >= p.y && c.y <= p.y + d.h; });
      if (target) addEdge(nodeId, target.id, branch);
      setDragLink(null);
    };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }, [nodes, positions, addEdge]);

  /* ── Edge click → popup ── */
  const handleEdgeClick = useCallback((edgeId, e) => {
    e.stopPropagation();
    const c = getSvgCoords(e, canvasRef);
    setEdgePopup({ edgeId, x: c.x, y: c.y });
    setSelectedNodeId(null);
  }, []);

  const resetStatuses = useCallback(() => {
    setNodes(prev => prev.map(n => ({ ...n, status: "idle" })));
    setContexts({});
  }, []);

  const updateNodeStatus = useCallback((id, status) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, status } : n));
  }, []);

  const runRequestFromModal = useCallback(async (node, reqState) => {
    updateNodeStatus(node.id, "running");
    let headers = {};
    try {
      if (reqState.headersText && reqState.headersText.trim()) {
        headers = JSON.parse(reqState.headersText);
      } else {
        headers = (reqState.headersRows || [])
          .filter(r => r.key && r.enabled !== false)
          .reduce((acc, r) => ({ ...acc, [r.key]: r.value }), {});
      }
    } catch {
      updateNodeStatus(node.id, "error");
      const errCtx = { request: { method: reqState.method, url: reqState.url }, response: { error: "Headers must be valid JSON." } };
      setContexts(prev => ({ ...prev, [node.id]: errCtx }));
      return errCtx;
    }

    const authHeaders = getCompiledAuthHeaders(reqState.authType, reqState.authConfig, reqState.authRows);
    headers = { ...headers, ...authHeaders };

    let urlStr = reqState.url || "";
    const pathVars = {};
    (reqState.pathVarsText || "").split("\n").forEach(line => {
      const [k, ...v] = line.split("=");
      if (k?.trim()) pathVars[k.trim()] = v.join("=").trim();
    });
    Object.entries(pathVars).forEach(([k, v]) => {
      urlStr = urlStr.replace(`:${k}`, encodeURIComponent(v)).replace(`{${k}}`, encodeURIComponent(v));
    });

    const params = {};
    (reqState.paramsRows || [])
      .filter(r => r.key && r.enabled !== false)
      .forEach(r => { params[r.key] = r.value; });
    Object.assign(params, getCompiledAuthParams(reqState.authType, reqState.authConfig));
    const qs = Object.entries(params)
      .filter(([k]) => k)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    if (qs) urlStr += (urlStr.includes("?") ? "&" : "?") + qs;

    const bodyStr = reqState.bodyText || "";
    const fetchOpts = { method: reqState.method || "GET", headers };
    if (bodyStr && !["GET", "HEAD"].includes(fetchOpts.method)) fetchOpts.body = bodyStr;

    try {
      const t0 = performance.now();
      const res = await fetch(urlStr, fetchOpts);
      const time = Math.round(performance.now() - t0);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      const resHeaders = {}; res.headers.forEach((v, k) => { resHeaders[k] = v; });
      const nodeCtx = {
        request: { method: fetchOpts.method, url: urlStr, headers, body: bodyStr, params, pathVars },
        response: { status: res.status, statusText: res.statusText, headers: resHeaders, data, time }
      };
      setContexts(prev => ({ ...prev, [node.id]: nodeCtx }));
      updateNodeStatus(node.id, "success");
      return nodeCtx;
    } catch (err) {
      const nodeCtx = { request: { method: reqState.method, url: reqState.url }, response: { error: err.message } };
      setContexts(prev => ({ ...prev, [node.id]: nodeCtx }));
      updateNodeStatus(node.id, "error");
      return nodeCtx;
    }
  }, [updateNodeStatus, setContexts]);

  /* ═══════════ Execution Engine ═══════════ */
  async function handleRun() {
    if (nodes.length === 0) return;
    setRunning(true);
    setNodes(prev => prev.map(n => ({ ...n, status: "pending" })));
    setContexts({});

    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
    const outEdges = {}; nodes.forEach(n => { outEdges[n.id] = []; }); edges.forEach(e => { outEdges[e.from]?.push(e); });

    // Topo sort
    const inDeg = {}; nodes.forEach(n => { inDeg[n.id] = 0; });
    edges.filter(e => e.from !== e.to).forEach(e => { inDeg[e.to] = (inDeg[e.to] || 0) + 1; });
    let queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
    if (!queue.length && nodes.length) queue = [nodes[0].id];
    const order = [], vis = new Set();
    while (queue.length) {
      const cur = queue.shift(); if (vis.has(cur)) continue; vis.add(cur); order.push(cur);
      (outEdges[cur] || []).filter(e => e.from !== e.to).forEach(e => { inDeg[e.to]--; if (inDeg[e.to] <= 0 && !vis.has(e.to)) queue.push(e.to); });
    }
    nodes.forEach(n => { if (!vis.has(n.id)) order.push(n.id); });

    const ctxMap = {}, skipSet = new Set(), blockedEdges = new Set();

    for (const id of order) {
      if (skipSet.has(id)) { setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "skipped" } : n)); continue; }
      const node = nodeMap[id]; if (!node) continue;

      // Check incoming edges
      const incEdges = edges.filter(e => e.to === id && e.from !== e.to);
      if (incEdges.length > 0) {
        const anyAllowed = incEdges.some(e => {
          if (blockedEdges.has(e.id)) return false;
          const srcNode = nodeMap[e.from];
          if (srcNode?.status === "error" && !e.runOnFailure) return false;
          if (srcNode?.status === "skipped" || skipSet.has(e.from)) return false;
          return true;
        });
        if (!anyAllowed) { setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "skipped" } : n)); skipSet.add(id); continue; }
      }

      // Gather incoming context
      let inCtx = {};
      incEdges.forEach(e => {
        if (blockedEdges.has(e.id)) return;
        const src = ctxMap[e.from]; if (!src) return;
        const srcNode = nodeMap[e.from];
        if (srcNode?.type === "transform" && src._emissions?.length) {
          if (src._emissions.length === 1) inCtx = { ...inCtx, ...src._emissions[0] };
          else inCtx = { ...inCtx, emissions: src._emissions };
        } else {
          inCtx = { ...inCtx, ...src };
        }
      });

      /* ── CONDITION NODE ── */
      if (node.type === "condition") {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "running" } : n));
        await new Promise(r => setTimeout(r, 60));
        const result = evaluateCondition(node.conditionConfig?.expression, inCtx);
        ctxMap[id] = { ...inCtx, _condResult: result };
        setContexts(prev => ({ ...prev, [id]: ctxMap[id] }));
        setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "success" } : n));
        // Block losing branch edges
        (outEdges[id] || []).forEach(e => {
          if (e.from === e.to) return;
          if (e.branch === "true" && !result) blockedEdges.add(e.id);
          if (e.branch === "false" && result) blockedEdges.add(e.id);
        });
        await new Promise(r => setTimeout(r, 60));
        continue;
      }

      /* ── TRANSFORM NODE ── */
      if (node.type === "transform") {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "running" } : n));
        await new Promise(r => setTimeout(r, 60));
        const { emissions, error } = runTransformScript(node.transformConfig?.script || "", inCtx);
        if (error) {
          ctxMap[id] = { ...inCtx, _emissions: [], response: { error } };
          setContexts(prev => ({ ...prev, [id]: ctxMap[id] }));
          setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "error" } : n));
        } else {
          ctxMap[id] = { ...inCtx, _emissions: emissions, _emissionCount: emissions.length };
          setContexts(prev => ({ ...prev, [id]: ctxMap[id] }));
          setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "success" } : n));
        }
        await new Promise(r => setTimeout(r, 60));
        continue;
      }

      /* ── REQUEST NODE ── */
      const selfEdge = (outEdges[id] || []).find(e => e.from === e.to);
      const maxIter = selfEdge ? (selfEdge.maxIterations || 10) : 1;
      let iteration = 0, keepLooping = true;

      while (keepLooping && iteration < maxIter) {
        iteration++;
        setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "running" } : n));
        setContexts(prev => ({ ...prev, [id]: { ...(prev[id] || {}), loopIteration: selfEdge ? iteration : undefined } }));
        try {
          let headers = {}; try { headers = JSON.parse(node.config.headers); } catch { }
          if (inCtx.headers && typeof inCtx.headers === "object") headers = { ...headers, ...inCtx.headers };
          let bodyStr = node.config.body || "";
          if (inCtx.body) bodyStr = typeof inCtx.body === "string" ? inCtx.body : JSON.stringify(inCtx.body);
          let urlStr = node.config.url || "";
          const pathVars = {};
          (node.config.pathVars || "").split("\n").forEach(line => { const [k, ...v] = line.split("="); if (k?.trim()) pathVars[k.trim()] = v.join("=").trim(); });
          if (inCtx.pathVars && typeof inCtx.pathVars === "object") Object.assign(pathVars, inCtx.pathVars);
          Object.entries(pathVars).forEach(([k, v]) => { urlStr = urlStr.replace(`:${k}`, encodeURIComponent(v)).replace(`{${k}}`, encodeURIComponent(v)); });
          const params = {};
          (node.config.params || "").split("\n").forEach(line => { const [k, ...v] = line.split("="); if (k?.trim()) params[k.trim()] = v.join("=").trim(); });
          if (inCtx.params && typeof inCtx.params === "object") Object.assign(params, inCtx.params);
          const qs = Object.entries(params).filter(([k]) => k).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
          if (qs) urlStr += (urlStr.includes("?") ? "&" : "?") + qs;
          const fetchOpts = { method: node.config.method || "GET", headers };
          if (bodyStr && !["GET", "HEAD"].includes(fetchOpts.method)) fetchOpts.body = bodyStr;
          const t0 = performance.now();
          const res = await fetch(urlStr, fetchOpts);
          const time = Math.round(performance.now() - t0);
          const text = await res.text();
          let data; try { data = JSON.parse(text); } catch { data = text; }
          const resHeaders = {}; res.headers.forEach((v, k) => { resHeaders[k] = v; });
          const nodeCtx = {
            request: { method: fetchOpts.method, url: urlStr, headers, body: bodyStr, params, pathVars },
            response: { status: res.status, statusText: res.statusText, headers: resHeaders, data, time }, loopIteration: selfEdge ? iteration : undefined
          };
          ctxMap[id] = nodeCtx; setContexts(prev => ({ ...prev, [id]: nodeCtx }));
          setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "success" } : n));
          if (selfEdge) {
            if (selfEdge.terminateWhen?.trim()) { try { const tf = new Function("status", "body", "headers", "ctx", "iteration", `return (${selfEdge.terminateWhen});`); if (tf(res.status, data, resHeaders, nodeCtx, iteration)) keepLooping = false; } catch { keepLooping = false; } }
            else if (selfEdge.condition?.trim()) { keepLooping = evaluateCondition(selfEdge.condition, nodeCtx, iteration); }
            else { keepLooping = false; }
            if (keepLooping) inCtx = { ...inCtx, ...nodeCtx };
          } else { keepLooping = false; }
        } catch (err) {
          ctxMap[id] = { request: { method: node.config.method, url: node.config.url }, response: { error: err.message }, loopIteration: selfEdge ? iteration : undefined };
          setContexts(prev => ({ ...prev, [id]: ctxMap[id] }));
          setNodes(prev => prev.map(n => n.id === id ? { ...n, status: "error" } : n));
          keepLooping = false;
        }
        await new Promise(r => setTimeout(r, 80));
      }
    }
    setRunning(false);
  }

  /* ── Derived ── */
  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const nodesById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 10px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0 }}>
          <span style={{ fontSize: "0.66rem", fontWeight: 700, color: ACCENT, background: `${ACCENT}18`, padding: "3px 8px", borderRadius: "5px", border: `1px solid ${ACCENT}30` }}>DAG</span>
          <button className="btn" onClick={() => setShowStepPicker(true)} style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "6px" }}>
            <IconPlus size={12} stroke="currentColor" />
            Step
          </button>
          <button className="btn" onClick={doAutoLayout} style={{ fontSize: "0.66rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }} title="Auto-arrange">
            <IconGrid size={12} stroke="var(--text-muted)" />
            Layout
          </button>
          <div style={{ flex: 1 }} />
          {nodes.length > 0 && !running && <button className="btn" onClick={resetStatuses} style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>Reset</button>}
          <button className="btn primary" onClick={handleRun} disabled={running || nodes.length === 0} style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "6px" }}>
            {running ? "Running..." : (<><IconPlay size={12} fill="currentColor" />Run</>)}
          </button>
          <span style={{ fontSize: "0.64rem", color: "var(--text-muted)" }}>{nodes.length}n · {edges.length}e</span>
        </div>

        {/* SVG Canvas */}
        <div ref={canvasRef} style={{ flex: 1, overflow: "auto", position: "relative", background: "var(--bg)" }}>
          {nodes.length === 0 ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "8px" }}>
              <span style={{ fontSize: "2.4rem", opacity: 0.35 }}>⬡</span>
              <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>Add steps to build your request flow</span>
              <span style={{ fontSize: "0.68rem" }}>Drag from handles to link steps</span>
            </div>
          ) : (
            <svg ref={svgRef} width={canvasSize.width} height={canvasSize.height} style={{ display: "block" }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                setSelectedNodeId(null);
                setEdgePopup(null);
              }}>
              <defs>
                <pattern id="dagGrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.5" fill="var(--border)" /></pattern>
                <marker id="arrow" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#cfd6e4" /></marker>
                <marker id="arrowYes" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill={YES_CLR} /></marker>
                <marker id="arrowNo" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill={NO_CLR} /></marker>
                <marker id="arrowFail" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#ff5555" /></marker>
              </defs>
              <rect width="100%" height="100%" fill="url(#dagGrid)" />

              {/* ── Edges ── */}
              {edges.map(edge => {
                const fn = nodesById[edge.from], tn = nodesById[edge.to];
                const fp = positions[edge.from], tp = positions[edge.to];
                if (!fp || !tp || !fn || !tn) return null;
                const isSelf = edge.from === edge.to;
                const exitSide = (fn.type === "condition" && edge.branch === "false") ? "right" : "bottom";
                const fd = getDims(fn), td = getDims(tn);
                const path = getEdgePath(fp, fd, tp, td, isSelf, exitSide);
                const isBranchTrue = edge.branch === "true";
                const isBranchFalse = edge.branch === "false";
                const edgeColor = isBranchTrue ? `${YES_CLR}90` : isBranchFalse ? `${NO_CLR}80` : edge.runOnFailure ? "#ff555580" : "#3b4256";
                const marker = isBranchTrue ? "url(#arrowYes)" : isBranchFalse ? "url(#arrowNo)" : edge.runOnFailure ? "url(#arrowFail)" : "url(#arrow)";
                const dash = (edge.runOnFailure && !isBranchTrue && !isBranchFalse) ? "5 3" : (isBranchFalse ? "4 2" : "none");
                // Exit point for label positioning
                const exitX = exitSide === "right" ? fp.x + fd.w : fp.x + fd.w / 2;
                const exitY = exitSide === "right" ? fp.y + fd.h / 2 : fp.y + fd.h;
                return (
                  <g key={edge.id} style={{ cursor: "pointer" }} onClick={e => handleEdgeClick(edge.id, e)}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth={16} />
                    <path d={path} fill="none" stroke={edgeColor} strokeWidth={1.6} strokeDasharray={dash} markerEnd={marker} />
                    {isSelf && <text x={fp.x + fd.w / 2} y={fp.y - 32} textAnchor="middle" style={{ fontSize: "0.55rem", fill: "#a78bfa", fontWeight: 600, pointerEvents: "none" }}>loop</text>}
                    {isBranchTrue && fn.type === "condition" && (
                      <g>
                        <rect x={exitX - 6} y={exitY + 4} width={12} height={10} rx={3} fill={`${YES_CLR}30`} />
                        <text x={exitX} y={exitY + 12} textAnchor="middle" style={{ fontSize: "0.52rem", fill: YES_CLR, fontWeight: 700, pointerEvents: "none" }}>YES</text>
                      </g>
                    )}
                    {isBranchFalse && fn.type === "condition" && (
                      <g>
                        <rect x={exitX + 6} y={exitY - 8} width={12} height={10} rx={3} fill={`${NO_CLR}30`} />
                        <text x={exitX + 12} y={exitY} textAnchor="middle" style={{ fontSize: "0.52rem", fill: NO_CLR, fontWeight: 700, pointerEvents: "none" }}>NO</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* ── Drag link preview ── */}
              {dragLink && (() => {
                const fp = positions[dragLink.fromId]; const fn = nodesById[dragLink.fromId]; const fd = getDims(fn);
                if (!fp) return null;
                const fromSide = dragLink.branch === "false" ? "right" : "bottom";
                const x1 = fromSide === "right" ? fp.x + fd.w : fp.x + fd.w / 2;
                const y1 = fromSide === "right" ? fp.y + fd.h / 2 : fp.y + fd.h;
                const color = dragLink.branch === "true" ? YES_CLR : dragLink.branch === "false" ? NO_CLR : ACCENT;
                return <line x1={x1} y1={y1} x2={dragLink.mouseX} y2={dragLink.mouseY} stroke={color} strokeWidth={1.8} strokeDasharray="4 3" opacity={0.7} />;
              })()}

              {/* ── Nodes ── */}
              {nodes.map(node => {
                const pos = positions[node.id]; if (!pos) return null;
                const d = getDims(node);
                const st = STATUS[node.status] || STATUS.idle;
                const isSel = selectedNodeId === node.id;

                /* ─ CONDITION diamond ─ */
                if (node.type === "condition") {
                  const cx = pos.x + d.w / 2, cy = pos.y + d.h / 2;
                  const pts = `${cx},${pos.y} ${pos.x + d.w},${cy} ${cx},${pos.y + d.h} ${pos.x},${cy}`;
                  const condResult = contexts[node.id]?._condResult;
                  const diamondColor = condResult === true ? YES_CLR : condResult === false ? NO_CLR : COND_CLR;
                  return (
                    <g key={node.id}>
                      <polygon points={pts} fill={isSel ? `${COND_CLR}20` : `${diamondColor}10`}
                        stroke={isSel ? ACCENT : diamondColor} strokeWidth={isSel ? 2 : 1.4}
                        style={{ cursor: "grab" }} onMouseDown={e => handleNodeDragStart(node.id, e)} />
                      {node.status === "running" && <polygon points={pts} fill="none" stroke={STATUS.running.color} strokeWidth={2}><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></polygon>}
                      <text x={cx} y={cy + 3} textAnchor="middle" style={{ fontSize: "0.58rem", fontWeight: 700, fill: diamondColor, pointerEvents: "none" }}>?</text>
                      <text x={cx} y={pos.y + d.h + 12} textAnchor="middle" style={{ fontSize: "0.58rem", fill: "#cfd6e4", pointerEvents: "none" }}>{node.label}</text>

                      {/* YES handle – bottom */}
                      <rect x={cx - 8} y={pos.y + d.h - 1} width={16} height={5} rx={2.5}
                        fill={YES_CLR} opacity={0.65} style={{ cursor: "crosshair" }}
                        onMouseDown={e => handleDragLinkStart(node.id, e, "true")}><title>Drag → YES path</title></rect>

                      {/* NO handle – right */}
                      <rect x={pos.x + d.w - 1} y={cy - 8} width={5} height={16} rx={2.5}
                        fill={NO_CLR} opacity={0.65} style={{ cursor: "crosshair" }}
                        onMouseDown={e => handleDragLinkStart(node.id, e, "false")}><title>Drag → NO path</title></rect>

                      {/* Delete */}
                      <g style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); removeNode(node.id); }}>
                        <circle cx={pos.x + d.w + 3} cy={pos.y - 3} r={7} fill="#1c2233" stroke="#3b4256" strokeWidth={0.8} />
                        <line x1={pos.x + d.w + 1} y1={pos.y - 5} x2={pos.x + d.w + 5} y2={pos.y - 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        <line x1={pos.x + d.w + 5} y1={pos.y - 5} x2={pos.x + d.w + 1} y2={pos.y - 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    </g>
                  );
                }

                /* ─ TRANSFORM node ─ */
                if (node.type === "transform") {
                  const emCount = contexts[node.id]?._emissionCount;
                  return (
                    <g key={node.id}>
                      <rect x={pos.x} y={pos.y} width={d.w} height={d.h} rx={5}
                        fill={isSel ? `${XFORM_CLR}20` : `${XFORM_CLR}08`}
                        stroke={isSel ? ACCENT : XFORM_CLR} strokeWidth={isSel ? 2 : 1.3}
                        style={{ cursor: "grab" }} onMouseDown={e => handleNodeDragStart(node.id, e)} />
                      {node.status === "running" && <rect x={pos.x} y={pos.y} width={d.w} height={d.h} rx={5}
                        fill="none" stroke={STATUS.running.color} strokeWidth={2}><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></rect>}
                      <text x={pos.x + d.w / 2} y={pos.y + d.h / 2 + 3.5} textAnchor="middle"
                        style={{ fontSize: "0.58rem", fontWeight: 600, fill: XFORM_CLR, pointerEvents: "none" }}>TF {node.label}</text>
                      {emCount != null && <text x={pos.x + d.w + 4} y={pos.y + d.h / 2 + 3} style={{ fontSize: "0.5rem", fill: XFORM_CLR, fontWeight: 600, pointerEvents: "none" }}>×{emCount}</text>}

                      {/* Bottom drag handle */}
                      <rect x={pos.x + d.w / 2 - 7} y={pos.y + d.h - 1} width={14} height={5} rx={2.5}
                        fill={XFORM_CLR} opacity={0.55} style={{ cursor: "crosshair" }}
                        onMouseDown={e => handleDragLinkStart(node.id, e)}><title>Drag to connect</title></rect>

                      <g style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); removeNode(node.id); }}>
                        <circle cx={pos.x + d.w + 3} cy={pos.y - 3} r={7} fill="#1c2233" stroke="#3b4256" strokeWidth={0.8} />
                        <line x1={pos.x + d.w + 1} y1={pos.y - 5} x2={pos.x + d.w + 5} y2={pos.y - 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        <line x1={pos.x + d.w + 5} y1={pos.y - 5} x2={pos.x + d.w + 1} y2={pos.y - 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    </g>
                  );
                }

                /* ─ REQUEST node (compact) ─ */
                const mColor = METHOD_COLORS[node.config.method] || "#64748b";
                const urlRaw = node.config.url || "";
                const urlDisplay = urlRaw.length > 24 ? urlRaw.slice(0, 24) + "…" : (urlRaw || "—");
                const labelShort = node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label;
                return (
                  <g key={node.id}>
                    <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                      fill={isSel ? `${ACCENT}10` : st.bg}
                      stroke={isSel ? ACCENT : node.status === "running" ? st.color : "var(--border)"}
                      strokeWidth={isSel ? 1.8 : 1.2} style={{ cursor: "grab" }}
                      onMouseDown={e => handleNodeDragStart(node.id, e)} />
                    {node.status === "running" && <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                      fill="none" stroke={STATUS.running.color} strokeWidth={1.8}><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></rect>}

                    {/* Row 1: dot + method + label */}
                    <circle cx={pos.x + 10} cy={pos.y + 15} r={3} fill={st.color} />
                    <text x={pos.x + 18} y={pos.y + 18} style={{ fontSize: "0.58rem", fontWeight: 700, fill: mColor, fontFamily: "var(--font-mono, monospace)", pointerEvents: "none" }}>{node.config.method}</text>
                    <text x={pos.x + 18 + node.config.method.length * 5.5 + 6} y={pos.y + 18} style={{ fontSize: "0.68rem", fontWeight: 600, fill: "var(--text)", pointerEvents: "none" }}>{labelShort}</text>

                    {/* Row 2: URL */}
                    <rect x={pos.x + 6} y={pos.y + 27} width={NODE_W - 12} height={18} rx={4} fill="var(--bg)" opacity={0.5} />
                    <text x={pos.x + 11} y={pos.y + 39.5} style={{ fontSize: "0.58rem", fontFamily: "var(--font-mono, monospace)", fill: "#cfd6e4", pointerEvents: "none" }}>{urlDisplay}</text>

                    {/* Status badge top-right */}
                    {node.status !== "idle" && <>
                      <rect x={pos.x + NODE_W - 34} y={pos.y + 3} width={30} height={13} rx={3} fill={`${st.color}20`} />
                      <text x={pos.x + NODE_W - 19} y={pos.y + 12.5} textAnchor="middle" style={{ fontSize: "0.5rem", fill: st.color, fontWeight: 600, pointerEvents: "none" }}>{st.label}</text>
                    </>}

                    {/* Iteration badge */}
                    {contexts[node.id]?.loopIteration != null && <>
                      <rect x={pos.x + NODE_W - 32} y={pos.y + NODE_H - 14} width={28} height={11} rx={3} fill="#a78bfa20" />
                      <text x={pos.x + NODE_W - 18} y={pos.y + NODE_H - 6} textAnchor="middle" style={{ fontSize: "0.48rem", fill: "#a78bfa", fontWeight: 600, pointerEvents: "none" }}>i{contexts[node.id].loopIteration}</text>
                    </>}

                    {/* Bottom handle */}
                    <rect x={pos.x + NODE_W / 2 - 10} y={pos.y + NODE_H - 3} width={20} height={6} rx={3}
                      fill={ACCENT} opacity={0.5} style={{ cursor: "crosshair" }}
                      onMouseDown={e => handleDragLinkStart(node.id, e)}><title>Drag to connect</title></rect>

                    {/* Delete */}
                    <g style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); removeNode(node.id); }}>
                      <circle cx={pos.x + NODE_W - 2} cy={pos.y - 2} r={7} fill="#1c2233" stroke="#3b4256" strokeWidth={0.8} />
                      <line x1={pos.x + NODE_W - 5} y1={pos.y - 5} x2={pos.x + NODE_W + 1} y2={pos.y + 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      <line x1={pos.x + NODE_W + 1} y1={pos.y - 5} x2={pos.x + NODE_W - 5} y2={pos.y + 1} stroke="#e9edf5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  </g>
                );
              })}
            </svg>
          )}

          {/* ── Edge action popup ── */}
          {edgePopup && (() => {
            const edge = edges.find(e => e.id === edgePopup.edgeId);
            if (!edge) return null;
            const isSelf = edge.from === edge.to;
            return (
              <div onClick={e => e.stopPropagation()} style={{
                position: "absolute", left: edgePopup.x - 90,
                top: Math.max(10, edgePopup.y - (isSelf ? 200 : 150)),
                width: 180,
                background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "9px",
                boxShadow: "0 8px 28px rgba(0,0,0,0.45)", padding: "6px", zIndex: 100,
                display: "flex", flexDirection: "column", gap: "2px",
              }}>
                {edge.branch && <div style={{ fontSize: "0.6rem", color: edge.branch === "true" ? YES_CLR : NO_CLR, fontWeight: 600, padding: "2px 8px" }}>{edge.branch === "true" ? "YES branch" : "NO branch"}</div>}
                {!isSelf && <>
                  <button className="ghost hover:bg-panel-2" onClick={() => handleInsertOnEdge(edge.id, "condition")} style={{
                    display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px", borderRadius: "5px", fontSize: "0.72rem",
                    color: COND_CLR, fontWeight: 600, width: "100%", textAlign: "left",
                  }}>◇ Condition</button>
                  <button className="ghost hover:bg-panel-2" onClick={() => handleInsertOnEdge(edge.id, "transform")} style={{
                    display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px", borderRadius: "5px", fontSize: "0.72rem",
                    color: XFORM_CLR, fontWeight: 600, width: "100%", textAlign: "left",
                  }}>⬡ Transform</button>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
                </>}
                <label className="hover:bg-panel-2 rounded-md" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.68rem", color: "var(--text-muted)", padding: "4px 8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={edge.runOnFailure || false}
                    onChange={ev => updateEdge({ ...edge, runOnFailure: ev.target.checked })}
                    style={{ accentColor: "#ff5555" }} />
                  Run on failure
                </label>
                {isSelf && <>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
                  <div style={{ padding: "1px 8px" }}>
                    <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginBottom: "2px" }}>Max iter</div>
                    <input className="input" type="number" min={1} max={1000} value={edge.maxIterations || 10}
                      onChange={ev => updateEdge({ ...edge, maxIterations: parseInt(ev.target.value) || 10 })}
                      style={{ fontSize: "0.68rem", padding: "2px 5px" }} />
                  </div>
                  <div style={{ padding: "1px 8px" }}>
                    <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginBottom: "2px" }}>Stop when</div>
                    <textarea className="input" rows={2} value={edge.terminateWhen || ""}
                      onChange={ev => updateEdge({ ...edge, terminateWhen: ev.target.value })}
                      placeholder="body.done === true"
                      style={{ fontSize: "0.66rem", fontFamily: "var(--font-mono, monospace)", resize: "vertical", padding: "2px 5px" }} />
                  </div>
                </>}
                <div style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
                <button className="ghost hover:bg-red-500/10" onClick={() => removeEdgeById(edge.id)} style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "5px 8px", borderRadius: "5px",
                  fontSize: "0.68rem", color: "#ff5555", fontWeight: 600, width: "100%", textAlign: "left",
                }}>
                  <IconTrash size={12} />
                  Delete
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ─── Modals ─── */}
      {selectedNode?.type === "condition" && (
        <ConditionConfigModal node={selectedNode} edges={edges}
          onUpdateConfig={updateConditionConfig} onUpdateLabel={updateNodeLabel}
          onRemove={() => removeNode(selectedNode.id)} onClose={() => setSelectedNodeId(null)} />
      )}
      {selectedNode?.type === "transform" && (
        <TransformConfigModal node={selectedNode} context={contexts[selectedNode.id]}
          onUpdateConfig={updateTransformConfig} onUpdateLabel={updateNodeLabel}
          onRemove={() => removeNode(selectedNode.id)} onClose={() => setSelectedNodeId(null)} />
      )}
      {selectedNode?.type === "request" && (
        <RequestResponseModal
          node={selectedNode}
          context={contexts[selectedNode.id]}
          onUpdateConfig={updateNodeConfig}
          onUpdateLabel={updateNodeLabel}
          onRunRequest={runRequestFromModal}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
      {showStepPicker && (
        <AddStepPicker collections={collections}
          onAddNew={m => addNodeWithMethod(m)} onAddFromCollection={r => addNodeFromRequest(r)}
          onClose={() => setShowStepPicker(false)} />
      )}
    </div>
  );
}
