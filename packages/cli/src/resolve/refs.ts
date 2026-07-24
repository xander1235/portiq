import { getEnvVars, type AppState, type Collection, type Environment, type FolderItem, type RequestItem } from "@portiq/core";
import { UsageError } from "../errors";

export interface RequestWithPath {
  path: string;
  item: RequestItem;
}

export function isFlow(item: RequestItem): boolean {
  return item.protocol === "dag";
}

function walk(items: (FolderItem | RequestItem)[], prefix: string, out: RequestWithPath[]): void {
  for (const item of items) {
    if (item.type === "request") out.push({ path: `${prefix}/${item.name}`, item });
    else if (item.type === "folder") walk(item.items, `${prefix}/${item.name}`, out);
  }
}

export function listRequestsWithPaths(state: AppState): RequestWithPath[] {
  const out: RequestWithPath[] = [];
  for (const c of state.collections ?? []) walk(c.items ?? [], c.name, out);
  return out;
}

export interface ResolvedRef {
  kind: "request" | "collection" | "environment" | "flow";
  path: string;
  request?: RequestItem;
  collection?: Collection;
  environment?: Environment;
}

function findRequestById(state: AppState, id: string): RequestWithPath | undefined {
  return listRequestsWithPaths(state).find((r) => r.item.id === id);
}

export function resolveRef(state: AppState, opts: { ref?: string; id?: string }): ResolvedRef {
  if (opts.id) {
    const req = findRequestById(state, opts.id);
    if (req) return { kind: isFlow(req.item) ? "flow" : "request", path: req.path, request: req.item };
    const col = (state.collections ?? []).find((c) => c.id === opts.id);
    if (col) return { kind: "collection", path: col.name, collection: col };
    const env = (state.environments ?? []).find((e) => e.id === opts.id);
    if (env) return { kind: "environment", path: env.name, environment: env };
    throw new UsageError(`No collection, request, or environment with id "${opts.id}"`);
  }
  if (!opts.ref) throw new UsageError("A reference (Collection/Folder/Request) or --id is required");

  const segments = opts.ref.split("/").filter(Boolean);
  const col = (state.collections ?? []).find((c) => c.name === segments[0]);
  if (col) {
    if (segments.length === 1) return { kind: "collection", path: col.name, collection: col };
    let items: (FolderItem | RequestItem)[] = col.items ?? [];
    for (let i = 1; i < segments.length; i++) {
      const match = items.find((it) => it.name === segments[i]);
      if (!match) throw new UsageError(`Could not resolve "${opts.ref}" (no "${segments[i]}")`);
      if (i === segments.length - 1) {
        if (match.type !== "request") throw new UsageError(`"${opts.ref}" is a folder, not a request`);
        return { kind: isFlow(match) ? "flow" : "request", path: opts.ref, request: match };
      }
      if (match.type !== "folder") throw new UsageError(`"${segments[i]}" is not a folder`);
      items = match.items;
    }
  }
  if (segments.length === 1) {
    const env = (state.environments ?? []).find((e) => e.name === segments[0]);
    if (env) return { kind: "environment", path: env.name, environment: env };
  }
  throw new UsageError(`Could not resolve reference "${opts.ref}"`);
}

export function resolveVars(state: AppState, flags: { env?: string; var?: string[] }): Record<string, string> {
  let env: Environment | undefined;
  if (flags.env) {
    env = (state.environments ?? []).find((e) => e.name === flags.env);
    if (!env) throw new UsageError(`Unknown environment "${flags.env}"`);
  } else if (state.activeEnvId) {
    env = (state.environments ?? []).find((e) => e.id === state.activeEnvId);
  }
  const vars = getEnvVars(env ?? null);
  for (const pair of flags.var ?? []) {
    const idx = pair.indexOf("=");
    if (idx === -1) throw new UsageError(`Invalid --var "${pair}", expected key=value`);
    vars[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return vars;
}
