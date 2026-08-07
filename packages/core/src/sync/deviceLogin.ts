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
  const deadlineMs = Math.max(device.expiresInSeconds * 1000, 1);
  const startedAt = Date.now();

  while (true) {
    // RFC 8628: stop polling once the device code's lifetime has elapsed.
    if (Date.now() - startedAt >= deadlineMs) throw new DeviceFlowExpiredError();
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
