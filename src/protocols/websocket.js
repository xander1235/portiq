/**
 * WebSocket Protocol Handler
 *
 * Manages persistent WebSocket connections with bidirectional
 * message streaming, connection lifecycle, and message history.
 */

export const WebSocketProtocol = {
  id: "websocket",
  name: "WebSocket",
  description: "Real-time bidirectional messaging",
  color: "#10b981",
  icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>`,

  methods: ["CONNECT", "SEND", "CLOSE"],

  defaultConfig: {
    url: "",
    protocols: [],
    headers: {},
    messages: [],
    autoReconnect: false,
    reconnectInterval: 3000,
    messageType: "text" // "text" | "json" | "binary"
  },

  getDefaultUrl() {
    return "wss://echo.websocket.org";
  },

  detectProtocol(url) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith("ws://") || lower.startsWith("wss://");
  },

  validateRequest(config) {
    const errors = [];
    if (!config.url || !config.url.trim()) {
      errors.push("WebSocket URL is required");
    } else {
      const lower = config.url.toLowerCase().trim();
      if (!lower.startsWith("ws://") && !lower.startsWith("wss://")) {
        errors.push("URL must start with ws:// or wss://");
      }
    }
    return { valid: errors.length === 0, errors };
  },

  buildRequest(config) {
    return {
      url: config.url,
      headers: config.headers || {},
      protocols: config.protocols || []
    };
  },

  parseResponse(raw) {
    // WebSocket doesn't have traditional responses;
    // this parses individual messages
    return {
      messages: raw.messages || [],
      status: raw.status || "disconnected",
      connectedAt: raw.connectedAt || null,
      error: raw.error || null
    };
  },

  /**
   * Parse a message trying JSON first.
   */
  parseMessage(data) {
    try {
      const json = JSON.parse(data);
      return { type: "json", data: json, raw: data };
    } catch {
      return { type: "text", data: data, raw: data };
    }
  },

  /**
   * Format a message for display.
   */
  formatMessage(msg) {
    if (msg.type === "json") {
      try {
        return JSON.stringify(msg.data, null, 2);
      } catch {
        return msg.raw;
      }
    }
    return msg.raw || String(msg.data);
  },

  /**
   * Create a connection manager for a specific WebSocket session.
   * This provides a higher-level API over the raw IPC calls.
   */
  createConnectionManager(connectionId) {
    let listeners = {
      message: [],
      close: [],
      error: [],
      statusChange: []
    };
    let status = "disconnected";
    let messageHistory = [];
    let cleanups = [];

    const manager = {
      get status() { return status; },
      get messages() { return messageHistory; },

      async connect(url, headers = {}, protocols = []) {
        status = "connecting";
        notify("statusChange", status);

        // Set up event listeners via preload
        if (window.api?.onWsMessage) {
          const unsub = window.api.onWsMessage((data) => {
            if (data.id === connectionId) {
              const parsed = WebSocketProtocol.parseMessage(data.message.data);
              const enriched = { ...data.message, parsed };
              messageHistory.push(enriched);
              notify("message", enriched);
            }
          });
          cleanups.push(unsub);
        }

        if (window.api?.onWsClosed) {
          const unsub = window.api.onWsClosed((data) => {
            if (data.id === connectionId) {
              status = "disconnected";
              notify("statusChange", status);
              notify("close", data);
            }
          });
          cleanups.push(unsub);
        }

        if (window.api?.onWsError) {
          const unsub = window.api.onWsError((data) => {
            if (data.id === connectionId) {
              status = "error";
              notify("statusChange", status);
              notify("error", data);
            }
          });
          cleanups.push(unsub);
        }

        const result = await window.api.wsConnect({
          id: connectionId,
          url,
          headers,
          protocols
        });

        if (result.error) {
          status = "error";
          notify("statusChange", status);
          return result;
        }

        status = "connected";
        notify("statusChange", status);
        return result;
      },

      async send(data) {
        if (status !== "connected") {
          return { error: "Not connected" };
        }
        const result = await window.api.wsSend({
          id: connectionId,
          data: typeof data === "string" ? data : JSON.stringify(data)
        });
        if (result.ok && result.message) {
          const parsed = WebSocketProtocol.parseMessage(result.message.data);
          const enriched = { ...result.message, parsed };
          messageHistory.push(enriched);
          notify("message", enriched);
        }
        return result;
      },

      async disconnect() {
        const result = await window.api.wsDisconnect({ id: connectionId });
        status = "disconnected";
        notify("statusChange", status);
        cleanup();
        return result;
      },

      on(event, callback) {
        if (listeners[event]) {
          listeners[event].push(callback);
        }
        return () => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(fn => fn !== callback);
          }
        };
      },

      clearHistory() {
        messageHistory = [];
      },

      cleanup() {
        cleanup();
      }
    };

    function notify(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    }

    function cleanup() {
      cleanups.forEach(fn => fn());
      cleanups = [];
    }

    return manager;
  }
};

export default WebSocketProtocol;
