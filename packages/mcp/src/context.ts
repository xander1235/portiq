import { openAppStateStore, HttpTransport, type AppStateStore } from "@portiq/core";
import type { ServerConfig } from "./config";
import { compileHostPolicy, type HostPolicy } from "./hostPolicy";

export interface ServerContext {
  config: ServerConfig;
  store: AppStateStore;
  transport: HttpTransport;
  hostPolicy: HostPolicy;
  close(): void;
}

export function buildContext(config: ServerConfig): ServerContext {
  const store = openAppStateStore({ dataDir: config.dataDir });
  const transport = new HttpTransport({ appVersion: config.appVersion });
  const hostPolicy = compileHostPolicy(config.execAllow ?? [], config.execDeny ?? []);
  return {
    config,
    store,
    transport,
    hostPolicy,
    close() {
      store.close();
    },
  };
}
