import type { Environment } from "@portiq/core";
import type { ServerContext } from "../context";

export function resolveEnvironment(ctx: ServerContext, ref?: string): Environment | null {
  const envs = ctx.store.environments();
  if (ref) {
    return envs.find((e) => e.id === ref) ?? envs.find((e) => e.name === ref) ?? null;
  }
  const activeId = ctx.store.load().state?.activeEnvId;
  return activeId ? envs.find((e) => e.id === activeId) ?? null : null;
}
