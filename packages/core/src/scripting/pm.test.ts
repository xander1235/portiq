import { describe, it, expect } from "vitest";
import { runScript, type PmContext } from "./pm";
import { summarizeTests } from "./testRunner";

function ctx(overrides: Partial<PmContext> = {}): PmContext {
  const env: Record<string, string> = { baseUrl: "https://x" };
  return {
    request: { method: "GET", url: "https://x" },
    response: { status: 200, statusText: "OK", duration: 1, headers: {}, body: '{"ok":true}', json: { ok: true }, error: null, size: 10 },
    env,
    setEnvVar: (k, v) => { env[k] = v; },
    sendRequest: async () => ({ status: 200 }),
    ...overrides,
  };
}

describe("pm sandbox", () => {
  it("records a passing test via pm.test + pm.expect", async () => {
    const entries = await runScript(
      `pm.test("status is 200", () => { pm.expect(pm.response.code).to.equal(200); });`,
      ctx()
    );
    const summary = summarizeTests(entries);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("records a failing assertion without throwing", async () => {
    const entries = await runScript(
      `pm.test("bad", () => { pm.expect(pm.response.code).to.equal(500); });`,
      ctx()
    );
    expect(summarizeTests(entries).failed).toBe(1);
  });

  it("writes environment variables through the injected setter", async () => {
    const env: Record<string, string> = {};
    await runScript(`pm.environment.set("token", "xyz");`, ctx({ env, setEnvVar: (k, v) => { env[k] = v; } }));
    expect(env.token).toBe("xyz");
  });
});
