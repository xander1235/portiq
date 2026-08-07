import {
  openAppStateStore,
  HttpTransport,
  compileHostPolicy,
  makeHostGuard,
  type AppStateStore,
  type HostPolicy,
} from "@portiq/core";
import type { ServerConfig } from "./config";

export interface ServerContext {
  config: ServerConfig;
  store: AppStateStore;
  transport: HttpTransport;
  hostPolicy: HostPolicy;
  close(): void;
}

export function buildContext(config: ServerConfig): ServerContext {
  const store = openAppStateStore({ dataDir: config.dataDir });
  const hostPolicy = compileHostPolicy(config.execAllow ?? [], config.execDeny ?? []);
  const transport = new HttpTransport({ appVersion: config.appVersion, hostGuard: makeHostGuard(hostPolicy) });
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
