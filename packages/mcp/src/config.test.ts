import { describe, it, expect } from "vitest";
import { parseServerConfig } from "./config";

describe("parseServerConfig", () => {
  it("defaults to writes disabled and no explicit dataDir", () => {
    const c = parseServerConfig([], {});
    expect(c.allowWrites).toBe(false);
    expect(c.dataDir).toBeUndefined();
    expect(c.appVersion).toBe("0.1.0");
  });

  it("enables writes via --allow-writes flag", () => {
    expect(parseServerConfig(["--allow-writes"], {}).allowWrites).toBe(true);
  });

  it("enables writes via PORTIQ_MCP_ALLOW_WRITES=1", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "1" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "true" }).allowWrites).toBe(true);
    expect(parseServerConfig([], { PORTIQ_MCP_ALLOW_WRITES: "0" }).allowWrites).toBe(false);
  });

  it("reads --data-dir in both spaced and = forms", () => {
    expect(parseServerConfig(["--data-dir", "/tmp/a"], {}).dataDir).toBe("/tmp/a");
    expect(parseServerConfig(["--data-dir=/tmp/b"], {}).dataDir).toBe("/tmp/b");
  });

  it("honors PORTIQ_MCP_APP_VERSION override", () => {
    expect(parseServerConfig([], { PORTIQ_MCP_APP_VERSION: "9.9.9" }).appVersion).toBe("9.9.9");
  });
});
