import React, { useMemo, useState } from "react";
import type { ParsedCurl } from "../../services/curlParser";
import { collectTemplateVars, findParameterizableVars } from "../../services/curlParser";

interface CurlImportModalProps {
  parsed: ParsedCurl;
  envVars: Record<string, string>;
  onConfirm: (result: { fills: Record<string, string>; parameterize: string[] }) => void;
  onCancel: () => void;
}

function summarize(parsed: ParsedCurl): string {
  const parts: string[] = [];
  const headerCount = parsed.headersRows.filter((r) => r.key.trim()).length;
  if (headerCount) parts.push(`${headerCount} header${headerCount === 1 ? "" : "s"}`);
  const paramCount = parsed.paramsRows.filter((r) => r.key.trim()).length;
  if (paramCount) parts.push(`${paramCount} query param${paramCount === 1 ? "" : "s"}`);
  if (parsed.bodyType !== "none") parts.push(`${parsed.bodyType} body`);
  if (parsed.authType !== "none") parts.push(`${parsed.authType} auth`);
  return parts.length ? parts.join(" · ") : "no headers, body, or auth";
}

export function CurlImportModal({ parsed, envVars, onConfirm, onCancel }: CurlImportModalProps) {
  const undefinedVars = useMemo(
    () => collectTemplateVars(parsed).filter((name) => !envVars[name]),
    [parsed, envVars]
  );
  const paramCandidates = useMemo(
    () => findParameterizableVars(parsed, envVars),
    [parsed, envVars]
  );

  const [fills, setFills] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const handleImport = () => {
    const cleanFills: Record<string, string> = {};
    for (const [name, value] of Object.entries(fills)) {
      if (value.trim()) cleanFills[name] = value;
    }
    const parameterize = paramCandidates.filter((c) => selected[c.name]).map((c) => c.name);
    onConfirm({ fills: cleanFills, parameterize });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel} style={{ zIndex: 9999 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "560px", maxWidth: "90vw" }}>
        <div className="modal-title">
          <div>Import from cURL</div>
          <button className="ghost icon-button" onClick={onCancel} style={{ margin: "-8px", padding: "8px" }}>✕</button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
          This will replace the current request with the pasted cURL command.
        </p>

        <div style={{ background: "var(--panel)", borderRadius: "6px", padding: "10px 12px", margin: "12px 0", fontFamily: "monospace", fontSize: "13px", wordBreak: "break-all" }}>
          <div><strong>{parsed.method}</strong> {parsed.url}</div>
          <div style={{ color: "var(--muted)", marginTop: "6px", fontFamily: "inherit" }}>{summarize(parsed)}</div>
        </div>

        {undefinedVars.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }}>
              Undefined variables — fill or leave blank to import as-is
            </div>
            {undefinedVars.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <code style={{ minWidth: "120px", fontSize: "12px" }}>{`{{${name}}}`}</code>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder={`value for ${name}`}
                  value={fills[name] || ""}
                  onChange={(e) => setFills((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        {paramCandidates.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }}>
              Use existing environment variables
            </div>
            {paramCandidates.map((c) => (
              <label key={c.name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", cursor: "pointer", fontSize: "0.82rem" }}>
                <input
                  type="checkbox"
                  checked={!!selected[c.name]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [c.name]: e.target.checked }))}
                />
                <span>Replace <code style={{ fontSize: "12px" }}>{c.value}</code> → <code style={{ fontSize: "12px" }}>{`{{${c.name}}}`}</code></span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={handleImport}>Import</button>
        </div>
      </div>
    </div>
  );
}
