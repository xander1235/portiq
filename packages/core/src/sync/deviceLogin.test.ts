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
