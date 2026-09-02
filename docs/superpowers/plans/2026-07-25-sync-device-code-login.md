# `portiq sync login` — GitHub Device-Code Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a headless `portiq sync login` CLI command that runs GitHub's OAuth Device Authorization flow (RFC 8628) end-to-end — request a device+user code, print the verification URL and code, poll the token endpoint honoring `interval`/`slow_down`, handle `expired_token`/`access_denied` — and persist the resulting token into the same `<dataDir>/config.json` that `resolveGitHubToken()` already reads, so `sync push|pull|status` pick it up automatically with no other changes.

**Architecture:** Three new/extended pieces, all in the already-existing `@portiq/core/sync` module and the already-existing `packages/cli/src/commands/sync.ts`. (1) `packages/core/src/sync/deviceLogin.ts` — two pure, injectable functions: `requestDeviceCode()` (one POST to `https://github.com/login/device/code`) and `pollDeviceToken()` (a `sleep`-then-POST loop against `https://github.com/login/oauth/access_token` that continues on `authorization_pending`, grows its interval on `slow_down`, and throws typed errors on `access_denied`/`expired_token`). Both take an injectable `fetch`/`sleep` so tests never touch the network or a real clock. (2) `packages/core/src/sync/auth.ts` gains `saveGitHubToken()`, a read-merge-write helper for `<dataDir>/config.json` that is the write-side counterpart of the existing `resolveGitHubToken()` read-side (same file, same key, same precedence — login only ever populates the *lowest*-precedence slot, so `--token`/env vars still win). (3) `packages/cli/src/commands/sync.ts` gains a `login` subcommand (with a `--client-id` flag) that wires the two core functions together, prints the human-facing instructions to `ctx.stderr`, and calls `saveGitHubToken()` on success — following the exact `SyncDeps`-injection pattern `push`/`pull`/`status` already use for `remoteFactory`, so CLI-level tests inject fake `requestDeviceCode`/`pollDeviceToken` and never hit `github.com`.

**Tech Stack:** TypeScript (ESNext, `moduleResolution: Bundler` for core / classic `Node` for CLI — both already wired for the `@portiq/core/sync` subpath), Vitest 4 (`node` env), Node 20 global `fetch` (no new dependency), Commander@12. No new npm packages, no new `exports` subpath, no new `tsconfig` path mapping — everything rides the `./sync` subpath and CJS bundle the git-sync track already built.

## Global Constraints

