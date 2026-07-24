import type { AppState, Collection, Environment } from "../model";

export interface PortableFile {
  portiq: 1;
  exportedAt?: string;
  collections: Collection[];
  environments: Environment[];
}

export function exportPortable(state: AppState, opts: { exportedAt?: string } = {}): PortableFile {
  return {
    portiq: 1,
    exportedAt: opts.exportedAt,
    collections: state.collections ?? [],
    environments: state.environments ?? [],
  };
}

export function importPortable(file: unknown): { collections: Collection[]; environments: Environment[] } {
  if (!file || typeof file !== "object" || (file as any).portiq !== 1) {
    throw new Error("Not a valid Portiq portable file (missing \"portiq\": 1 marker)");
  }
  const f = file as PortableFile;
  return {
    collections: Array.isArray(f.collections) ? f.collections : [],
    environments: Array.isArray(f.environments) ? f.environments : [],
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((x) => [x.id, x]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function mergeIntoAppState(
  state: AppState,
  incoming: { collections: Collection[]; environments: Environment[] }
): AppState {
  return {
    ...state,
    collections: mergeById(state.collections ?? [], incoming.collections),
    environments: mergeById(state.environments ?? [], incoming.environments),
  };
}
