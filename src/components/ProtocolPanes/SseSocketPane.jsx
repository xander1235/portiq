import React, { useState, useRef, useEffect } from "react";

/**
 * SSE / Socket Pane — Server-Sent Events and raw socket stream viewer.
 */
export function SseSocketPane({ url, setUrl }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const sourceRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleConnect() {
    if (!url) return;
    setError("");
    setMessages([]);
    try {
      const es = new EventSource(url);
      sourceRef.current = es;
      es.onopen = () => {
        setConnected(true);
        setMessages((prev) => [...prev, { type: "system", text: "Connected", ts: Date.now() }]);
      };
      es.onmessage = (e) => {
        setMessages((prev) => [...prev, { type: "data", text: e.data, ts: Date.now() }]);
      };
      es.onerror = () => {
        setMessages((prev) => [...prev, { type: "error", text: "Connection error / closed", ts: Date.now() }]);
        setConnected(false);
        es.close();
        sourceRef.current = null;
      };
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDisconnect() {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setConnected(false);
    setMessages((prev) => [...prev, { type: "system", text: "Disconnected", ts: Date.now() }]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "12px 16px", gap: "10px" }}>
      {/* URL + connect */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{
          fontSize: "0.72rem", fontWeight: 700, color: "#a78bfa",
          background: "#a78bfa18", padding: "4px 10px", borderRadius: "6px",
          border: "1px solid #a78bfa30", flexShrink: 0,
        }}>SSE</span>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="http://localhost:3000/events"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {!connected ? (
          <button className="btn primary" onClick={handleConnect} style={{ flexShrink: 0 }}>
            Connect
          </button>
        ) : (
          <button className="btn" onClick={handleDisconnect} style={{ flexShrink: 0, background: "#ff555520", color: "#ff5555", border: "1px solid #ff555530" }}>
            Disconnect
          </button>
        )}
      </div>

      {error && <div style={{ color: "#ff5555", fontSize: "0.78rem" }}>{error}</div>}

      {/* Status */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: connected ? "#22c55e" : "var(--text-muted)",
        }} />
        <span style={{ color: "var(--text-muted)" }}>{connected ? "Listening for events…" : "Disconnected"}</span>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{messages.filter(m => m.type === "data").length} events</span>
      </div>

      {/* Event log */}
      <div style={{
        flex: 1, overflow: "auto", borderRadius: "8px",
        border: "1px solid var(--border)", background: "var(--bg)",
        fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem",
        padding: "8px",
      }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>
            Connect to an SSE endpoint to see events stream in real-time
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            padding: "4px 0",
            borderBottom: "1px solid var(--border)",
            color: msg.type === "error" ? "#ff5555" : msg.type === "system" ? "#a78bfa" : "var(--text)",
          }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.68rem", marginRight: "8px" }}>
              {new Date(msg.ts).toLocaleTimeString()}
            </span>
            {msg.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
