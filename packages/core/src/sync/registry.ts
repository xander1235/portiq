import type { SyncRemoteFactory } from "./types";

const factories = new Map<string, SyncRemoteFactory>();

/** Additive self-registration — mirrors ProtocolRegistry. Call at module load. */
export function registerSyncRemote(kind: string, factory: SyncRemoteFactory): void {
  if (!kind) throw new Error("Sync remote must have a non-empty kind");
  if (factories.has(kind)) {
    console.warn(`Sync remote "${kind}" is already registered. Overwriting.`);
  }
  factories.set(kind, factory);
}

export function getSyncRemoteFactory(kind: string): SyncRemoteFactory | null {
  return factories.get(kind) || null;
}

export function listSyncRemoteKinds(): string[] {
  return Array.from(factories.keys());
}
