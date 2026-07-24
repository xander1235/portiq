import { openAppStateStore, HttpTransport, type AppStateStore } from "@portiq/core";
import type { ServerConfig } from "./config";

export interface ServerContext {
  config: ServerConfig;
  store: AppStateStore;
  transport: HttpTransport;
  close(): void;
}

export function buildContext(config: ServerConfig): ServerContext {
  const store = openAppStateStore({ dataDir: config.dataDir });
  const transport = new HttpTransport({ appVersion: config.appVersion });
  return {
    config,
    store,
    transport,
    close() {
      store.close();
    },
  };
}
