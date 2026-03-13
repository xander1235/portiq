import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { WebSocketProtocol } from "../../protocols/websocket.js";
import { TableEditor } from "../TableEditor.jsx";
import styles from "../RequestPane/RequestEditor.module.css";
import { customJsonLinter } from "../../utils/codemirror/jsonExtensions.js";
import { envVarHighlightPlugin, createEnvAutoComplete } from "../../utils/codemirror/environmentExtensions.js";
import { lintGutter } from "@codemirror/lint";
import { search } from "@codemirror/search";
import { createCustomSearchPanel, customSearchKeymap } from "../../utils/codemirror/customSearchPanel.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT_WS_CONFIG = {
  headersText: "{\n}",
  headersRows: [{ key: "", value: "", comment: "", enabled: true }],
  headersMode: "table",
  protocolsText: "",
  protocolRows: [{ key: "", value: "", comment: "", enabled: true }],
  autoReconnect: false,
  reconnectInterval: 3000,
  connectTimeout: 10000,
  messageType: "text",
  messages: []
};

function objectToRows(obj) {
  if (!obj || typeof obj !== "object") return [{ key: "", value: "", comment: "", enabled: true }];
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
    comment: "",
    enabled: true
  }));
}

function rowsToObject(rows) {
  return (rows || [])
    .filter((row) => row.key && row.enabled !== false)
    .reduce((acc, row) => ({ ...acc, [row.key]: row.value || "" }), {});
}