- **Framework-free core.** `@portiq/core` must never import Electron/DOM/React. Node-only modules (better-sqlite3, node:os/http/child_process, @grpc/*, @octokit/rest) must stay OFF the browser barrels (`src/index.browser.ts`, `src/ai/index.browser.ts`) and behind Node-only subpath exports (`./flows`, `./grpc`, `./sync`). The Vite renderer resolves core via `vite.config.js` array/RegExp `resolve.alias` → browser barrels (rolldown-vite ignores the `browser` export condition; the alias is the working mechanism). Any new Node-only capability follows this same pattern or the renderer white-screens.
- **better-sqlite3 native ABI toggle.** One hoisted binary serves EITHER Node (vitest/CLI/MCP) OR Electron (`npm run rebuild`), not both. Tests run on the Node ABI; the GUI smoke needs `npm run rebuild` first.
- **ESM-octokit / CJS-sync boundary.** `@octokit/rest` is ESM-only; the CLI is CommonJS. `./sync` is esbuild-bundled to `dist/sync/index.cjs` (octokit inlined, native/runtime deps `--external`), exposed behind the `require` export condition. octokit must stay OUT of the Electron `.` dist. Any new sync/ESM dep follows this bundling approach.
- **Classic-resolution type wiring.** CLI/MCP builds use classic `moduleResolution:"Node"`, which IGNORES core's `exports` map. Subpath TYPES are supplied via `baseUrl`+`paths`→`../../node_modules/@portiq/core/src/...` in each package's `tsconfig.build.json` (NOT via `types` conditions in core's exports map — that would redirect vitest/renderer to stale dist). Follow this if a task adds a new core subpath the CLI/MCP consume.
- **Shared storage + concurrency.** All surfaces share one `<userData>/appdata.sqlite`; core's `resolveDataDir()` reproduces Electron's userData path (app name pinned to `"Portiq"`). Writes go through core's optimistic-concurrency path (`openKvStore().setIfVersion(key, value, expectedVersion)` → throws `ConflictError`). `assembleRequest()` on the top `@portiq/core` barrel is the CANONICAL rows→payload builder — never reintroduce a parallel copy.
- **Testing.** vitest (Node env for core/cli/mcp; jsdom where a renderer unit exists). TDD: write the failing test first, run it red, implement minimally, run it green, commit. The root `pretest` hook builds core/cli/mcp dists before the suite; CLI integration tests spawn the built binary. Keep the full suite green.
- **Commits.** Conventional Commits, appropriate scope, each ending with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Frequent, one deliverable each. NEVER stage the untracked junk dirs (`.claude/skills/ui-ux-pro-max/scripts/__pycache__/`, `ux-review-visuals/`). Stage only files your task changed.
- DRY, YAGNI, TDD, frequent commits. No placeholders in the plan (see format rules).

**Subsystem-specific constraints for this track:**

- **No new subpath, no new dependency.** `./sync` (`packages/core/package.json`) and its `dist/sync/index.cjs` CJS bundle already exist (built by the git-sync track). This track adds files *inside* `packages/core/src/sync/**` and re-exports them from the existing barrel (`packages/core/src/sync/index.ts`); it must NOT touch `packages/core/package.json`'s `exports`/`dependencies`, `packages/core/tsconfig.build.json`, or `packages/cli/tsconfig.build.json` — all already correctly wired for `@portiq/core/sync`. Device-code HTTP calls use the Node 20 global `fetch`, not `@octokit/rest` (GitHub's OAuth device endpoints are unauthenticated form/JSON POSTs, not REST-API calls, so Octokit is not the right tool here).
- **`config.json` is the single write target, and `saveGitHubToken()` must not clobber it.** `resolveGitHubToken()` (`packages/core/src/sync/auth.ts:19-35`) already reads `<dataDir>/config.json`'s `.githubToken` as the *last* step of its precedence (`--token` → `PORTIQ_GITHUB_TOKEN` → `GITHUB_TOKEN` → `config.json`). No writer for this file exists anywhere in the repo today (confirmed by search) — `packages/cli/src/config.ts`'s `saveConfig()` writes a *different* file (`cli-config.json`, for `dataDir`/`reporter`/`env` CLI settings) and is unrelated. `saveGitHubToken()` must read-merge-write `config.json` (preserve any other keys already in the file, mirroring the merge pattern in `packages/core/src/ai/configStore.ts:100-109`'s `saveAiConfig()`), not overwrite it wholesale.
- **Token stays plaintext; this is a known, already-accepted tradeoff.** `config.json`'s `githubToken` is stored unencrypted, exactly like `ai.json`'s provider API keys (`packages/core/src/ai/configStore.ts`). `docs/superpowers/plans/2026-07-24-phase3-parity-ai-assist.md`'s "Plaintext keys" open question already flags this for `ai.json`; this track's Self-Review carries the identical caveat forward for `config.json` rather than re-solving it — an encrypted-at-rest keystore for both files is out-of-scope future work.
- **Preserve the desktop OAuth app identity.** `GITHUB_CLIENT_ID = "Ov23liWUpjkSkyaC3sBq"` and scope `"repo"` (`packages/core/src/sync/auth.ts:6-7`) are the existing desktop app's registered device-flow client id/scope; `requestDeviceCode()` defaults to them so `sync login` authorizes the same GitHub OAuth App the desktop UI does. `--client-id` lets a user substitute their own registered OAuth App (e.g., for org policies that forbid a shared client id) without a code change.
- **This is genuinely new capability, not a resurrection of scope.** `docs/superpowers/plans/2026-07-24-phase3-parity-git-sync.md:28` explicitly deferred a headless device-code login as YAGNI at the time ("out of scope for this track... can be added later without changing this module") — this plan is that later addition. It changes nothing about the already-shipped `push`/`pull`/`status` engine, remotes, or serialization; it only adds a new way to populate the token precedence chain's last slot.

---

## File Structure

- `packages/core/src/sync/deviceLogin.ts` (**create**) — `GITHUB_DEVICE_CODE_URL`, `GITHUB_ACCESS_TOKEN_URL` constants; `DeviceCodeResult` type; `DeviceFlowFetch` type; `DeviceFlowDeniedError`, `DeviceFlowExpiredError` error classes; `requestDeviceCode()`; `pollDeviceToken()`.
- `packages/core/src/sync/deviceLogin.test.ts` (**create**) — unit tests for both functions with an injected fake `fetch` and a no-op injected `sleep` (no real network, no real waiting).
- `packages/core/src/sync/index.ts` (**modify**) — add `export * from "./deviceLogin";` to the existing barrel (`auth`, `registry`, etc. are already exported here).
- `packages/core/src/sync/auth.ts` (**modify**) — add `saveGitHubToken(token, opts)`, the write-side counterpart of the existing `resolveGitHubToken()`.
- `packages/core/src/sync/auth.test.ts` (**modify**) — add round-trip tests: save then `resolveGitHubToken()` reads it back; save preserves pre-existing unrelated keys in `config.json`.
- `packages/cli/src/commands/sync.ts` (**modify**) — add the `login` subcommand (`--client-id <id>` flag), extend `SyncFlags`/`SyncDeps` with `clientId` and injectable `requestDeviceCode`/`pollDeviceToken`, and touch up the `--token` option description to mention `sync login`.
- `packages/cli/src/commands/sync.test.ts` (**modify**) — add CLI-level tests: happy path (prints instructions, saves token, a subsequent `resolveGitHubToken()` call against the same `--data-dir` returns it), denied-authorization surfaces the core error message, expired-device-code surfaces the core error message.
- `packages/cli/src/__integration__/cli.integration.test.ts` (**modify**) — extend the existing `sync --help` assertion to also match `login` (no live network call in this file; GitHub's real device endpoints are never hit by the test suite).

---

## Task 1: Core — `requestDeviceCode()` (device+user code request)

**Files:**
- Create: `packages/core/src/sync/deviceLogin.ts`
- Create: `packages/core/src/sync/deviceLogin.test.ts`
- Modify: `packages/core/src/sync/index.ts`

**Interfaces:**
- Consumes: `GITHUB_CLIENT_ID` (`packages/core/src/sync/auth.ts:7`, already exported).
- Produces: `interface DeviceCodeResult { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; expiresInSeconds: number; intervalSeconds: number }`; `type DeviceFlowFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<any> }>`; `function requestDeviceCode(opts?: { clientId?: string; scope?: string; fetch?: DeviceFlowFetch }): Promise<DeviceCodeResult>` — consumed by Task 4's CLI action.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/deviceLogin.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { requestDeviceCode, GITHUB_DEVICE_CODE_URL, type DeviceFlowFetch } from "./deviceLogin";
import { GITHUB_CLIENT_ID } from "./auth";

function fakeFetch(sequence: any[]): DeviceFlowFetch {
  let i = 0;
  return async () => ({ json: async () => sequence[Math.min(i++, sequence.length - 1)] });
}

describe("requestDeviceCode", () => {
  it("posts to GitHub's device-code endpoint with the default client id and repo scope", async () => {
    let seenUrl = "";
    let seenBody = "";
    const fetch: DeviceFlowFetch = async (url, init) => {
      seenUrl = url;
      seenBody = init.body;
      return {
        json: async () => ({
          device_code: "d-123",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=ABCD-1234",
          expires_in: 900,
          interval: 5,
        }),
      };
    };

    const result = await requestDeviceCode({ fetch });

    expect(seenUrl).toBe(GITHUB_DEVICE_CODE_URL);
    expect(JSON.parse(seenBody)).toEqual({ client_id: GITHUB_CLIENT_ID, scope: "repo" });
    expect(result).toEqual({
      deviceCode: "d-123",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=ABCD-1234",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    });
  });

  it("honors a custom clientId and scope", async () => {
    let seenBody = "";
    const fetch: DeviceFlowFetch = async (_url, init) => {
      seenBody = init.body;
      return { json: async () => ({ device_code: "d", user_code: "u", verification_uri: "v", expires_in: 1, interval: 1 }) };
    };
    await requestDeviceCode({ fetch, clientId: "custom-id", scope: "repo,read:user" });
    expect(JSON.parse(seenBody)).toEqual({ client_id: "custom-id", scope: "repo,read:user" });
  });

  it("throws with GitHub's error_description when the device-code request itself fails", async () => {
    const fetch = fakeFetch([{ error: "unauthorized_client", error_description: "the client id is not valid" }]);
    await expect(requestDeviceCode({ fetch })).rejects.toThrow("the client id is not valid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/deviceLogin.test.ts`
Expected: FAIL — cannot find module `./deviceLogin`.

- [ ] **Step 3: Create `packages/core/src/sync/deviceLogin.ts`**

```ts
import { GITHUB_CLIENT_ID } from "./auth";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const DEFAULT_DEVICE_SCOPE = "repo";

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** The exact subset of `fetch` used by the device flow: a JSON-body POST that
 *  resolves to something with an async `.json()`. Injectable so tests never
 *  reach github.com. */
export type DeviceFlowFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ json(): Promise<any> }>;

