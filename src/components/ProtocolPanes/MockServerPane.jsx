import React, { useState, useCallback, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { MockServerService } from "../../services/mockServer.js";

/**
 * MockServerPane - UI for configuring, running, and managing mock HTTP servers.
 *
 * Props:
 *   collections - Array of collections (for auto-generating routes)
 */
export function MockServerPane({ collections }) {
  const [servers, setServers] = useState([]);
  const [port, setPort] = useState(3100);
  const [name, setName] = useState("");
  const [routes, setRoutes] = useState([MockServerService.createDefaultRoute()]);
  const [serverLogs, setServerLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("config"); // config | routes | logs
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const logsEndRef = useRef(null);

  // Fetch running servers on mount
  useEffect(() => {
    refreshServers();
  }, []);

  // Auto-scroll logs on new entries
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [serverLogs]);

  const refreshServers = useCallback(async () => {
    try {
      const list = await MockServerService.list();
      if (Array.isArray(list)) setServers(list);
    } catch (err) {
      console.error("Failed to list mock servers:", err);
    }
  }, []);

  const handleStart = useCallback(async () => {
    try {
      const result = await MockServerService.start({
        port,
        name: name || `Mock Server (${port})`,
        routes
      });
      addLog("info", `Server started on port ${result?.port ?? port}`);
      refreshServers();
    } catch (err) {
      addLog("error", `Failed to start: ${err.message}`);
    }
  }, [port, name, routes, refreshServers]);

  const handleStop = useCallback(async (serverPort) => {
    try {
      await MockServerService.stop(serverPort);
      addLog("info", `Server on port ${serverPort} stopped`);
      refreshServers();
    } catch (err) {
      addLog("error", `Failed to stop: ${err.message}`);
    }
  }, [refreshServers]);

  const addRoute = useCallback(() => {
    setRoutes(prev => [...prev, MockServerService.createDefaultRoute()]);
    setSelectedRouteIdx(routes.length);
  }, [routes.length]);

  const removeRoute = useCallback((idx) => {
    setRoutes(prev => prev.filter((_, i) => i !== idx));
    setSelectedRouteIdx(Math.max(0, selectedRouteIdx - 1));
  }, [selectedRouteIdx]);

  const updateRoute = useCallback((idx, updates) => {
    setRoutes(prev => prev.map((r, i) => i === idx ? { ...r, ...updates } : r));
  }, []);

  const addLog = (level, message) => {
    setServerLogs(prev => [
      ...prev.slice(-200), // keep last 200 logs
      { level, message, timestamp: new Date().toISOString() }
    ]);
  };

  const handleGenerateFromCollection = useCallback(async () => {
    if (!collections?.length) {
      addLog("warn", "No collections available to generate routes from");
      return;
    }
    const generated = MockServerService.generateRoutesFromCollection(collections);
    if (generated.length === 0) {
      addLog("warn", "No routes could be generated from collections.");
      return;
    }
    setRoutes(prev => [...prev, ...generated]);
    addLog("info", `Generated ${generated.length} route(s) from collections.`);
  }, [collections]);

  const currentRoute = routes[selectedRouteIdx];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px" }}>
        <span style={{
          padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem",
          fontWeight: 700, background: "rgba(255, 152, 0, 0.1)", color: "#ff9800"
        }}>
          Mock Server
        </span>
        <input
          className="input"
          style={{ flex: 1, maxWidth: "220px" }}
          placeholder="Server name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Port:</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            style={{ width: "80px" }}
            min={1024}
            max={65535}
          />
        </div>
        <button className="primary" onClick={handleStart} style={{ padding: "8px 20px" }}>
          Start Server
        </button>
      </div>

      {/* Running servers */}
      {servers.length > 0 && (
        <div style={{ padding: "0 12px" }}>
          <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
            {servers.map((srv) => (
              <div key={srv.port} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "6px 12px", borderRadius: "8px",
                background: "rgba(34, 197, 94, 0.05)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                fontSize: "0.8rem", flexShrink: 0
              }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }}></span>
                <span style={{ fontWeight: 600 }}>{srv.name || `Port ${srv.port}`}</span>
                <span style={{ color: "var(--text-muted)" }}>:{srv.port}</span>
                <span style={{ color: "var(--text-muted)" }}>{srv.routeCount ?? "?"} routes</span>
                <button
                  className="ghost"
                  onClick={() => handleStop(srv.port)}
                  style={{ padding: "2px 8px", fontSize: "0.7rem", color: "#ef4444" }}
                >
                  Stop
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "2px", padding: "0 12px", borderBottom: "1px solid var(--border)" }}>
        {["config", "routes", "logs"].map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "ghost active" : "ghost"}
            onClick={() => setActiveTab(tab)}
            style={{ textTransform: "capitalize", fontSize: "0.85rem", padding: "6px 14px" }}
          >
            {tab}
            {tab === "routes" && <span style={{ marginLeft: "4px", opacity: 0.6 }}>({routes.length})</span>}
            {tab === "logs" && serverLogs.length > 0 && (
              <span style={{ marginLeft: "4px", opacity: 0.6 }}>({serverLogs.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
        {activeTab === "config" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{
              background: "var(--bg-secondary, rgba(255,255,255,0.03))",
              borderRadius: "8px", padding: "16px", border: "1px solid var(--border)"
            }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: "0.9rem" }}>Quick Start</h4>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 12px 0" }}>
                Create a local HTTP mock server that responds with predefined data.
                Configure routes below, then click "Start Server".
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="ghost" onClick={handleGenerateFromCollection}>
                  Generate Routes from Collections
                </button>
                <button className="ghost" onClick={addRoute}>
                  Add Empty Route
                </button>
              </div>
            </div>

            <div style={{
              background: "var(--bg-secondary, rgba(255,255,255,0.03))",
              borderRadius: "8px", padding: "16px", border: "1px solid var(--border)"
            }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: "0.9rem" }}>Server Options</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label style={{ fontSize: "0.8rem", width: "120px", color: "var(--text-muted)" }}>
                    CORS Enabled
                  </label>
                  <span style={{ fontSize: "0.8rem", color: "#22c55e" }}>Yes (all origins)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label style={{ fontSize: "0.8rem", width: "120px", color: "var(--text-muted)" }}>
                    Response Format
                  </label>
                  <span style={{ fontSize: "0.8rem" }}>JSON (Content-Type: application/json)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "routes" && (
          <div style={{ display: "flex", gap: "12px", height: "100%", minHeight: "300px" }}>
            {/* Route list sidebar */}
            <div style={{
              width: "200px", flexShrink: 0, borderRadius: "8px",
              border: "1px solid var(--border)", overflow: "auto"
            }}>
              {routes.map((route, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedRouteIdx(idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 10px", cursor: "pointer",
                    borderBottom: "1px solid var(--border)",
                    background: idx === selectedRouteIdx ? "rgba(99, 102, 241, 0.1)" : "transparent"
                  }}
                >
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 700,
                    color: methodColor(route.method), minWidth: "32px"
                  }}>
                    {route.method}
                  </span>
                  <span style={{
                    fontSize: "0.75rem", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1
                  }}>
                    {route.path || "/"}
                  </span>
                  <button
                    className="ghost"
                    onClick={(e) => { e.stopPropagation(); removeRoute(idx); }}
                    style={{ padding: "0 4px", fontSize: "0.7rem", color: "#ef4444", flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="ghost"
                onClick={addRoute}
                style={{ width: "100%", padding: "8px", fontSize: "0.8rem", borderRadius: 0 }}
              >
                + Add Route
              </button>
            </div>

            {/* Route editor */}
            {currentRoute && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", gap: "8px",
                borderRadius: "8px", border: "1px solid var(--border)", padding: "12px"
              }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select
                    className="input"
                    value={currentRoute.method}
                    onChange={(e) => updateRoute(selectedRouteIdx, { method: e.target.value })}
                    style={{ width: "100px" }}
                  >
                    {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={currentRoute.path}
                    onChange={(e) => updateRoute(selectedRouteIdx, { path: e.target.value })}
                    placeholder="/api/resource/:id"
                    style={{ flex: 1 }}
                  />
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Status:</label>
                  <input
                    className="input"
                    type="number"
                    value={currentRoute.statusCode}
                    onChange={(e) => updateRoute(selectedRouteIdx, { statusCode: Number(e.target.value) })}
                    style={{ width: "80px" }}
                    min={100}
                    max={599}
                  />
                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: "12px" }}>
                    Delay (ms):
                  </label>
                  <input
                    className="input"
                    type="number"
                    value={currentRoute.delay || 0}
                    onChange={(e) => updateRoute(selectedRouteIdx, { delay: Number(e.target.value) })}
                    style={{ width: "80px" }}
                    min={0}
                  />
                </div>

                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  Response Body (JSON)
                </label>
                <div style={{ flex: 1 }}>
                  <CodeMirror
                    value={typeof currentRoute.body === "string"
                      ? currentRoute.body
                      : JSON.stringify(currentRoute.body, null, 2)}
                    onChange={(val) => updateRoute(selectedRouteIdx, { body: val })}
                    theme={vscodeDark}
                    extensions={[json()]}
                    height="100%"
                    style={{
                      fontSize: "13px", borderRadius: "8px", overflow: "hidden",
                      border: "1px solid var(--border)"
                    }}
                  />
                </div>

                <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  Custom Response Headers (JSON)
                </label>
                <CodeMirror
                  value={currentRoute.headers ? JSON.stringify(currentRoute.headers, null, 2) : "{}"}
                  onChange={(val) => {
                    try { updateRoute(selectedRouteIdx, { headers: JSON.parse(val) }); }
                    catch { /* ignore invalid json while typing */ }
                  }}
                  theme={vscodeDark}
                  extensions={[json()]}
                  height="80px"
                  style={{
                    fontSize: "13px", borderRadius: "8px", overflow: "hidden",
                    border: "1px solid var(--border)"
                  }}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "logs" && (
          <div style={{
            fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem",
            height: "100%", overflow: "auto", borderRadius: "8px",
            border: "1px solid var(--border)", padding: "8px"
          }}>
            {serverLogs.length === 0 && (
              <span style={{ color: "var(--text-muted)" }}>No logs yet. Start a server to see activity.</span>
            )}
            {serverLogs.map((log, idx) => (
              <div key={idx} style={{
                padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)",
                color: log.level === "error" ? "#ef4444" : log.level === "warn" ? "#f59e0b" : "var(--text)"
              }}>
                <span style={{ color: "var(--text-muted)", marginRight: "8px" }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                {log.message}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function methodColor(method) {
  const colors = {
    GET: "#22c55e",
    POST: "#eab308",
    PUT: "#3b82f6",
    PATCH: "#a855f7",
    DELETE: "#ef4444",
    HEAD: "#6b7280",
    OPTIONS: "#06b6d4"
  };
  return colors[method] || "#999";
}

export default MockServerPane;
