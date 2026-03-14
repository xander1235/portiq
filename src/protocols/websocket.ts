/**
 * WebSocket Protocol Handler
 *
 * Manages persistent WebSocket connections with bidirectional
 * message streaming, connection lifecycle, and message history.
 */

import { ProtocolHandler } from "./registry";

export interface WsMessage {
  id: string;
  type: "sent" | "received";
  data: any;
  raw: string;
  encoding: string;
  timestamp: number;
  parsed?: {
    type: "text" | "json" | "binary";
    data: any;
    raw: string;
    encoding: string;
  };
}

export const WebSocketProtocol: ProtocolHandler & {
  parseMessage: (data: any, encoding?: string) => any;
  formatMessage: (msg: any) => string;
  createConnectionManager: (connectionId: string) => any;
} = {
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

  detectProtocol(url: string) {
    if (!url) return false;
    const lower = url.toLowerCase().trim();
    return lower.startsWith("ws://") || lower.startsWith("wss://");
  },

  validateRequest(config: any) {
    const errors: string[] = [];
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

  buildRequest(config: any) {
    let parsedHeaders: any = {};
    if (Array.isArray(config.headersRows) && config.headersRows.length > 0) {
      parsedHeaders = config.headersRows
        .filter((row: any) => row.key && row.enabled !== false)
        .reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value || "" }), {});
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
          .filter((row: any) => row.key && row.enabled !== false)
          .map((row: any) => String(row.key).trim())
          .filter(Boolean)
      : Array.isArray(config.protocols)
      ? config.protocols
      : String(config.protocolsText || "")
        .split(",")
        .map((item: string) => item.trim())
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

  parseResponse(raw: any) {
    return {
      messages: raw.messages || [],
      status: raw.status || "disconnected",
      connectedAt: raw.connectedAt || null,
      error: raw.error || null
    };
  },

  parseMessage(data: any, encoding: string = "text") {
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

  formatMessage(msg: any) {
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

  createConnectionManager(connectionId: string) {
    const listeners: Record<string, any[]> = {
      message: [],
      close: [],
      error: [],
      statusChange: []
    };
    let status = "disconnected";
    let messageHistory: any[] = [];
    let cleanups: (() => void)[] = [];
    let reconnectTimer: any = null;
    let connectionArgs: any = null;
    let manuallyClosed = false;

    async function syncStatusFromBackend() {
      const existing = await (window as any).api.wsGetMessages({ id: connectionId });
      status = existing.status || "disconnected";
      notify("statusChange", status);
      return existing;
    }

    const manager = {
      get status() { return status; },
      get messages() { return messageHistory; },

      async attachExisting(options: any = {}) {
        connectionArgs = options.url ? {
          url: options.url,
          headers: options.headers || {},
          protocols: options.protocols || [],
          options: options.options || {}
        } : connectionArgs;

        bindListeners();

        const existing = await syncStatusFromBackend();
        messageHistory = Array.isArray(existing.messages)
          ? existing.messages.map((msg: any) => ({
              ...msg,
              parsed: WebSocketProtocol.parseMessage(msg.data, msg.encoding)
            }))
          : [];
        return {
          ...existing,
          messages: messageHistory
        };
      },

      async connect(url: string, headers: any = {}, protocols: any[] = [], options: any = {}) {
        manuallyClosed = false;
        connectionArgs = { url, headers, protocols, options };
        status = "connecting";
        notify("statusChange", status);

        bindListeners();

        const result = await (window as any).api.wsConnect({
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

      async send(data: any) {
        if (status !== "connected") {
          await syncStatusFromBackend();
          if (status !== "connected") {
            return { error: "Not connected" };
          }
        }
        const payload = data && typeof data === "object" && data.encoding === "base64"
          ? { id: connectionId, data: data.data, encoding: "base64" }
          : { id: connectionId, data: typeof data === "string" ? data : JSON.stringify(data), encoding: "text" };

        const result = await (window as any).api.wsSend(payload);
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
        const result = await (window as any).api.wsDisconnect({ id: connectionId });
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

      on(event: string, callback: any) {
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

    function notify(event: string, data: any) {
      (listeners[event] || []).forEach((fn: any) => fn(data));
    }

    function bindListeners() {
      cleanup();

      if ((window as any).api?.onWsMessage) {
        const unsub = (window as any).api.onWsMessage((data: any) => {
          if (data.id === connectionId) {
            const parsed = WebSocketProtocol.parseMessage(data.message.data, data.message.encoding);
            const enriched = { ...data.message, parsed };
            messageHistory.push(enriched);
            notify("message", enriched);
          }
        });
        cleanups.push(unsub);
      }

      if ((window as any).api?.onWsClosed) {
        const unsub = (window as any).api.onWsClosed((data: any) => {
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

      if ((window as any).api?.onWsError) {
        const unsub = (window as any).api.onWsError((data: any) => {
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
