/**
 * WebSocket Connection Manager (renderer glue)
 *
 * This talks to the Electron main process via `window.api.ws*` to manage a
 * persistent WebSocket connection's lifecycle, message history, and
 * reconnection. It was extracted out of `@portiq/core`'s WebSocketProtocol
 * because it depends on `window.api` and `window.setTimeout`, which are not
 * allowed in the headless core package.
 */
import { WebSocketProtocol } from "@portiq/core";

export function createConnectionManager(connectionId: string) {
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

export default createConnectionManager;
