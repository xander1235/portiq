import React, { useState } from "react";

/**
 * MCP Pane — Model Context Protocol client for interacting with
 * MCP servers (tools, resources, prompts).
 */
export interface McpPaneProps {
  url: string;
  setUrl: (v: string) => void;
}

export function McpPane({ url, setUrl }: McpPaneProps) {
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("tools");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [result, setResult] = useState<any>(null);

  async function handleConnect() {
    if (!url) return;
    setConnecting(true);
    setError("");
    try {
      // Initialize MCP connection
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Portiq", version: "0.2.1" },
        }}),
      });
      const data = await res.json();
      setServerInfo(data.result || data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleCallTool() {
    if (!toolName) return;
    setError("");
    try {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(toolArgs); } catch { /* ignore */ }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: {
          name: toolName,
          arguments: parsedArgs,
        }}),
      });
      const data = await res.json();
      setResult(data.result || data);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const tabs = [
    { id: "tools", label: "Tools" },
    { id: "resources", label: "Resources" },
    { id: "prompts", label: "Prompts" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "12px 16px", gap: "10px" }}>
      {/* URL + connect */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{
          fontSize: "0.72rem", fontWeight: 700, color: "#f472b6",
          background: "#f472b618", padding: "4px 10px", borderRadius: "6px",
          border: "1px solid #f472b630", flexShrink: 0,
        }}>MCP</span>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="http://localhost:3000/mcp"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="btn primary"
          onClick={handleConnect}
          disabled={connecting}
          style={{ flexShrink: 0 }}
        >
          {connecting ? "Connecting…" : serverInfo ? "Reconnect" : "Connect"}
        </button>
      </div>

      {error && <div style={{ color: "#ff5555", fontSize: "0.78rem" }}>{error}</div>}

      {/* Server info badge */}
      {serverInfo && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          fontSize: "0.75rem", color: "var(--text-muted)",
          padding: "6px 10px", borderRadius: "6px",
          background: "#f472b608", border: "1px solid #f472b620",
        }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }} />
          Connected to MCP server
          {serverInfo.serverInfo && (
            <span style={{ fontWeight: 600, color: "#f472b6" }}>
              {serverInfo.serverInfo.name} v{serverInfo.serverInfo.version}
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", paddingBottom: "4px" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="ghost"
            onClick={() => setActiveTab(tab.id)}
            style={{
              fontSize: "0.78rem", padding: "4px 12px", borderRadius: "6px 6px 0 0",
              fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? "#f472b6" : "var(--text-muted)",
              borderBottom: activeTab === tab.id ? "2px solid #f472b6" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tool call area */}
      {activeTab === "tools" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              className="input"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="Tool name (e.g. get_weather)"
              style={{ flex: 1 }}
            />
            <button className="btn primary" onClick={handleCallTool} style={{ flexShrink: 0 }}>
              Call Tool
            </button>
          </div>
          <textarea
            className="input"
            value={toolArgs}
            onChange={(e) => setToolArgs(e.target.value)}
            placeholder='{"param": "value"}'
            rows={4}
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.82rem", resize: "vertical" }}
          />
          {result && (
            <div style={{
              flex: 1, overflow: "auto", borderRadius: "8px",
              border: "1px solid var(--border)", background: "var(--bg)",
              padding: "10px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem",
            }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {activeTab === "resources" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
          Connect to an MCP server and browse available resources
        </div>
      )}

      {activeTab === "prompts" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
          Connect to an MCP server and browse available prompt templates
        </div>
      )}
    </div>
  );
}
