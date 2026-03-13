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
    connectTimeout: 10000,
    messageType: "text" // "text" | "json" | "binary"
  },

  getDefaultUrl() {
    return "ws://localhost:8080";
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
    let parsedHeaders = {};
    if (Array.isArray(config.headersRows) && config.headersRows.length > 0) {
      parsedHeaders = config.headersRows
        .filter((row) => row.key && row.enabled !== false)
        .reduce((acc, row) => ({ ...acc, [row.key]: row.value || "" }), {});
    } else if (typeof config.headersText === "string" && config.headersText.trim()) {
      try {
        parsedHeaders = JSON.parse(config.headersText);
      } catch {
        parsedHeaders = {};
      }
    } else if (config.headers && typeof config.headers === "object") {
      parsedHeaders = config.headers;
    }

    const parsedProtocols = Array.isArray(config.protocolRows) && config.protocolRows.length > 0
      ? config.protocolRows
          .filter((row) => row.key && row.enabled !== false)
          .map((row) => String(row.key).trim())
          .filter(Boolean)
      : Array.isArray(config.protocols)
      ? config.protocols
      : String(config.protocolsText || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    return {
      url: config.url,
      headers: parsedHeaders,
      protocols: parsedProtocols,
      autoReconnect: Boolean(config.autoReconnect),
      reconnectInterval: Number(config.reconnectInterval) > 0 ? Number(config.reconnectInterval) : 3000,
      connectTimeout: Number(config.connectTimeout) > 0 ? Number(config.connectTimeout) : 10000
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
  parseMessage(data, encoding = "text") {
    if (encoding === "base64") {
      return { type: "binary", data, raw: data, encoding };
    }
    try {
      const json = JSON.parse(data);
      return { type: "json", data: json, raw: data, encoding };
    } catch {
      return { type: "text", data: data, raw: data, encoding };
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
    if (msg.type === "binary") {
      return msg.raw || "";
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
    let reconnectTimer = null;
    let connectionArgs = null;
    let manuallyClosed = false;

    async function syncStatusFromBackend() {
      const existing = await window.api.wsGetMessages({ id: connectionId });
      status = existing.status || "disconnected";
      notify("statusChange", status);
      return existing;
    }

    const manager = {
      get status() { return status; },
      get messages() { return messageHistory; },

      async attachExisting(options = {}) {
        connectionArgs = options.url ? {
          url: options.url,
          headers: options.headers || {},
          protocols: options.protocols || [],
          options: options.options || {}
        } : connectionArgs;

        bindListeners();

        const existing = await syncStatusFromBackend();
        messageHistory = Array.isArray(existing.messages)
          ? existing.messages.map((msg) => ({
              ...msg,
              parsed: WebSocketProtocol.parseMessage(msg.data, msg.encoding)
            }))
          : [];
        return {
          ...existing,
          messages: messageHistory
        };
      },

      async connect(url, headers = {}, protocols = [], options = {}) {
        manuallyClosed = false;
        connectionArgs = { url, headers, protocols, options };
        status = "connecting";
        notify("statusChange", status);

        bindListeners();

        const result = await window.api.wsConnect({
          id: connectionId,
          url,
          headers,
          protocols,
          timeoutMs: options.connectTimeout
        });

        if (result.error) {
          status = result.cancelled ? "disconnected" : "error";
          notify("statusChange", status);
          return result;
        }

        status = "connected";
        notify("statusChange", status);
        return result;
      },

      async send(data) {
        if (status !== "connected") {
          await syncStatusFromBackend();
          if (status !== "connected") {
            return { error: "Not connected" };
          }
        }
        const payload = data && typeof data === "object" && data.encoding === "base64"
          ? { id: connectionId, data: data.data, encoding: "base64" }
          : { id: connectionId, data: typeof data === "string" ? data : JSON.stringify(data), encoding: "text" };

        const result = await window.api.wsSend(payload);
        if (result.error) {
          await syncStatusFromBackend();
          if (status !== "connected") {
            return { error: "Not connected" };
          }
          return result;
        }
        if (result.ok && result.message) {
          const parsed = WebSocketProtocol.parseMessage(result.message.data, result.message.encoding);
          const enriched = { ...result.message, parsed };
          messageHistory.push(enriched);
          notify("message", enriched);
        }
        return result;
      },

      async disconnect() {
        manuallyClosed = true;
        const result = await window.api.wsDisconnect({ id: connectionId });
        status = "disconnected";
        notify("statusChange", status);
        cleanup();
        return result;
      },

      async reconnectNow() {
        if (!connectionArgs) {
          return { error: "No previous connection to reconnect" };
        }
        manuallyClosed = false;
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        return manager.connect(
          connectionArgs.url,
          connectionArgs.headers,
          connectionArgs.protocols,
          connectionArgs.options
        );
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

    function bindListeners() {
      cleanup();

      if (window.api?.onWsMessage) {
        const unsub = window.api.onWsMessage((data) => {
          if (data.id === connectionId) {
            const parsed = WebSocketProtocol.parseMessage(data.message.data, data.message.encoding);
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
            if (!manuallyClosed && connectionArgs?.options?.autoReconnect) {
              status = "reconnecting";
              notify("statusChange", status);
              reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                manager.connect(
                  connectionArgs.url,
                  connectionArgs.headers,
                  connectionArgs.protocols,
                  connectionArgs.options
                );
              }, connectionArgs.options.reconnectInterval || 3000);
            }
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
    }

    function cleanup() {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanups.forEach(fn => fn());
      cleanups = [];
    }

    return manager;
  }
};

export default WebSocketProtocol;
