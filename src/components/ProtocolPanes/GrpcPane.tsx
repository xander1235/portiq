import React, { useState, useCallback, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { GrpcProtocol } from "../../protocols/grpc";

/**
 * GrpcPane - Request editor for gRPC calls with proto file support.
 *
 * Props:
 *   url, setUrl, onSend, isSending
 */
export interface GrpcPaneProps {
  url: string;
  setUrl: (v: string) => void;
  config: any;
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  onSend: () => void;
  isSending: boolean;
  response?: any;
}

export function GrpcPane({
  url,
  setUrl,
  config,
  setConfig,
  onSend,
  isSending,
  response
}: GrpcPaneProps) {
  const [activeTab, setActiveTab] = useState("request"); // request | proto | metadata | response
  const [protoContent, setProtoContent] = useState(config?.protoContent || "");
  const [parsedProto, setParsedProto] = useState<{ services: any[]; messages: any[] }>({ services: [], messages: [] });
  const [selectedService, setSelectedService] = useState(config?.service || "");
  const [selectedMethod, setSelectedMethod] = useState(config?.method || "");
  const [requestBody, setRequestBody] = useState(config?.requestBody || "{}");
  const [metadata, setMetadata] = useState(config?.metadata ? JSON.stringify(config.metadata, null, 2) : "{}");
  const [deadline, setDeadline] = useState(config?.deadline || 30000);

  // Parse proto when content changes
  useEffect(() => {
    if (protoContent) {
      const parsed = GrpcProtocol.parseProtoSchema(protoContent);
      setParsedProto(parsed as any);

      // Auto-select first service/method if none selected
      if (!selectedService && (parsed as any).services?.length > 0) {
        setSelectedService((parsed as any).services[0].name);
        if ((parsed as any).services[0].methods?.length > 0) {
          setSelectedMethod((parsed as any).services[0].methods[0].name);
        }
      }
    }
  }, [protoContent]);

  // Sync local state to config
  useEffect(() => {
    setConfig?.({
      ...config,
      protoContent,
      service: selectedService,
      method: selectedMethod,
      requestBody,
      metadata: (() => { try { return JSON.parse(metadata); } catch { return {}; } })(),
      deadline
    });
  }, [protoContent, selectedService, selectedMethod, requestBody, metadata, deadline]);

  const currentService = (parsedProto.services as any[]).find((s: any) => s.name === selectedService);
  const currentMethod = (currentService?.methods as any[] || []).find((m: any) => m.name === selectedMethod);

  const handleGenerateSample = useCallback(() => {
    if (currentMethod) {
      const sample = GrpcProtocol.generateSampleBody(currentMethod.inputType, parsedProto.messages);
      setRequestBody(sample);
    }
  }, [currentMethod, parsedProto.messages]);

  const handleSend = useCallback(() => {
    const validation = GrpcProtocol.validateRequest({
      url,
      service: selectedService,
      method: selectedMethod,
      requestBody
    });
    if (!validation.valid) {
      alert(validation.errors.join("\n"));
      return;
    }
    onSend?.();
  }, [url, selectedService, selectedMethod, requestBody, onSend]);

  const handleImportProto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".proto";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event: any) => {
        setProtoContent(event.target?.result as string);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      {/* Server address */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px" }}>
        <span style={{
          padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem",
          fontWeight: 700, background: "rgba(0, 188, 212, 0.1)", color: "#00bcd4",
          flexShrink: 0
        }}>
          gRPC
        </span>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="localhost:50051"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="primary"
          onClick={handleSend}
          disabled={isSending}
          style={{ flexShrink: 0, padding: "8px 20px" }}
        >
          {isSending ? "Calling..." : "Invoke"}
        </button>
      </div>

      {/* Service / Method selector */}
      {parsedProto.services.length > 0 && (
        <div style={{ display: "flex", gap: "8px", padding: "0 12px", alignItems: "center" }}>
          <select
            className="input"
            value={selectedService}
            onChange={(e) => {
              setSelectedService(e.target.value);
              const svc = (parsedProto.services as any[]).find((s: any) => s.name === e.target.value);
              if (svc?.methods?.[0]) setSelectedMethod(svc.methods[0].name);
            }}
            style={{ flex: 1, maxWidth: "300px" }}
          >
            <option value="">Select Service...</option>
            {parsedProto.services.map((s: any) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <select
            className="input"
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            style={{ flex: 1, maxWidth: "300px" }}
          >
            <option value="">Select Method...</option>
            {currentService?.methods.map((m: any) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.callType})
              </option>
            ))}
          </select>
          {currentMethod && (
            <span style={{
              fontSize: "0.7rem", padding: "2px 8px", borderRadius: "4px",
              background: "rgba(0, 188, 212, 0.1)", color: "#00bcd4", fontWeight: 600
            }}>
              {currentMethod.callType}
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "2px", padding: "0 12px", borderBottom: "1px solid var(--border)" }}>
        {["request", "proto", "metadata"].map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "ghost active" : "ghost"}
            onClick={() => setActiveTab(tab)}
            style={{ textTransform: "capitalize", fontSize: "0.85rem", padding: "6px 14px" }}
          >
            {tab === "proto" ? "Proto Definition" : tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
        {activeTab === "request" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Request Body (JSON)
                {currentMethod && (
                  <span style={{ color: "var(--accent)" }}> → {currentMethod.inputType}</span>
                )}
              </span>
              {currentMethod && (
                <button
                  className="ghost"
                  onClick={handleGenerateSample}
                  style={{ fontSize: "0.75rem" }}
                >
                  Generate Sample
                </button>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <CodeMirror
                value={requestBody}
                onChange={(val) => setRequestBody(val)}
                theme={vscodeDark}
                extensions={[json()]}
                height="100%"
                style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Deadline (ms)</label>
              <input
                className="input"
                type="number"
                value={deadline}
                onChange={(e) => setDeadline(Number(e.target.value))}
                style={{ width: "100px" }}
                min={0}
              />
            </div>
          </div>
        )}

        {activeTab === "proto" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button className="ghost" onClick={handleImportProto}>
                Import .proto File
              </button>
              {parsedProto.services.length > 0 && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {parsedProto.services.length} service(s), {parsedProto.messages.length} message(s) found
                </span>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <CodeMirror
                value={protoContent}
                onChange={(val) => setProtoContent(val)}
                theme={vscodeDark}
                height="100%"
                style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
                placeholder={`syntax = "proto3";\n\npackage myservice;\n\nservice MyService {\n  rpc GetUser (GetUserRequest) returns (User);\n}\n\nmessage GetUserRequest {\n  string id = 1;\n}\n\nmessage User {\n  string id = 1;\n  string name = 2;\n  string email = 3;\n}`}
              />
            </div>
          </div>
        )}

        {activeTab === "metadata" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              gRPC Metadata (equivalent to HTTP headers)
            </span>
            <div style={{ flex: 1 }}>
              <CodeMirror
                value={metadata}
                onChange={(val) => setMetadata(val)}
                theme={vscodeDark}
                extensions={[json()]}
                height="100%"
                style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
                placeholder='{\n  "authorization": "Bearer token"\n}'
              />
            </div>
          </div>
        )}
      </div>

      {/* Response area */}
      {response && (
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "12px",
          maxHeight: "40%",
          overflow: "auto"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{
              padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600,
              background: response.statusCode === 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: response.statusCode === 0 ? "#22c55e" : "#ef4444"
            }}>
              {GrpcProtocol.getStatusName(response.statusCode || 0)}
            </span>
            {response.duration && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{response.duration}ms</span>
            )}
          </div>

          {response.error && (
            <div style={{
              background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "8px", padding: "8px 12px", marginBottom: "8px",
              fontSize: "0.8rem", color: "#ef4444"
            }}>
              {response.error}
            </div>
          )}

          {(response.json || response.body) && (
            <CodeMirror
              value={response.json ? JSON.stringify(response.json, null, 2) : response.body}
              theme={vscodeDark}
              extensions={[json()]}
              readOnly
              height="200px"
              style={{ fontSize: "13px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default GrpcPane;