function rowsToProtocols(rows) {
  return (rows || [])
    .filter((row) => row.key && row.enabled !== false)
    .map((row) => String(row.key).trim())
    .filter(Boolean);
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function WebSocketPane({
  url,
  setUrl,
  config = DEFAULT_WS_CONFIG,
  setConfig,
  currentRequestId,
  updateRequestState,
  getEnvVars,
  interpolate,
  onStatusChange,
  clearSignal,
  onResponseChange
}) {
  const wsConfig = { ...DEFAULT_WS_CONFIG, ...(config || {}) };
  const [status, setStatus] = useState("disconnected");
  const [messages, setMessages] = useState(() => Array.isArray(wsConfig.messages) ? wsConfig.messages : []);
  const [messageInput, setMessageInput] = useState("");
  const [activeTab, setActiveTab] = useState("Message");
  const [error, setError] = useState(null);
  const [connectionTime, setConnectionTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [connectButtonHover, setConnectButtonHover] = useState(false);

  const managerRef = useRef(null);
  const connectionIdRef = useRef(currentRequestId ? `ws-${currentRequestId}` : `ws-${Date.now()}`);
  const searchWithReplace = useMemo(() => [
    search({ top: true, createPanel: createCustomSearchPanel }),
    customSearchKeymap
  ], []);

  const updateWsConfig = useCallback((patch) => {
    setConfig((prev) => {
      const next = { ...DEFAULT_WS_CONFIG, ...(prev || {}), ...patch };
      if (currentRequestId) {
        updateRequestState?.(currentRequestId, "wsConfig", next);
      }
      return next;
    });
  }, [currentRequestId, setConfig, updateRequestState]);

  const handleHeadersRowsChange = useCallback((nextRows) => {
    updateWsConfig({
      headersRows: nextRows,
      headersText: JSON.stringify(rowsToObject(nextRows), null, 2)
    });
  }, [updateWsConfig]);

  const handleHeadersTextChange = useCallback((value) => {
    const patch = { headersText: value };
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      patch.headersRows = objectToRows(parsed);
    } catch {
      // keep text while typing invalid JSON
    }
    updateWsConfig(patch);
  }, [updateWsConfig]);

  const handleProtocolRowsChange = useCallback((nextRows) => {
    updateWsConfig({
      protocolRows: nextRows,
      protocolsText: rowsToProtocols(nextRows).join(", ")
    });
  }, [updateWsConfig]);

  useEffect(() => {
    if (Array.isArray(wsConfig.messages) && wsConfig.messages.length && messages.length === 0) {
      setMessages(wsConfig.messages);
    }
  }, [wsConfig.messages, messages.length]);

  useEffect(() => {
    if ((!wsConfig.headersRows || wsConfig.headersRows.length === 0) && wsConfig.headersText) {
      try {
        updateWsConfig({ headersRows: objectToRows(JSON.parse(wsConfig.headersText)) });
      } catch {
        // ignore invalid persisted JSON
      }
    }
  }, [updateWsConfig, wsConfig.headersRows, wsConfig.headersText]);

  useEffect(() => {
    if ((!wsConfig.protocolRows || wsConfig.protocolRows.length === 0) && wsConfig.protocolsText) {
      updateWsConfig({
        protocolRows: wsConfig.protocolsText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((value) => ({ key: value, value: "", comment: "", enabled: true }))
      });
    }
  }, [updateWsConfig, wsConfig.protocolRows, wsConfig.protocolsText]);

  useEffect(() => {
    connectionIdRef.current = currentRequestId ? `ws-${currentRequestId}` : connectionIdRef.current;
  }, [currentRequestId]);

  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.cleanup();
      }
    };
  }, []);

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg].slice(-200));
  }, []);

  const compiledConfig = useMemo(() => {
    return WebSocketProtocol.buildRequest({
      url,
      headersText: wsConfig.headersText,
      headersRows: wsConfig.headersRows,
      protocolsText: wsConfig.protocolsText,
      protocolRows: wsConfig.protocolRows,
      autoReconnect: wsConfig.autoReconnect,
      reconnectInterval: wsConfig.reconnectInterval,
      connectTimeout: wsConfig.connectTimeout
    });
  }, [
    url,
    wsConfig.headersText,
    wsConfig.headersRows,
    wsConfig.protocolsText,
    wsConfig.protocolRows,
    wsConfig.autoReconnect,
    wsConfig.reconnectInterval,
    wsConfig.connectTimeout
  ]);

  useEffect(() => {
    let cancelled = false;
    const connectionId = currentRequestId ? `ws-${currentRequestId}` : connectionIdRef.current;
    connectionIdRef.current = connectionId;

    const manager = WebSocketProtocol.createConnectionManager(connectionId);
    managerRef.current = manager;

    const unsubMessage = manager.on("message", appendMessage);
    const unsubStatus = manager.on("statusChange", (nextStatus) => {
      if (cancelled) return;
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      if (nextStatus === "disconnected" || nextStatus === "error") {
        setConnectionTime(null);
      }
    });
    const unsubError = manager.on("error", (data) => {
      if (cancelled) return;
      setError(data.error || "Connection error");
    });

    manager.attachExisting({
      url: compiledConfig.url,
      headers: compiledConfig.headers,
      protocols: compiledConfig.protocols,
      options: {
        autoReconnect: compiledConfig.autoReconnect,
        reconnectInterval: compiledConfig.reconnectInterval,
        connectTimeout: compiledConfig.connectTimeout
      }
    }).then((existing) => {
      if (cancelled) return;
      setMessages(existing.messages || []);
      if (existing.status === "connected" && existing.connectedAt) {
        setConnectionTime(existing.connectedAt);
      } else if (existing.status !== "connected") {
        setConnectionTime(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setMessages([]);
        setStatus("disconnected");
      }
    });

    return () => {
      cancelled = true;
      unsubMessage?.();
      unsubStatus?.();
      unsubError?.();
      manager.cleanup();
    };
  }, [
    appendMessage,
    compiledConfig.autoReconnect,
    compiledConfig.connectTimeout,
    compiledConfig.headers,
    compiledConfig.protocols,
    compiledConfig.reconnectInterval,
    compiledConfig.url,
    currentRequestId,
    onStatusChange
  ]);

  useEffect(() => {
    if (!connectionTime || (status !== "connected" && status !== "reconnecting")) {
      setElapsedTime(0);
      return;
    }
    setElapsedTime(Math.floor((Date.now() - connectionTime) / 1000));
    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - connectionTime) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [connectionTime, status]);

  useEffect(() => {
    onResponseChange?.({
      protocol: "websocket",
      status,
      statusText: status,
      body: JSON.stringify(messages, null, 2),
      json: messages,
      headers: compiledConfig.headers,
      time: elapsedTime ? elapsedTime * 1000 : undefined,
      duration: elapsedTime ? elapsedTime * 1000 : undefined,
      ws: {
        status,
        messages,
        connectionTime,
        elapsedSeconds: elapsedTime,
        protocols: compiledConfig.protocols,
        autoReconnect: compiledConfig.autoReconnect,
        reconnectInterval: compiledConfig.reconnectInterval,
        connectTimeout: compiledConfig.connectTimeout
      },
      error
    });
  }, [
    compiledConfig.autoReconnect,
    compiledConfig.connectTimeout,
    compiledConfig.headers,
    compiledConfig.protocols,
    compiledConfig.reconnectInterval,
    connectionTime,
    elapsedTime,
    error,
    messages,
    onResponseChange,
    status
  ]);

  useEffect(() => {
    if (clearSignal > 0) {
      setMessages([]);
      if (managerRef.current) {
        managerRef.current.clearHistory();
      }
    }
  }, [clearSignal]);

  const handleConnect = useCallback(async () => {
    const validation = WebSocketProtocol.validateRequest({ url });
    if (!validation.valid) {
      setError(validation.errors.join(", "));
      return;
    }

    if (managerRef.current) {
      await managerRef.current.disconnect();
      managerRef.current.cleanup();
    }

    setError(null);
    setMessages([]);

    setStatus("connecting");
    const result = await managerRef.current.connect(
      compiledConfig.url,
      compiledConfig.headers,
      compiledConfig.protocols,
      {
        autoReconnect: compiledConfig.autoReconnect,
        reconnectInterval: compiledConfig.reconnectInterval,
        connectTimeout: compiledConfig.connectTimeout
      }
    );

    if (result.error) {
      if (!result.cancelled) {
        setError(result.error);
      }
      managerRef.current = null;
    } else if (result.connectedAt) {
      setConnectionTime(result.connectedAt);
    }
  }, [compiledConfig, url]);

  const handleDisconnect = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.disconnect();
      managerRef.current = null;
    }
    setError(null);
    setStatus("disconnected");
    setConnectionTime(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!messageInput.trim()) return;
    if (!managerRef.current) {
      setError("Not connected");
      return;
    }

    let payload = messageInput;
    const messageType = wsConfig.messageType || "text";

    if (messageType === "json") {
      try {
        const withoutComments = String(messageInput)
          .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        payload = JSON.parse(interpolate(withoutComments));
      } catch {
        setError("Invalid JSON");
        return;
      }
    }

    if (messageType === "binary") {
      const encoded = bytesToBase64(new TextEncoder().encode(interpolate(messageInput)));
      payload = { data: encoded, encoding: "base64" };
    }

    if (messageType === "text") {
      payload = interpolate(messageInput);
    }

    const result = await managerRef.current.send(payload);
    if (result.error) {
      setError(result.error);
      return;
    }

    setMessageInput("");
    setError(null);
  }, [interpolate, messageInput, status, wsConfig.messageType]);

  const statusColors = {
    connected: "#22c55e",
    connecting: "#f59e0b",
    reconnecting: "#f59e0b",
    disconnected: "#6b7280",
    error: "#ef4444"
  };

  const sentCount = useMemo(
    () => messages.filter((message) => message.direction === "outgoing").length,
    [messages]
  );
  const receivedCount = useMemo(
    () => messages.filter((message) => message.direction === "incoming").length,
    [messages]
  );

  const envAutoComplete = useMemo(() => createEnvAutoComplete(getEnvVars), [getEnvVars]);

  const messageActions = (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      {activeTab === "Headers" && (
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
          <button
            className={wsConfig.headersMode === "table" ? `${styles.tab} ${styles.active}` : styles.tab}
            onClick={() => updateWsConfig({ headersMode: "table" })}
          >
            Table
          </button>
          <button
            className={wsConfig.headersMode === "json" ? `${styles.tab} ${styles.active}` : styles.tab}
            onClick={() => updateWsConfig({ headersMode: "json" })}
          >
            JSON
          </button>
        </div>
      )}

      {activeTab === "Message" && (
        <>
          <Select value={wsConfig.messageType} onValueChange={(value) => updateWsConfig({ messageType: value })}>
            <SelectTrigger className="w-[180px] h-[28px] text-[12px] bg-panel border-border text-foreground">
              <SelectValue placeholder="Message Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="binary">Binary</SelectItem>
            </SelectContent>
          </Select>
          {wsConfig.messageType === "json" && (
            <>
              <button
                className="ghost compact"
                style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                onClick={() => {
                  try {
                    const withoutComments = String(messageInput)
                      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
                    const parsed = JSON.parse(withoutComments);
                    setMessageInput(JSON.stringify(parsed, null, 2));
                  } catch {
                    // ignore invalid JSON while typing
                  }
                }}
              >
                Prettify
              </button>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Supports // comments</div>
            </>
          )}
        </>
      )}

      <label style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "6px", color: "var(--muted)" }}>
        <input
          type="checkbox"
          checked={Boolean(wsConfig.autoReconnect)}
          onChange={(e) => updateWsConfig({ autoReconnect: e.target.checked })}
        />
        Auto-reconnect
      </label>

      <label style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "6px", color: "var(--muted)" }}>
        Retry ms
        <input
          className="input"
          type="number"
          min="250"
          step="250"
          value={wsConfig.reconnectInterval}
          onChange={(e) => updateWsConfig({ reconnectInterval: Number(e.target.value) || 3000 })}
          style={{ width: "96px", height: "28px" }}
          disabled={!wsConfig.autoReconnect}
        />
      </label>

    </div>
  );

  return (
    <section className={styles.request}>
      <div className={styles.requestTitle}>
        <span className="request-name">WebSocket</span>
      </div>

      <div className={styles.requestBar}>
        <div
          className="input"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontWeight: 700,
            color: statusColors[status] || "var(--muted)"
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: statusColors[status] || statusColors.disconnected,
              boxShadow: status === "connected" ? `0 0 6px ${statusColors.connected}` : "none"
            }}
          />
          {status === "connected" ? "OPEN" : status === "connecting" ? "WAIT" : "WS"}
        </div>

        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && status !== "connected" && handleConnect()}
          placeholder="ws://localhost:8080"
          disabled={status === "connected" || status === "reconnecting"}
        />

        {status === "connected" || status === "reconnecting" ? (
          <button className="ghost" onClick={handleDisconnect} style={{ color: "#ef4444", borderColor: "#ef4444" }}>
            Disconnect
          </button>
        ) : (
          <button
            className={status === "connecting" ? "ghost" : "primary"}
            onClick={status === "connecting" ? handleDisconnect : handleConnect}
            onMouseEnter={() => setConnectButtonHover(true)}
            onMouseLeave={() => setConnectButtonHover(false)}
            style={status === "connecting" ? { color: "#ef4444", borderColor: "#ef4444" } : undefined}
          >
            {status === "connecting"
              ? (connectButtonHover ? "Cancel" : "Connecting...")
              : "Connect"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div className={styles.tabs} style={{ marginBottom: 0 }}>
          {["Headers", "Connection", "Message"].map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? `${styles.tab} ${styles.active}` : styles.tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "0.8rem", color: "var(--muted)", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {messageActions}
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", fontSize: "0.8rem", color: "var(--muted)", flexWrap: "wrap" }}>
        <span>Status: <span style={{ color: statusColors[status], fontWeight: 600 }}>{status}</span></span>
        <span>Sent: {sentCount}</span>
        <span>Received: {receivedCount}</span>
        <span>Connected: {connectionTime ? `${elapsedTime}s` : "-"}</span>
        {error && <span style={{ color: "#ef4444" }}>Error: {error}</span>}
      </div>

      <div className={styles.editor}>
        {activeTab === "Headers" && (
          <div className={styles.headersEditor}>
            {wsConfig.headersMode === "table" && (
              <TableEditor
                rows={wsConfig.headersRows}
                onChange={handleHeadersRowsChange}
                keyPlaceholder="Header"
                valuePlaceholder="Value"
                envVars={getEnvVars()}
              />
            )}

            {wsConfig.headersMode === "json" && (
              <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: "4px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <CodeMirror
                  value={wsConfig.headersText}
                  theme={vscodeDark}
                  extensions={[json()]}
                  onChange={handleHeadersTextChange}
                  basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                  style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: "13px" }}
                  placeholder="Paste JSON headers here"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "Connection" && (
          <div className={styles.headersEditor} style={{ gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)" }}>Connection</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.76rem", color: "var(--muted)" }}>Connect timeout</label>
                <input
                  className="input"
                  type="number"
                  min="1000"
                  step="500"
                  value={wsConfig.connectTimeout}
                  onChange={(e) => updateWsConfig({ connectTimeout: Number(e.target.value) || 10000 })}
                  style={{ width: "120px", height: "32px" }}
                />
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>ms</span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                Abort the handshake if the server does not open within this time.
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minHeight: 0, flex: 1 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)" }}>Subprotocols</div>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                Optional. Use only if the server requires `Sec-WebSocket-Protocol`.
              </div>
              <TableEditor
                rows={wsConfig.protocolRows}
                onChange={handleProtocolRowsChange}
                keyPlaceholder="Subprotocol"
                valuePlaceholder="Notes"
              />
            </div>
          </div>
        )}

        {activeTab === "Message" && (
          <div className={styles.bodyEditor} style={{ flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {wsConfig.messageType === "json" ? (
                <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: "4px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <CodeMirror
                    value={messageInput}
                    height="100%"
                    theme={vscodeDark}
                    extensions={[json(), customJsonLinter, lintGutter(), envAutoComplete, envVarHighlightPlugin, ...searchWithReplace]}
                    onChange={(value) => setMessageInput(value)}
                    basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, highlightActiveLine: false }}
                    style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontSize: "13px" }}
                    placeholder={'{\n  "type": "ping"\n}'}
                    editable={true}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: "4px", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <textarea
                    className="textarea"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && (wsConfig.messageType === "text" || wsConfig.messageType === "binary")) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={
                      wsConfig.messageType === "binary"
                        ? "Binary frame content (UTF-8 text encoded to bytes)"
                        : "Type a message..."
                    }
                    style={{
                      flex: 1,
                      minHeight: 0,
                      height: "100%",
                      border: "none",
                      borderRadius: "4px",
                      background: "transparent",
                      fontFamily: wsConfig.messageType === "text" ? "inherit" : "IBM Plex Mono, monospace",
                      fontSize: "0.85rem"
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                Incoming and outgoing frames are shown in the response section below.
              </div>
              <button
                className="primary"
                onClick={handleSend}
                disabled={status !== "connected" || !messageInput.trim()}
                style={{ minWidth: "110px" }}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default WebSocketPane;
