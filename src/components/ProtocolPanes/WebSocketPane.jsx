import React, { useState, useEffect, useRef, useCallback } from "react";
import { WebSocketProtocol } from "../../protocols/websocket.js";

/**
 * WebSocketPane - Connection manager and message viewer for WebSocket.
 *
 * Props:
 *   url, setUrl, headers, onStatusChange
 */
export function WebSocketPane({
  url,
  setUrl,
  headers = {},
  protocols = [],
  onStatusChange
}) {
  const [status, setStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [messageType, setMessageType] = useState("text"); // text | json
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("all"); // all | incoming | outgoing
  const [error, setError] = useState(null);
  const [connectionTime, setConnectionTime] = useState(null);

  const managerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const connectionIdRef = useRef(`ws-${Date.now()}`);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (managerRef.current) {
        managerRef.current.disconnect();
        managerRef.current.cleanup();
      }
    };
  }, []);

  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const handleConnect = useCallback(async () => {
    const validation = WebSocketProtocol.validateRequest({ url });
    if (!validation.valid) {
      setError(validation.errors.join(", "));
      return;
    }

    setError(null);
    setMessages([]);

    connectionIdRef.current = `ws-${Date.now()}`;
    const manager = WebSocketProtocol.createConnectionManager(connectionIdRef.current);
    managerRef.current = manager;

    manager.on("message", (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    manager.on("statusChange", (newStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    });

    manager.on("close", (data) => {
      setConnectionTime(null);
    });

    manager.on("error", (data) => {
      setError(data.error || "Connection error");
    });

    setStatus("connecting");
    const result = await manager.connect(url, headers, protocols);
    if (result.error) {
      setError(result.error);
    } else {
      setConnectionTime(Date.now());
    }
  }, [url, headers, protocols, onStatusChange]);

  const handleDisconnect = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.disconnect();
      managerRef.current = null;
    }
    setConnectionTime(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!messageInput.trim()) return;
    if (!managerRef.current || status !== "connected") {
      setError("Not connected");
      return;
    }

    let dataToSend = messageInput;
    if (messageType === "json") {
      try {
        JSON.parse(messageInput);
      } catch (e) {
        setError("Invalid JSON");
        return;
      }
    }

    const result = await managerRef.current.send(dataToSend);
    if (result.error) {
      setError(result.error);
    } else {
      setMessageInput("");
      setError(null);
    }
  }, [messageInput, messageType, status]);

  const handleClear = () => {
    setMessages([]);
    if (managerRef.current) {
      managerRef.current.clearHistory();
    }
  };

  const filteredMessages = messages.filter(msg => {
    if (filter === "all") return true;
    return msg.direction === filter;
  });

  const statusColors = {
    connected: "#22c55e",
    connecting: "#f59e0b",
    disconnected: "#6b7280",
    error: "#ef4444"
  };

  const elapsedTime = connectionTime
    ? Math.floor((Date.now() - connectionTime) / 1000)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      {/* Connection bar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px" }}>
        <div style={{
          width: "10px", height: "10px", borderRadius: "50%",
          background: statusColors[status] || statusColors.disconnected,
          flexShrink: 0,
          boxShadow: status === "connected" ? `0 0 6px ${statusColors.connected}` : "none"
        }} />
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="wss://echo.websocket.org"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && status !== "connected" && handleConnect()}
          disabled={status === "connected"}
        />
        {status === "connected" ? (
          <button
            className="ghost"
            onClick={handleDisconnect}
            style={{ color: "#ef4444", borderColor: "#ef4444", flexShrink: 0 }}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="primary"
            onClick={handleConnect}
            disabled={status === "connecting"}
            style={{ flexShrink: 0 }}
          >
            {status === "connecting" ? "Connecting..." : "Connect"}
          </button>
        )}
      </div>

      {/* Status bar */}
      <div style={{
        display: "flex", gap: "12px", alignItems: "center", padding: "0 12px",
        fontSize: "0.75rem", color: "var(--text-muted)"
      }}>
        <span>Status: <span style={{ color: statusColors[status], fontWeight: 600 }}>{status}</span></span>
        <span>Messages: {messages.length}</span>
        {elapsedTime !== null && <span>Connected: {elapsedTime}s</span>}
        {error && <span style={{ color: "#ef4444" }}>Error: {error}</span>}
      </div>

      {/* Message filter and actions */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "0 12px" }}>
        <div style={{ display: "flex", gap: "2px" }}>
          {["all", "incoming", "outgoing"].map(f => (
            <button
              key={f}
              className={filter === f ? "ghost active" : "ghost"}
              onClick={() => setFilter(f)}
              style={{ fontSize: "0.75rem", padding: "4px 10px", textTransform: "capitalize" }}
            >
              {f === "incoming" ? "↓ Received" : f === "outgoing" ? "↑ Sent" : "All"}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={handleClear} style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
          Clear
        </button>
        <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {/* Messages list */}
      <div style={{
        flex: 1, overflow: "auto", padding: "0 12px",
        display: "flex", flexDirection: "column", gap: "4px"
      }}>
        {filteredMessages.length === 0 ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            flex: 1, color: "var(--text-muted)", fontSize: "0.85rem"
          }}>
            {status === "connected" ? "No messages yet. Send a message below." : "Connect to start exchanging messages."}
          </div>
        ) : (
          filteredMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                padding: "6px 10px",
                borderRadius: "6px",
                background: msg.direction === "outgoing" ? "rgba(99, 102, 241, 0.08)" : "rgba(34, 197, 94, 0.08)",
                border: `1px solid ${msg.direction === "outgoing" ? "rgba(99, 102, 241, 0.15)" : "rgba(34, 197, 94, 0.15)"}`,
                alignSelf: msg.direction === "outgoing" ? "flex-end" : "flex-start",
                maxWidth: "85%"
              }}
            >
              <div style={{ display: "flex", gap: "8px", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                <span style={{
                  fontWeight: 600,
                  color: msg.direction === "outgoing" ? "#6366f1" : "#22c55e"
                }}>
                  {msg.direction === "outgoing" ? "↑ SENT" : "↓ RECEIVED"}
                </span>
                <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ""}</span>
                {msg.size !== undefined && <span>{msg.size}B</span>}
              </div>
              <pre style={{
                margin: 0, fontFamily: "monospace", fontSize: "0.8rem",
                color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-all"
              }}>
                {msg.parsed?.type === "json"
                  ? JSON.stringify(msg.parsed.data, null, 2)
                  : (msg.data || msg.raw || "")}
              </pre>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Send bar */}
      <div style={{
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        display: "flex", gap: "8px", alignItems: "flex-end"
      }}>
        <select
          className="input"
          value={messageType}
          onChange={(e) => setMessageType(e.target.value)}
          style={{ width: "80px", flexShrink: 0 }}
        >
          <option value="text">Text</option>
          <option value="json">JSON</option>
        </select>
        <textarea
          className="input"
          style={{
            flex: 1, resize: "none", minHeight: "36px", maxHeight: "100px",
            fontFamily: messageType === "json" ? "monospace" : "inherit",
            fontSize: "0.85rem"
          }}
          placeholder={messageType === "json" ? '{"type": "ping"}' : "Type a message..."}
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={status !== "connected"}
          rows={1}
        />
        <button
          className="primary"
          onClick={handleSend}
          disabled={status !== "connected" || !messageInput.trim()}
          style={{ flexShrink: 0, padding: "8px 16px" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default WebSocketPane;
