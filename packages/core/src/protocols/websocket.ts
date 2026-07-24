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
  }
};

export default WebSocketProtocol;
