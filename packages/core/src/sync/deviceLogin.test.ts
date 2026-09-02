import { describe, it, expect } from "vitest";
import {
  requestDeviceCode,
  pollDeviceToken,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
  type DeviceFlowFetch,
} from "./deviceLogin";
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

  it("stops polling once the device code's lifetime has elapsed", async () => {
    const { fetch } = sequencedFetch([{ error: "authorization_pending" }]);
    await expect(
      pollDeviceToken({ ...device, expiresInSeconds: 0 }, { fetch, sleep: async () => {} })
    ).rejects.toThrow(DeviceFlowExpiredError);
  });
});
