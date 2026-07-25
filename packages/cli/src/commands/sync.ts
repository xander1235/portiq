import type { Command } from "commander";
import type { SyncRemote, DeviceCodeResult } from "@portiq/core/sync";
import type { CliContext } from "../context";
import { parseGlobalFlags, type CommandModule, type GlobalFlags } from "../registry";
import { withState } from "./store";
import { emit } from "./emit";
import { UsageError, RuntimeError } from "../errors";
import type { CommandOutput } from "../reporters";

// Type-only import — erased at compile time, so it never forces the octokit-laden
// bundle into commands that don't touch sync (e.g. `portiq ls`).
type SyncModule = typeof import("@portiq/core/sync");

/**
 * Loaded LAZILY inside each action below, never at module top-level. The CLI
 * compiles to CommonJS, so `import("@portiq/core/sync")` downlevels to a
 * `require` of `@portiq/core`'s `require`-condition dist (dist/sync/index.cjs)
 * at runtime — no ESM boundary, and a sync-bundle problem can't break unrelated
 * commands that never import this module's actions.
 */
async function loadSync(): Promise<SyncModule> {
  return import("@portiq/core/sync");
}

export interface SyncDeps {
  /** Default builds a github/local remote from flags; tests inject a fake. */
  remoteFactory?: (args: {
    sync: SyncModule;
    token?: string;
    local?: string;
    dataDir?: string;
    env: NodeJS.ProcessEnv;
  }) => SyncRemote;
  /** Default calls sync.requestDeviceCode(...); tests inject a fake to avoid github.com. */
  requestDeviceCode?: (args: { sync: SyncModule; clientId: string; scope: string }) => Promise<DeviceCodeResult>;
  /** Default calls sync.pollDeviceToken(...); tests inject a fake to avoid real polling. */
  pollDeviceToken?: (args: { sync: SyncModule; device: DeviceCodeResult; clientId: string }) => Promise<string>;
}

interface SyncFlags extends GlobalFlags {
  token?: string;
  local?: string;
  clientId?: string;
}

function parseSyncFlags(cmd: Command): SyncFlags {
  const flags = parseGlobalFlags(cmd);
  const o = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    ...flags,
    token: o.token as string | undefined,
    local: o.local as string | undefined,
    clientId: o.clientId as string | undefined,
  };
}

function buildRemote(sync: SyncModule, ctx: CliContext, flags: SyncFlags): SyncRemote {
  if (flags.local) return sync.createLocalGitRemote({ dir: flags.local });
  const token = sync.resolveGitHubToken({ token: flags.token, dataDir: flags.dataDir, env: ctx.env });
  if (!token) {
    throw new UsageError(
      "No GitHub token found. Pass --token, set PORTIQ_GITHUB_TOKEN or GITHUB_TOKEN, or use --local <dir>."
    );
  }
  return sync.createGithubRemote({ token });
}

function resolveRemote(sync: SyncModule, ctx: CliContext, flags: SyncFlags, deps: SyncDeps): SyncRemote {
  if (deps.remoteFactory) {
    return deps.remoteFactory({ sync, token: flags.token, local: flags.local, dataDir: flags.dataDir, env: ctx.env });
  }
  return buildRemote(sync, ctx, flags);
}

export function syncCommand(deps: SyncDeps = {}): CommandModule {
  return {
    register(program: Command, ctx: CliContext) {
      const sync = program
        .command("sync")
        .description("sync your workspace with a git remote")
        .option("--token <token>", "GitHub token (else PORTIQ_GITHUB_TOKEN / GITHUB_TOKEN / config.json — see `sync login`)")
        .option("--local <dir>", "sync to a local git repo directory instead of GitHub");

      sync
        .command("login")
        .description("authenticate with GitHub via the OAuth device flow and save the token for push/pull/status")
        .option("--client-id <id>", "GitHub OAuth App client id (defaults to Portiq's desktop app client id)")
        .action(async (_opts: unknown, cmd: Command) => {
          const flags = parseSyncFlags(cmd);
          const syncMod = await loadSync();
          const clientId = flags.clientId ?? syncMod.GITHUB_CLIENT_ID;
          const scope = "repo";

          const device = deps.requestDeviceCode
            ? await deps.requestDeviceCode({ sync: syncMod, clientId, scope })
            : await syncMod.requestDeviceCode({ clientId, scope });

          ctx.stderr.write(
            `First copy your one-time code: ${device.userCode}\n` +
              `Then open ${device.verificationUri} in your browser and paste it to authorize Portiq.\n` +
              "Waiting for you to authorize...\n"
          );

          const token = deps.pollDeviceToken
            ? await deps.pollDeviceToken({ sync: syncMod, device, clientId })
            : await syncMod.pollDeviceToken(device, { clientId });

          const configPath = syncMod.saveGitHubToken(token, { dataDir: flags.dataDir, env: ctx.env });
          const output: CommandOutput = {
            kind: "message",
            text: `Logged in to GitHub. Token saved to ${configPath}; sync push/pull/status will use it automatically.`,
          };
          emit(ctx, flags, output);
        });

      sync
        .command("push")
        .description(
          "push the local workspace to the remote. LIMITATION: variable values are sent as stored " +
            "(no secret-masking UI like the desktop app) — do not use with untrusted remotes."
        )
        .action(async (_opts: unknown, cmd: Command) => {
          const flags = parseSyncFlags(cmd);
          const syncMod = await loadSync();
          const state = withState(ctx, flags, (s) => s);
          const remote = resolveRemote(syncMod, ctx, flags, deps);
          ctx.stderr.write(
            "warning: variable values are pushed unmasked (no desktop-style secret masking). " +
              "Do not push secrets to shared or untrusted remotes.\n"
          );
          await syncMod.syncPush(remote, state);
          const label = flags.local ?? (await remote.getIdentity()).login;
          const output: CommandOutput = { kind: "message", text: `Pushed local workspace to ${label}.` };
          emit(ctx, flags, output);
        });

      sync
        .command("pull")
        .description("pull the remote workspace into the local store")
        .action(async (_opts: unknown, cmd: Command) => {
          const flags = parseSyncFlags(cmd);
          const syncMod = await loadSync();
          const remote = resolveRemote(syncMod, ctx, flags, deps);

          let res: { appState: { collections?: unknown[]; environments?: unknown[] }; version: number };
          try {
            res = await syncMod.syncPullToStore(remote, { dataDir: flags.dataDir, env: ctx.env });
          } catch (err) {
            if (err instanceof syncMod.SyncConflictError) {
              throw new RuntimeError("Local store changed during pull; reload and retry.");
            }
            throw err;
          }

          const collections = res.appState.collections?.length ?? 0;
          const environments = res.appState.environments?.length ?? 0;
          const output: CommandOutput = {
            kind: "message",
            text: `Pulled remote workspace into local store (version ${res.version}): ${collections} collections, ${environments} environments.`,
          };
          emit(ctx, flags, output);
        });

      sync
        .command("status")
        .description("show the diff between the local workspace and the remote")
        .action(async (_opts: unknown, cmd: Command) => {
          const flags = parseSyncFlags(cmd);
          const syncMod = await loadSync();
          const state = withState(ctx, flags, (s) => s);
          const remote = resolveRemote(syncMod, ctx, flags, deps);
          const st = await syncMod.syncStatus(remote, state);
          const output: CommandOutput = { kind: "entity", entity: { ...st } };
          emit(ctx, flags, output);
        });
    },
  };
}