const defaultFetch: DeviceFlowFetch = (url, init) => (globalThis.fetch as any)(url, init);

export class DeviceFlowDeniedError extends Error {
  constructor(message = "GitHub authorization was denied. Run `portiq sync login` again to retry.") {
    super(message);
    this.name = "DeviceFlowDeniedError";
  }
}

export class DeviceFlowExpiredError extends Error {
  constructor(message = "The device code expired before authorization completed. Run `portiq sync login` again.") {
    super(message);
    this.name = "DeviceFlowExpiredError";
  }
}

export interface RequestDeviceCodeOptions {
  clientId?: string;
  scope?: string;
  fetch?: DeviceFlowFetch;
}

/** Step 1 of RFC 8628: ask GitHub for a device_code + user_code pair. */
export async function requestDeviceCode(opts: RequestDeviceCodeOptions = {}): Promise<DeviceCodeResult> {
  const fetchFn = opts.fetch ?? defaultFetch;
  const clientId = opts.clientId ?? GITHUB_CLIENT_ID;
  const scope = opts.scope ?? DEFAULT_DEVICE_SCOPE;

  const res = await fetchFn(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresInSeconds: data.expires_in,
    intervalSeconds: data.interval,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/deviceLogin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the barrel export in `packages/core/src/sync/index.ts`**

```ts
export * from "./constants";
export * from "./secrets";
export * from "./serialize";
export * from "./deserialize";
export * from "./types";
export * from "./registry";
export * from "./localRemote";
export * from "./githubRemote";
export * from "./engine";
export * from "./auth";
export * from "./deviceLogin";
```

Run: `npm test -- packages/core/src/sync/` — Expected: PASS (all sync-package tests, no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/deviceLogin.ts packages/core/src/sync/deviceLogin.test.ts packages/core/src/sync/index.ts
git commit -m "$(cat <<'EOF'
feat(core): request GitHub OAuth device code for headless sync login

Adds requestDeviceCode(), the first step of RFC 8628's device
authorization flow, with an injectable fetch so tests never reach
github.com. Re-exported from @portiq/core/sync.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Core — `pollDeviceToken()` (interval / slow_down / expiry / denial)

**Files:**
- Modify: `packages/core/src/sync/deviceLogin.ts`
- Modify: `packages/core/src/sync/deviceLogin.test.ts`

**Interfaces:**
- Consumes: `DeviceCodeResult`, `DeviceFlowFetch`, `DeviceFlowDeniedError`, `DeviceFlowExpiredError`, `GITHUB_ACCESS_TOKEN_URL`, `GITHUB_CLIENT_ID` (all Task 1).
- Produces: `interface PollDeviceTokenOptions { clientId?: string; fetch?: DeviceFlowFetch; sleep?: (ms: number) => Promise<void> }`; `function pollDeviceToken(device: DeviceCodeResult, opts?: PollDeviceTokenOptions): Promise<string>` — consumed by Task 4's CLI action.

- [ ] **Step 1: Add failing tests to `packages/core/src/sync/deviceLogin.test.ts`**

Append:

```ts
import { pollDeviceToken, DeviceFlowDeniedError, DeviceFlowExpiredError, GITHUB_ACCESS_TOKEN_URL } from "./deviceLogin";

function sequencedFetch(responses: any[]): { fetch: DeviceFlowFetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetch: DeviceFlowFetch = async (url, init) => {
    calls.push(url);
    void init;
    const data = responses[Math.min(i, responses.length - 1)];
    i++;
    return { json: async () => data };
  };
  return { fetch, calls };
}

const device = {
  deviceCode: "d-123",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresInSeconds: 900,
  intervalSeconds: 5,
};

describe("pollDeviceToken", () => {
  it("returns the access token once GitHub reports success", async () => {
    const { fetch, calls } = sequencedFetch([{ access_token: "gho_abc", token_type: "bearer", scope: "repo" }]);
    const sleeps: number[] = [];
    const token = await pollDeviceToken(device, { fetch, sleep: async (ms) => { sleeps.push(ms); } });
    expect(token).toBe("gho_abc");
    expect(calls).toEqual([GITHUB_ACCESS_TOKEN_URL]);
    expect(sleeps).toEqual([5000]);
  });

  it("keeps polling at the same interval on authorization_pending", async () => {
    const { fetch, calls } = sequencedFetch([
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { access_token: "gho_abc" },
    ]);
    const sleeps: number[] = [];
    const token = await pollDeviceToken(device, { fetch, sleep: async (ms) => { sleeps.push(ms); } });
    expect(token).toBe("gho_abc");
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([5000, 5000, 5000]);
  });

  it("grows the interval by 5s on slow_down and keeps using the new interval", async () => {
    const { fetch } = sequencedFetch([
      { error: "slow_down" },
      { error: "authorization_pending" },
      { access_token: "gho_abc" },
    ]);
    const sleeps: number[] = [];
    const token = await pollDeviceToken(device, { fetch, sleep: async (ms) => { sleeps.push(ms); } });
    expect(token).toBe("gho_abc");
    expect(sleeps).toEqual([5000, 10000, 10000]);
  });

  it("throws DeviceFlowDeniedError on access_denied", async () => {
    const { fetch } = sequencedFetch([{ error: "access_denied" }]);
    await expect(pollDeviceToken(device, { fetch, sleep: async () => {} })).rejects.toThrow(DeviceFlowDeniedError);
  });

  it("throws DeviceFlowExpiredError on expired_token", async () => {
    const { fetch } = sequencedFetch([{ error: "expired_token" }]);
    await expect(pollDeviceToken(device, { fetch, sleep: async () => {} })).rejects.toThrow(DeviceFlowExpiredError);
  });

  it("throws a generic error with GitHub's description for any other error", async () => {
    const { fetch } = sequencedFetch([{ error: "server_error", error_description: "GitHub had a hiccup" }]);
    await expect(pollDeviceToken(device, { fetch, sleep: async () => {} })).rejects.toThrow("GitHub had a hiccup");
  });

  it("defaults clientId to GITHUB_CLIENT_ID and sends the device_code/grant_type in the polling request body", async () => {
    let seenBody = "";
    const fetch: DeviceFlowFetch = async (_url, init) => {
      seenBody = init.body;
      return { json: async () => ({ access_token: "gho_abc" }) };
    };
    await pollDeviceToken(device, { fetch, sleep: async () => {} });
    const parsed = JSON.parse(seenBody);
    expect(parsed.client_id).toBe(GITHUB_CLIENT_ID);
    expect(parsed.device_code).toBe("d-123");
    expect(parsed.grant_type).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/deviceLogin.test.ts`
Expected: FAIL — `pollDeviceToken` is not exported.

- [ ] **Step 3: Add `pollDeviceToken()` to `packages/core/src/sync/deviceLogin.ts`**

Append:

```ts
export interface PollDeviceTokenOptions {
  clientId?: string;
  fetch?: DeviceFlowFetch;
  /** Injectable so tests resolve instantly instead of waiting real seconds. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Step 2 of RFC 8628: poll the token endpoint every `interval` seconds until
 *  the user authorizes (or the device code is denied/expires). Mirrors the
 *  desktop app's polling shape (src/services/githubAuth.ts:35-70) but runs to
 *  completion headlessly instead of resolving a Promise from a setTimeout chain. */
export async function pollDeviceToken(device: DeviceCodeResult, opts: PollDeviceTokenOptions = {}): Promise<string> {
  const fetchFn = opts.fetch ?? defaultFetch;
  const sleep = opts.sleep ?? defaultSleep;
  const clientId = opts.clientId ?? GITHUB_CLIENT_ID;
  let intervalMs = device.intervalSeconds * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(intervalMs);

    const res = await fetchFn(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await res.json();

    if (data.access_token) return data.access_token as string;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (data.error === "access_denied") throw new DeviceFlowDeniedError();
    if (data.error === "expired_token") throw new DeviceFlowExpiredError();
    throw new Error(data.error_description || data.error || "Unknown error polling for a device token.");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/deviceLogin.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Lint**

Run: `npm run lint` — Expected: no new errors under `packages/core/src/sync`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/deviceLogin.ts packages/core/src/sync/deviceLogin.test.ts
git commit -m "$(cat <<'EOF'
feat(core): poll GitHub's device-flow token endpoint

Adds pollDeviceToken(), the second step of RFC 8628: polls on the
device's interval, grows the interval 5s on slow_down, and throws
typed DeviceFlowDeniedError/DeviceFlowExpiredError on access_denied/
expired_token. fetch and sleep are both injectable for deterministic,
network-free tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Core — `saveGitHubToken()` (persist to `config.json`)

**Files:**
- Modify: `packages/core/src/sync/auth.ts`
- Modify: `packages/core/src/sync/auth.test.ts`

**Interfaces:**
- Consumes: `resolveDataDir`, `ResolveDataDirOptions` (`packages/core/src/store/dataDir.ts`, already imported by `auth.ts`).
- Produces: `function saveGitHubToken(token: string, opts?: ResolveDataDirOptions): string` (returns the absolute `config.json` path written) — consumed by Task 4's CLI action.

- [ ] **Step 1: Add failing tests to `packages/core/src/sync/auth.test.ts`**

Append:

```ts
import { resolveGitHubToken, saveGitHubToken, GITHUB_CLIENT_ID } from "./auth";
import { readFileSync } from "node:fs";

describe("saveGitHubToken", () => {
  it("writes githubToken to <dataDir>/config.json and returns the path", () => {
    const dir = tempDir();
    const path = saveGitHubToken("gho_new", { dataDir: dir });
    expect(path).toBe(join(dir, "config.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ githubToken: "gho_new" });
  });

  it("round-trips through resolveGitHubToken with no other precedence set", () => {
    const dir = tempDir();
    saveGitHubToken("gho_roundtrip", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_roundtrip");
  });

  it("preserves unrelated existing keys in config.json", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ someOtherSetting: true }));
    saveGitHubToken("gho_merged", { dataDir: dir });
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual({
      someOtherSetting: true,
      githubToken: "gho_merged",
    });
  });

  it("overwrites a previously saved token", () => {
    const dir = tempDir();
    saveGitHubToken("gho_old", { dataDir: dir });
    saveGitHubToken("gho_new", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_new");
  });

  it("trims whitespace before saving", () => {
    const dir = tempDir();
    saveGitHubToken("  gho_padded  ", { dataDir: dir });
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_padded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: FAIL — `saveGitHubToken` is not exported.

- [ ] **Step 3: Add `saveGitHubToken()` to `packages/core/src/sync/auth.ts`**

Replace the file's imports and append the function:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir, type ResolveDataDirOptions } from "../store/dataDir";
```

Append at the end of the file:

```ts
/**
 * Write-side counterpart of resolveGitHubToken()'s config.json read. Read-
 * merge-write so any other keys already in config.json survive (mirrors
 * ../ai/configStore.ts's saveAiConfig() merge behavior, just for a plain
 * JSON file instead of the kv store — resolveGitHubToken() only ever reads
 * config.json, never the kv store, so this stays a plain file write).
 * Returns the absolute config.json path that was written, for CLI messaging.
 */
export function saveGitHubToken(token: string, opts: ResolveDataDirOptions = {}): string {
  const configPath = join(resolveDataDir(opts), "config.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch {
      // malformed config.json — overwrite rather than fail the login.
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ ...existing, githubToken: token.trim() }, null, 2) + "\n", "utf8");
  return configPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/core/src/sync/auth.test.ts`
Expected: PASS (10 tests total: 4 existing + 1 existing GITHUB_CLIENT_ID check + 5 new).

- [ ] **Step 5: Run the full core sync suite and lint**

Run: `npm test -- packages/core/src/sync/`
Expected: PASS, no regressions.
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/auth.ts packages/core/src/sync/auth.test.ts
git commit -m "$(cat <<'EOF'
feat(core): persist GitHub tokens to config.json for headless login

Adds saveGitHubToken(), the write-side counterpart of the existing
resolveGitHubToken() read. Read-merge-writes <dataDir>/config.json so
unrelated keys survive, matching the merge pattern already used by
../ai/configStore.ts's saveAiConfig().

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: CLI — `portiq sync login` subcommand

**Files:**
- Modify: `packages/cli/src/commands/sync.ts`
- Modify: `packages/cli/src/commands/sync.test.ts`

**Interfaces:**
- Consumes: `requestDeviceCode`, `pollDeviceToken`, `saveGitHubToken`, `DeviceFlowDeniedError`, `DeviceFlowExpiredError`, `DeviceCodeResult`, `GITHUB_CLIENT_ID` (all from `@portiq/core/sync`, Tasks 1–3); existing `SyncModule`/`loadSync`/`parseSyncFlags`/`emit`/`CommandOutput` (`packages/cli/src/commands/sync.ts`).
- Produces: extends `SyncDeps` with `requestDeviceCode?: (args: { sync: SyncModule; clientId: string; scope: string }) => Promise<DeviceCodeResult>` and `pollDeviceToken?: (args: { sync: SyncModule; device: DeviceCodeResult; clientId: string }) => Promise<string>`; registers `portiq sync login [--client-id <id>]` on the `Command` returned by `syncCommand()`.

- [ ] **Step 1: Add failing tests to `packages/cli/src/commands/sync.test.ts`**

Append (needs `resolveGitHubToken` alongside the existing `openAppStateStore` import at the top — add `resolveGitHubToken` to the `import type { SyncRemote, ...}` line's neighboring value import, i.e. add a second import line `import { resolveGitHubToken } from "@portiq/core/sync";`):

```ts
import { resolveGitHubToken } from "@portiq/core/sync";

describe("sync login", () => {
  function fakeDevice() {
    return {
      deviceCode: "d-123",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=ABCD-1234",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    };
  }

  it("prints the verification URL and code, saves the token, and it's readable via resolveGitHubToken", async () => {
    const dir = tempDir();

    const { out } = await cli(["sync", "login", "--data-dir", dir, "--reporter", "json"], {
      requestDeviceCode: async () => fakeDevice(),
      pollDeviceToken: async () => "gho_faketoken",
    });

    expect(out).toMatch(/https:\/\/github\.com\/login\/device/);
    expect(out).toMatch(/ABCD-1234/);
    const parsed = JSON.parse(out.slice(out.indexOf("{")));
    expect(parsed.kind).toBe("message");
    expect(parsed.text).toMatch(/Logged in to GitHub/);

    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBe("gho_faketoken");
  });

  it("passes --client-id through to requestDeviceCode and pollDeviceToken", async () => {
    const dir = tempDir();
    const seenClientIds: string[] = [];

    await cli(["sync", "login", "--data-dir", dir, "--client-id", "custom-id", "--reporter", "json"], {
      requestDeviceCode: async ({ clientId }) => {
        seenClientIds.push(clientId);
        return fakeDevice();
      },
      pollDeviceToken: async ({ clientId }) => {
        seenClientIds.push(clientId);
        return "gho_faketoken";
      },
    });

    expect(seenClientIds).toEqual(["custom-id", "custom-id"]);
  });

  it("surfaces a denied authorization as an error without saving a token", async () => {
    const dir = tempDir();

    let caught: unknown;
    try {
      await cli(["sync", "login", "--data-dir", dir], {
        requestDeviceCode: async () => fakeDevice(),
        pollDeviceToken: async ({ sync }) => {
          throw new sync.DeviceFlowDeniedError();
        },
      });
    } catch (err) {
      caught = err;
    }

    expect((caught as Error)?.message).toMatch(/denied/i);
    expect(resolveGitHubToken({ env: {}, dataDir: dir })).toBeNull();
  });

  it("surfaces an expired device code as an error", async () => {
    const dir = tempDir();

    let caught: unknown;
    try {
      await cli(["sync", "login", "--data-dir", dir], {
        requestDeviceCode: async () => fakeDevice(),
        pollDeviceToken: async ({ sync }) => {
          throw new sync.DeviceFlowExpiredError();
        },
      });
    } catch (err) {
      caught = err;
    }

    expect((caught as Error)?.message).toMatch(/expired/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/cli/src/commands/sync.test.ts`
Expected: FAIL — `sync login` is an unknown command (commander error) / `SyncDeps` has no `requestDeviceCode`/`pollDeviceToken` fields (type error).

- [ ] **Step 3: Extend `SyncDeps`/`SyncFlags` and add the `login` subcommand in `packages/cli/src/commands/sync.ts`**

Change the type-only import line at the top:

```ts
import type { SyncRemote, DeviceCodeResult } from "@portiq/core/sync";
```

Change the `SyncDeps` interface:

```ts
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
```

Change `SyncFlags` and `parseSyncFlags`:

```ts
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
```

Update the `--token` option's description and add the `login` subcommand inside `syncCommand()`'s `register()`, after the `sync` parent command's options are declared and alongside the `push`/`pull`/`status` subcommands:

```ts
      const sync = program
        .command("sync")
        .description("sync your workspace with a git remote")
        .option("--token <token>", "GitHub token (else PORTIQ_GITHUB_TOKEN / GITHUB_TOKEN / config.json — see `sync login`)")
        .option("--local <dir>", "sync to a local git repo directory instead of GitHub");
```

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/cli/src/commands/sync.test.ts`
Expected: PASS (all existing + 4 new `sync login` tests).

- [ ] **Step 5: Run the full CLI suite, typecheck, and lint**

Run: `npm test -- packages/cli/`
Expected: PASS, no regressions.
Run: `npm run build:cli`
Expected: succeeds (confirms `DeviceCodeResult`/`requestDeviceCode`/`pollDeviceToken`/`saveGitHubToken`/`DeviceFlowDeniedError`/`DeviceFlowExpiredError` all resolve through the classic-resolution `paths` mapping to `@portiq/core/src/sync/index.ts`).
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/sync.ts packages/cli/src/commands/sync.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add `portiq sync login` device-code flow command

Wires requestDeviceCode/pollDeviceToken/saveGitHubToken (@portiq/core/
sync) into a new `portiq sync login [--client-id]` subcommand: prints
the verification URL/code, polls to completion, and persists the
token to config.json so push/pull/status pick it up through the
existing resolveGitHubToken() precedence with no other changes.
SyncDeps gains injectable requestDeviceCode/pollDeviceToken so tests
never reach github.com.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integration smoke + `--token` cross-reference

**Files:**
- Modify: `packages/cli/src/__integration__/cli.integration.test.ts`

**Interfaces:**
- Consumes: the built `portiq` binary's `sync --help` output (Task 4).
- Produces: no new exports; extends existing integration coverage only.

- [ ] **Step 1: Extend the failing assertion in `packages/cli/src/__integration__/cli.integration.test.ts`**

Change:

```ts
  it("sync --help exits 0 and lists the push/pull/status subcommands", async () => {
    const { code, stdout } = await cli(["sync", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/push/);
    expect(stdout).toMatch(/pull/);
    expect(stdout).toMatch(/status/);
  });
```

to:

```ts
  it("sync --help exits 0 and lists the push/pull/status/login subcommands", async () => {
    const { code, stdout } = await cli(["sync", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/push/);
    expect(stdout).toMatch(/pull/);
    expect(stdout).toMatch(/status/);
    expect(stdout).toMatch(/login/);
  });
```

- [ ] **Step 2: Run test to verify it passes**

This step is a coverage extension, not new production code — `login` was already registered on the `sync` command in Task 4 (already committed), so there is no red state to force here; the assertion is a regression guard confirming that registration reaches the real, freshly-built, freshly-spawned binary.

Run: `npm run build:cli && npm test -- packages/cli/src/__integration__/cli.integration.test.ts`
Expected: PASS (all integration tests, including the extended `login` assertion). If this fails with `stdout` not matching `/login/`, `dist/index.js` is stale — re-run `npm run build:cli` and retry before treating it as a real regression.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS (full suite green, no regressions in core/cli/mcp).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/__integration__/cli.integration.test.ts
git commit -m "$(cat <<'EOF'
test(cli): cover `sync login` in the built-binary integration smoke

Extends the existing sync --help integration assertion to also match
`login`, proving the new subcommand is registered in the real,
freshly-spawned CLI binary (not just under vitest/Bundler resolution).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage.** Device-code request ✔ (Task 1), print verification URL + user code ✔ (Task 4), poll honoring `interval`/`slow_down` ✔ (Task 2), handle `expired_token`/`access_denied` ✔ (Task 2, surfaced in Task 4), persist token via core's config store so push/pull/status pick it up unchanged ✔ (Task 3, proven via `resolveGitHubToken()` round-trip in Tasks 3 and 4), headless-friendly and injectable (no test hits github.com — `fetch`/`sleep` injected in core tests, `requestDeviceCode`/`pollDeviceToken` injected in CLI tests) ✔, `--client-id` flag with a documented default (`GITHUB_CLIENT_ID`) ✔ (Task 4), note on unencrypted storage ✔ (Global Constraints subsystem section + Self-Review below).
- **No placeholders.** Every step shows real, complete code (no "TBD", no "similar to Task N"); every type referenced (`DeviceCodeResult`, `DeviceFlowFetch`, `SyncModule`, `SyncDeps`, `CommandOutput`, `ResolveDataDirOptions`) is either defined in this plan's own tasks or already exists in the cited file/line.
- **Type consistency.** `requestDeviceCode`/`pollDeviceToken`/`saveGitHubToken`/`DeviceFlowDeniedError`/`DeviceFlowExpiredError` are all exported from `packages/core/src/sync/deviceLogin.ts` and `auth.ts` and re-exported by the existing `packages/core/src/sync/index.ts` barrel (Task 1, Step 5) — the same barrel already consumed by `packages/cli/src/commands/sync.ts` via the pre-existing `@portiq/core/sync` classic-resolution `paths` mapping (`packages/cli/tsconfig.build.json`, unchanged by this plan). `SyncDeps`'s new fields use the same `{ sync, ... }`-object-argument convention as the existing `remoteFactory`, so CLI tests inject fakes without importing `@portiq/core/sync` types directly (they read error classes off the injected `sync` param, exactly as `remoteFactory` tests already do).
- **Unencrypted token storage (carried caveat, not re-solved here).** `config.json`'s `githubToken` is plaintext on disk, same as `ai.json`'s provider API keys — see `docs/superpowers/plans/2026-07-24-phase3-parity-ai-assist.md`'s "Plaintext keys" open question, which already flagged this tradeoff and marked an encrypted-at-rest keystore as future, out-of-scope work. This plan does not introduce a new risk class; it adds a second writer (`saveGitHubToken`) to a file that was already an accepted plaintext-secret store by design (`resolveGitHubToken`'s precedence already treats `config.json` as the lowest-priority, most-persistent tier, with `--token`/env vars as the higher-priority, non-persisted escape hatches for CI/shared machines).
- **No engine/remote/serialization changes.** This plan touches zero files from the git-sync track's `engine.ts`/`githubRemote.ts`/`localRemote.ts`/`registry.ts`/`serialize.ts`/`deserialize.ts`/`secrets.ts`/`types.ts` — `push`/`pull`/`status` behavior is provably unchanged (Task 4's CLI tests reuse the same `remoteFactory`-fake pattern from the pre-existing test suite for those commands, untouched).
