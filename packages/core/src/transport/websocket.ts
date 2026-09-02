import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface WsConnectPayload {
  id: string;
  url: string;
  headers?: Record<string, string>;
  protocols?: string[];
  timeoutMs?: number;
}

export interface WsSendPayload {
  id: string;
  data: string;
  encoding?: "text" | "base64";
}

export interface WsRecord {
  timestamp: number;
  direction: "incoming" | "outgoing";
  data: string;
  size: number;
  encoding: string;
}

type ConnectResult =
  | { status: "connected"; connectedAt: number }
  | { error: string }
  | { cancelled: true; error: string };

interface ConnectionData {
  ws: WebSocket;
  messages: WsRecord[];
  status: string;
  connectedAt: number | null;
  cancelled: boolean;
}

/**
 * Manages WebSocket connections, mirroring the Electron `ws:*` IPC handlers
 * but emitting events instead of pushing to a `BrowserWindow`.
 */
export class WsManager extends EventEmitter {
  private connections = new Map<string, ConnectionData>();

  async connect(payload: WsConnectPayload): Promise<ConnectResult> {
    const { id, url, headers, protocols, timeoutMs } = payload || ({} as WsConnectPayload);
    if (!url || typeof url !== "string") return { error: "Missing or invalid URL" };
    if (!id) return { error: "Missing connection ID" };

    // Close existing connection with same ID
    if (this.connections.has(id)) {
      try { this.connections.get(id)!.ws.close(); } catch { /* ignore */ }
      this.connections.delete(id);
    }

    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url, protocols || [], {
          headers: headers || {}
        });

        const connectionData: ConnectionData = { ws, messages: [], status: "connecting", connectedAt: null, cancelled: false };
        this.connections.set(id, connectionData);
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const finish = (result: ConnectResult) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          resolve(result);
        };

        ws.on("open", () => {
          connectionData.status = "connected";
          connectionData.connectedAt = Date.now();
          finish({ status: "connected", connectedAt: connectionData.connectedAt });
        });

        ws.on("message", (data: any, isBinary: boolean) => {
          const normalized = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const msg: WsRecord = {
            timestamp: Date.now(),
            direction: "incoming",
            data: isBinary ? normalized.toString("base64") : normalized.toString(),
            size: normalized.length,
            encoding: isBinary ? "base64" : "text"
          };
          connectionData.messages.push(msg);
          // Keep last 1000 messages only
          if (connectionData.messages.length > 1000) {
            connectionData.messages = connectionData.messages.slice(-1000);
          }
          // Notify listeners
          this.emit("message", { id, message: msg });
        });

        ws.on("close", (code: number, reason: Buffer) => {
          connectionData.status = "disconnected";
          connectionData.connectedAt = null;
          this.emit("closed", { id, code, reason: reason?.toString() });
          this.connections.delete(id);
          if (!settled) {
            finish(connectionData.cancelled
              ? { cancelled: true, error: "Connection cancelled" }
              : { error: "Connection closed" });
          }
        });

        ws.on("error", (err: Error) => {
          connectionData.status = "error";
          this.emit("error", { id, error: err.message });
          finish({ error: err.message });
        });

        // Timeout for connection
        timeoutHandle = setTimeout(() => {
          if (connectionData.status === "connecting") {
            connectionData.cancelled = false;
            ws.close();
            finish({ error: "Connection timeout" });
          }
        }, Number(timeoutMs) > 0 ? Number(timeoutMs) : 10000);
      } catch (err: any) {
        resolve({ error: err.message || String(err) });
      }
    });
  }

  sendMessage(payload: WsSendPayload): { ok: true; message: WsRecord } | { error: string } {
    const { id, data, encoding } = payload || ({} as WsSendPayload);
    const conn = this.connections.get(id);
    if (!conn || !conn.ws) return { error: "No active WebSocket connection" };
    if (conn.ws.readyState !== 1) return { error: "WebSocket is not open" };

    try {
      const payloadData = encoding === "base64" ? Buffer.from(data || "", "base64") : data;
      conn.ws.send(payloadData);
      const normalized = Buffer.isBuffer(payloadData) ? payloadData : Buffer.from(String(payloadData ?? ""));
      const msg: WsRecord = {
        timestamp: Date.now(),
        direction: "outgoing",
        data: encoding === "base64" ? normalized.toString("base64") : normalized.toString(),
        size: normalized.length,
        encoding: encoding === "base64" ? "base64" : "text"
      };
      conn.messages.push(msg);
      return { ok: true, message: msg };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  disconnect(payload: { id: string }): { ok: true } | { error: string } {
    const { id } = payload || ({} as { id: string });
    const conn = this.connections.get(id);
    if (!conn || !conn.ws) return { ok: true };

    try {
      conn.cancelled = conn.status === "connecting";
      conn.ws.close();
      this.connections.delete(id);
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  getMessages(payload: { id: string }): { messages: WsRecord[]; status: string; connectedAt: number | null } {
    const { id } = payload || ({} as { id: string });
    const conn = this.connections.get(id);
    if (!conn) return { messages: [], status: "disconnected", connectedAt: null };
    return { messages: conn.messages, status: conn.status, connectedAt: conn.connectedAt || null };
  }
}
